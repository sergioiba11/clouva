"""Side-by-side CLOUVA Avatar Analyzer V4 API while retaining V3.2 routes."""
from __future__ import annotations

import base64
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
from typing import Any, Literal

import app_v17 as v32
from analyzer_v4_contract import (
    ANALYZER_VERSION,
    APPROVED_STATES,
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


class AvatarAnalyzeV4Request(BaseModel):
    source_url: AnyHttpUrl
    include_renders: bool = True
    requested_rig_profile: Literal[
        "BODY_BASIC", "BODY_FACE", "BODY_HANDS_BASIC", "FULL_BODY_HANDS_FACE"
    ] = "BODY_BASIC"


class AnalyzerV4CompleteRigRequest(v32.current.CompleteAvatarRigRequest):
    force_analyzer: bool = True
    requested_rig_profile: Literal[
        "BODY_BASIC", "BODY_FACE", "BODY_HANDS_BASIC", "FULL_BODY_HANDS_FACE"
    ] = "BODY_BASIC"


class ManualLandmarkCorrectionV4(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    surface_click: list[float] = Field(min_length=3, max_length=3)
    proposed_internal_position: list[float] | None = Field(default=None, min_length=3, max_length=3)
    approved: bool = True
    note: str | None = Field(default=None, max_length=1000)


class ManualCorrectionRequestV4(BaseModel):
    requested_rig_profile: Literal[
        "BODY_BASIC", "BODY_FACE", "BODY_HANDS_BASIC", "FULL_BODY_HANDS_FACE"
    ] = "BODY_BASIC"
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
    requested_rig_profile: Literal[
        "BODY_BASIC", "BODY_FACE", "BODY_HANDS_BASIC", "FULL_BODY_HANDS_FACE"
    ] = "BODY_BASIC"


def _summary(analysis: dict[str, Any]):
    landmarks = analysis.get("landmarks") if isinstance(analysis.get("landmarks"), dict) else {}
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
        "criticalLandmarksVerified": bool(analysis.get("criticalLandmarksVerified")),
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


def _run_analysis_v4(source_url: str, requested_profile: str, operation: str | None = None):
    if not AVATAR_ANALYZER_V4_SCRIPT.is_file():
        raise HTTPException(status_code=500, detail="Falta avatar_analyzer_v4.py en el Blender Worker")
    job_dir = Path(tempfile.mkdtemp(prefix="clouva-avatar-analyzer-v4-"))
    input_path = job_dir / "avatar-original-clean.glb"
    output_dir = job_dir / "analysis"
    try:
        legacy.download(source_url, input_path)
        command = [
            legacy.BLENDER_BIN, "--background", "--factory-startup",
            "--python-exit-code", "1", "--python", str(AVATAR_ANALYZER_V4_SCRIPT),
            "--", str(input_path), str(output_dir),
        ]
        environment = {**os.environ, REQUESTED_PROFILE_ENV: requested_profile}
        if operation:
            environment[REANALYSIS_ENV] = operation
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=max(legacy.BLENDER_TIMEOUT_SECONDS, 900),
            cwd=str(job_dir),
            env=environment,
        )
        report_path = output_dir / "diagnostic_report.json"
        analysis_path = output_dir / "avatar_analysis.json"
        diagnostic_glb = output_dir / "diagnostic_landmarks.glb"
        if result.returncode != 0:
            technical = (result.stderr or result.stdout or "Blender Avatar Analyzer V4 failed")[-12000:]
            raise RuntimeError(technical)
        missing = [path.name for path in (report_path, analysis_path, diagnostic_glb) if not path.is_file()]
        if missing:
            raise RuntimeError(f"Avatar Analyzer V4 no generó: {', '.join(missing)}")
        analysis = json.loads(analysis_path.read_text(encoding="utf-8"))
        cached = v32._persist_run(output_dir, analysis)
        source_dir = cached / "source"
        source_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(input_path, source_dir / "avatar-original-clean.glb")
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


def _public_result(run_dir: Path):
    analysis = json.loads((run_dir / "avatar_analysis.json").read_text(encoding="utf-8"))
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
        "version": "clouva-avatar-analysis-manual-corrections-v4.0",
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
    analysis_path = run_dir / "avatar_analysis.json"
    analysis = json.loads(analysis_path.read_text(encoding="utf-8"))
    plan = build_targeted_reanalysis_plan(request.operation, request.landmark)
    if request.camera_id:
        plan["cameras"] = [request.camera_id]
    if request.region:
        plan["regions"] = [request.region]
    if request.operation == "reanalyze_right_shoulder":
        upgraded = upgrade_analysis_v4(
            analysis,
            requested_rig_profile=request.requested_rig_profile,
            camera_calibration=analysis.get("camera_calibration") or {},
            config=analysis.get("confidence_gate_config") or None,
        )
        analysis_path.write_text(json.dumps(upgraded, indent=2, ensure_ascii=False), encoding="utf-8")
        return {"status": "completed", "targeted": True, "plan": plan, "summary": _summary(upgraded)}
    # Fresh Blender scenes cannot retain a previous scene graph. Region/camera
    # requests are made explicit rather than silently pretending to be targeted.
    return JSONResponse(status_code=409, content={
        "status": "requires_fresh_region_job",
        "targeted": True,
        "plan": plan,
        "message": "La operación quedó definida, pero requiere reenviar source_url para ejecutar una escena Blender temporal nueva.",
    })


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
        "routes": [
            "/avatar/analyze-v4",
            "/avatar/analyze-v4-preview",
            "/avatar/analyze-v4/result/{run_id}",
            "/avatar/analyze-v4/result/{run_id}/manual-corrections",
            "/avatar/analyze-v4/result/{run_id}/reanalyze",
            "/avatar/complete-rig-v4",
        ],
    }
