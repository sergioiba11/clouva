import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import app_v6 as base
import app_legacy as legacy
from fastapi import HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, HttpUrl
from starlette.background import BackgroundTask

app = base.app
EXPORT_UNREAL_SCRIPT_PATH = Path(__file__).with_name("export_unreal.py")


class ValidatedUnrealExportRequest(BaseModel):
    avatar_id: str | None = None
    user_id: str | None = None
    source_url: HttpUrl
    target_height_cm: float = 175.0


@app.post("/export/unreal-v2")
def export_avatar_for_unreal_v2(request: ValidatedUnrealExportRequest):
    if not EXPORT_UNREAL_SCRIPT_PATH.exists():
        raise HTTPException(status_code=500, detail="Falta export_unreal.py en el Blender Worker")

    job_dir = Path(tempfile.mkdtemp(prefix="clouva-unreal-v2-"))
    input_path = job_dir / "avatar-rigged.glb"
    output_path = job_dir / "avatar-unreal.fbx"
    metadata_path = job_dir / "avatar-unreal.json"

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
            "avatar",
            str(metadata_path),
        ]
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=legacy.BLENDER_TIMEOUT_SECONDS,
            cwd=str(job_dir),
        )
        if result.returncode != 0 or not output_path.exists() or output_path.stat().st_size < 1024:
            details = base.base.extract_validation_error({"stdout": result.stdout, "stderr": result.stderr})
            raise RuntimeError(details or result.stderr[-1500:] or "Blender no pudo generar el FBX validado")
        if not metadata_path.exists():
            raise RuntimeError("Blender no generó metadata de validación")

        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        if not metadata.get("readyForUnreal"):
            raise RuntimeError(f"La validación Unreal fue rechazada: {metadata}")

        suffix = (request.avatar_id or "activo")[:8]
        compact_metadata = json.dumps(metadata, separators=(",", ":"))
        return FileResponse(
            output_path,
            media_type="application/octet-stream",
            filename=f"clouva-avatar-{suffix}-unreal.fbx",
            background=BackgroundTask(shutil.rmtree, job_dir, True),
            headers={
                "X-Clouva-Target": "unreal",
                "X-Clouva-Height-Cm": str(metadata.get("heightCm", request.target_height_cm)),
                "X-Clouva-Ready": "true",
                "X-Clouva-Metadata": compact_metadata,
            },
        )
    except HTTPException:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise
    except subprocess.TimeoutExpired as exc:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(status_code=504, detail="Blender agotó el tiempo al exportar para Unreal") from exc
    except Exception as exc:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(status_code=422, detail=f"No se pudo exportar para Unreal: {exc}") from exc
