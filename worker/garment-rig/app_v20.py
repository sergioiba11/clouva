"""CLOUVA worker API V20: production routing for Avatar Analyzer V4.2.2."""
from __future__ import annotations

import json
from pathlib import Path
import shutil
import time

import app_v19 as v42
from analyzer_v43_incremental import (
    ANALYZER_VERSION,
    MAP_VERSION,
    build_incremental_plan,
)
from fastapi import HTTPException

app = v42.app
v41 = v42.v41
v32 = v42.v32

AVATAR_ANALYZER_V4_SCRIPT = Path(__file__).with_name("avatar_analyzer_v44.py")
v42.AVATAR_ANALYZER_V4_SCRIPT = AVATAR_ANALYZER_V4_SCRIPT
v42.build_incremental_plan = build_incremental_plan
v41.AVATAR_ANALYZER_V4_SCRIPT = AVATAR_ANALYZER_V4_SCRIPT
v41.AVATAR_ANALYZER_V4_VERSION = ANALYZER_VERSION
v41.ANALYZER_VERSION = ANALYZER_VERSION
v41.MAP_VERSION = MAP_VERSION

COMPLETE_AVATAR_RIG_SCRIPT = v42.COMPLETE_AVATAR_RIG_SCRIPT
AVATAR_ANALYZER_VERSION = v42.AVATAR_ANALYZER_VERSION
AVATAR_ANALYZER_SCRIPT = v42.AVATAR_ANALYZER_SCRIPT
ANALYZER_AUTORIG_SCRIPT = v42.ANALYZER_AUTORIG_SCRIPT
ANALYZER_RIG_LOCK = v42.ANALYZER_RIG_LOCK
AVATAR_ANALYZER_V4_VERSION = ANALYZER_VERSION
ANALYZER_AUTORIG_V4_SCRIPT = v42.ANALYZER_AUTORIG_V4_SCRIPT

AvatarAnalyzeV4Request = v42.AvatarAnalyzeV4Request
AnalyzerV4CompleteRigRequest = v42.AnalyzerV4CompleteRigRequest
ManualLandmarkCorrectionV4 = v42.ManualLandmarkCorrectionV4
ManualCorrectionRequestV4 = v42.ManualCorrectionRequestV4
TargetedReanalysisRequestV4 = v42.TargetedReanalysisRequestV4
RigProfileLiteral = v42.RigProfileLiteral


def _read_started(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8")).get("startedAt")
    except Exception:
        return None


def _run_analysis_v42_background(job_id: str, source_url: str, requested_profile: str) -> None:
    status_path = v41._job_status_path(job_id)
    started_at = time.time()
    v42._CONTEXT.job_status_path = status_path
    v41._write_job_status(job_id, {
        "status": "queued",
        "phaseStatus": "queued",
        "progress": 0.0,
        "currentModule": None,
        "startedAt": started_at,
        "updatedAt": started_at,
        "attempts": 1,
        "cacheHits": 0,
        "cacheMisses": 0,
        "modulesExecuted": [],
        "modulesSkipped": [],
    })
    try:
        with v32.ANALYZER_RIG_LOCK:
            job_dir, _output_dir, _cached, analysis = v41._run_analysis_v4(
                source_url,
                requested_profile,
            )
        shutil.rmtree(job_dir, ignore_errors=True)
        metrics = analysis.get("metrics") if isinstance(analysis.get("metrics"), dict) else {}
        completed_at = time.time()
        v41._write_job_status(job_id, {
            "status": "done",
            "phaseStatus": "completed",
            "progress": 1.0,
            "currentModule": None,
            "runId": analysis.get("runId"),
            "summary": v41._summary(analysis),
            "startedAt": _read_started(status_path) or started_at,
            "updatedAt": completed_at,
            "completedAt": completed_at,
            "attempts": 1,
            "cacheHits": int(metrics.get("cacheHits") or 0),
            "cacheMisses": int(metrics.get("cacheMisses") or 0),
            "modulesExecuted": metrics.get("modulesExecuted") or analysis.get("modulesExecuted") or [],
            "modulesSkipped": metrics.get("modulesSkipped") or analysis.get("modulesSkipped") or [],
        })
    except HTTPException as exc:
        completed_at = time.time()
        v41._write_job_status(job_id, {
            "status": "error",
            "phaseStatus": "failed",
            "progress": 1.0,
            "currentModule": None,
            "startedAt": _read_started(status_path) or started_at,
            "updatedAt": completed_at,
            "completedAt": completed_at,
            "detail": str(exc.detail)[:2000],
        })
    except Exception as exc:
        completed_at = time.time()
        v41._write_job_status(job_id, {
            "status": "error",
            "phaseStatus": "failed",
            "progress": 1.0,
            "currentModule": None,
            "startedAt": _read_started(status_path) or started_at,
            "updatedAt": completed_at,
            "completedAt": completed_at,
            "detail": str(exc)[:2000],
        })
    finally:
        v42._CONTEXT.job_status_path = None


v41._run_analysis_v4_background = _run_analysis_v42_background
v42._run_analysis_v4_background = _run_analysis_v42_background


def _remove_route(path: str, method: str):
    for route in list(app.router.routes):
        methods = set(getattr(route, "methods", set()) or set())
        if getattr(route, "path", None) == path and method.upper() in methods:
            app.router.routes.remove(route)


_remove_route("/avatar/analyze-v4/result/{run_id}/reanalyze", "POST")


@app.post("/avatar/analyze-v4/result/{run_id}/reanalyze")
def targeted_reanalysis_v42(run_id: str, request: TargetedReanalysisRequestV4):
    run_dir = v32._safe_run_dir(run_id)
    plan = build_incremental_plan(
        request.operation,
        requested_profile=request.requested_rig_profile,
        camera_id=request.camera_id,
        region=request.region,
        landmark=request.landmark,
    )
    source_path = run_dir / "source" / "avatar-original-clean.glb"
    v42._CONTEXT.targeted_plan = plan
    with v32.ANALYZER_RIG_LOCK:
        job_dir, _cached, analysis = v42._rerun_cached_source_v42(
            source_path,
            request.requested_rig_profile,
            request.operation,
        )
    try:
        new_run_id = str(analysis.get("runId") or "")
        incremental = request.operation != "rerun_full_pipeline"
        return {
            "status": "completed",
            "targeted": incremental,
            "executedAsIncrementalPipeline": incremental,
            "executedAsCleanPipeline": not incremental,
            "sourceRunId": run_id,
            "newRunId": new_run_id,
            "resultPath": f"/avatar/analyze-v4/result/{new_run_id}",
            "plan": plan,
            "modulesExecuted": analysis.get("modulesExecuted") or [],
            "modulesReused": analysis.get("modulesReused") or [],
            "modulesSkipped": analysis.get("modulesSkipped") or [],
            "summary": v41._summary(analysis),
        }
    finally:
        shutil.rmtree(job_dir, ignore_errors=True)


_remove_route("/diagnostics/avatar-analyzer-v4", "GET")


@app.get("/diagnostics/avatar-analyzer-v4")
def avatar_analyzer_v42_health():
    v32._cleanup_expired_runs()
    return {
        "ok": AVATAR_ANALYZER_V4_SCRIPT.is_file() and ANALYZER_AUTORIG_V4_SCRIPT.is_file(),
        "version": ANALYZER_VERSION,
        "mapVersion": MAP_VERSION,
        "legacyV32Preserved": True,
        "publicRoutesPreserved": True,
        "defaultRigProfile": "BODY_BASIC",
        "createsArmature": False,
        "modifiesOriginalAvatar": False,
        "temporaryCanonicalCopy": True,
        "persistentBaseGeometry": True,
        "exactSanitizedTopologyCache": True,
        "independentModules": ["body", "face", "left_hand", "right_hand", "measurements"],
        "profileExecution": {
            "BODY_BASIC": ["body", "measurements"],
            "BODY_FACE": ["body", "face", "measurements"],
            "BODY_HANDS_BASIC": ["body", "left_hand_base", "right_hand_base", "measurements"],
            "FULL_HUMANOID": ["body", "left_hand_fingers", "right_hand_fingers", "measurements"],
            "FULL_BODY_HANDS_FACE": ["body", "left_hand_fingers", "right_hand_fingers", "face", "measurements"],
        },
        "targetedReanalysis": True,
        "sparseLandmarkProjection": True,
        "fullTechnicalPassesEnvironment": "CLOUVA_ANALYZER_FULL_TECHNICAL_PASSES",
        "diagnosticApprovedAsset": "diagnostic-approved.glb",
        "diagnosticFullAsset": "diagnostic-full.glb",
        "diagnosticLegacyAlias": "diagnostic_landmarks.glb",
        "backgroundJobStateMachine": [
            "queued", "preflight", "loading_base", "building_base_geometry",
            "analyzing_body", "analyzing_left_hand", "analyzing_right_hand",
            "analyzing_face", "calculating_measurements", "merging_evidence",
            "building_diagnostics", "persisting", "completed", "failed",
        ],
        "durableRunCache": str(v32.RUN_CACHE_ROOT),
        "runTtlSeconds": v32.RUN_TTL_SECONDS,
        "routes": [
            "/avatar/analyze-v4",
            "/avatar/analyze-v4-preview",
            "/avatar/analyze-v4-preview-async",
            "/avatar/analyze-v4/job/{job_id}",
            "/avatar/analyze-v4/result/{run_id}",
            "/avatar/analyze-v4/result/{run_id}/reanalyze",
            "/avatar/analyze-v4/result/{run_id}/manual-corrections",
            "/avatar/complete-rig-v4",
            "/diagnostics/avatar-analyzer-v4",
        ],
    }
