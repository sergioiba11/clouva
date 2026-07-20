import json
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path

import app_v7 as base
import app_legacy as legacy
from fastapi import HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, HttpUrl
from starlette.background import BackgroundTask


app = base.app
EXPORT_UNREAL_SCRIPT_PATH = base.EXPORT_UNREAL_SCRIPT_PATH
RIG_ROUTE_VERSION = "v8-diagnostic-sync"
UNREAL_EXPORT_VERSION = "v27-garment-volume-preserved"


# Replace the legacy synchronous /rig route. The previous endpoint discarded
# Blender's real validation error and always returned the same generic message.
# Also replace /export/unreal-v2 so garments no longer travel through the avatar
# normalisation branch.
app.router.routes[:] = [
    route
    for route in app.router.routes
    if not (
        getattr(route, "path", None) in {"/rig", "/export/unreal-v2"}
        and "POST" in (getattr(route, "methods", set()) or set())
    )
]


def pop_job(job_id: str) -> dict:
    with legacy.JOBS_LOCK:
        return dict(legacy.JOBS.pop(job_id, {}))


@app.post("/rig")
def rig_with_diagnostics(request: legacy.RigRequest):
    category_raw = request.category.strip().lower()
    category = legacy.CATEGORY_MAP.get(category_raw, category_raw)
    if category not in legacy.VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail="Invalid category")

    job_id = f"sync-{uuid.uuid4().hex}"
    job_dir = Path(tempfile.mkdtemp(prefix="clouva-rig-sync-"))
    avatar_path = job_dir / "avatar.glb"
    garment_path = job_dir / "garment.glb"
    output_path = job_dir / "rigged.glb"
    art_path = job_dir / "art.png"

    try:
        legacy.download(str(request.avatar_url), avatar_path)
        legacy.download(str(request.garment_url), garment_path)
        if request.art_url:
            legacy.download(str(request.art_url), art_path)

        # app_v5 wraps this function and stores the exact Blender exception in
        # the job snapshot when validation fails.
        legacy.run_blender_job(
            job_id,
            job_dir,
            avatar_path,
            garment_path,
            output_path,
            category,
            art_path if art_path.exists() else None,
            request.color or "",
            {},
        )
        snapshot = pop_job(job_id)

        if not output_path.exists() or output_path.stat().st_size < 1024:
            visible_error = str(snapshot.get("error") or "").strip()
            technical_error = str(snapshot.get("technicalError") or "").strip()
            detail = visible_error or technical_error or "Blender no pudo producir un GLB riggeado válido"
            raise HTTPException(status_code=422, detail=detail)

        return FileResponse(
            output_path,
            media_type="model/gltf-binary",
            filename="rigged.glb",
            background=BackgroundTask(legacy.cleanup, job_dir),
            headers={
                "X-Clouva-Rig-Route": RIG_ROUTE_VERSION,
                "X-Clouva-Rig-Category": category,
            },
        )
    except HTTPException:
        pop_job(job_id)
        legacy.cleanup(job_dir)
        raise
    except Exception as exc:
        pop_job(job_id)
        legacy.cleanup(job_dir)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class ValidatedUnrealExportRequestV27(BaseModel):
    avatar_id: str | None = None
    asset_id: str | None = None
    user_id: str | None = None
    source_url: HttpUrl
    target_height_cm: float = 175.0
    asset_type: str = "avatar"
    category: str = "prop"
    preserve_armature: bool = True
    preserve_skin_weights: bool = True


def extract_validation_error(stdout: str, stderr: str) -> str | None:
    try:
        helper = base.base.base.extract_validation_error
        return helper({"stdout": stdout, "stderr": stderr})
    except Exception:
        combined = "\n".join((stdout or "", stderr or ""))
        for line in reversed(combined.splitlines()):
            stripped = line.strip()
            if stripped.startswith("RuntimeError:"):
                return stripped
        return None


def dimensions_header(metadata: dict) -> str:
    values = metadata.get("fbxRoundTripDimensionsCm") or metadata.get("dimensionsCm") or []
    try:
        return "x".join(str(round(float(value), 3)) for value in values)
    except (TypeError, ValueError):
        return "unknown"


@app.post("/export/unreal-v2")
def export_for_unreal_v27(request: ValidatedUnrealExportRequestV27):
    if not EXPORT_UNREAL_SCRIPT_PATH.exists():
        raise HTTPException(status_code=500, detail="Falta export_unreal_clean.py en el Blender Worker")
    if request.target_height_cm < 80 or request.target_height_cm > 260:
        raise HTTPException(status_code=400, detail="target_height_cm debe estar entre 80 y 260")

    asset_type = str(request.asset_type or "avatar").strip().lower()
    is_garment = asset_type == "garment"
    category = legacy.CATEGORY_MAP.get(
        str(request.category or "prop").strip().lower(),
        str(request.category or "prop").strip().lower(),
    )
    if is_garment and category not in legacy.VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail="Categoría de prenda inválida")

    job_dir = Path(tempfile.mkdtemp(prefix="clouva-unreal-garment-" if is_garment else "clouva-unreal-v2-"))
    input_path = job_dir / ("garment-rigged.glb" if is_garment else "avatar-rigged.glb")
    output_path = job_dir / ("garment-unreal.fbx" if is_garment else "avatar-unreal.fbx")
    metadata_path = job_dir / ("garment-unreal.json" if is_garment else "avatar-unreal.json")

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
            "object" if is_garment else "avatar",
            str(metadata_path),
        ]
        if is_garment:
            command.extend([category, "wearable-preserve"])

        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=legacy.BLENDER_TIMEOUT_SECONDS,
            cwd=str(job_dir),
            env={**legacy.os.environ, "PYTHONUNBUFFERED": "1"},
        )
        if result.returncode != 0 or not output_path.exists() or output_path.stat().st_size < 1024:
            details = extract_validation_error(result.stdout, result.stderr)
            raise RuntimeError(
                details
                or result.stderr[-1800:]
                or "Blender no pudo generar el FBX validado"
            )
        if not metadata_path.exists():
            raise RuntimeError("Blender no generó metadata de validación")

        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        if is_garment:
            physically_valid = bool(
                metadata.get("readyForUnreal")
                and metadata.get("fbxRoundTripValidated")
                and metadata.get("fbxRoundTripDimensionsValidated")
                and metadata.get("garmentVolumeValid")
                and metadata.get("skeletal")
                and metadata.get("skinWeights")
                and metadata.get("sourceDimensionsPreserved")
                and metadata.get("fbxGlobalScale") == 1.0
                and metadata.get("fbxApplyUnitScale") is True
                and metadata.get("fbxApplyScaleOptions") == "FBX_SCALE_UNITS"
                and metadata.get("fbxDeclaredUnitScaleCm") == 100.0
            )
        else:
            final_height_cm = float(metadata.get("finalMeshHeightCm", metadata.get("heightCm", 0.0)))
            roundtrip_height_cm = float(metadata.get("fbxRoundTripHeightCm", 0.0))
            physically_valid = bool(
                metadata.get("readyForUnreal")
                and metadata.get("fbxRoundTripValidated")
                and abs(final_height_cm - request.target_height_cm) <= base.UNREAL_HEIGHT_TOLERANCE_CM
                and abs(roundtrip_height_cm - request.target_height_cm) <= base.UNREAL_HEIGHT_TOLERANCE_CM
                and metadata.get("fbxGlobalScale") == 1.0
                and metadata.get("fbxApplyUnitScale") is True
                and metadata.get("fbxApplyScaleOptions") == "FBX_SCALE_UNITS"
                and metadata.get("fbxDeclaredUnitScaleCm") == 100.0
            )

        if not physically_valid:
            raise RuntimeError(f"La validación física para Unreal fue rechazada: {metadata}")

        suffix = (request.asset_id or request.avatar_id or "activo")[:8]
        compact_metadata = json.dumps(metadata, separators=(",", ":"))
        filename = (
            f"clouva-{category}-{suffix}-unreal.fbx"
            if is_garment
            else f"clouva-avatar-{suffix}-unreal.fbx"
        )
        headers = {
            "X-Clouva-Target": "unreal-garment" if is_garment else "unreal",
            "X-Clouva-Ready": "true",
            "X-Clouva-Import-Uniform-Scale": "1.0",
            "X-Clouva-Metadata": compact_metadata,
            "X-Clouva-Exporter": UNREAL_EXPORT_VERSION,
            "X-Clouva-Dimensions-Cm": dimensions_header(metadata),
        }
        if is_garment:
            headers["X-Clouva-Scale"] = "fitted-volume-preserved"
            headers["X-Clouva-Rig-Preserved"] = "true"
        else:
            headers["X-Clouva-Height-Cm"] = str(metadata.get("finalMeshHeightCm", ""))
            headers["X-Clouva-Roundtrip-Height-Cm"] = str(metadata.get("fbxRoundTripHeightCm", ""))

        return FileResponse(
            output_path,
            media_type="application/octet-stream",
            filename=filename,
            background=BackgroundTask(shutil.rmtree, job_dir, True),
            headers=headers,
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
