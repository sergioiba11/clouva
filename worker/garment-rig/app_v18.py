"""Side-by-side CLOUVA Avatar Analyzer V4 API while retaining V3.2 routes."""
from __future__ import annotations

import base64
import gc
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import threading
import time
from typing import Any, Literal
import uuid

import app_v17 as v32
from analysis_glb_sanitizer import sanitize_glb_for_analysis
from analyzer_v4_contract import (
    ANALYZER_VERSION,
    MAP_VERSION,
    RIG_PROFILES,
    build_targeted_reanalysis_plan,
    upgrade_analysis_v4,
)
from fastapi import Header, HTTPException
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
V4_REQUIRED_FILES = ("avatar_analysis.json", "diagnostic_report.json", "diagnostic_landmarks.glb")
PUBLIC_RESULT_BUDGET_BYTES = 24 * 1024 * 1024
RESULT_RETRY_AFTER_SECONDS = 3
MAX_ANALYSIS_INPUT_VERTICES = max(
    20_000,
    int(os.environ.get("CLOUVA_AVATAR_ANALYZER_MAX_INPUT_VERTICES", "2000000")),
)
RigProfileLiteral = Literal[
    "BODY_BASIC", "BODY_FACE", "BODY_HANDS_BASIC", "FULL_HUMANOID", "FULL_BODY_HANDS_FACE",
    "body_only", "body_with_hands", "full_humanoid", "full_humanoid_with_face",
]


class AvatarAnalyzeV4Request(BaseModel):
    source_url: AnyHttpUrl
    include_renders: bool = True
    requested_rig_profile: RigProfileLiteral = "BODY_BASIC"


class AnalyzerV4CompleteRigRequest(v32.current.CompleteAvatarRigRequest):
    force_analyzer: bool = True
    requested_rig_profile: RigProfileLiteral = "BODY_BASIC"


class ManualLandmarkCorrectionV4(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    surface_click: list[float] = Field(min_length=3, max_length=3)
    proposed_internal_position: list[float] | None = Field(default=None, min_length=3, max_length=3)
    approved: bool = True
    note: str | None = Field(default=None, max_length=1000)


class ManualCorrectionRequestV4(BaseModel):
    requested_rig_profile: RigProfileLiteral = "BODY_BASIC"
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
    requested_rig_profile: RigProfileLiteral = "BODY_BASIC"


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
        "requestedRigProfile": analysis.get("requestedRigProfile") or analysis.get("requested_rig_profile"),
        "supportedRigProfiles": analysis.get("supportedRigProfiles") or analysis.get("supported_rig_profiles") or [],
        "requestedProfileReady": bool(analysis.get("requestedProfileReady", analysis.get("rigReadinessApproved"))),
        "requestedProfileBlockingReasons": analysis.get("requestedProfileBlockingReasons") or analysis.get("blocking_reasons") or [],
        "advancedAnalysisWarnings": analysis.get("advancedAnalysisWarnings") or [],
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


def _reject_if_too_heavy(sanitization: dict) -> None:
    total_vertices = int(sanitization.get("totalVertices") or 0)
    if total_vertices > MAX_ANALYSIS_INPUT_VERTICES:
        raise HTTPException(
            status_code=422,
            detail=(
                "El avatar tiene demasiada geometría para analizarse "
                f"({total_vertices} vertices, limite {MAX_ANALYSIS_INPUT_VERTICES}). "
                "Reduci el detalle de la malla antes de subirla."
            ),
        )


class AnalysisCancelled(Exception):
    """Raised when a background analyzer job is cancelled by the client."""


_RUNNING_JOBS_LOCK = threading.Lock()
_RUNNING_JOBS: dict[str, dict[str, Any]] = {}


def _job_cancel_requested(job_id: str | None) -> bool:
    if job_id is None:
        return False
    with _RUNNING_JOBS_LOCK:
        entry = _RUNNING_JOBS.get(job_id)
        return bool(entry and entry.get("cancelRequested"))


def _register_job_process(job_id: str | None, proc: subprocess.Popen | None) -> bool:
    """Track the Blender subprocess currently backing a job.

    Returns False if cancellation was already requested, in which case the
    caller must not let the process keep running.
    """
    if job_id is None:
        return True
    with _RUNNING_JOBS_LOCK:
        entry = _RUNNING_JOBS.setdefault(job_id, {})
        if entry.get("cancelRequested"):
            return False
        entry["proc"] = proc
    return True


def _kill_process_group(proc: subprocess.Popen) -> None:
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        return
    try:
        proc.wait(timeout=5)
        return
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        return
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        pass


def _run_v4_blender_phases(
    input_path: Path,
    output_dir: Path,
    environment: dict[str, str],
    job_dir: Path,
    job_id: str | None = None,
):
    phase_logs = []
    for phase in ("base", "upgrade"):
        if _job_cancel_requested(job_id):
            raise AnalysisCancelled()
        proc = subprocess.Popen(
            [
                legacy.BLENDER_BIN, "--background", "--factory-startup",
                "--python-exit-code", "1", "--python", str(AVATAR_ANALYZER_V4_SCRIPT),
                "--", str(input_path), str(output_dir),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=str(job_dir),
            env={**environment, V4_PHASE_ENV: phase},
            start_new_session=True,
        )
        if not _register_job_process(job_id, proc):
            _kill_process_group(proc)
            raise AnalysisCancelled()
        try:
            stdout, stderr = proc.communicate(timeout=max(legacy.BLENDER_TIMEOUT_SECONDS, 900))
        except subprocess.TimeoutExpired:
            _kill_process_group(proc)
            raise
        finally:
            _register_job_process(job_id, None)
        if _job_cancel_requested(job_id):
            raise AnalysisCancelled()
        phase_logs.append(stderr or stdout or "")
        if proc.returncode != 0:
            technical = (
                stderr
                or stdout
                or f"Blender Avatar Analyzer V4 {phase} phase failed"
            )[-12000:]
            raise RuntimeError(technical)
        gc.collect()
    return phase_logs


def _run_analysis_v4(
    source_url: str,
    requested_profile: str,
    operation: str | None = None,
    job_id: str | None = None,
):
    if not AVATAR_ANALYZER_V4_SCRIPT.is_file():
        raise HTTPException(status_code=500, detail="Falta avatar_analyzer_v4.py en el Blender Worker")
    job_dir = Path(tempfile.mkdtemp(prefix="clouva-avatar-analyzer-v4-"))
    input_path = job_dir / "avatar-original-clean.glb"
    analysis_input_path = job_dir / "avatar-analysis-sanitized.glb"
    output_dir = job_dir / "analysis"
    try:
        if _job_cancel_requested(job_id):
            raise AnalysisCancelled()
        legacy.download(source_url, input_path)
        sanitization = sanitize_glb_for_analysis(input_path, analysis_input_path)
        print(
            "[clouva-avatar-analyzer] pre-Blender GLB sanitizer "
            f"bytes={sanitization['sourceBytes']}->{sanitization['analysisBytes']} "
            f"attributesRemoved={sanitization['attributesRemoved']} "
            f"imagesRemoved={sanitization['imagesRemoved']} "
            f"morphTargetsRemoved={sanitization['morphTargetsRemoved']} "
            f"totalVertices={sanitization['totalVertices']}",
            flush=True,
        )
        _reject_if_too_heavy(sanitization)
        gc.collect()
        environment = {**os.environ, REQUESTED_PROFILE_ENV: requested_profile}
        if operation:
            environment[REANALYSIS_ENV] = operation
        _run_v4_blender_phases(
            analysis_input_path,
            output_dir,
            environment,
            job_dir,
            job_id=job_id,
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
    except AnalysisCancelled:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise
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
        sanitization = sanitize_glb_for_analysis(input_path, analysis_input_path)
        _reject_if_too_heavy(sanitization)
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


def _validate_staged_run(staging: Path, run_id: str) -> None:
    missing = [name for name in V4_REQUIRED_FILES if not (staging / name).is_file()]
    if missing:
        raise RuntimeError(f"Avatar Analyzer V4 durable result incomplete: {', '.join(missing)}")
    staged_analysis = json.loads((staging / "avatar_analysis.json").read_text(encoding="utf-8"))
    json.loads((staging / "diagnostic_report.json").read_text(encoding="utf-8"))
    if str(staged_analysis.get("runId") or "") != run_id:
        raise RuntimeError("Avatar Analyzer V4 staged runId does not match its destination")
    if (staging / "diagnostic_landmarks.glb").stat().st_size < 1024:
        raise RuntimeError("Avatar Analyzer V4 diagnostic GLB is empty")


def _persist_run_v4(output_dir: Path, analysis: dict[str, Any], source_path: Path):
    """Validate a local staging tree and publish it with a final commit marker."""
    run_id = str(analysis.get("runId") or "")
    if not v32.RUN_ID_PATTERN.fullmatch(run_id):
        raise RuntimeError("Avatar Analyzer V4 returned an invalid runId")
    v32._cleanup_expired_runs()
    v32.RUN_CACHE_ROOT.mkdir(parents=True, exist_ok=True)
    destination = v32.RUN_CACHE_ROOT / run_id
    staging = Path(tempfile.mkdtemp(prefix=f"clouva-run-staging-{run_id}-"))
    started = time.perf_counter()
    try:
        for source_file in output_dir.rglob("*"):
            if not source_file.is_file() or source_file.suffix.lower() not in V4_DURABLE_SUFFIXES:
                continue
            target = staging / source_file.relative_to(output_dir)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_file, target)
        source_dir = staging / "source"
        source_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, source_dir / "avatar-original-clean.glb")
        _validate_staged_run(staging, run_id)
        shutil.rmtree(destination, ignore_errors=True)
        shutil.move(str(staging), str(destination))
        marker = destination / "expires_at.json"
        marker_tmp = destination / ".expires_at.json.tmp"
        marker_tmp.write_text(json.dumps({
            "runId": run_id,
            "createdAt": time.time(),
            "expiresAt": time.time() + v32.RUN_TTL_SECONDS,
            "state": "completed",
        }, separators=(",", ":")), encoding="utf-8")
        marker_tmp.replace(marker)
        print(json.dumps({
            "event": "avatar_analyzer_run_persisted",
            "runId": run_id,
            "state": "completed",
            "durationMs": round((time.perf_counter() - started) * 1000, 3),
            "persistentBytes": sum(path.stat().st_size for path in destination.rglob("*") if path.is_file()),
        }, separators=(",", ":")), flush=True)
        return destination
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        if destination.is_dir() and not (destination / "expires_at.json").is_file():
            shutil.rmtree(destination, ignore_errors=True)
        raise


def _strip_public_debug(value: Any):
    if isinstance(value, list):
        return [_strip_public_debug(item) for item in value]
    if not isinstance(value, dict):
        return value
    omitted = {
        "initialAttempt", "finalAttempt", "stdout", "stderr", "subprocessLogs",
        "phaseLogs", "rawDetectorOutput", "rawDetections", "detectorDump",
    }
    return {
        key: _strip_public_debug(item)
        for key, item in value.items()
        if key not in omitted
    }


def _public_result(run_dir: Path):
    analysis_path = run_dir / "avatar_analysis.json"
    analysis = json.loads(analysis_path.read_text(encoding="utf-8"))
    if analysis.get("version") != ANALYZER_VERSION or analysis.get("mapVersion") != MAP_VERSION:
        raise HTTPException(status_code=410, detail={
            "code": "ANALYZER_RESULT_STALE",
            "message": "El resultado fue invalidado porque cambió el Analyzer o el mapa anatómico.",
            "storedAnalyzerVersion": analysis.get("version"),
            "currentAnalyzerVersion": ANALYZER_VERSION,
            "storedMapVersion": analysis.get("mapVersion"),
            "currentMapVersion": MAP_VERSION,
        })
    report_path = run_dir / "diagnostic_report.json"
    report = json.loads(report_path.read_text(encoding="utf-8"))
    public_analysis = _strip_public_debug(analysis)
    public_report = _strip_public_debug(report)
    renders = []
    for directory_name in ("renders_v4", "renders_temporales", "renders_initial"):
        directory = run_dir / directory_name
        if directory.is_dir():
            renders.extend(
                f"{directory_name}/{path.name}"
                for path in sorted(directory.iterdir())
                if path.is_file() and path.suffix.lower() in {".png", ".json"}
            )
    payload = {
        "id": analysis.get("runId"),
        "runId": analysis.get("runId"),
        "createdAt": analysis.get("createdAt") or analysis.get("timestamp"),
        "source": analysis.get("source") or {},
        "summary": _summary(analysis),
        "analysis": public_analysis,
        "report": public_report,
        "assets": {"diagnosticGlb": "diagnostic_landmarks.glb", "renders": renders},
    }
    encoded = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    if len(encoded) > PUBLIC_RESULT_BUDGET_BYTES:
        public_analysis.pop("diagnostics", None)
        if isinstance(public_report, dict):
            public_report.pop("diagnostics", None)
            public_report.pop("debug", None)
        payload["publicPayloadTrimmed"] = True
        encoded = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    if len(encoded) > PUBLIC_RESULT_BUDGET_BYTES:
        essential = {
            "version", "mapVersion", "runId", "createdAt", "timestamp", "source",
            "overall_status", "status", "requested_rig_profile", "supported_rig_profiles",
            "rigReadinessScore", "rigReadinessApproved", "rigReadinessGates",
            "bodyBaseConfidence", "humanoidConfidence", "criticalLandmarksVerified",
            "bodyAnalysis", "faceAnalysis", "leftHandAnalysis", "rightHandAnalysis",
            "landmarks", "warnings", "bodySubsystems", "detectionCoverage", "dimensions",
            "metrics", "orientation", "root_causes", "blocking_reasons",
            "recommended_next_action", "topology_capabilities", "diagnostic_fingerprint",
        }
        payload["analysis"] = {key: value for key, value in public_analysis.items() if key in essential}
        payload["report"] = {"publicPayloadTrimmed": True}
        payload["publicPayloadTrimmed"] = True
        encoded = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    if len(encoded) > PUBLIC_RESULT_BUDGET_BYTES:
        raise HTTPException(status_code=413, detail={
            "code": "ANALYZER_PUBLIC_RESULT_BUDGET_EXCEEDED",
            "message": "El diagnóstico supera el presupuesto público aun después de eliminar evidencia regenerable.",
            "publicBytes": len(encoded),
            "budgetBytes": PUBLIC_RESULT_BUDGET_BYTES,
        })
    landmarks = analysis.get("landmarks") if isinstance(analysis.get("landmarks"), dict) else {}
    print(json.dumps({
        "event": "avatar_analyzer_public_result",
        "runId": analysis.get("runId"),
        "persistedAnalysisBytes": analysis_path.stat().st_size,
        "persistedReportBytes": report_path.stat().st_size,
        "publicBytes": len(encoded),
        "landmarkCount": len(landmarks),
        "renderCount": len(renders),
        "trimmed": bool(payload.get("publicPayloadTrimmed")),
    }, separators=(",", ":")), flush=True)
    return payload


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


JOBS_ROOT = v32.RUN_CACHE_ROOT.parent / "avatar-analyzer-jobs"


def _job_status_path(job_id: str) -> Path:
    return JOBS_ROOT / f"{job_id}.json"


def _write_job_status(job_id: str, payload: dict[str, Any]) -> None:
    path = _job_status_path(job_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload), encoding="utf-8")
    tmp.replace(path)


def _run_analysis_v4_background(job_id: str, source_url: str, requested_profile: str) -> None:
    try:
        with v32.ANALYZER_RIG_LOCK:
            if _job_cancel_requested(job_id):
                raise AnalysisCancelled()
            job_dir, _output_dir, _cached, analysis = _run_analysis_v4(
                source_url, requested_profile, job_id=job_id,
            )
        shutil.rmtree(job_dir, ignore_errors=True)
        _write_job_status(job_id, {
            "status": "done",
            "runId": analysis.get("runId"),
            "summary": _summary(analysis),
        })
    except AnalysisCancelled:
        _write_job_status(job_id, {"status": "cancelled"})
    except HTTPException as exc:
        _write_job_status(job_id, {"status": "error", "detail": str(exc.detail)[:2000]})
    except Exception as exc:
        _write_job_status(job_id, {"status": "error", "detail": str(exc)[:2000]})
    finally:
        with _RUNNING_JOBS_LOCK:
            _RUNNING_JOBS.pop(job_id, None)


@app.post("/avatar/analyze-v4-preview-async")
def analyze_avatar_v4_preview_async(request: AvatarAnalyzeV4Request):
    """Kick off analysis in the background and return immediately.

    A full analysis run can take several minutes, which exceeds typical
    proxy/gateway idle timeouts (Railway's edge, Node's fetch headers
    timeout) if held open as one synchronous request. Callers should poll
    GET /avatar/analyze-v4/job/{job_id} until status is done or error.
    """
    job_id = uuid.uuid4().hex
    _write_job_status(job_id, {"status": "pending"})
    threading.Thread(
        target=_run_analysis_v4_background,
        args=(job_id, str(request.source_url), request.requested_rig_profile),
        daemon=True,
    ).start()
    return {"jobId": job_id, "status": "pending"}


@app.get("/avatar/analyze-v4/job/{job_id}")
def avatar_analyze_v4_job_status(job_id: str):
    if not v32.RUN_ID_PATTERN.fullmatch(job_id):
        raise HTTPException(status_code=400, detail="job_id inválido")
    path = _job_status_path(job_id)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Job no encontrado")
    return JSONResponse(json.loads(path.read_text(encoding="utf-8")))


@app.post("/avatar/analyze-v4/job/{job_id}/cancel")
def avatar_analyze_v4_job_cancel(job_id: str):
    """Cancel a queued or running analysis job.

    Terminates the active Blender subprocess (if any), which unblocks the
    background thread waiting on/holding ANALYZER_RIG_LOCK so it can release
    it immediately, and marks the job as cancelled. Terminal jobs (done,
    error, already cancelled) are returned unchanged.
    """
    if not v32.RUN_ID_PATTERN.fullmatch(job_id):
        raise HTTPException(status_code=400, detail="job_id inválido")
    path = _job_status_path(job_id)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Job no encontrado")
    current = json.loads(path.read_text(encoding="utf-8"))
    if current.get("status") != "pending":
        return JSONResponse(current)

    with _RUNNING_JOBS_LOCK:
        entry = _RUNNING_JOBS.setdefault(job_id, {})
        entry["cancelRequested"] = True
        proc = entry.get("proc")
    if proc is not None and proc.poll() is None:
        _kill_process_group(proc)

    payload = {"status": "cancelled"}
    _write_job_status(job_id, payload)
    return JSONResponse(payload)


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


def _result_still_persisting(run_id: str):
    raise HTTPException(
        status_code=503,
        detail={
            "code": "ANALYZER_RESULT_STILL_PERSISTING",
            "message": "El diagnóstico todavía se está guardando. Probá de nuevo en unos segundos.",
            "runId": run_id,
            "retryAfterSeconds": RESULT_RETRY_AFTER_SECONDS,
        },
        headers={"Retry-After": str(RESULT_RETRY_AFTER_SECONDS)},
    )


@app.get("/avatar/analyze-v4/result/{run_id}")
def avatar_analyze_v4_result(run_id: str):
    v32._cleanup_expired_runs()
    run_dir = v32._safe_run_dir(run_id)
    if not (run_dir / "expires_at.json").is_file():
        _result_still_persisting(run_id)
    try:
        return JSONResponse(_public_result(run_dir))
    except HTTPException:
        raise
    except (json.JSONDecodeError, FileNotFoundError, OSError):
        _result_still_persisting(run_id)


@app.get("/avatar/analyze-v4/result/{run_id}/asset/{asset_path:path}")
def avatar_analyze_v4_asset(run_id: str, asset_path: str):
    run_dir = v32._safe_run_dir(run_id)
    if not (run_dir / "expires_at.json").is_file():
        _result_still_persisting(run_id)
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


def _classify_cache_file(path: Path, run_cache_root: Path) -> str:
    try:
        relative = path.relative_to(run_cache_root)
    except ValueError:
        return "other"
    parts = relative.parts
    name = path.name
    if "source" in parts and path.suffix.lower() == ".glb":
        return "glb_source"
    if name == "diagnostic_landmarks.glb":
        return "glb_diagnostic"
    if any(part.startswith("renders_") for part in parts):
        return "renders"
    if name in ("avatar_analysis.json", "diagnostic_report.json", "avatar_analysis_corrections_v4.json"):
        return "results_json"
    if name == "expires_at.json":
        return "expiry_marker"
    return "other"


class MigrateToGcsRequest(BaseModel):
    bucket: str = Field(min_length=1, max_length=222)
    destination_prefix: str = Field(default="railway-volume-migration", max_length=200)


def _gcs_client_from_env():
    import json as _json

    from google.cloud import storage as gcs_storage
    from google.oauth2 import service_account

    raw = os.environ.get("CLOUVA_GCS_MIGRATION_CREDENTIALS_JSON")
    if not raw:
        raise HTTPException(status_code=500, detail="Falta CLOUVA_GCS_MIGRATION_CREDENTIALS_JSON en el Worker")
    info = _json.loads(raw)
    credentials = service_account.Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/devstorage.read_write"],
    )
    return gcs_storage.Client(project=info.get("project_id"), credentials=credentials)


_MIGRATION_JOBS_LOCK = threading.Lock()
_MIGRATION_JOBS: dict[str, dict[str, Any]] = {}


def _file_sha256(path: Path) -> str:
    with open(path, "rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def _run_migration_to_gcs_background(migration_job_id: str, bucket_name: str, prefix: str) -> None:
    def _update(**changes: Any) -> None:
        with _MIGRATION_JOBS_LOCK:
            _MIGRATION_JOBS[migration_job_id].update(changes)

    try:
        client = _gcs_client_from_env()
        bucket = client.bucket(bucket_name)

        run_cache_root = v32.RUN_CACHE_ROOT
        sources: list[tuple[Path, Path]] = []
        if run_cache_root.is_dir():
            for file_path in run_cache_root.rglob("*"):
                if file_path.is_file():
                    sources.append((file_path, run_cache_root))
        if JOBS_ROOT.is_dir():
            for file_path in JOBS_ROOT.glob("*.json"):
                if file_path.is_file():
                    sources.append((file_path, JOBS_ROOT.parent))

        _update(filesConsidered=len(sources))
        uploaded = {"count": 0, "bytes": 0}
        skipped_identical = {"count": 0, "bytes": 0}
        failures: list[dict[str, str]] = []

        for file_path, root in sources:
            relative = file_path.relative_to(root)
            blob_name = f"{prefix}/{relative.as_posix()}"
            size = file_path.stat().st_size
            local_sha256 = _file_sha256(file_path)
            blob = bucket.blob(blob_name)
            try:
                blob.reload()
                existing_sha256 = (blob.metadata or {}).get("sha256")
                if blob.size == size and existing_sha256 == local_sha256:
                    skipped_identical["count"] += 1
                    skipped_identical["bytes"] += size
                    _update(skippedIdentical=dict(skipped_identical))
                    continue
            except Exception:
                pass
            try:
                blob.metadata = {"sha256": local_sha256, "migratedFrom": "railway-clouva-volume"}
                blob.upload_from_filename(str(file_path), checksum="crc32c")
                blob.reload()
                if (blob.metadata or {}).get("sha256") != local_sha256:
                    raise RuntimeError("sha256 mismatch after upload")
                uploaded["count"] += 1
                uploaded["bytes"] += size
                _update(uploaded=dict(uploaded))
            except Exception as exc:
                failures.append({"path": str(relative), "error": str(exc)[:500]})
                _update(failures=list(failures))

        _update(status="done", uploaded=uploaded, skippedIdentical=skipped_identical, failures=failures)
    except Exception as exc:
        _update(status="error", detail=str(exc)[:2000])


@app.post("/diagnostics/avatar-analyzer-v4-migrate-to-gcs")
def avatar_analyzer_v4_migrate_to_gcs(
    request: MigrateToGcsRequest,
    x_migration_token: str | None = Header(default=None, alias="X-Migration-Token"),
):
    expected_token = os.environ.get("CLOUVA_MIGRATION_TOKEN")
    if not expected_token or x_migration_token != expected_token:
        raise HTTPException(status_code=403, detail="Token de migración inválido o faltante")

    prefix = request.destination_prefix.strip("/")
    migration_job_id = uuid.uuid4().hex
    with _MIGRATION_JOBS_LOCK:
        _MIGRATION_JOBS[migration_job_id] = {
            "status": "running",
            "bucket": request.bucket,
            "destinationPrefix": prefix,
            "filesConsidered": 0,
            "uploaded": {"count": 0, "bytes": 0},
            "skippedIdentical": {"count": 0, "bytes": 0},
            "failures": [],
        }
    threading.Thread(
        target=_run_migration_to_gcs_background,
        args=(migration_job_id, request.bucket, prefix),
        daemon=True,
    ).start()
    return {"migrationJobId": migration_job_id, "status": "running"}


@app.get("/diagnostics/avatar-analyzer-v4-migrate-to-gcs/{migration_job_id}")
def avatar_analyzer_v4_migrate_to_gcs_status(
    migration_job_id: str,
    x_migration_token: str | None = Header(default=None, alias="X-Migration-Token"),
):
    expected_token = os.environ.get("CLOUVA_MIGRATION_TOKEN")
    if not expected_token or x_migration_token != expected_token:
        raise HTTPException(status_code=403, detail="Token de migración inválido o faltante")
    with _MIGRATION_JOBS_LOCK:
        job = _MIGRATION_JOBS.get(migration_job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Migration job no encontrado")
        return dict(job)


@app.get("/diagnostics/avatar-analyzer-v4-storage-inventory")
def avatar_analyzer_v4_storage_inventory():
    """Read-only inventory of this worker's local run-cache disk, by category.

    Reports aggregate counts/bytes only (no filenames or run IDs), so it is
    safe to leave world-readable like the existing health diagnostics route.
    """
    run_cache_root = v32.RUN_CACHE_ROOT
    categories: dict[str, dict[str, int]] = {}

    def _bump(category: str, size: int) -> None:
        entry = categories.setdefault(category, {"count": 0, "bytes": 0})
        entry["count"] += 1
        entry["bytes"] += size

    run_dir_count = 0
    incomplete_run_count = 0
    incomplete_run_bytes = 0
    if run_cache_root.is_dir():
        for run_dir in run_cache_root.iterdir():
            if not run_dir.is_dir():
                continue
            run_dir_count += 1
            has_marker = (run_dir / "expires_at.json").is_file()
            for file_path in run_dir.rglob("*"):
                if not file_path.is_file():
                    continue
                size = file_path.stat().st_size
                _bump(_classify_cache_file(file_path, run_cache_root), size)
                if not has_marker:
                    incomplete_run_bytes += size
            if not has_marker:
                incomplete_run_count += 1

    job_status_count = 0
    job_status_bytes = 0
    if JOBS_ROOT.is_dir():
        for job_file in JOBS_ROOT.glob("*.json"):
            if job_file.is_file():
                job_status_count += 1
                job_status_bytes += job_file.stat().st_size

    return {
        "inspectedPath": str(run_cache_root),
        "jobsPath": str(JOBS_ROOT),
        "runDirectoryCount": run_dir_count,
        "incompleteOrAbandonedRuns": {"count": incomplete_run_count, "bytes": incomplete_run_bytes},
        "categories": categories,
        "jobStatusCache": {"count": job_status_count, "bytes": job_status_bytes},
        "runTtlSeconds": v32.RUN_TTL_SECONDS,
    }


@app.get("/diagnostics/avatar-analyzer-v4")
def avatar_analyzer_v4_health():
    v32._cleanup_expired_runs()
    return {
        "ok": AVATAR_ANALYZER_V4_SCRIPT.is_file() and ANALYZER_AUTORIG_V4_SCRIPT.is_file(),
        "version": AVATAR_ANALYZER_V4_VERSION,
        "legacyV32Preserved": True,
        "defaultRigProfile": "BODY_BASIC",
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
            "/diagnostics/avatar-analyzer-v4-storage-inventory",
            "/avatar/analyze-v4",
            "/avatar/analyze-v4-preview",
            "/avatar/analyze-v4/result/{run_id}",
            "/avatar/analyze-v4/result/{run_id}/manual-corrections",
            "/avatar/analyze-v4/result/{run_id}/reanalyze",
            "/avatar/complete-rig-v4",
        ],
    }
