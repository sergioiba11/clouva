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
UNREAL_MOLD_RIG_VERSION = "v1-unreal-snapshot-mold"


def _complete_rig_failure(stdout: str | None, stderr: str | None) -> str:
    """Extract the real Blender error without ever replacing it with a parser error."""
    try:
        technical = extract_blender_failure(stdout, stderr)
    except Exception as parser_error:
        print(f"[complete-avatar-rig] error parser failed: {parser_error}", flush=True)
        technical = None

    if technical:
        return technical

    stderr_text = str(stderr or "").strip()
    stdout_text = str(stdout or "").strip()
    fallback = stderr_text or stdout_text
    if fallback:
        return fallback[-1800:]
    return "Blender no pudo completar el rig del avatar"


class CompleteAvatarRigRequest(BaseModel):
    source_url: HttpUrl
    require_fingers: bool = True
    require_ears: bool = True
    finger_segments: int = 3


class RigWithUnrealMoldRequest(BaseModel):
    avatar_url: HttpUrl
    garment_url: HttpUrl
    category: str
    art_url: HttpUrl | None = None
    color: str | None = None
    unreal_snapshot: dict
    attempt_id: str | None = None


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
            raise RuntimeError(_complete_rig_failure(result.stdout, result.stderr))
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
                "X-Clouva-Rig-Run-Id": str(profile.get("runId") or ""),
                "X-Clouva-Rig-Duration-Ms": str(profile.get("durationMs") or 0),
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


@app.post("/rig-with-unreal-mold")
def rig_with_unreal_mold(request: RigWithUnrealMoldRequest):
    if not request.unreal_snapshot:
        raise HTTPException(status_code=400, detail="Falta el snapshot corporal devuelto por Unreal")

    category_raw = request.category.strip().lower()
    category = legacy.CATEGORY_MAP.get(category_raw, category_raw)
    if category not in legacy.VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail="Categoría de prenda inválida")

    job_dir = Path(tempfile.mkdtemp(prefix="clouva-unreal-mold-rig-"))
    avatar_path = job_dir / "avatar-complete-rigged.glb"
    garment_path = job_dir / "garment-original.glb"
    output_path = job_dir / "garment-rigged.glb"
    art_path = job_dir / "art.png"

    try:
        legacy.download(str(request.avatar_url), avatar_path)
        legacy.download(str(request.garment_url), garment_path)
        resolved_art_path = None
        if request.art_url:
            legacy.download(str(request.art_url), art_path)
            resolved_art_path = art_path

        preview_settings = {
            "attemptId": request.attempt_id,
            "forceFreshSource": True,
            "cleanScene": True,
            "moldSource": "unreal-avatar-snapshot",
            "unrealSnapshot": request.unreal_snapshot,
        }
        legacy.run_blender_job(
            f"unreal-mold-{request.attempt_id or 'sync'}",
            job_dir,
            avatar_path,
            garment_path,
            output_path,
            category,
            resolved_art_path,
            request.color or "",
            preview_settings,
        )
        if not output_path.is_file() or output_path.stat().st_size < 1024:
            raise RuntimeError("Blender no generó un GLB riggeado válido usando el molde de Unreal")

        return FileResponse(
            output_path,
            media_type="model/gltf-binary",
            filename="clouva-garment-unreal-mold-rigged.glb",
            background=BackgroundTask(shutil.rmtree, job_dir, True),
            headers={
                "X-Clouva-Mold-Source": "unreal-avatar-snapshot",
                "X-Clouva-Mold-Version": UNREAL_MOLD_RIG_VERSION,
                "X-Clouva-Attempt-Id": request.attempt_id or "sync",
            },
        )
    except HTTPException:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise
    except Exception as exc:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(status_code=422, detail=f"No se pudo riggear el GLB con el molde de Unreal: {exc}") from exc


@app.get("/diagnostics/avatar-complete-rig")
def complete_avatar_rig_health():
    return {
        "ok": COMPLETE_AVATAR_RIG_SCRIPT.is_file(),
        "version": COMPLETE_AVATAR_RIG_VERSION,
        "fingers": {"chainsPerHand": 5, "segmentsPerFinger": 3},
        "ears": {"left": True, "right": True},
        "validationRequired": True,
        "unrealMoldRig": {
            "supported": True,
            "version": UNREAL_MOLD_RIG_VERSION,
            "endpoint": "/rig-with-unreal-mold",
        },
    }
