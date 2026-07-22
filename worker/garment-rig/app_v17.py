"""Worker V17 adds Avatar Analyzer diagnostics without changing AutoRig V16."""
from __future__ import annotations

import base64
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import app_v16 as current
from fastapi import HTTPException
from fastapi.responses import FileResponse
from pydantic import AnyHttpUrl, BaseModel
from starlette.background import BackgroundTask

app = current.app
base = current.base
legacy = current.legacy

# Re-export the worker globals consumed by health checks and tests.
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

AVATAR_ANALYZER_VERSION = "v1-mediapipe-multiview-diagnostic"
AVATAR_ANALYZER_SCRIPT = Path(__file__).with_name("avatar_analyzer.py")


class AvatarAnalyzeRequest(BaseModel):
    source_url: AnyHttpUrl
    include_renders: bool = True


def _analysis_summary(analysis: dict) -> dict:
    landmarks = analysis.get("landmarks") if isinstance(analysis.get("landmarks"), dict) else {}
    warnings = analysis.get("warnings") if isinstance(analysis.get("warnings"), list) else []
    return {
        "status": str(analysis.get("status") or "unknown"),
        "runId": str(analysis.get("runId") or ""),
        "humanoidConfidence": float(analysis.get("humanoidConfidence") or 0.0),
        "faceAnalysis": str(analysis.get("faceAnalysis") or "unknown"),
        "leftHandAnalysis": str(analysis.get("leftHandAnalysis") or "unknown"),
        "rightHandAnalysis": str(analysis.get("rightHandAnalysis") or "unknown"),
        "landmarkCount": len(landmarks),
        "warningCount": len(warnings),
        "rigModified": False,
    }


def _summary_header(summary: dict) -> str:
    raw = json.dumps(summary, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii")


def _run_analysis(source_url: str):
    if not AVATAR_ANALYZER_SCRIPT.is_file():
        raise HTTPException(status_code=500, detail="Falta avatar_analyzer.py en el Blender Worker")

    job_dir = Path(tempfile.mkdtemp(prefix="clouva-avatar-analyzer-v1-"))
    input_path = job_dir / "avatar-original-clean.glb"
    output_dir = job_dir / "analysis"
    try:
        legacy.download(source_url, input_path)
        command = [
            legacy.BLENDER_BIN,
            "--background",
            "--factory-startup",
            "--python-exit-code",
            "1",
            "--python",
            str(AVATAR_ANALYZER_SCRIPT),
            "--",
            str(input_path),
            str(output_dir),
        ]
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=max(legacy.BLENDER_TIMEOUT_SECONDS, 240),
            cwd=str(job_dir),
        )
        report_path = output_dir / "diagnostic_report.json"
        analysis_path = output_dir / "avatar_analysis.json"
        diagnostic_glb = output_dir / "diagnostic_landmarks.glb"
        if result.returncode != 0:
            technical = (result.stderr or result.stdout or "Blender Avatar Analyzer failed")[-12000:]
            raise RuntimeError(technical)
        missing = [
            str(path.name)
            for path in (report_path, analysis_path, diagnostic_glb)
            if not path.is_file()
        ]
        if missing:
            raise RuntimeError(f"Avatar Analyzer no generó: {', '.join(missing)}")
        analysis = json.loads(analysis_path.read_text(encoding="utf-8"))
        return job_dir, output_dir, analysis
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


@app.post("/avatar/analyze")
def analyze_avatar(request: AvatarAnalyzeRequest):
    """Return the complete phase-1 diagnostic ZIP."""
    job_dir, output_dir, analysis = _run_analysis(str(request.source_url))
    archive_base = job_dir / "clouva-avatar-analysis"
    archive_path = archive_base.with_suffix(".zip")
    try:
        if not request.include_renders:
            shutil.rmtree(output_dir / "renders_temporales", ignore_errors=True)
        shutil.make_archive(str(archive_base), "zip", root_dir=str(output_dir))
        if not archive_path.is_file() or archive_path.stat().st_size < 1024:
            raise RuntimeError("No se pudo empaquetar el diagnóstico del Avatar Analyzer")
        return FileResponse(
            archive_path,
            media_type="application/zip",
            filename="clouva-avatar-analysis.zip",
            background=BackgroundTask(shutil.rmtree, job_dir, True),
            headers=_headers(analysis),
        )
    except Exception as exc:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(status_code=422, detail=f"No se pudo empaquetar el diagnóstico: {exc}") from exc


@app.post("/avatar/analyze-preview")
def analyze_avatar_preview(request: AvatarAnalyzeRequest):
    """Return the selectable diagnostic GLB for the CLOUVA web viewer."""
    job_dir, output_dir, analysis = _run_analysis(str(request.source_url))
    diagnostic_glb = output_dir / "diagnostic_landmarks.glb"
    return FileResponse(
        diagnostic_glb,
        media_type="model/gltf-binary",
        filename="clouva-avatar-diagnostic.glb",
        background=BackgroundTask(shutil.rmtree, job_dir, True),
        headers=_headers(analysis),
    )


@app.get("/diagnostics/avatar-analyzer")
def avatar_analyzer_health():
    return {
        "ok": AVATAR_ANALYZER_SCRIPT.is_file(),
        "version": AVATAR_ANALYZER_VERSION,
        "script": AVATAR_ANALYZER_SCRIPT.name,
        "createsArmature": False,
        "modifiesProductionRig": False,
        "outputs": [
            "avatar_analysis.json",
            "diagnostic_report.json",
            "diagnostic_landmarks.glb",
            "renders_temporales/",
        ],
        "routes": ["/avatar/analyze", "/avatar/analyze-preview"],
        "detectors": ["MediaPipe Face Landmarker", "MediaPipe Hand Landmarker"],
    }
