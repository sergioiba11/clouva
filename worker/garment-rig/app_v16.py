import shutil
import tempfile
from pathlib import Path

import app_v15 as current
from fastapi import HTTPException
from fastapi.responses import FileResponse
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
COMPLETE_AVATAR_RIG_VERSION = "v5-proportional-roots"
COMPLETE_AVATAR_RIG_SCRIPT = Path(__file__).with_name("complete_avatar_rig_v3.py")
RigWithUnrealMoldRequest = current.RigWithUnrealMoldRequest

# Las rutas /avatar/complete-rig y /diagnostics/avatar-complete-rig fueron
# registradas al importar app_v15. Sus funciones leen los globales de ese
# módulo, no las variables homónimas de app_v16.
current.COMPLETE_AVATAR_RIG_VERSION = COMPLETE_AVATAR_RIG_VERSION
current.COMPLETE_AVATAR_RIG_SCRIPT = COMPLETE_AVATAR_RIG_SCRIPT

UNREAL_MOLD_RIG_VERSION = "v2-fresh-source-real-diagnostics"

# Reemplaza únicamente la ruta síncrona del molde. El resto del Worker V15 queda intacto.
app.router.routes[:] = [
    route
    for route in app.router.routes
    if not (
        getattr(route, "path", None) == "/rig-with-unreal-mold"
        and "POST" in (getattr(route, "methods", set()) or set())
    )
]


def _pop_job(job_id: str) -> dict:
    with legacy.JOBS_LOCK:
        return dict(legacy.JOBS.pop(job_id, {}))


def _failure_from_job(snapshot: dict) -> str:
    stage = str(snapshot.get("stage") or "").strip()
    technical = str(snapshot.get("technicalError") or "").strip()
    visible = str(snapshot.get("error") or "").strip()
    details = snapshot.get("details") if isinstance(snapshot.get("details"), dict) else {}
    extracted = extract_blender_failure(
        details.get("stdout") or "",
        details.get("stderr") or "",
    )
    reason = technical or visible or extracted or "Blender no generó un GLB riggeado válido"
    return f"{stage}: {reason}" if stage else reason


@app.post("/rig-with-unreal-mold")
def rig_with_unreal_mold_v2(request: RigWithUnrealMoldRequest):
    if not request.unreal_snapshot:
        raise HTTPException(status_code=400, detail="Falta el snapshot corporal reciente devuelto por Unreal")

    category_raw = request.category.strip().lower()
    category = legacy.CATEGORY_MAP.get(category_raw, category_raw)
    if category not in legacy.VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail="Categoría de prenda inválida")

    job_dir = Path(tempfile.mkdtemp(prefix="clouva-unreal-mold-rig-v2-"))
    avatar_path = job_dir / "avatar-complete-rigged.glb"
    garment_path = job_dir / "garment-original.glb"
    output_path = job_dir / "garment-rigged.glb"
    art_path = job_dir / "art.png"
    job_id = f"unreal-mold-{request.attempt_id or 'sync'}"

    try:
        legacy.download(str(request.avatar_url), avatar_path)
        legacy.download(str(request.garment_url), garment_path)
        resolved_art_path = None
        if request.art_url:
            legacy.download(str(request.art_url), art_path)
            resolved_art_path = art_path

        legacy.run_blender_job(
            job_id,
            job_dir,
            avatar_path,
            garment_path,
            output_path,
            category,
            resolved_art_path,
            request.color or "",
            {
                "attemptId": request.attempt_id,
                "forceFreshSource": True,
                "cleanScene": True,
                "moldSource": "unreal-avatar-snapshot",
                "unrealSnapshot": request.unreal_snapshot,
            },
        )
        snapshot = _pop_job(job_id)
        if not output_path.is_file() or output_path.stat().st_size < 1024:
            raise RuntimeError(_failure_from_job(snapshot))

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
        _pop_job(job_id)
        shutil.rmtree(job_dir, ignore_errors=True)
        raise
    except Exception as exc:
        _pop_job(job_id)
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(
            status_code=422,
            detail=f"No se pudo riggear el GLB con el molde de Unreal: {exc}",
        ) from exc


@app.get("/diagnostics/unreal-mold")
def unreal_mold_health_v2():
    return {
        "ok": True,
        "version": UNREAL_MOLD_RIG_VERSION,
        "freshGarmentSource": True,
        "freshUnrealSnapshot": True,
        "realBlenderFailureVisible": True,
    }
