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
EXPORT_UNREAL_SCRIPT_PATH = Path(__file__).with_name("export_unreal_clean.py")
UNREAL_HEIGHT_TOLERANCE_CM = 2.0


class ValidatedUnrealExportRequest(BaseModel):
    avatar_id: str | None = None
    user_id: str | None = None
    source_url: HttpUrl
    target_height_cm: float = 175.0


@app.post("/export/unreal-v2")
def export_avatar_for_unreal_v2(request: ValidatedUnrealExportRequest):
    if not EXPORT_UNREAL_SCRIPT_PATH.exists():
        raise HTTPException(
            status_code=500,
            detail="Falta export_unreal_clean.py en el Blender Worker",
        )

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
        if (
            result.returncode != 0
            or not output_path.exists()
            or output_path.stat().st_size < 1024
        ):
            details = base.base.extract_validation_error(
                {"stdout": result.stdout, "stderr": result.stderr}
            )
            raise RuntimeError(
                details
                or result.stderr[-1500:]
                or "Blender no pudo generar el FBX validado"
            )
        if not metadata_path.exists():
            raise RuntimeError("Blender no generó metadata de validación")

        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        final_height_cm = float(
            metadata.get("finalMeshHeightCm", metadata.get("heightCm", 0.0))
        )
        roundtrip_height_cm = float(
            metadata.get("fbxRoundTripHeightCm", 0.0)
        )
        physically_valid = bool(
            metadata.get("readyForUnreal")
            and metadata.get("fbxRoundTripValidated")
            and abs(final_height_cm - request.target_height_cm)
            <= UNREAL_HEIGHT_TOLERANCE_CM
            and abs(roundtrip_height_cm - request.target_height_cm)
            <= UNREAL_HEIGHT_TOLERANCE_CM
            and metadata.get("fbxGlobalScale") == 1.0
            and metadata.get("fbxApplyUnitScale") is True
            and metadata.get("fbxApplyScaleOptions") == "FBX_SCALE_UNITS"
            and metadata.get("fbxDeclaredUnitScaleCm") == 100.0
        )
        if not physically_valid:
            raise RuntimeError(
                f"La validación física para Unreal fue rechazada: {metadata}"
            )

        suffix = (request.avatar_id or "activo")[:8]
        compact_metadata = json.dumps(metadata, separators=(",", ":"))
        return FileResponse(
            output_path,
            media_type="application/octet-stream",
            filename=f"clouva-avatar-{suffix}-unreal.fbx",
            background=BackgroundTask(shutil.rmtree, job_dir, True),
            headers={
                "X-Clouva-Target": "unreal",
                "X-Clouva-Height-Cm": str(final_height_cm),
                "X-Clouva-Roundtrip-Height-Cm": str(roundtrip_height_cm),
                "X-Clouva-Ready": "true",
                "X-Clouva-Import-Uniform-Scale": "1.0",
                "X-Clouva-Metadata": compact_metadata,
                "X-Clouva-Exporter": "metric-meters-fbx-units-v3",
            },
        )
    except HTTPException:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise
    except subprocess.TimeoutExpired as exc:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(
            status_code=504,
            detail="Blender agotó el tiempo al exportar para Unreal",
        ) from exc
    except Exception as exc:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(
            status_code=422,
            detail=f"No se pudo exportar para Unreal: {exc}",
        ) from exc
