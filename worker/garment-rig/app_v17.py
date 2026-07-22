"""Worker wrapper exposing Avatar Analyzer V3 without changing AutoRig V16."""
from __future__ import annotations

import base64
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

import app_v16 as current
from fastapi import HTTPException
from fastapi.responses import FileResponse, JSONResponse
from pydantic import AnyHttpUrl, BaseModel, Field
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
MAX_CONCURRENT_BLENDER_JOBS = current.MAX_CONCURRENT_BLENDER_JOBS
BLENDER_SINGLE_FLIGHT_VERSION = current.BLENDER_SINGLE_FLIGHT_VERSION
RIG_DIAGNOSTICS_VERSION = current.RIG_DIAGNOSTICS_VERSION
CLEAN_ATTEMPT_VERSION = current.CLEAN_ATTEMPT_VERSION
COMPLETE_AVATAR_RIG_VERSION = current.COMPLETE_AVATAR_RIG_VERSION
COMPLETE_AVATAR_RIG_SCRIPT = current.COMPLETE_AVATAR_RIG_SCRIPT
UNREAL_MOLD_RIG_VERSION = current.UNREAL_MOLD_RIG_VERSION

AVATAR_ANALYZER_VERSION = "v3-region-bvh-topology-geodesics"
AVATAR_ANALYZER_SCRIPT = Path(__file__).with_name("avatar_analyzer.py")
RUN_CACHE_ROOT = Path(os.environ.get(
    "CLOUVA_AVATAR_ANALYZER_RUN_CACHE",
    str(Path(tempfile.gettempdir()) / "clouva-avatar-analyzer-runs"),
))
RUN_TTL_SECONDS = int(os.environ.get("CLOUVA_AVATAR_ANALYZER_RUN_TTL_SECONDS", "3600"))
RUN_ID_PATTERN = re.compile(r"^[a-f0-9]{32}$")


class AvatarAnalyzeRequest(BaseModel):
    source_url: AnyHttpUrl
    include_renders: bool = True


class LandmarkCorrection(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    corrected_position: list[float] = Field(min_length=3, max_length=3)
    corrected_surface_position: list[float] | None = Field(default=None, min_length=3, max_length=3)
    approved: bool = True
    note: str | None = Field(default=None, max_length=1000)


class AvatarAnalysisCorrectionsRequest(BaseModel):
    corrections: list[LandmarkCorrection] = Field(default_factory=list, max_length=300)
    region_decisions: dict[str, str] = Field(default_factory=dict)
    fused_fingers: list[str] = Field(default_factory=list, max_length=20)


def _analysis_summary(analysis: dict) -> dict:
    landmarks = analysis.get("landmarks") if isinstance(analysis.get("landmarks"), dict) else {}
    warnings = analysis.get("warnings") if isinstance(analysis.get("warnings"), list) else []
    metrics = analysis.get("metrics") if isinstance(analysis.get("metrics"), dict) else {}
    verified_surface = int(metrics.get("verifiedSurfaceLandmarkCount") or 0)
    internal = int(metrics.get("internalJointCount") or 0)
    rejected = int(metrics.get("rejectedLandmarkCount") or 0)
    hidden = int(metrics.get("hiddenLandmarkCount") or 0)
    return {
        "status": str(analysis.get("status") or "unknown"),
        "runId": str(analysis.get("runId") or ""),
        "humanoidConfidence": float(analysis.get("humanoidConfidence") or 0.0),
        "bodyAnalysis": str(analysis.get("bodyAnalysis") or "unknown"),
        "faceAnalysis": str(analysis.get("faceAnalysis") or "unknown"),
        "leftHandAnalysis": str(analysis.get("leftHandAnalysis") or "unknown"),
        "rightHandAnalysis": str(analysis.get("rightHandAnalysis") or "unknown"),
        "landmarkCount": verified_surface,
        "verifiedSurfaceLandmarkCount": verified_surface,
        "internalJointCount": internal,
        "rejectedLandmarkCount": rejected,
        "rawLandmarkCount": len(landmarks),
        "hiddenLandmarkCount": hidden,
        "warningCount": len(warnings),
        "bodySubsystems": analysis.get("bodySubsystems") or {},
        "rigModified": False,
    }


def _summary_header(summary: dict) -> str:
    raw = json.dumps(summary, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii")


def _cleanup_expired_runs():
    RUN_CACHE_ROOT.mkdir(parents=True, exist_ok=True)
    cutoff = time.time() - RUN_TTL_SECONDS
    for child in RUN_CACHE_ROOT.iterdir():
        try:
            if child.is_dir() and child.stat().st_mtime < cutoff:
                shutil.rmtree(child, ignore_errors=True)
        except OSError:
            continue


def _safe_run_dir(run_id: str):
    if not RUN_ID_PATTERN.fullmatch(run_id or ""):
        raise HTTPException(status_code=400, detail="run_id inválido")
    path = (RUN_CACHE_ROOT / run_id).resolve()
    if RUN_CACHE_ROOT.resolve() not in path.parents:
        raise HTTPException(status_code=400, detail="run_id inválido")
    if not path.is_dir():
        raise HTTPException(status_code=404, detail="El diagnóstico expiró o no existe")
    return path


def _persist_run(output_dir: Path, analysis: dict):
    run_id = str(analysis.get("runId") or "")
    if not RUN_ID_PATTERN.fullmatch(run_id):
        raise RuntimeError("Avatar Analyzer returned an invalid runId")
    _cleanup_expired_runs()
    destination = RUN_CACHE_ROOT / run_id
    shutil.rmtree(destination, ignore_errors=True)
    shutil.copytree(output_dir, destination)
    (destination / "expires_at.json").write_text(json.dumps({
        "runId": run_id,
        "createdAt": time.time(),
        "expiresAt": time.time() + RUN_TTL_SECONDS,
    }, indent=2), encoding="utf-8")
    return destination


def _run_analysis(source_url: str):
    if not AVATAR_ANALYZER_SCRIPT.is_file():
        raise HTTPException(status_code=500, detail="Falta avatar_analyzer.py en el Blender Worker")
    job_dir = Path(tempfile.mkdtemp(prefix="clouva-avatar-analyzer-v3-"))
    input_path = job_dir / "avatar-original-clean.glb"
    output_dir = job_dir / "analysis"
    try:
        legacy.download(source_url, input_path)
        command = [
            legacy.BLENDER_BIN, "--background", "--factory-startup",
            "--python-exit-code", "1", "--python", str(AVATAR_ANALYZER_SCRIPT),
            "--", str(input_path), str(output_dir),
        ]
        result = subprocess.run(
            command, capture_output=True, text=True,
            timeout=max(legacy.BLENDER_TIMEOUT_SECONDS, 360), cwd=str(job_dir),
        )
        report_path = output_dir / "diagnostic_report.json"
        analysis_path = output_dir / "avatar_analysis.json"
        diagnostic_glb = output_dir / "diagnostic_landmarks.glb"
        if result.returncode != 0:
            technical = (result.stderr or result.stdout or "Blender Avatar Analyzer failed")[-12000:]
            raise RuntimeError(technical)
        missing = [str(path.name) for path in (report_path, analysis_path, diagnostic_glb) if not path.is_file()]
        if missing:
            raise RuntimeError(f"Avatar Analyzer no generó: {', '.join(missing)}")
        analysis = json.loads(analysis_path.read_text(encoding="utf-8"))
        cached = _persist_run(output_dir, analysis)
        return job_dir, output_dir, cached, analysis
    except subprocess.TimeoutExpired as exc:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(status_code=504, detail="Avatar Analyzer agotó el tiempo de procesamiento") from exc
    except HTTPException:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise
    except Exception as exc:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(status_code=422, detail=f"No se pudo analizar el avatar: {exc}") from exc


def _headers(analysis: dict):
    summary = _analysis_summary(analysis)
    return {
        "X-Clouva-Avatar-Analyzer-Version": AVATAR_ANALYZER_VERSION,
        "X-Clouva-Analysis-Status": summary["status"],
        "X-Clouva-Analysis-Run-Id": summary["runId"],
        "X-Clouva-Face-Analysis": summary["faceAnalysis"],
        "X-Clouva-Left-Hand-Analysis": summary["leftHandAnalysis"],
        "X-Clouva-Right-Hand-Analysis": summary["rightHandAnalysis"],
        "X-Clouva-Analysis-Summary": _summary_header(summary),
        "X-Clouva-Rig-Modified": "false",
    }


def _public_analysis(run_dir: Path):
    analysis = json.loads((run_dir / "avatar_analysis.json").read_text(encoding="utf-8"))
    report = json.loads((run_dir / "diagnostic_report.json").read_text(encoding="utf-8"))
    corrections_path = run_dir / "avatar_analysis_corrections.json"
    corrections = json.loads(corrections_path.read_text(encoding="utf-8")) if corrections_path.is_file() else None
    landmarks = analysis.get("landmarks") or {}
    accepted = {name: item for name, item in landmarks.items() if isinstance(item, dict) and item.get("accepted", False)}
    rejected = {name: item for name, item in landmarks.items() if isinstance(item, dict) and not item.get("accepted", False)}
    render_files = []
    renders = run_dir / "renders_temporales"
    if renders.is_dir():
        render_files = sorted(path.name for path in renders.iterdir() if path.is_file() and path.suffix.lower() in {".png", ".json"})
    return {
        "summary": _analysis_summary(analysis),
        "analysis": analysis,
        "report": report,
        "acceptedLandmarks": accepted,
        "rejectedLandmarks": rejected,
        "corrections": corrections,
        "assets": {
            "diagnosticGlb": "diagnostic_landmarks.glb",
            "renders": render_files,
        },
    }


@app.post("/avatar/analyze")
def analyze_avatar(request: AvatarAnalyzeRequest):
    job_dir, output_dir, _cached, analysis = _run_analysis(str(request.source_url))
    archive_base = job_dir / "clouva-avatar-analysis"
    archive_path = archive_base.with_suffix(".zip")
    try:
        if not request.include_renders:
            shutil.rmtree(output_dir / "renders_temporales", ignore_errors=True)
        shutil.make_archive(str(archive_base), "zip", root_dir=str(output_dir))
        return FileResponse(
            archive_path, media_type="application/zip", filename="clouva-avatar-analysis.zip",
            background=BackgroundTask(shutil.rmtree, job_dir, True), headers=_headers(analysis),
        )
    except Exception as exc:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(status_code=422, detail=f"No se pudo empaquetar el diagnóstico: {exc}") from exc


@app.post("/avatar/analyze-preview")
def analyze_avatar_preview(request: AvatarAnalyzeRequest):
    job_dir, output_dir, _cached, analysis = _run_analysis(str(request.source_url))
    return FileResponse(
        output_dir / "diagnostic_landmarks.glb", media_type="model/gltf-binary",
        filename="clouva-avatar-diagnostic.glb",
        background=BackgroundTask(shutil.rmtree, job_dir, True), headers=_headers(analysis),
    )


@app.get("/avatar/analyze/result/{run_id}")
def avatar_analyze_result(run_id: str):
    _cleanup_expired_runs()
    return JSONResponse(_public_analysis(_safe_run_dir(run_id)))


@app.get("/avatar/analyze/result/{run_id}/asset/{asset_path:path}")
def avatar_analyze_asset(run_id: str, asset_path: str):
    run_dir = _safe_run_dir(run_id)
    requested = (run_dir / asset_path).resolve()
    if run_dir not in requested.parents or not requested.is_file():
        raise HTTPException(status_code=404, detail="Archivo de diagnóstico no encontrado")
    allowed = {".png", ".json", ".glb", ".npy"}
    if requested.suffix.lower() not in allowed:
        raise HTTPException(status_code=403, detail="Tipo de archivo no permitido")
    media_type = {
        ".png": "image/png", ".json": "application/json", ".glb": "model/gltf-binary",
        ".npy": "application/octet-stream",
    }[requested.suffix.lower()]
    return FileResponse(requested, media_type=media_type, filename=requested.name)


@app.post("/avatar/analyze/result/{run_id}/corrections")
def save_avatar_analysis_corrections(run_id: str, request: AvatarAnalysisCorrectionsRequest):
    run_dir = _safe_run_dir(run_id)
    analysis = json.loads((run_dir / "avatar_analysis.json").read_text(encoding="utf-8"))
    landmarks = analysis.get("landmarks") or {}
    serialized = []
    for correction in request.corrections:
        source = landmarks.get(correction.name) if isinstance(landmarks, dict) else None
        automatic = (source or {}).get("internalJointPosition") or (source or {}).get("position")
        corrected = [float(value) for value in correction.corrected_position]
        delta = None
        if automatic and len(automatic) == 3:
            delta = [corrected[index] - float(automatic[index]) for index in range(3)]
        serialized.append({
            "name": correction.name,
            "automaticPosition": automatic,
            "correctedPosition": corrected,
            "correctedSurfacePosition": correction.corrected_surface_position,
            "correctionDelta": delta,
            "approvedByUser": bool(correction.approved),
            "note": correction.note,
        })
    payload: dict[str, Any] = {
        "version": "clouva-avatar-analysis-corrections-v1",
        "runId": run_id,
        "avatarHash": (analysis.get("source") or {}).get("sha256"),
        "analyzerVersion": analysis.get("version"),
        "timestamp": time.time(),
        "corrections": serialized,
        "regionDecisions": request.region_decisions,
        "fusedFingers": request.fused_fingers,
    }
    path = run_dir / "avatar_analysis_corrections.json"
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return payload


@app.get("/diagnostics/avatar-analyzer")
def avatar_analyzer_health():
    _cleanup_expired_runs()
    return {
        "ok": AVATAR_ANALYZER_SCRIPT.is_file(), "version": AVATAR_ANALYZER_VERSION,
        "script": AVATAR_ANALYZER_SCRIPT.name, "createsArmature": False,
        "modifiesProductionRig": False, "surfaceOnlyPreview": True,
        "internalJointsStoredSeparately": True, "regionBvh": True,
        "depthNormalRegionPasses": True, "geodesicLimbCenterlines": True,
        "topologyFirstHands": True, "temporaryCorrectionDataset": True,
        "runTtlSeconds": RUN_TTL_SECONDS,
        "outputs": ["avatar_analysis.json", "diagnostic_report.json", "diagnostic_landmarks.glb", "renders_temporales/"],
        "routes": [
            "/avatar/analyze", "/avatar/analyze-preview", "/avatar/analyze/result/{run_id}",
            "/avatar/analyze/result/{run_id}/corrections",
        ],
        "detectors": ["MediaPipe Face Landmarker", "MediaPipe Hand Landmarker"],
    }
