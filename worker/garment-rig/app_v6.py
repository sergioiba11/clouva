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
EXPORT_UNREAL_SCRIPT_PATH = Path(__file__).with_name("export_unreal.py")


class UnrealObjectExportRequest(BaseModel):
    source_url: HttpUrl
    asset_name: str = "clouva-object.glb"


def safe_name(value: str) -> str:
    stem = Path(value).stem
    cleaned = "".join(character if character.isalnum() or character in "-_" else "-" for character in stem)
    return cleaned.strip("-")[:70] or "clouva-object"


@app.post("/export/unreal-object")
def export_object_for_unreal(request: UnrealObjectExportRequest):
    if not EXPORT_UNREAL_SCRIPT_PATH.exists():
        raise HTTPException(status_code=500, detail="Falta export_unreal.py en el Blender Worker")

    job_dir = Path(tempfile.mkdtemp(prefix="clouva-unreal-object-"))
    input_path = job_dir / "object.glb"
    output_path = job_dir / "object-unreal.fbx"

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
            "180",
            "object",
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
            raise RuntimeError(details or result.stderr[-1000:] or "Blender no pudo generar el FBX del objeto")

        filename = f"{safe_name(request.asset_name)}-unreal.fbx"
        return FileResponse(
            output_path,
            media_type="application/octet-stream",
            filename=filename,
            background=BackgroundTask(shutil.rmtree, job_dir, True),
            headers={
                "X-Clouva-Target": "unreal-object",
                "X-Clouva-Scale": "preserved",
                "X-Clouva-Rig-Preserved": "true",
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
