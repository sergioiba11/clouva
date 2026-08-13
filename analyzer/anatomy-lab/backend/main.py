from __future__ import annotations

import asyncio
import json
import re
import shutil
import socket
import threading
import uuid
from pathlib import Path
import sys

_VENDOR_DIR = Path(__file__).resolve().parent / "_vendor"
if _VENDOR_DIR.is_dir():
    vendor_path = str(_VENDOR_DIR)
    if vendor_path not in sys.path:
        sys.path.insert(0, vendor_path)

from fastapi import FastAPI, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

from analyzer import OUTPUT, RunState, execute
from clouva_connector import (
    ClouvaConnectionError,
    download_active_avatar,
    fetch_active_avatar,
    public_config,
)
from garment_mold import GarmentMoldError, generate_tshirt_mold
from garment_analyzer import (
    GarmentAnalyzerError,
    accept_garment_analysis,
    analyze_glb_asset,
    fit_analyzed_glb_to_avatar,
)
from raycast_scene import geometry_backend_status, open3d_status
from template_fit_engine import TemplateFitError, create_aligned_preview, fit_template_to_run
from template_library import (
    TemplateLibraryError,
    download_library_asset,
    download_template_glb,
    list_library_assets,
)

BASE = Path(__file__).resolve().parent.parent
INPUT = BASE / "input"
MAX_GLB_BYTES = 250 * 1024 * 1024
RUNS: dict[str, RunState] = {}

app = FastAPI(title="CLOUVA Anatomy Lab Local", version="1.3.1")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "clouva-anatomy-lab",
        "version": "1.3.1",
        "hostname": socket.gethostname(),
        "geometry_backend": geometry_backend_status(),
        "open3d": open3d_status(),
        "networkx_vendor_ready": (_VENDOR_DIR / "networkx" / "__init__.py").is_file(),
    }


def _bearer_token(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Sesión de CLOUVA requerida")
    token = authorization[7:].strip()
    if not token:
        raise HTTPException(401, "Sesión de CLOUVA requerida")
    return token


def _safe_name(value: str, fallback: str = "asset") -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "-", value).strip("-")
    return cleaned or fallback


@app.get("/api/clouva/config")
def clouva_config():
    return public_config()


@app.get("/api/clouva/avatar")
def clouva_avatar(authorization: str | None = Header(default=None)):
    try:
        return fetch_active_avatar(_bearer_token(authorization))
    except ClouvaConnectionError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.get("/api/clouva/avatar/file")
def clouva_avatar_file(authorization: str | None = Header(default=None)):
    token = _bearer_token(authorization)
    cache_dir = INPUT / ".clouva-cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    destination = cache_dir / f"{uuid.uuid4().hex}.glb"
    try:
        avatar = download_active_avatar(token, destination)
    except ClouvaConnectionError as exc:
        destination.unlink(missing_ok=True)
        raise HTTPException(422, str(exc)) from exc
    safe_name = _safe_name(str(avatar.get("name") or "avatar-activo"), "avatar-activo")
    return FileResponse(
        destination,
        media_type="model/gltf-binary",
        filename=f"{safe_name}.glb",
        background=BackgroundTask(destination.unlink, missing_ok=True),
    )


@app.get("/api/library/assets")
def library_assets(authorization: str | None = Header(default=None)):
    token = _bearer_token(authorization)
    try:
        assets = list_library_assets(token)
    except TemplateLibraryError as exc:
        raise HTTPException(422, str(exc)) from exc
    categories = sorted({item["category_label"] for item in assets})
    return {
        "version": "clouva-library-browser-v1.1.1",
        "count": len(assets),
        "categories": categories,
        "assets": assets,
    }


# v1.0.1 compatibility alias.
@app.get("/api/templates")
def list_templates(authorization: str | None = Header(default=None)):
    token = _bearer_token(authorization)
    try:
        assets = list_library_assets(token)
    except TemplateLibraryError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"templates": assets, "assets": assets, "count": len(assets)}


@app.get("/api/library/asset-file")
def library_asset_file(
    asset_key: str = Query(...),
    authorization: str | None = Header(default=None),
):
    token = _bearer_token(authorization)
    cache_dir = INPUT / ".library-cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    destination = cache_dir / f"{uuid.uuid4().hex}.glb"
    try:
        asset = download_library_asset(asset_key, destination, token)
    except TemplateLibraryError as exc:
        destination.unlink(missing_ok=True)
        raise HTTPException(422, str(exc)) from exc
    filename = _safe_name(str(asset.get("name") or "library-asset"), "library-asset") + ".glb"
    return FileResponse(
        destination,
        media_type="model/gltf-binary",
        filename=filename,
        background=BackgroundTask(destination.unlink, missing_ok=True),
    )


@app.post("/api/analyze")
async def analyze(file: UploadFile = File(...), height_cm: float = Form(180.0)):
    if not file.filename or not file.filename.lower().endswith(".glb"):
        raise HTTPException(422, "Solo se aceptan archivos .glb")
    if not 80.0 <= float(height_cm) <= 250.0:
        raise HTTPException(422, "La altura debe estar entre 80 y 250 cm")
    run_id = uuid.uuid4().hex
    run_dir = OUTPUT / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    source = run_dir / "uploaded.glb"
    total = 0
    with source.open("wb") as stream:
        while chunk := await file.read(1024 * 1024):
            total += len(chunk)
            if total > MAX_GLB_BYTES:
                source.unlink(missing_ok=True)
                raise HTTPException(413, "El GLB supera el límite local de 250 MB")
            stream.write(chunk)
    state = RunState(run_id)
    RUNS[run_id] = state
    threading.Thread(target=execute, args=(state, source, float(height_cm)), daemon=True).start()
    return {"runId": run_id}


@app.post("/api/analyze-default")
def analyze_default():
    source = INPUT / "avatar.glb"
    if not source.is_file():
        raise HTTPException(404, "Copiá el archivo en input/avatar.glb")
    run_id = uuid.uuid4().hex
    run_dir = OUTPUT / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    local_source = run_dir / "uploaded.glb"
    shutil.copy2(source, local_source)
    state = RunState(run_id)
    RUNS[run_id] = state
    threading.Thread(target=execute, args=(state, local_source, 180.0), daemon=True).start()
    return {"runId": run_id}


@app.get("/api/runs/{run_id}")
def run_status(run_id: str):
    state = RUNS.get(run_id)
    if state is None:
        result_path = OUTPUT / run_id / "anatomy_result.json"
        if result_path.is_file():
            return {"runId": run_id, "status": "completed", "phase": "completed", "progress": 100}
        raise HTTPException(404, "Run no encontrado")
    return {
        "runId": run_id,
        "status": state.status,
        "phase": state.phase,
        "progress": state.progress,
        "message": state.message,
        "error": state.error,
    }


@app.get("/api/runs/{run_id}/progress")
async def progress(run_id: str):
    state = RUNS.get(run_id)
    if state is None:
        raise HTTPException(404, "Run no encontrado")

    async def event_stream():
        cursor = 0
        while True:
            while cursor < len(state.events):
                event = state.events[cursor]
                cursor += 1
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
            if state.status in {"completed", "failed", "cancelled"}:
                final_event = {
                    "phase": state.phase,
                    "progress": state.progress,
                    "message": state.message,
                    "error": state.error,
                }
                yield f"data: {json.dumps(final_event, ensure_ascii=False)}\n\n"
                break
            await asyncio.sleep(0.35)

    return StreamingResponse(event_stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@app.get("/api/runs/{run_id}/result")
def result(run_id: str):
    state = RUNS.get(run_id)
    if state and state.result:
        return state.result
    path = OUTPUT / run_id / "anatomy_result.json"
    if not path.is_file():
        raise HTTPException(404, "El resultado todavía no existe")
    return JSONResponse(json.loads(path.read_text(encoding="utf-8")))


def _load_run_result(run_id: str) -> dict:
    state = RUNS.get(run_id)
    if state and state.result:
        return state.result
    path = OUTPUT / run_id / "anatomy_result.json"
    if path.is_file():
        return json.loads(path.read_text(encoding="utf-8"))
    raise HTTPException(404, "El resultado anatómico todavía no existe")


class GarmentMoldRequest(BaseModel):
    fit: str = "oversized"


@app.post("/api/runs/{run_id}/garment-mold")
def create_garment_mold(run_id: str, payload: GarmentMoldRequest):
    run_dir = OUTPUT / run_id
    result_path = run_dir / "anatomy_result.json"
    source_path = run_dir / "uploaded.glb"
    if not result_path.is_file():
        raise HTTPException(404, "Primero completá el análisis anatómico")
    try:
        anatomy_result = json.loads(result_path.read_text(encoding="utf-8"))
        return generate_tshirt_mold(
            anatomy_result,
            output_dir=run_dir,
            source_glb=source_path if source_path.is_file() else None,
            fit=payload.fit,
        )
    except GarmentMoldError as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(500, f"GARMENT_MOLD_FAILED:{type(exc).__name__}:{exc}") from exc


@app.get("/api/runs/{run_id}/garment-mold/latest")
def latest_garment_mold(run_id: str):
    path = OUTPUT / run_id / "garment_mold_latest.json"
    if not path.is_file():
        raise HTTPException(404, "Todavía no se generó un molde")
    return JSONResponse(json.loads(path.read_text(encoding="utf-8")))


@app.post("/api/runs/{run_id}/analyze-library-asset")
def analyze_library_asset(
    run_id: str,
    asset_key: str = Form(...),
    authorization: str | None = Header(default=None),
):
    token = _bearer_token(authorization)
    _load_run_result(run_id)
    run_dir = OUTPUT / run_id
    cache_dir = run_dir / "library_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_name = _safe_name(asset_key.replace(":", "-"), "library-asset")
    template_path = cache_dir / f"{cache_name}.glb"
    try:
        asset_info = download_library_asset(asset_key.strip(), template_path, token)
        relative_dir = Path("library_analysis") / str(asset_info["id"])
        artifacts = analyze_glb_asset(
            template_glb=template_path,
            template_info=asset_info,
            output_dir=run_dir / relative_dir,
        )
    except (TemplateLibraryError, GarmentAnalyzerError) as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(500, f"GARMENT_ANALYSIS_FAILED:{type(exc).__name__}:{exc}") from exc

    payload = dict(artifacts.analysis)
    asset_base = str(relative_dir).replace("\\", "/")
    payload["asset_base"] = asset_base
    payload["asset_paths"] = {
        "glb": f"{asset_base}/{artifacts.preview_glb_path.name}",
        "analysis_json": f"{asset_base}/{artifacts.analysis_json_path.name}",
    }
    return payload


@app.post("/api/runs/{run_id}/accept-garment-analysis")
def accept_library_garment_analysis(
    run_id: str,
    asset_key: str = Form(...),
    analysis_id: str = Form(...),
    quarter_turns: int = Form(0),
    rotation_x_quarter_turns: int = Form(0),
    rotation_y_quarter_turns: int = Form(0),
    rotation_z_quarter_turns: int | None = Form(None),
    category_override: str = Form(""),
    orientation_confirmed: bool = Form(False),
    landmarks_confirmed: bool = Form(False),
    authorization: str | None = Header(default=None),
):
    token = _bearer_token(authorization)
    _load_run_result(run_id)
    run_dir = OUTPUT / run_id
    cache_dir = run_dir / "library_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_name = _safe_name(asset_key.replace(":", "-"), "library-asset")
    template_path = cache_dir / f"{cache_name}.glb"
    try:
        asset_info = download_library_asset(asset_key.strip(), template_path, token)
        relative_dir = Path("library_analysis") / str(asset_info["id"])
        analysis_dir = run_dir / relative_dir
        analysis_path = analysis_dir / "garment_analysis.json"
        if not analysis_path.is_file():
            raise GarmentAnalyzerError("Primero ejecutá Analizar prenda")
        analysis = json.loads(analysis_path.read_text(encoding="utf-8"))
        if str(analysis.get("analysis_id")) != str(analysis_id):
            raise GarmentAnalyzerError("El análisis seleccionado ya no coincide con la prenda actual")
        artifacts = accept_garment_analysis(
            template_glb=template_path,
            template_info=asset_info,
            analysis=analysis,
            output_dir=analysis_dir,
            quarter_turns=int(quarter_turns),
            rotation_x_quarter_turns=int(rotation_x_quarter_turns),
            rotation_y_quarter_turns=int(rotation_y_quarter_turns),
            rotation_z_quarter_turns=None if rotation_z_quarter_turns is None else int(rotation_z_quarter_turns),
            category_override=category_override.strip() or None,
            orientation_confirmed=bool(orientation_confirmed),
            landmarks_confirmed=bool(landmarks_confirmed),
        )
    except (TemplateLibraryError, GarmentAnalyzerError) as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(500, f"GARMENT_ANALYSIS_ACCEPT_FAILED:{type(exc).__name__}:{exc}") from exc

    payload = dict(artifacts.analysis)
    asset_base = str(relative_dir).replace("\\", "/")
    payload["asset_base"] = asset_base
    payload["asset_paths"] = {
        "glb": f"{asset_base}/{artifacts.preview_glb_path.name}",
        "analysis_json": f"{asset_base}/{artifacts.analysis_json_path.name}",
    }
    return payload


@app.post("/api/runs/{run_id}/preview-library-asset")
def preview_library_asset(
    run_id: str,
    asset_key: str = Form(...),
    fit_mode: str = Form("oversized"),
    authorization: str | None = Header(default=None),
):
    token = _bearer_token(authorization)
    mode = fit_mode.strip().lower()
    if mode not in {"base", "regular", "oversized"}:
        raise HTTPException(422, "Calce inválido")
    anatomy_result = _load_run_result(run_id)
    run_dir = OUTPUT / run_id
    cache_dir = run_dir / "library_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_name = _safe_name(asset_key.replace(":", "-"), "library-asset")
    template_path = cache_dir / f"{cache_name}.glb"
    try:
        asset_info = download_library_asset(asset_key.strip(), template_path, token)
        relative_dir = Path("library_previews") / asset_info["id"] / mode
        artifacts = create_aligned_preview(
            run_result=anatomy_result,
            template_info=asset_info,
            template_glb=template_path,
            output_dir=run_dir / relative_dir,
            fit_mode=mode,
            avatar_glb=(run_dir / "uploaded.glb") if (run_dir / "uploaded.glb").is_file() else None,
        )
    except (TemplateLibraryError, TemplateFitError) as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(500, f"LIBRARY_PREVIEW_ALIGN_FAILED:{type(exc).__name__}:{exc}") from exc

    payload = dict(artifacts.payload)
    asset_base = str(relative_dir).replace("\\", "/")
    payload["asset_base"] = asset_base
    payload["asset_paths"] = {
        "glb": f"{asset_base}/{artifacts.glb_path.name}",
        "alignment_json": f"{asset_base}/{artifacts.alignment_json_path.name}",
    }
    return payload


def _fit_asset(
    run_id: str,
    asset_key: str,
    fit_mode: str,
    token: str,
) -> dict:
    anatomy_result = _load_run_result(run_id)
    run_dir = OUTPUT / run_id
    source_path = run_dir / "uploaded.glb"
    cache_dir = run_dir / "library_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_name = _safe_name(asset_key.replace(":", "-"), "library-asset")
    template_path = cache_dir / f"{cache_name}.glb"

    try:
        asset_info = download_library_asset(asset_key, template_path, token)
        accepted_path = run_dir / "library_analysis" / str(asset_info["id"]) / "garment_analysis_accepted.json"
        if not accepted_path.is_file():
            raise GarmentAnalyzerError("Primero analizá la prenda sola y tocá Aceptar análisis")
        accepted_analysis = json.loads(accepted_path.read_text(encoding="utf-8"))
        if accepted_analysis.get("template", {}).get("asset_key") != asset_info.get("asset_key"):
            raise GarmentAnalyzerError("El análisis aceptado pertenece a otro GLB")
        relative_dir = Path("universal_library_fits") / str(asset_info["id"]) / fit_mode
        artifacts = fit_analyzed_glb_to_avatar(
            run_result=anatomy_result,
            template_info=asset_info,
            template_glb=template_path,
            avatar_glb=source_path if source_path.is_file() else None,
            output_dir=run_dir / relative_dir,
            fit_mode=fit_mode,
            analysis_override=accepted_analysis,
        )
    except (TemplateLibraryError, GarmentAnalyzerError) as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(500, f"UNIVERSAL_LIBRARY_FIT_FAILED:{type(exc).__name__}:{exc}") from exc

    payload = dict(artifacts.fit_json)
    asset_base = str(relative_dir).replace("\\", "/")
    payload["asset_base"] = asset_base
    payload["asset_paths"] = {
        "glb": f"{asset_base}/{artifacts.glb_path.name}",
        "fit_json": f"{asset_base}/{artifacts.fit_json_path.name}",
        "analysis_json": f"{asset_base}/{artifacts.analysis_json_path.name}",
        "collision_json": f"{asset_base}/{artifacts.collision_json_path.name}",
    }
    return payload


@app.post("/api/runs/{run_id}/fit-library-asset")
def fit_library_asset(
    run_id: str,
    asset_key: str = Form(...),
    fit_mode: str = Form("oversized"),
    authorization: str | None = Header(default=None),
):
    token = _bearer_token(authorization)
    mode = fit_mode.strip().lower()
    if mode not in {"base", "regular", "oversized"}:
        raise HTTPException(422, "Calce inválido")
    return _fit_asset(run_id, asset_key.strip(), mode, token)


# v1.0.1 compatibility endpoint for official r1/h1.
@app.post("/api/runs/{run_id}/fit-template")
def fit_real_template(
    run_id: str,
    template_code: str = Form(...),
    fit_mode: str = Form("oversized"),
    authorization: str | None = Header(default=None),
):
    token = _bearer_token(authorization)
    cache_dir = INPUT / ".compat-template"
    cache_dir.mkdir(parents=True, exist_ok=True)
    destination = cache_dir / f"{uuid.uuid4().hex}.glb"
    try:
        info = download_template_glb(template_code, destination, token)
    except TemplateLibraryError as exc:
        destination.unlink(missing_ok=True)
        raise HTTPException(422, str(exc)) from exc
    destination.unlink(missing_ok=True)
    return _fit_asset(run_id, info["asset_key"], fit_mode.strip().lower(), token)


@app.get("/api/runs/{run_id}/asset/{asset_path:path}")
def asset(run_id: str, asset_path: str):
    if ".." in asset_path or asset_path.startswith("/"):
        raise HTTPException(400, "Ruta inválida")
    root = (OUTPUT / run_id).resolve()
    path = (root / asset_path).resolve()
    if root not in path.parents and path != root:
        raise HTTPException(400, "Ruta inválida")
    if not path.is_file():
        raise HTTPException(404, "Asset no encontrado")
    media_type = "model/gltf-binary" if path.suffix.lower() == ".glb" else None
    return FileResponse(path, media_type=media_type)


@app.post("/api/runs/{run_id}/cancel")
def cancel(run_id: str):
    state = RUNS.get(run_id)
    if state is None:
        raise HTTPException(404, "Run no encontrado")
    state.cancel_requested = True
    return {"ok": True}
