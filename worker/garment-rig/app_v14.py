import json
import os
import re
import shutil
import tempfile
import uuid
from pathlib import Path

import app_v13 as current


app = current.app
base = current.base
legacy = current.legacy
WORKER_INSPECTOR_VERSION = current.WORKER_INSPECTOR_VERSION
INSPECT_SCRIPT_PATH = current.INSPECT_SCRIPT_PATH
RIG_ROUTE_VERSION = current.RIG_ROUTE_VERSION
GARMENT_SOURCE_ROUTING_VERSION = current.GARMENT_SOURCE_ROUTING_VERSION
UNREAL_EXPORT_VERSION = current.UNREAL_EXPORT_VERSION
EXPORT_UNREAL_SCRIPT_PATH = current.EXPORT_UNREAL_SCRIPT_PATH
extract_blender_failure = current.extract_blender_failure
user_facing_failure = current.user_facing_failure
RIG_DIAGNOSTICS_VERSION = "v43-canonical-bind-diagnostics"
CLEAN_ATTEMPT_VERSION = "v43-fresh-source-per-attempt"

_guarded_runner = legacy.run_blender_job
_DIAGNOSTIC_PATTERN = re.compile(r"^\[rig-v43\] canonical diagnostics (?P<payload>\{.*\})$", re.MULTILINE)


def _copy_if_present(source: Path | None, destination: Path | None):
    if source is None or destination is None or not source.exists():
        return None
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    return destination


def _extract_canonical_report(job_id: str, attempt_dir: Path):
    sidecar = attempt_dir / "canonical-bind-diagnostics.json"
    if sidecar.is_file():
        try:
            payload = json.loads(sidecar.read_text(encoding="utf-8"))
            if isinstance(payload, dict):
                return payload
        except (json.JSONDecodeError, OSError):
            pass

    with legacy.JOBS_LOCK:
        snapshot = dict(legacy.JOBS.get(job_id, {}))
    details = snapshot.get("details") if isinstance(snapshot.get("details"), dict) else {}
    combined = "\n".join((str(details.get("stdout") or ""), str(details.get("stderr") or "")))
    matches = list(_DIAGNOSTIC_PATTERN.finditer(combined))
    if not matches:
        return None
    try:
        payload = json.loads(matches[-1].group("payload"))
    except (json.JSONDecodeError, TypeError):
        return None
    return payload if isinstance(payload, dict) else None


def run_blender_job_clean_v43(
    job_id: str,
    job_dir: Path,
    avatar_path: Path,
    garment_path: Path,
    output_path: Path,
    category: str,
    art_path: Path | None = None,
    color: str = "",
    preview_settings: dict | None = None,
):
    settings = dict(preview_settings or {})
    raw_attempt_id = str(settings.get("attemptId") or uuid.uuid4().hex)
    safe_attempt_id = re.sub(r"[^a-zA-Z0-9_-]", "", raw_attempt_id)[:64] or uuid.uuid4().hex
    root = Path(job_dir)
    root.mkdir(parents=True, exist_ok=True)
    attempt_dir = Path(tempfile.mkdtemp(prefix=f"attempt-{safe_attempt_id}-", dir=str(root)))

    clean_avatar = attempt_dir / Path(avatar_path).name
    clean_garment = attempt_dir / "garment-original.glb"
    clean_output = attempt_dir / "rigged.glb"
    clean_art = attempt_dir / Path(art_path).name if art_path else None

    try:
        _copy_if_present(Path(avatar_path), clean_avatar)
        _copy_if_present(Path(garment_path), clean_garment)
        _copy_if_present(Path(art_path) if art_path else None, clean_art)
        metadata_path = Path(avatar_path).with_name("clouva_avatar_data.json")
        _copy_if_present(metadata_path, attempt_dir / "clouva_avatar_data.json")

        Path(output_path).unlink(missing_ok=True)
        clean_output.unlink(missing_ok=True)
        settings["attemptId"] = raw_attempt_id
        settings["forceFreshSource"] = True
        settings["cleanScene"] = True

        legacy.set_job(
            job_id,
            cleanAttemptVersion=CLEAN_ATTEMPT_VERSION,
            cleanSourceAttempt=True,
            attemptId=raw_attempt_id,
            sourcePolicy="fresh-upload-and-factory-startup",
            stagingDirectory=str(attempt_dir),
        )
        _guarded_runner(
            job_id,
            attempt_dir,
            clean_avatar,
            clean_garment,
            clean_output,
            category,
            clean_art,
            color,
            settings,
        )

        if clean_output.exists() and clean_output.stat().st_size >= 1024:
            os.replace(clean_output, output_path)

        canonical_report = _extract_canonical_report(job_id, attempt_dir)
        legacy.set_job(
            job_id,
            canonicalDiagnostics=canonical_report,
            canonicalBindVersion=43,
            cleanAttemptVersion=CLEAN_ATTEMPT_VERSION,
            cleanSourceAttempt=True,
            attemptId=raw_attempt_id,
        )
    finally:
        shutil.rmtree(attempt_dir, ignore_errors=True)
        with legacy.JOBS_LOCK:
            if job_id in legacy.JOBS:
                legacy.JOBS[job_id].pop("stagingDirectory", None)


legacy.run_blender_job = run_blender_job_clean_v43


@app.get("/diagnostics/canonical-bind")
def canonical_bind_health_v43():
    return {
        "ok": True,
        "canonicalBindVersion": 43,
        "cleanAttemptVersion": CLEAN_ATTEMPT_VERSION,
        "sourcePolicy": "fresh-upload-and-factory-startup",
        "restPoseBeforeMold": True,
        "postSkinScaleChanges": False,
    }
