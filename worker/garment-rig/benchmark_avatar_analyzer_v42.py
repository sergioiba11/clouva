"""Reproducible benchmark for CLOUVA Avatar Analyzer V4.1 versus V4.2.

The script never deploys. It sanitizes one source GLB, executes both analyzers on
the same host/Blender binary and writes wall-clock plus internal metric deltas.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

from analysis_glb_sanitizer import sanitize_glb_for_analysis
from analyzer_v43_incremental import build_incremental_plan

ROOT = Path(__file__).resolve().parent
BASELINE_SCRIPT = ROOT / "avatar_analyzer_v4.py"
CANDIDATE_SCRIPT = ROOT / "avatar_analyzer_v44.py"


def sha256(path: Path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run_blender(blender: str, script: Path, source: Path, output: Path, env: dict[str, str]):
    output.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    process = subprocess.run(
        [
            blender,
            "--background",
            "--factory-startup",
            "--python-exit-code",
            "1",
            "--python",
            str(script),
            "--",
            str(source),
            str(output),
        ],
        cwd=str(output.parent),
        env=env,
        capture_output=True,
        text=True,
        timeout=int(os.environ.get("CLOUVA_BENCHMARK_TIMEOUT_SECONDS", "3600")),
    )
    wall_ms = (time.perf_counter() - started) * 1000.0
    if process.returncode != 0:
        raise RuntimeError((process.stderr or process.stdout or "Blender benchmark failed")[-12000:])
    report_path = output / "diagnostic_report.json"
    analysis_path = output / "avatar_analysis.json"
    report = json.loads(report_path.read_text(encoding="utf-8")) if report_path.is_file() else {}
    analysis = json.loads(analysis_path.read_text(encoding="utf-8")) if analysis_path.is_file() else {}
    return {
        "wallMs": round(wall_ms, 3),
        "report": report,
        "analysis": analysis,
        "stdoutTail": (process.stdout or "")[-2000:],
    }


def run_v41(blender: str, source: Path, output: Path, profile: str):
    environment = {**os.environ, "CLOUVA_REQUESTED_RIG_PROFILE": profile}
    base_result = run_blender(
        blender,
        BASELINE_SCRIPT,
        source,
        output,
        {**environment, "CLOUVA_AVATAR_ANALYZER_V4_PHASE": "base"},
    )
    upgrade_result = run_blender(
        blender,
        BASELINE_SCRIPT,
        source,
        output,
        {**environment, "CLOUVA_AVATAR_ANALYZER_V4_PHASE": "upgrade"},
    )
    return {
        "wallMs": round(base_result["wallMs"] + upgrade_result["wallMs"], 3),
        "baseWallMs": base_result["wallMs"],
        "upgradeWallMs": upgrade_result["wallMs"],
        "report": upgrade_result["report"],
        "analysis": upgrade_result["analysis"],
    }


def run_v42_initial(blender: str, source: Path, output: Path, profile: str):
    return run_blender(
        blender,
        CANDIDATE_SCRIPT,
        source,
        output,
        {
            **os.environ,
            "CLOUVA_REQUESTED_RIG_PROFILE": profile,
            "CLOUVA_AVATAR_ANALYZER_V42_PHASE": "initial",
            "CLOUVA_ANALYZER_FULL_TECHNICAL_PASSES": "false",
        },
    )


def run_v42_incremental(
    blender: str,
    source: Path,
    base_dir: Path,
    previous_analysis: Path,
    output: Path,
    profile: str,
    operation: str,
    landmark: str | None,
):
    plan = build_incremental_plan(
        operation,
        requested_profile=profile,
        landmark=landmark,
    )
    return run_blender(
        blender,
        CANDIDATE_SCRIPT,
        source,
        output,
        {
            **os.environ,
            "CLOUVA_REQUESTED_RIG_PROFILE": profile,
            "CLOUVA_AVATAR_ANALYZER_V42_PHASE": "incremental",
            "CLOUVA_INCREMENTAL_PLAN_JSON": json.dumps(plan, separators=(",", ":")),
            "CLOUVA_PREVIOUS_ANALYSIS_PATH": str(previous_analysis),
            "CLOUVA_BASE_CACHE_DIR": str(base_dir),
            "CLOUVA_ANALYZER_FULL_TECHNICAL_PASSES": "false",
        },
    )


def metrics(result: dict):
    analysis = result.get("analysis") or {}
    values = analysis.get("metrics") if isinstance(analysis.get("metrics"), dict) else {}
    return {
        key: values.get(key)
        for key in (
            "totalMs", "classificationMs", "segmentationMs", "bvhBuildMs",
            "renderPreflightMs", "renderFinalMs", "detectorMs", "sparseProjectionMs",
            "fullTechnicalPassMs", "handGeometryMs", "fingerBranchMs", "faceAnalysisMs",
            "measurementsMs", "mergeMs", "diagnosticBuildMs", "persistenceMs",
            "camerasRendered", "camerasSkipped", "fullTechnicalPassesGenerated",
            "sparseProjectionsGenerated", "raysExecuted", "modulesExecuted",
            "modulesReused", "modulesSkipped", "cacheHits", "cacheMisses",
        )
        if key in values
    }


def reduction(before: float, after: float):
    if before <= 0:
        return None
    return round((before - after) / before * 100.0, 3)


def compare(label: str, before: dict, after: dict, target_ms: float | None):
    before_wall = float(before.get("wallMs") or 0.0)
    after_wall = float(after.get("wallMs") or 0.0)
    return {
        "label": label,
        "beforeWallMs": before_wall,
        "afterWallMs": after_wall,
        "reductionPercent": reduction(before_wall, after_wall),
        "targetMs": target_ms,
        "targetMet": after_wall <= target_ms if target_ms else None,
        "beforeMetrics": metrics(before),
        "afterMetrics": metrics(after),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input_glb", type=Path)
    parser.add_argument("--output", type=Path, default=Path("avatar-analyzer-v42-benchmark.json"))
    parser.add_argument("--profile", default="FULL_HUMANOID")
    parser.add_argument("--operation", default="reanalyze_left_hand")
    parser.add_argument("--landmark", default=None)
    parser.add_argument("--keep-artifacts", action="store_true")
    args = parser.parse_args()

    source = args.input_glb.resolve()
    if not source.is_file():
        raise SystemExit(f"Input GLB not found: {source}")
    blender = os.environ.get("BLENDER_BIN", "blender-headless")
    workspace = Path(tempfile.mkdtemp(prefix="clouva-analyzer-v42-benchmark-"))
    try:
        sanitized = workspace / "avatar-analysis-sanitized.glb"
        sanitization = sanitize_glb_for_analysis(source, sanitized)
        source_hash = sha256(sanitized)

        baseline_initial = run_v41(blender, sanitized, workspace / "v41-initial", args.profile)
        candidate_initial_dir = workspace / "v42-initial"
        candidate_initial = run_v42_initial(blender, sanitized, candidate_initial_dir, args.profile)

        # V4.1 targeted reanalysis is objectively a clean full rerun.
        baseline_targeted = run_v41(blender, sanitized, workspace / "v41-targeted", args.profile)
        candidate_targeted = run_v42_incremental(
            blender,
            candidate_initial_dir / "avatar-analysis-sanitized.glb",
            candidate_initial_dir,
            candidate_initial_dir / "avatar_analysis.json",
            workspace / "v42-targeted",
            args.profile,
            args.operation,
            args.landmark,
        )

        target_ms = 30000.0 if args.operation == "reanalyze_landmark" else 90000.0
        payload = {
            "version": "clouva-avatar-analyzer-benchmark-v4.2",
            "source": str(source),
            "sanitizedSourceSha256": source_hash,
            "sameHost": True,
            "sameBlenderBinary": blender,
            "profile": args.profile,
            "operation": args.operation,
            "landmark": args.landmark,
            "sanitization": sanitization,
            "initial": compare(
                "V4.1 initial versus V4.2 initial",
                baseline_initial,
                candidate_initial,
                300000.0 if args.profile.startswith("FULL_") else 120000.0,
            ),
            "targeted": compare(
                "V4.1 full rerun versus V4.2 incremental reanalysis",
                baseline_targeted,
                candidate_targeted,
                target_ms,
            ),
            "minimumRequiredReductionMet": (
                float(candidate_targeted.get("wallMs") or 0.0)
                <= float(baseline_targeted.get("wallMs") or 0.0) * 0.40
            ),
            "workspace": str(workspace) if args.keep_artifacts else None,
        }
        args.output.resolve().write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    finally:
        if not args.keep_artifacts:
            shutil.rmtree(workspace, ignore_errors=True)


if __name__ == "__main__":
    main()
