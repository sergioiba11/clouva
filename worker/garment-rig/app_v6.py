import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import app_v5 as base
import app_legacy as legacy
from fastapi import HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, HttpUrl
from starlette.background import BackgroundTask

app = base.app
CLEAN_EXPORT_SCRIPT_PATH = Path(__file__).with_name("export_unreal_clean.py")
EXPORT_UNREAL_SCRIPT_PATH = CLEAN_EXPORT_SCRIPT_PATH if CLEAN_EXPORT_SCRIPT_PATH.exists() else Path(__file__).with_name("export_unreal.py")


class UnrealObjectExportRequest(BaseModel):
    source_url: HttpUrl
    asset_name: str = "clouva-object.glb"
    category: str = "prop"
    target_height_cm: float = 175.0
    wearable: bool = False


def safe_name(value: str) -> str:
    stem = Path(value).stem
    cleaned = "".join(character if character.isalnum() or character in "-_" else "-" for character in stem)
    return cleaned.strip("-")[:70] or "clouva-object"


@app.post("/export/unreal-object")
def export_object_for_unreal(request: UnrealObjectExportRequest):
    if not EXPORT_UNREAL_SCRIPT_PATH.exists():
        raise HTTPException(status_code=500, detail="Falta el exportador Unreal en el Blender Worker")
    if request.target_height_cm < 80 or request.target_height_cm > 260:
        raise HTTPException(status_code=400, detail="target_height_cm debe estar entre 80 y 260")

    job_dir = Path(tempfile.mkdtemp(prefix="clouva-unreal-object-"))
    input_path = job_dir / "object.glb"
    output_path = job_dir / "object-unreal.fbx"
    metadata_path = job_dir / "object-unreal.json"

    try:
        legacy.download(str(request.source_url), input_path)
        command = [
            legacy.BLENDER_BIN,
            "--background",
            "--factory-startup",
            "--python-exit-code",
            "1",
            "--python",
            str(EXPORT_UNREAL_SCRIPT_PATH),
            "--",
            str(input_path),
            str(output_path),
            str(request.target_height_cm),
            "object",
            str(metadata_path),
            request.category,
            "wearable" if request.wearable else "rigid",
        ]
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=legacy.BLENDER_TIMEOUT_SECONDS,
            cwd=str(job_dir),
        )
        if result.returncode != 0 or not output_path.exists() or output_path.stat().st_size < 1024:
            details = base.extract_validation_error({"stdout": result.stdout, "stderr": result.stderr})
            raise RuntimeError(details or result.stderr[-1400:] or "Blender no pudo generar el FBX del objeto")
        if not metadata_path.exists():
            raise RuntimeError("Blender no generó metadata del objeto Unreal")

        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        if not metadata.get("readyForUnreal"):
            raise RuntimeError(f"La validación del objeto Unreal fue rechazada: {metadata}")

        filename = f"{safe_name(request.asset_name)}-unreal.fbx"
        calibrated = bool(metadata.get("calibratedToAvatar"))
        compact_metadata = json.dumps(metadata, separators=(",", ":"))
        return FileResponse(
            output_path,
            media_type="application/octet-stream",
            filename=filename,
            background=BackgroundTask(shutil.rmtree, job_dir, True),
            headers={
                "X-Clouva-Target": "unreal-object",
                "X-Clouva-Scale": "avatar-calibrated" if calibrated else "source-preserved",
                "X-Clouva-Rig-Preserved": "true",
                "X-Clouva-Metadata": compact_metadata,
                "X-Clouva-Exporter": "wearable-object-v1",
            },
        )
    except HTTPException:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise
    except subprocess.TimeoutExpired as exc:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(status_code=504, detail="Blender agotó el tiempo al exportar el objeto") from exc
    except Exception as exc:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(status_code=422, detail=f"No se pudo exportar el objeto para Unreal: {exc}") from exc
