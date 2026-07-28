"""Cloud Run Job entrypoint for the Avatar Analyzer.

Runs one durable analysis job end-to-end. Reads job parameters from and
writes all progress/results to the `avatar_analyzer_jobs` Supabase table
instead of the HTTP service's in-process background thread + local JSON
file (see /avatar/analyze-v4-preview-async in app.py). Reuses
app._run_analysis_v4 -- and everything it calls -- completely unchanged;
this file only handles job I/O, signed-URL minting, and process lifecycle
(cancellation via SIGTERM, exit codes).

Invoked by the `clouva-avatar-analyzer` Cloud Run Job with
CLOUVA_ANALYZER_JOB_ID set to the avatar_analyzer_jobs.id to process.
"""
from __future__ import annotations

import json
import os
import shutil
import signal
import sys
import time
import traceback
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

try:
    import app_v18 as app
except ModuleNotFoundError:  # Docker promotes app_v18.py to app.py.
    import app

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
AVATAR_STORAGE_BUCKET = os.environ.get("CLOUVA_AVATAR_STORAGE_BUCKET", "avatars")
SIGNED_URL_TTL_SECONDS = 60 * 60

_CANCEL_REQUESTED = False


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _supabase_call(method: str, url: str, body: dict | None = None) -> object:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }
    if method in ("PATCH", "POST"):
        headers["Prefer"] = "return=representation"
    request = Request(url, data=data, headers=headers, method=method)
    with urlopen(request, timeout=30) as response:
        payload = response.read()
        return json.loads(payload) if payload else None


def _get_job(job_id: str) -> dict:
    rows = _supabase_call(
        "GET",
        f"{SUPABASE_URL}/rest/v1/avatar_analyzer_jobs?id=eq.{job_id}&select=*",
    )
    if not rows:
        raise SystemExit(f"[analyzer-job] job {job_id} not found in avatar_analyzer_jobs")
    return rows[0]


def _update_job(job_id: str, fields: dict) -> None:
    _supabase_call(
        "PATCH",
        f"{SUPABASE_URL}/rest/v1/avatar_analyzer_jobs?id=eq.{job_id}",
        {**fields, "updated_at": _now_iso()},
    )


def _signed_source_url(storage_path: str) -> str:
    """Mint a short-lived signed URL for the source GLB just before downloading it.

    Avoids storing a long-lived signed URL in the jobs table or in logs --
    the durable reference is the storage path, not a bearer-token URL.
    """
    result = _supabase_call(
        "POST",
        f"{SUPABASE_URL}/storage/v1/object/sign/{AVATAR_STORAGE_BUCKET}/{storage_path}",
        {"expiresIn": SIGNED_URL_TTL_SECONDS},
    )
    signed_path = result.get("signedURL") if isinstance(result, dict) else None
    if not signed_path:
        raise RuntimeError(f"No se pudo firmar la URL de storage para {storage_path}")
    return f"{SUPABASE_URL}/storage/v1{signed_path}"


def _handle_sigterm(signum, frame):  # noqa: ARG001 -- signal handler signature
    global _CANCEL_REQUESTED
    _CANCEL_REQUESTED = True
    job_id = os.environ.get("CLOUVA_ANALYZER_JOB_ID")
    if not job_id:
        return
    with app._RUNNING_JOBS_LOCK:
        entry = app._RUNNING_JOBS.setdefault(job_id, {})
        entry["cancelRequested"] = True
        proc = entry.get("proc")
    if proc is not None and proc.poll() is None:
        app._kill_process_group(proc)


def main() -> int:
    job_id = os.environ.get("CLOUVA_ANALYZER_JOB_ID")
    if not job_id:
        print("[analyzer-job] CLOUVA_ANALYZER_JOB_ID is not set", file=sys.stderr)
        return 2
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        print("[analyzer-job] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured", file=sys.stderr)
        return 2

    signal.signal(signal.SIGTERM, _handle_sigterm)

    try:
        job = _get_job(job_id)
    except (HTTPError, URLError) as exc:
        print(f"[analyzer-job] could not read job {job_id}: {exc}", file=sys.stderr)
        return 2

    if job.get("status") == "cancel_requested":
        _update_job(job_id, {"status": "cancelled", "cancelled_at": _now_iso(), "phase": "cancelled"})
        print(f"[analyzer-job] {job_id} was cancel_requested before starting; marking cancelled")
        return 0

    storage_path = job.get("source_storage_path")
    if not storage_path:
        _update_job(job_id, {
            "status": "failed",
            "error_code": "MISSING_SOURCE",
            "error_message": "source_storage_path is empty",
            "finished_at": _now_iso(),
        })
        print(f"[analyzer-job] {job_id} has no source_storage_path", file=sys.stderr)
        return 1

    requested_profile = job.get("requested_rig_profile") or "BODY_BASIC"
    operation = job.get("operation") or None
    if operation == "full_analysis":
        operation = None  # app._run_analysis_v4's full-analysis path takes operation=None

    _update_job(job_id, {"status": "starting", "started_at": _now_iso(), "phase": "starting"})

    job_dir = None
    try:
        source_url = _signed_source_url(storage_path)
        with app.ANALYZER_RIG_LOCK:
            if _CANCEL_REQUESTED or app._job_cancel_requested(job_id):
                raise app.AnalysisCancelled()
            _update_job(job_id, {"status": "running", "phase": "blender"})
            job_dir, _output_dir, _cached, analysis = app._run_analysis_v4(
                source_url, requested_profile, operation=operation, job_id=job_id,
            )
        _update_job(job_id, {"status": "persisting", "phase": "persisting"})
        summary = app._summary(analysis)
        _update_job(job_id, {
            "status": "completed",
            "run_id": analysis.get("runId"),
            "result_prefix": analysis.get("runId"),
            "progress": 100,
            "phase": "completed",
            "finished_at": _now_iso(),
        })
        print(f"[analyzer-job] {job_id} completed runId={analysis.get('runId')} status={summary.get('status')}")
        return 0
    except app.AnalysisCancelled:
        _update_job(job_id, {"status": "cancelled", "cancelled_at": _now_iso(), "phase": "cancelled"})
        print(f"[analyzer-job] {job_id} cancelled")
        return 0
    except app.HTTPException as exc:
        _update_job(job_id, {
            "status": "failed",
            "error_code": f"HTTP_{exc.status_code}",
            "error_message": str(exc.detail)[:2000],
            "finished_at": _now_iso(),
        })
        print(f"[analyzer-job] {job_id} failed: {exc.detail}", file=sys.stderr)
        return 1
    except Exception as exc:  # noqa: BLE001 -- last-resort structured failure, exit code carries it
        _update_job(job_id, {
            "status": "failed",
            "error_code": "UNEXPECTED",
            "error_message": str(exc)[:2000],
            "finished_at": _now_iso(),
        })
        traceback.print_exc()
        return 1
    finally:
        if job_dir is not None:
            shutil.rmtree(job_dir, ignore_errors=True)
        with app._RUNNING_JOBS_LOCK:
            app._RUNNING_JOBS.pop(job_id, None)


if __name__ == "__main__":
    sys.exit(main())
