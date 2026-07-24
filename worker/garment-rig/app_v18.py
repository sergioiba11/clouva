"""Side-by-side CLOUVA Avatar Analyzer V4 API while retaining V3.2 routes."""
from __future__ import annotations

import base64
import gc
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
from typing import Any, Literal
import uuid

import app_v17 as v32
from analysis_glb_sanitizer import sanitize_glb_for_analysis
from analyzer_v4_contract import (
    ANALYZER_VERSION,
    APPROVED_STATES,
    MAP_VERSION,
    RIG_PROFILES,
    build_targeted_reanalysis_plan,
    upgrade_analysis_v4,
)
from fastapi import HTTPException
from fastapi.responses import FileResponse, JSONResponse
from pydantic import AnyHttpUrl, BaseModel, Field
from starlette.background import BackgroundTask

app = v32.app
base = v32.base
legacy = v32.legacy

# Preserve the complete V3.2 public module contract for existing CI and callers.
COMPLETE_AVATAR_RIG_SCRIPT = v32.COMPLETE_AVATAR_RIG_SCRIPT
AVATAR_ANALYZER_VERSION = v32.AVATAR_ANALYZER_VERSION
AVATAR_ANALYZER_SCRIPT = v32.AVATAR_ANALYZER_SCRIPT
ANALYZER_AUTORIG_SCRIPT = v32.ANALYZER_AUTORIG_SCRIPT
ANALYZER_RIG_LOCK = v32.ANALYZER_RIG_LOCK

AVATAR_ANALYZER_V4_VERSION = ANALYZER_VERSION
AVATAR_ANALYZER_V4_SCRIPT = Path(__file__).with_name("avatar_analyzer_v4.py")
ANALYZER_AUTORIG_V4_SCRIPT = Path(__file__).with_name("autorig_avatar_v19.py")
REQUESTED_PROFILE_ENV = "CLOUVA_REQUESTED_RIG_PROFILE"
REANALYSIS_ENV = "CLOUVA_REANALYSIS_OPERATION"
V4_PHASE_ENV = "CLOUVA_AVATAR_ANALYZER_V4_PHASE"
V4_DURABLE_SUFFIXES = {".glb", ".json", ".png"}
RigProfileLiteral = Literal[
    "BODY_BASIC", "BODY_FACE", "BODY_HANDS_BASIC", "FULL_HUMANOID", "FULL_BODY_HANDS_FACE",
    "body_only", "body_with_hands", "full_humanoid", "full_humanoid_with_face",
]


class AvatarAnalyzeV4Request(BaseModel):
    source_url: AnyHttpUrl
    include_renders: bool = True
    requested_rig_profile: RigProfileLiteral = "body_only"


class AnalyzerV4CompleteRigRequest(v32.current.CompleteAvatarRigRequest):
    force_analyzer: bool = True
    requested_rig_profile: RigProfileLiteral = "body_only"


class ManualLandmarkCorrectionV4(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    surface_click: list[float] = Field(min_length=3, max_length=3)
    proposed_internal_position: list[float] | None = Field(default=None, min_length=3, max_length=3)
    approved: bool = True
    note: str | None = Field(default=None, max_length=1000)


class ManualCorrectionRequestV4(BaseModel):
    requested_rig_profile: RigProfileLiteral = "body_only"
    corrections: list[ManualLandmarkCorrectionV4] = Field(default_factory=list, max_length=300)


class TargetedReanalysisRequestV4(BaseModel):
    operation: Literal[
        "reanalyze_camera", "reanalyze_region", "reanalyze_landmark",
        "reanalyze_face", "reanalyze_left_hand", "reanalyze_right_hand",
        "reanalyze_body", "reanalyze_right_shoulder", "rerun_full_pipeline",
    ]
    camera_id: str | None = Field(default=None, max_length=128)
    region: str | None = Field(default=None, max_length=128)
    landmark: str | None = Field(default=None, max_length=128)
    requested_rig_profile: RigProfileLiteral = "body_only"


def _summary(analysis: dict[str, Any]):
    landmarks = analysis.get("landmarks") if isinstance(analysis.get("landmarks"), dict) else {}
    warnings = analysis.get("warnings") if isinstance(analysis.get("warnings"), list) else []
    metrics = analysis.get("metrics") if isinstance(analysis.get("metrics"), dict) else {}
    states: dict[str, int] = {}
    for record in landmarks.values():
        if isinstance(record, dict):
            state = str(record.get("state") or "needs_review")
            states[state] = states.get(state, 0) + 1
    return {
        "status": analysis.get("overall_status") or analysis.get("status"),
        "runId": analysis.get("runId"),
        "analyzerVersion": analysis.get("version") or AVATAR_ANALYZER_V4_VERSION,
        "sourceSha256": (analysis.get("source") or {}).get("sha256"),
        "requestedRigProfile": analysis.get("requested_rig_profile"),
        "supportedRigProfiles": analysis.get("supported_rig_profiles") or [],
        "rigReadinessScore": float(analysis.get("rigReadinessScore") or 0.0),
        "rigReadinessApproved": bool(analysis.get("rigReadinessApproved")),
        "bodyRigScore": float(analysis.get("bodyRigScore") or 0.0),
        "bodyRigReady": bool(analysis.get("bodyRigReady")),
        "faceAnalysisScore": float(analysis.get("faceAnalysisScore") or 0.0),
        "faceAnalysisReady": bool(analysis.get("faceAnalysisReady")),
        "leftHandBaseReady": bool(analysis.get("leftHandBaseReady")),
        "rightHandBaseReady": bool(analysis.get("rightHandBaseReady")),
        "leftFingerRigReady": bool(analysis.get("leftFingerRigReady")),
        "rightFingerRigReady": bool(analysis.get("rightFingerRigReady")),
        "fullHumanoidRigReady": bool(analysis.get("fullHumanoidRigReady")),
        "unrealExportReady": bool(analysis.get("unrealExportReady")),
        "criticalLandmarksVerified": bool(analysis.get("criticalLandmarksVerified")),
        "humanoidConfidence": float(analysis.get("humanoidConfidence") or 0.0),
        "bodyBaseConfidence": float(
            analysis.get("bodyBaseConfidence", analysis.get("humanoidConfidence")) or 0.0
        ),
        "bodyAnalysis": str(analysis.get("bodyAnalysis") or "needs_review"),
        "faceAnalysis": str(analysis.get("faceAnalysis") or "needs_review"),
        "leftHandAnalysis": str(analysis.get("leftHandAnalysis") or "needs_review"),
        "rightHandAnalysis": str(analysis.get("rightHandAnalysis") or "needs_review"),
        "landmarkCount": int(metrics.get("verifiedSurfaceLandmarkCount") or 0),
        "verifiedSurfaceLandmarkCount": int(metrics.get("verifiedSurfaceLandmarkCount") or 0),
        "verifiedLandmarkCount": int(metrics.get("verifiedLandmarkCount") or 0),
        "internalJointCount": int(metrics.get("internalJointCount") or 0),
        "rejectedLandmarkCount": int(metrics.get("rejectedLandmarkCount") or 0),
        "noVisualEvidenceCount": int(metrics.get("noVisualEvidenceCount") or 0),
        "insufficientViewsCount": int(metrics.get("insufficientViewsCount") or 0),
        "technicalMismatchCount": int(metrics.get("technicalMismatchCount") or 0),
        "topologyInvalidCount": int(metrics.get("topologyInvalidCount") or 0),
        "rawLandmarkCount": len(landmarks),
        "hiddenLandmarkCount": int(metrics.get("hiddenLandmarkCount") or 0),
        "warningCount": len(warnings),
        "detectionCoverage": v32._compact_coverage(analysis.get("detectionCoverage")),
        "orientation": v32._compact_orientation(analysis.get("orientation")),
        "topologyCapabilities": analysis.get("topology_capabilities") or {},
        "rootCauseCount": len(analysis.get("root_causes") or []),
        "blockingReasonCount": len(analysis.get("blocking_reasons") or []),
        "recommendedNextAction": analysis.get("recommended_next_action"),
        "diagnosticFingerprint": analysis.get("diagnostic_fingerprint"),
        "landmarkStates": states,
        "rigModified": False,
    }


def _headers(analysis: dict[str, Any]):
    summary = _summary(analysis)
    encoded = base64.urlsafe_b64encode(
        json.dumps(summary, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    ).decode("ascii")
    return {
        "X-Clouva-Avatar-Analyzer-Version": AVATAR_ANALYZER_V4_VERSION,
        "X-Clouva-Analysis-Status": str(summary["status"] or "unknown"),
        "X-Clouva-Analysis-Run-Id": str(summary["runId"] or ""),
        "X-Clouva-Analysis-Source-Sha256": str(summary["sourceSha256"] or ""),
        "X-Clouva-Requested-Rig-Profile": str(summary["requestedRigProfile"] or "BODY_BASIC"),
        "X-Clouva-Supported-Rig-Profiles": ",".join(summary["supportedRigProfiles"]),
        "X-Clouva-Rig-Readiness": str(summary["rigReadinessScore"]),
        "X-Clouva-Rig-Readiness-Approved": "true" if summary["rigReadinessApproved"] else "false",
        "X-Clouva-Analysis-Summary": encoded,
        "X-Clouva-Rig-Modified": "false",
    }


def _run_v4_blender_phases(
    input_path: Path,
    output_dir: Path,
    environment: dict[str, str],
    job_dir: Path,
):
    phase_logs = []
    for phase in ("base", "upgrade"):
        result = subprocess.run(
            [
                legacy.BLENDER_BIN, "--background", "--factory-startup",
                "--python-exit-code", "1", "--python", str(AVATAR_ANALYZER_V4_SCRIPT),
                "--", str(input_path), str(output_dir),
            ],
            capture_output=True,
            text=True,
            timeout=max(legacy.BLENDER_TIMEOUT_SECONDS, 900),
            cwd=str(job_dir),
            env={**environment, V4_PHASE_ENV: phase},
        )
        phase_logs.append(result.stderr or result.stdout or "")
        if result.returncode != 0:
            technical = (
                result.stderr
                or result.stdout
                or f"Blender Avatar Analyzer V4 {phase} phase failed"
            )[-12000:]
            raise RuntimeError(technical)
        gc.collect()
    return phase_logs


def _run_analysis_v4(source_url: str, requested_profile: str, operation: str | None = None):
    if not AVATAR_ANALYZER_V4_SCRIPT.is_file():
        raise HTTPException(status_code=500, detail="Falta avatar_analyzer_v4.py en el Blender Worker")
    job_dir = Path(tempfile.mkdtemp(prefix="clouva-avatar-analyzer-v4-"))
    input_path = job_dir / "avatar-original-clean.glb"
    analysis_input_path = job_dir / "avatar-analysis-sanitized.glb"
    output_dir = job_dir / "analysis"
    try:
        legacy.download(source_url, input_path)
        sanitization = sanitize_glb_for_analysis(input_path, analysis_input_path)
        print(
            "[clouva-avatar-analyzer] pre-Blender GLB sanitizer "
            f"bytes={sanitization['sourceBytes']}->{sanitization['analysisBytes']} "
            f"attributesRemoved={sanitization['attributesRemoved']} "
            f"imagesRemoved={sanitization['imagesRemoved']} "
            f"morphTargetsRemoved={sanitization['morphTargetsRemoved']}",
            flush=True,
        )
        gc.collect()
        environment = {**os.environ, REQUESTED_PROFILE_ENV: requested_profile}
        if operation:
            environment[REANALYSIS_ENV] = operation
        _run_v4_blender_phases(
            analysis_input_path,
            output_dir,
            environment,
            job_dir,
        )
        report_path = output_dir / "diagnostic_report.json"
        analysis_path = output_dir / "avatar_analysis.json"
        diagnostic_glb = output_dir / "diagnostic_landmarks.glb"
        missing = [path.name for path in (report_path, analysis_path, diagnostic_glb) if not path.is_file()]
        if missing:
            raise RuntimeError(f"Avatar Analyzer V4 no generó: {', '.join(missing)}")
        analysis = json.loads(analysis_path.read_text(encoding="utf-8"))
        cached = _persist_run_v4(output_dir, analysis, input_path)
        return job_dir, output_dir, cached, analysis
    except subprocess.TimeoutExpired as exc:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(status_code=504, detail="Avatar Analyzer V4 agotó el tiempo de procesamiento") from exc
    except HTTPException:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise
    except Exception as exc:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(status_code=422, detail=f"No se pudo analizar el avatar con V4: {exc}") from exc


def _rerun_cached_source_v4(source_path: Path, requested_profile: str, operation: str):
    """Execute a clean Blender scene from the immutable GLB cached for a previous run."""
    if not source_path.is_file():
        raise HTTPException(status_code=410, detail={
            "code": "ANALYZER_SOURCE_EXPIRED",
            "message": "El GLB original de este run ya no está disponible para reanálisis.",
        })
    job_dir = Path(tempfile.mkdtemp(prefix="clouva-avatar-analyzer-v4-reanalysis-"))
    input_path = job_dir / "avatar-original-clean.glb"
    analysis_input_path = job_dir / "avatar-analysis-sanitized.glb"
    output_dir = job_dir / "analysis"
    try:
        shutil.copy2(source_path, input_path)
        sanitize_glb_for_analysis(input_path, analysis_input_path)
        gc.collect()
        _run_v4_blender_phases(
            analysis_input_path,
            output_dir,
            {
                **os.environ,
                REQUESTED_PROFILE_ENV: requested_profile,
                REANALYSIS_ENV: operation,
            },
            job_dir,
        )
        required = (
            output_dir / "diagnostic_report.json",
            output_dir / "avatar_analysis.json",
            output_dir / "diagnostic_landmarks.glb",
        )
        missing = [path.name for path in required if not path.is_file()]
        if missing:
            raise RuntimeError(f"Avatar Analyzer V4 no generó: {', '.join(missing)}")
        analysis = json.loads((output_dir / "avatar_analysis.json").read_text(encoding="utf-8"))
        cached = _persist_run_v4(output_dir, analysis, input_path)
        return job_dir, cached, analysis
    except subprocess.TimeoutExpired as exc:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(status_code=504, detail="El reanálisis V4 agotó el tiempo de procesamiento") from exc
    except HTTPException:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise
    except Exception as exc:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(status_code=422, detail=f"No se pudo reanalizar el avatar con V4: {exc}") from exc


def _persist_run_v4(output_dir: Path, analysis: dict[str, Any], source_path: Path):
    """Atomically retain only user-facing evidence on the bounded volume."""
    run_id = str(analysis.get("runId") or "")
    if not v32.RUN_ID_PATTERN.fullmatch(run_id):
        raise RuntimeError("Avatar Analyzer V4 returned an invalid runId")
    v32._cleanup_expired_runs()
    v32.RUN_CACHE_ROOT.mkdir(parents=True, exist_ok=True)
    destination = v32.RUN_CACHE_ROOT / run_id
    staging = v32.RUN_CACHE_ROOT / f".{run_id}.partial-{uuid.uuid4().hex}"
    try:
        staging.mkdir(parents=True)
        for source in output_dir.rglob("*"):
            if not source.is_file() or source.suffix.lower() not in V4_DURABLE_SUFFIXES:
                continue
            target = staging / source.relative_to(output_dir)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        source_dir = staging / "source"
        source_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, source_dir / "avatar-original-clean.glb")
        (staging / "expires_at.json").write_text(json.dumps({
            "runId": run_id,
            "createdAt": time.time(),
            "expiresAt": time.time() + v32.RUN_TTL_SECONDS,
        }, indent=2), encoding="utf-8")
        shutil.rmtree(destination, ignore_errors=True)
        staging.replace(destination)
        return destination
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def _public_result(run_dir: Path):
    analysis = json.loads((run_dir / "avatar_analysis.json").read_text(encoding="utf-8"))
    if analysis.get("version") != ANALYZER_VERSION or analysis.get("mapVersion") != MAP_VERSION:
        raise HTTPException(status_code=410, detail={
            "code": "ANALYZER_RESULT_STALE",
            "message": "El resultado fue invalidado porque cambió el Analyzer o el mapa anatómico.",
            "storedAnalyzerVersion": analysis.get("version"),
            "currentAnalyzerVersion": ANALYZER_VERSION,
            "storedMapVersion": analysis.get("mapVersion"),
            "currentMapVersion": MAP_VERSION,
        })
    report = json.loads((run_dir / "diagnostic_report.json").read_text(encoding="utf-8"))
    landmarks = analysis.get("landmarks") or {}
    accepted = {
        name: item for name, item in landmarks.items()
        if isinstance(item, dict) and item.get("state") in APPROVED_STATES
    }
    rejected = {
        name: item for name, item in landmarks.items()
        if isinstance(item, dict) and item.get("state") not in APPROVED_STATES
    }
    renders = []
    for directory_name in ("renders_v4", "renders_temporales", "renders_initial"):
        directory = run_dir / directory_name
        if directory.is_dir():
            renders.extend(
                f"{directory_name}/{path.name}"
                for path in sorted(directory.iterdir())
                if path.is_file() and path.suffix.lower() in {".png", ".json", ".npy"}
            )
    return {
        "id": analysis.get("runId"),
        "runId": analysis.get("runId"),
        "createdAt": analysis.get("createdAt") or analysis.get("timestamp"),
        "source": analysis.get("source") or {},
        "summary": _summary(analysis),
        "analysis": analysis,
        "report": report,
        "acceptedLandmarks": accepted,
        "rejectedLandmarks": rejected,
        "assets": {"diagnosticGlb": "diagnostic_landmarks.glb", "renders": renders},
    }


def _assert_profile_ready(analysis: dict[str, Any], requested_profile: str):
    if requested_profile not in RIG_PROFILES:
        raise HTTPException(status_code=400, detail="Perfil de rig inválido")
    supported = set(analysis.get("supported_rig_profiles") or [])
    if requested_profile not in supported:
        raise HTTPException(status_code=409, detail={
            "code": "INCOMPATIBLE_WITH_REQUESTED_PROFILE",
            "message": f"La malla no soporta {requested_profile}",
            "requestedRigProfile": requested_profile,
            "supportedRigProfiles": sorted(supported),
            "blockingReasons": analysis.get("blocking_reasons") or [],
            "recommendedNextAction": analysis.get("recommended_next_action"),
        })
    if analysis.get("overall_status") not in {"approved", "approved_with_fallbacks"}:
        raise HTTPException(status_code=409, detail={
            "code": "AVATAR_ANALYZER_V4_NOT_APPROVED",
            "message": "El perfil solicitado todavía necesita revisión",
            "summary": _summary(analysis),
        })
    return _summary(analysis)


@app.post("/avatar/analyze-v4")
def analyze_avatar_v4(request: AvatarAnalyzeV4Request):
    with v32.ANALYZER_RIG_LOCK:
        job_dir, output_dir, _cached, analysis = _run_analysis_v4(
            str(request.source_url), request.requested_rig_profile,
        )
    archive_base = job_dir / "clouva-avatar-analysis-v4"
    archive_path = archive_base.with_suffix(".zip")
    try:
        if not request.include_renders:
            for name in ("renders_v4", "renders_temporales", "renders_initial"):
                shutil.rmtree(output_dir / name, ignore_errors=True)
        shutil.make_archive(str(archive_base), "zip", root_dir=str(output_dir))
        return FileResponse(
            archive_path,
            media_type="application/zip",
            filename="clouva-avatar-analysis-v4.zip",
            background=BackgroundTask(shutil.rmtree, job_dir, True),
            headers=_headers(analysis),
        )
    except Exception as exc:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(status_code=422, detail=f"No se pudo empaquetar V4: {exc}") from exc


@app.post("/avatar/analyze-v4-preview")
def analyze_avatar_v4_preview(request: AvatarAnalyzeV4Request):
    with v32.ANALYZER_RIG_LOCK:
        job_dir, output_dir, _cached, analysis = _run_analysis_v4(
            str(request.source_url), request.requested_rig_profile,
        )
    return FileResponse(
        output_dir / "diagnostic_landmarks.glb",
        media_type="model/gltf-binary",
        filename="clouva-avatar-diagnostic-v4.glb",
        background=BackgroundTask(shutil.rmtree, job_dir, True),
        headers=_headers(analysis),
    )


@app.get("/avatar/analyze-v4/result/{run_id}")
def avatar_analyze_v4_result(run_id: str):
    v32._cleanup_expired_runs()
    return JSONResponse(_public_result(v32._safe_run_dir(run_id)))


@app.get("/avatar/analyze-v4/result/{run_id}/asset/{asset_path:path}")
def avatar_analyze_v4_asset(run_id: str, asset_path: str):
    run_dir = v32._safe_run_dir(run_id)
    requested = (run_dir / asset_path).resolve()
    if run_dir not in requested.parents or not requested.is_file():
        raise HTTPException(status_code=404, detail="Archivo de diagnóstico V4 no encontrado")
    allowed = {".png", ".json", ".glb", ".npy"}
    if requested.suffix.lower() not in allowed:
        raise HTTPException(status_code=403, detail="Tipo de archivo no permitido")
    media_type = {
        ".png": "image/png", ".json": "application/json",
        ".glb": "model/gltf-binary", ".npy": "application/octet-stream",
    }[requested.suffix.lower()]
    return FileResponse(requested, media_type=media_type, filename=requested.name)


@app.post("/avatar/analyze-v4/result/{run_id}/manual-corrections")
def save_v4_manual_corrections(run_id: str, request: ManualCorrectionRequestV4):
    run_dir = v32._safe_run_dir(run_id)
    path = run_dir / "avatar_analysis.json"
    analysis = json.loads(path.read_text(encoding="utf-8"))
    landmarks = analysis.get("landmarks") or {}
    serialized = []
    for correction in request.corrections:
        record = landmarks.get(correction.name)
        if not isinstance(record, dict):
            raise HTTPException(status_code=404, detail=f"Landmark no encontrado: {correction.name}")
        current_internal = record.get("internalJointPosition") or record.get("position")
        proposed = correction.proposed_internal_position or current_internal
        if not isinstance(proposed, list) or len(proposed) != 3:
            raise HTTPException(
                status_code=422,
                detail="El clic superficial no puede guardarse como articulación interna sin candidato anatómico",
            )
        # The surface click is evidence only. The internal point remains current or
        # comes from the center-section solver supplied by the diagnostic viewer.
        record.update({
            "manualSurfaceEvidence": [float(value) for value in correction.surface_click],
            "manualCorrectionApproved": bool(correction.approved),
            "manual_verified": bool(correction.approved),
            "position": [float(value) for value in proposed],
            "internalJointPosition": [float(value) for value in proposed],
            "note": correction.note,
        })
        serialized.append({
            "name": correction.name,
            "surfaceEvidence": correction.surface_click,
            "previousInternalPosition": current_internal,
            "proposedInternalPosition": proposed,
            "approved": correction.approved,
            "note": correction.note,
        })
    upgraded = upgrade_analysis_v4(
        analysis,
        requested_rig_profile=request.requested_rig_profile,
        camera_calibration=analysis.get("camera_calibration") or {},
        config=analysis.get("confidence_gate_config") or None,
    )
    path.write_text(json.dumps(upgraded, indent=2, ensure_ascii=False), encoding="utf-8")
    payload = {
        "version": "clouva-avatar-analysis-manual-corrections-v4.1",
        "runId": run_id,
        "timestamp": time.time(),
        "corrections": serialized,
        "summary": _summary(upgraded),
    }
    (run_dir / "avatar_analysis_corrections_v4.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8",
    )
    return payload


@app.post("/avatar/analyze-v4/result/{run_id}/reanalyze")
def targeted_reanalysis_v4(run_id: str, request: TargetedReanalysisRequestV4):
    run_dir = v32._safe_run_dir(run_id)
    plan = build_targeted_reanalysis_plan(request.operation, request.landmark)
    if request.camera_id:
        plan["cameras"] = [request.camera_id]
    if request.region:
        plan["regions"] = [request.region]
    source_path = run_dir / "source" / "avatar-original-clean.glb"
    with v32.ANALYZER_RIG_LOCK:
        job_dir, _cached, analysis = _rerun_cached_source_v4(
            source_path,
            request.requested_rig_profile,
            request.operation,
        )
    try:
        new_run_id = str(analysis.get("runId") or "")
        return {
            "status": "completed",
            "targeted": True,
            "executedAsCleanPipeline": True,
            "sourceRunId": run_id,
            "newRunId": new_run_id,
            "resultPath": f"/avatar/analyze-v4/result/{new_run_id}",
            "plan": plan,
            "summary": _summary(analysis),
        }
    finally:
        shutil.rmtree(job_dir, ignore_errors=True)


@app.post("/avatar/complete-rig-v4")
def complete_avatar_rig_v4(request: AnalyzerV4CompleteRigRequest):
    with v32.ANALYZER_RIG_LOCK:
        job_dir, _output_dir, cached, analysis = _run_analysis_v4(
            str(request.source_url), request.requested_rig_profile,
        )
        try:
            summary = _assert_profile_ready(analysis, request.requested_rig_profile)
            analysis_path = cached / "avatar_analysis.json"
            previous_analysis = os.environ.get(v32.ANALYZER_ENV)
            previous_profile = os.environ.get(REQUESTED_PROFILE_ENV)
            previous_script = v32.current.COMPLETE_AVATAR_RIG_SCRIPT
            os.environ[v32.ANALYZER_ENV] = str(analysis_path)
            os.environ[REQUESTED_PROFILE_ENV] = request.requested_rig_profile
            v32.current.COMPLETE_AVATAR_RIG_SCRIPT = ANALYZER_AUTORIG_V4_SCRIPT
            try:
                response = v32.current.complete_avatar_rig_v16(request)
            finally:
                v32.current.COMPLETE_AVATAR_RIG_SCRIPT = previous_script
                if previous_analysis is None:
                    os.environ.pop(v32.ANALYZER_ENV, None)
                else:
                    os.environ[v32.ANALYZER_ENV] = previous_analysis
                if previous_profile is None:
                    os.environ.pop(REQUESTED_PROFILE_ENV, None)
                else:
                    os.environ[REQUESTED_PROFILE_ENV] = previous_profile
            profile = json.loads(response.headers.get("X-Clouva-Rig-Profile") or "{}")
            if profile.get("analyzedInputSha256") != profile.get("rigInputSha256"):
                raise HTTPException(status_code=422, detail="El SHA analizado no coincide con el archivo riggeado")
            if profile.get("analyzedInputSha256") != summary["sourceSha256"]:
                raise HTTPException(status_code=422, detail="El Worker intentó riggear otro archivo")
            if profile.get("analyzerRunId") != summary["runId"]:
                raise HTTPException(status_code=422, detail="El rig no conserva el runId del Analyzer V4")
            response.headers["X-Clouva-Rig-Profile"] = json.dumps(profile, separators=(",", ":"))
            response.headers["X-Clouva-Analyzer-Run-Id"] = str(summary["runId"])
            response.headers["X-Clouva-Analyzer-Version"] = AVATAR_ANALYZER_V4_VERSION
            response.headers["X-Clouva-Analyzed-Input-Sha256"] = str(summary["sourceSha256"])
            response.headers["X-Clouva-Requested-Rig-Profile"] = request.requested_rig_profile
            response.headers["X-Clouva-Rig-Readiness"] = str(summary["rigReadinessScore"])
            return response
        finally:
            shutil.rmtree(job_dir, ignore_errors=True)


@app.get("/diagnostics/avatar-analyzer-v4")
def avatar_analyzer_v4_health():
    v32._cleanup_expired_runs()
    return {
        "ok": AVATAR_ANALYZER_V4_SCRIPT.is_file() and ANALYZER_AUTORIG_V4_SCRIPT.is_file(),
        "version": AVATAR_ANALYZER_V4_VERSION,
        "legacyV32Preserved": True,
        "defaultRigProfile": "body_only",
        "rigProfiles": list(RIG_PROFILES),
        "createsArmature": False,
        "modifiesOriginalAvatar": False,
        "temporaryCanonicalCopy": True,
        "adaptiveBodyFaceHandViews": True,
        "cameraProjectionSelfTest": True,
        "topologyCapabilityScan": True,
        "jointCorridors": True,
        "profileAwareSkeletonPlanner": True,
        "rootCauseGrouping": True,
        "manualSurfaceClickIsEvidenceOnly": True,
        "durableRunCache": str(v32.RUN_CACHE_ROOT),
        "runTtlSeconds": v32.RUN_TTL_SECONDS,
        "durableCachePolicy": "json-png-glb-source-30d",
        "routes": [
            "/avatar/analyze-v4",
            "/avatar/analyze-v4-preview",
            "/avatar/analyze-v4/result/{run_id}",
            "/avatar/analyze-v4/result/{run_id}/manual-corrections",
            "/avatar/analyze-v4/result/{run_id}/reanalyze",
            "/avatar/complete-rig-v4",
        ],
    }
