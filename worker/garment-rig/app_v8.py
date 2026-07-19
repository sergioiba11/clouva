import shutil
import tempfile
import uuid
from pathlib import Path

import app_v7 as base
import app_legacy as legacy
from fastapi import HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask


app = base.app
EXPORT_UNREAL_SCRIPT_PATH = base.EXPORT_UNREAL_SCRIPT_PATH
RIG_ROUTE_VERSION = "v8-diagnostic-sync"


# Replace the legacy synchronous /rig route. The previous endpoint discarded
# Blender's real validation error and always returned the same generic message.
app.router.routes[:] = [
    route
    for route in app.router.routes
    if not (
        getattr(route, "path", None) == "/rig"
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
