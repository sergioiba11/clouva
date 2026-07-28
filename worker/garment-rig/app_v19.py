"""CLOUVA worker API V19: Avatar Analyzer V4.2 incremental execution.

Public routes stay unchanged. The V4.1 API module is retained as the compatibility
surface while its Blender runner, targeted reanalysis plan and public assets are
replaced with the V4.2 implementations below.
"""
from __future__ import annotations

import gc
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import time
from typing import Any

import app_v18 as v41
from analysis_glb_sanitizer import sanitize_glb_for_analysis
from analyzer_v42_incremental import (
    ANALYZER_VERSION,
    MAP_VERSION,
    build_incremental_plan,
    canonical_profile,
)
from fastapi import HTTPException

app = v41.app
base = v41.base
legacy = v41.legacy
v32 = v41.v32

COMPLETE_AVATAR_RIG_SCRIPT = v41.COMPLETE_AVATAR_RIG_SCRIPT
AVATAR_ANALYZER_VERSION = v41.AVATAR_ANALYZER_VERSION
AVATAR_ANALYZER_SCRIPT = v41.AVATAR_ANALYZER_SCRIPT
ANALYZER_AUTORIG_SCRIPT = v41.ANALYZER_AUTORIG_SCRIPT
ANALYZER_RIG_LOCK = v41.ANALYZER_RIG_LOCK

AVATAR_ANALYZER_V4_VERSION = ANALYZER_VERSION
AVATAR_ANALYZER_V4_SCRIPT = Path(__file__).with_name("avatar_analyzer_v42.py")
ANALYZER_AUTORIG_V4_SCRIPT = v41.ANALYZER_AUTORIG_V4_SCRIPT
V42_PHASE_ENV = "CLOUVA_AVATAR_ANALYZER_V42_PHASE"
V42_PLAN_ENV = "CLOUVA_INCREMENTAL_PLAN_JSON"
V42_PREVIOUS_ANALYSIS_ENV = "CLOUVA_PREVIOUS_ANALYSIS_PATH"
V42_BASE_CACHE_DIR_ENV = "CLOUVA_BASE_CACHE_DIR"
V42_JOB_STATUS_ENV = "CLOUVA_ANALYZER_JOB_STATUS_PATH"

v41.ANALYZER_VERSION = ANALYZER_VERSION
v41.MAP_VERSION = MAP_VERSION
v41.AVATAR_ANALYZER_V4_VERSION = ANALYZER_VERSION
v41.AVATAR_ANALYZER_V4_SCRIPT = AVATAR_ANALYZER_V4_SCRIPT

_CONTEXT = threading.local()
_ORIGINAL_PUBLIC_RESULT = v41._public_result
_BASE_CACHE_FILES = (
    "base_geometry.json",
    "canonical_orientation.json",
    "body_vectors.json",
    "mesh_classifications.json",
    "body_landmarks.json",
    "body_subsystems.json",
    "segmentation.json",
    "segmentation_labels.json",
    "triangle_region_map.json",
    "limb_centerlines.json",
    "body_measurements.json",
    "base_manifest.json",
    "avatar-analysis-sanitized.glb",
)


def _run_blender(
    input_path: Path,
    output_dir: Path,
    environment: dict[str, str],
    job_dir: Path,
    *,
    phase: str,
):
    env = {**environment, V42_PHASE_ENV: phase}
    job_status_path = getattr(_CONTEXT, "job_status_path", None)
    if job_status_path:
        env[V42_JOB_STATUS_ENV] = str(job_status_path)
    started = time.perf_counter()
    result = subprocess.run(
        [
            legacy.BLENDER_BIN,
            "--background",
            "--factory-startup",
            "--python-exit-code",
            "1",
            "--python",
            str(AVATAR_ANALYZER_V4_SCRIPT),
            "--",
            str(input_path),
            str(output_dir),
        ],
        capture_output=True,
        text=True,
        timeout=max(legacy.BLENDER_TIMEOUT_SECONDS, 900),
        cwd=str(job_dir),
        env=env,
    )
    if result.returncode != 0:
        technical = (
            result.stderr
            or result.stdout
            or f"Blender Avatar Analyzer V4.2 {phase} failed"
        )[-12000:]
        raise RuntimeError(technical)
    print(json.dumps({
        "event": "avatar_analyzer_v42_blender_phase",
        "phase": phase,
        "durationMs": round((time.perf_counter() - started) * 1000.0, 3),
    }, separators=(",", ":")), flush=True)
    gc.collect()
    return [result.stderr or result.stdout or ""]


def _run_v42_blender_phases(input_path: Path, output_dir: Path, environment: dict[str, str], job_dir: Path):
    """Compatibility replacement: V4.2 initial analysis runs in one Blender process."""
    return _run_blender(input_path, output_dir, environment, job_dir, phase="initial")


v41._run_v4_blender_phases = _run_v42_blender_phases


def _build_targeted_plan(operation: str, landmark: str | None = None):
    plan = build_incremental_plan(operation, requested_profile="BODY_BASIC", landmark=landmark)
    _CONTEXT.targeted_plan = plan
    return plan


v41.build_targeted_reanalysis_plan = _build_targeted_plan


def _copy_base_cache(run_dir: Path, output_dir: Path):
    output_dir.mkdir(parents=True, exist_ok=True)
    for name in _BASE_CACHE_FILES:
        source = run_dir / name
        if not source.is_file():
            raise HTTPException(status_code=410, detail={
                "code": "ANALYZER_BASE_CACHE_EXPIRED",
                "message": f"Falta el artefacto base persistente {name}.",
            })
        shutil.copy2(source, output_dir / name)
    modules = run_dir / "modules"
    if modules.is_dir():
        shutil.copytree(modules, output_dir / "modules", dirs_exist_ok=True)


def _validate_v42_output(output_dir: Path):
    required = (
        output_dir / "diagnostic_report.json",
        output_dir / "avatar_analysis.json",
        output_dir / "diagnostic_landmarks.glb",
        output_dir / "diagnostic-approved.glb",
        output_dir / "diagnostic-full.glb",
    )
    missing = [path.name for path in required if not path.is_file()]
    if missing:
        raise RuntimeError(f"Avatar Analyzer V4.2 no generó: {', '.join(missing)}")


def _full_rerun_from_source(source_path: Path, requested_profile: str):
    job_dir = Path(tempfile.mkdtemp(prefix="clouva-avatar-analyzer-v42-full-"))
    input_path = job_dir / "avatar-original-clean.glb"
    analysis_input_path = job_dir / "avatar-analysis-sanitized.glb"
    output_dir = job_dir / "analysis"
    try:
        shutil.copy2(source_path, input_path)
        sanitization = sanitize_glb_for_analysis(input_path, analysis_input_path)
        v41._reject_if_too_heavy(sanitization)
        _run_blender(
            analysis_input_path,
            output_dir,
            {**os.environ, v41.REQUESTED_PROFILE_ENV: requested_profile},
            job_dir,
            phase="initial",
        )
        _validate_v42_output(output_dir)
        analysis = json.loads((output_dir / "avatar_analysis.json").read_text(encoding="utf-8"))
        cached = v41._persist_run_v4(output_dir, analysis, input_path)
        return job_dir, cached, analysis
    except subprocess.TimeoutExpired as exc:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(status_code=504, detail="El análisis V4.2 agotó el tiempo de procesamiento") from exc
    except HTTPException:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise
    except Exception as exc:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(status_code=422, detail=f"No se pudo ejecutar Avatar Analyzer V4.2: {exc}") from exc


def _rerun_cached_source_v42(source_path: Path, requested_profile: str, operation: str):
    if not source_path.is_file():
        raise HTTPException(status_code=410, detail={
            "code": "ANALYZER_SOURCE_EXPIRED",
            "message": "El GLB original de este run ya no está disponible para reanálisis.",
        })
    if operation == "rerun_full_pipeline":
        return _full_rerun_from_source(source_path, requested_profile)

    run_dir = source_path.parent.parent
    previous_analysis = run_dir / "avatar_analysis.json"
    canonical_input = run_dir / "avatar-analysis-sanitized.glb"
    if not previous_analysis.is_file() or not canonical_input.is_file():
        raise HTTPException(status_code=410, detail={
            "code": "ANALYZER_BASE_CACHE_EXPIRED",
            "message": "El run no conserva la base geométrica V4.2 necesaria para reanálisis incremental.",
        })

    raw_plan = dict(getattr(_CONTEXT, "targeted_plan", {}) or {})
    camera_id = next(iter(raw_plan.get("cameras") or []), None)
    region = next(iter(raw_plan.get("regions") or []), None)
    landmark = next(iter(raw_plan.get("landmarks") or []), None)
    plan = build_incremental_plan(
        operation,
        requested_profile=requested_profile,
        camera_id=camera_id,
        region=region,
        landmark=landmark,
    )
    job_dir = Path(tempfile.mkdtemp(prefix="clouva-avatar-analyzer-v42-incremental-"))
    output_dir = job_dir / "analysis"
    analysis_input = job_dir / "avatar-analysis-sanitized.glb"
    try:
        _copy_base_cache(run_dir, output_dir)
        shutil.copy2(canonical_input, analysis_input)
        _run_blender(
            analysis_input,
            output_dir,
            {
                **os.environ,
                v41.REQUESTED_PROFILE_ENV: canonical_profile(requested_profile),
                v41.REANALYSIS_ENV: operation,
                V42_PLAN_ENV: json.dumps(plan, separators=(",", ":")),
                V42_PREVIOUS_ANALYSIS_ENV: str(previous_analysis),
                V42_BASE_CACHE_DIR_ENV: str(run_dir),
            },
            job_dir,
            phase="incremental",
        )
        _validate_v42_output(output_dir)
        analysis = json.loads((output_dir / "avatar_analysis.json").read_text(encoding="utf-8"))
        cached = v41._persist_run_v4(output_dir, analysis, source_path)
        return job_dir, cached, analysis
    except subprocess.TimeoutExpired as exc:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(status_code=504, detail="El reanálisis incremental V4.2 agotó el tiempo") from exc
    except HTTPException:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise
    except Exception as exc:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(status_code=422, detail=f"No se pudo reanalizar el módulo solicitado con V4.2: {exc}") from exc
    finally:
        _CONTEXT.targeted_plan = None


v41._rerun_cached_source_v4 = _rerun_cached_source_v42


def _public_result_v42(run_dir: Path):
    payload = _ORIGINAL_PUBLIC_RESULT(run_dir)
    assets = payload.setdefault("assets", {})
    assets.update({
        "diagnosticGlb": "diagnostic-approved.glb",
        "diagnosticApprovedGlb": "diagnostic-approved.glb",
        "diagnosticFullGlb": "diagnostic-full.glb",
        "diagnosticLegacyAlias": "diagnostic_landmarks.glb",
    })
    render_dir = run_dir / "renders_v42"
    if render_dir.is_dir():
        existing = list(assets.get("renders") or [])
        for path in sorted(render_dir.iterdir()):
            if path.is_file() and path.suffix.lower() in {".png", ".json"}:
                value = f"renders_v42/{path.name}"
                if value not in existing:
                    existing.append(value)
        assets["renders"] = existing
    return payload


v41._public_result = _public_result_v42


def _run_analysis_v42_background(job_id: str, source_url: str, requested_profile: str) -> None:
    status_path = v41._job_status_path(job_id)
    _CONTEXT.job_status_path = status_path
    v41._write_job_status(job_id, {
        "status": "queued",
        "progress": 0.0,
        "currentModule": None,
        "startedAt": time.time(),
        "updatedAt": time.time(),
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
        v41._write_job_status(job_id, {
            "status": "completed",
            "progress": 1.0,
            "currentModule": None,
            "runId": analysis.get("runId"),
            "summary": v41._summary(analysis),
            "startedAt": _read_started(status_path),
            "updatedAt": time.time(),
            "completedAt": time.time(),
            "attempts": 1,
            "cacheHits": int(metrics.get("cacheHits") or 0),
            "cacheMisses": int(metrics.get("cacheMisses") or 0),
            "modulesExecuted": metrics.get("modulesExecuted") or analysis.get("modulesExecuted") or [],
            "modulesSkipped": metrics.get("modulesSkipped") or analysis.get("modulesSkipped") or [],
        })
    except HTTPException as exc:
        v41._write_job_status(job_id, {
            "status": "failed", "progress": 1.0, "currentModule": None,
            "updatedAt": time.time(), "completedAt": time.time(),
            "detail": str(exc.detail)[:2000],
        })
    except Exception as exc:
        v41._write_job_status(job_id, {
            "status": "failed", "progress": 1.0, "currentModule": None,
            "updatedAt": time.time(), "completedAt": time.time(),
            "detail": str(exc)[:2000],
        })
    finally:
        _CONTEXT.job_status_path = None


def _read_started(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8")).get("startedAt")
    except Exception:
        return None


v41._run_analysis_v4_background = _run_analysis_v42_background

# Re-export request models and route-visible symbols expected by tests/importers.
AvatarAnalyzeV4Request = v41.AvatarAnalyzeV4Request
AnalyzerV4CompleteRigRequest = v41.AnalyzerV4CompleteRigRequest
ManualLandmarkCorrectionV4 = v41.ManualLandmarkCorrectionV4
ManualCorrectionRequestV4 = v41.ManualCorrectionRequestV4
TargetedReanalysisRequestV4 = v41.TargetedReanalysisRequestV4
RigProfileLiteral = v41.RigProfileLiteral
