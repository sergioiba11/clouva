import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import app_v14 as current
from fastapi import HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, HttpUrl
from starlette.background import BackgroundTask

app = current.app
base = current.base
legacy = current.legacy
WORKER_INSPECTOR_VERSION = current.WORKER_INSPECTOR_VERSION
INSPECT_SCRIPT_PATH = current.INSPECT_SCRIPT_PATH
RIG_ROUTE_VERSION = current.RIG_ROUTE_VERSION
GARMENT_SOURCE_ROUTING_VERSION = current.GARMENT_SOURCE_ROUTING_VERSION
UNREAL_EXPORT_VERSION = current.UNREAL_EXPORT_VERSION
EXPORT_UNREAL_SCRIPT_PATH = current.EXPORT_UNREAL_SCRIPT_PATH
extract_blender_failure = current.extract_blender_failure
user_facing_failure = current.user_facing_failure
MAX_CONCURRENT_BLENDER_JOBS = current.MAX_CONCURRENT_BLENDER_JOBS
BLENDER_SINGLE_FLIGHT_VERSION = current.BLENDER_SINGLE_FLIGHT_VERSION
RIG_DIAGNOSTICS_VERSION = current.RIG_DIAGNOSTICS_VERSION
CLEAN_ATTEMPT_VERSION = current.CLEAN_ATTEMPT_VERSION

COMPLETE_AVATAR_RIG_VERSION = "v1-fingers-ears"
COMPLETE_AVATAR_RIG_SCRIPT = Path(__file__).with_name("complete_avatar_rig.py")


class CompleteAvatarRigRequest(BaseModel):
    source_url: HttpUrl
    require_fingers: bool = True
    require_ears: bool = True
    finger_segments: int = 3


@app.post("/avatar/complete-rig")
def complete_avatar_rig(request: CompleteAvatarRigRequest):
    if not COMPLETE_AVATAR_RIG_SCRIPT.is_file():
        raise HTTPException(status_code=500, detail="Falta complete_avatar_rig.py en el Blender Worker")
    if request.finger_segments != 3:
        raise HTTPException(status_code=400, detail="CLOUVA usa tres segmentos por dedo")

    job_dir = Path(tempfile.mkdtemp(prefix="clouva-complete-avatar-rig-"))
    input_path = job_dir / "avatar-rig-base.glb"
    output_path = job_dir / "avatar-complete-rigged.glb"
    metadata_path = job_dir / "avatar-complete-rig.json"

    try:
        legacy.download(str(request.source_url), input_path)
        command = [
            legacy.BLENDER_BIN,
            "--background",
            "--factory-startup",
            "--python-exit-code",
            "1",
            "--python",
            str(COMPLETE_AVATAR_RIG_SCRIPT),
            "--",
            str(input_path),
            str(output_path),
            str(metadata_path),
        ]
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=legacy.BLENDER_TIMEOUT_SECONDS,
            cwd=str(job_dir),
        )
        if result.returncode != 0 or not output_path.is_file() or output_path.stat().st_size < 1024:
            details = extract_blender_failure({"stdout": result.stdout, "stderr": result.stderr})
            raise RuntimeError(details or result.stderr[-1800:] or "Blender no pudo completar el rig del avatar")
        if not metadata_path.is_file():
            raise RuntimeError("Blender no generó la validación del rig completo")

        profile = json.loads(metadata_path.read_text(encoding="utf-8"))
        valid = bool(
            profile.get("complete")
            and profile.get("fingers", {}).get("complete")
            and profile.get("ears", {}).get("complete")
        )
        if request.require_fingers and not profile.get("fingers", {}).get("complete"):
            valid = False
        if request.require_ears and not profile.get("ears", {}).get("complete"):
            valid = False
        if not valid:
            raise RuntimeError(f"El rig completo fue rechazado: {profile}")

        return FileResponse(
            output_path,
            media_type="model/gltf-binary",
            filename="clouva-complete-rigged.glb",
            background=BackgroundTask(shutil.rmtree, job_dir, True),
            headers={
                "X-Clouva-Rig-Profile": json.dumps(profile, separators=(",", ":")),
                "X-Clouva-Rig-Version": COMPLETE_AVATAR_RIG_VERSION,
                "X-Clouva-Fingers": "true",
                "X-Clouva-Ears": "true",
            },
        )
    except HTTPException:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise
    except subprocess.TimeoutExpired as exc:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(status_code=504, detail="Blender agotó el tiempo al completar el rig") from exc
    except Exception as exc:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(status_code=422, detail=f"No se pudo completar el rig del avatar: {exc}") from exc


@app.get("/diagnostics/avatar-complete-rig")
def complete_avatar_rig_health():
    return {
        "ok": COMPLETE_AVATAR_RIG_SCRIPT.is_file(),
        "version": COMPLETE_AVATAR_RIG_VERSION,
        "fingers": {"chainsPerHand": 5, "segmentsPerFinger": 3},
        "ears": {"left": True, "right": True},
        "validationRequired": True,
    }
