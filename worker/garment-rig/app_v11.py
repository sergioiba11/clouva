import re

import app_v10 as current
from fastapi import HTTPException


app = current.app
base = current.base
legacy = current.base.legacy
WORKER_INSPECTOR_VERSION = current.WORKER_INSPECTOR_VERSION
INSPECT_SCRIPT_PATH = current.INSPECT_SCRIPT_PATH
RIG_ROUTE_VERSION = current.RIG_ROUTE_VERSION
GARMENT_SOURCE_ROUTING_VERSION = current.GARMENT_SOURCE_ROUTING_VERSION
UNREAL_EXPORT_VERSION = current.UNREAL_EXPORT_VERSION
EXPORT_UNREAL_SCRIPT_PATH = current.EXPORT_UNREAL_SCRIPT_PATH
RIG_DIAGNOSTICS_VERSION = "v34-runtime-error-surface"


_EXCEPTION_PATTERN = re.compile(
    r"(?P<kind>RuntimeError|ModuleNotFoundError|ImportError|ValueError|AssertionError|TypeError|KeyError|IndexError|OSError):\s*(?P<message>.+)",
    re.IGNORECASE,
)


def extract_blender_failure(stdout: str | None, stderr: str | None) -> str | None:
    """Return the final useful Blender exception without exposing complete logs."""
    combined = "\n".join((str(stdout or ""), str(stderr or "")))
    lines = [line.strip() for line in combined.splitlines() if line.strip()]

    for line in reversed(lines):
        match = _EXCEPTION_PATTERN.search(line)
        if match:
            kind = match.group("kind")
            message = match.group("message").strip()
            return f"{kind}: {message}"[:1800]

    # Some Blender operators only print an ERROR line and exit with code 1.
    for line in reversed(lines):
        lowered = line.lower()
        if "error" in lowered or "failed" in lowered or "exception" in lowered:
            return line[:1800]
    return None


def user_facing_failure(technical: str | None, returncode: object = None) -> str:
    if technical:
        return technical
    if returncode not in (None, 0, "0"):
        return f"Blender terminó con código {returncode} sin generar un GLB válido."
    return "Blender no generó un GLB riggeado válido."


_original_run_blender_job = legacy.run_blender_job


def run_blender_job_with_diagnostics(*args, **kwargs):
    """Keep the existing pipeline and enrich failed async jobs with the real cause."""
    job_id = str(args[0] if args else kwargs.get("job_id") or "")
    _original_run_blender_job(*args, **kwargs)
    if not job_id:
        return

    with legacy.JOBS_LOCK:
        snapshot = dict(legacy.JOBS.get(job_id, {}))
    if str(snapshot.get("status") or "").lower() not in {"failed", "error"}:
        return

    details = snapshot.get("details") if isinstance(snapshot.get("details"), dict) else {}
    technical = extract_blender_failure(
        details.get("stdout") if isinstance(details, dict) else None,
        details.get("stderr") if isinstance(details, dict) else None,
    )
    visible = user_facing_failure(
        technical,
        details.get("returncode") if isinstance(details, dict) else None,
    )
    legacy.set_job(
        job_id,
        error=visible,
        technicalError=technical or visible,
        diagnosticsVersion=RIG_DIAGNOSTICS_VERSION,
    )
    print(
        f"[worker-v34] surfaced Blender failure job={job_id} error={visible}",
        flush=True,
    )


legacy.run_blender_job = run_blender_job_with_diagnostics


@app.get("/diagnostics/latest-rig-failure")
def latest_rig_failure():
    """Expose only the latest sanitized failure, never complete Blender logs or URLs."""
    with legacy.JOBS_LOCK:
        failed = [
            (job_id, dict(value))
            for job_id, value in legacy.JOBS.items()
            if str(value.get("status") or "").lower() in {"failed", "error"}
        ]
    if not failed:
        raise HTTPException(status_code=404, detail="No hay fallos de rig registrados en este proceso")
    job_id, value = failed[-1]
    return {
        "ok": False,
        "jobId": job_id,
        "status": value.get("status"),
        "stage": value.get("stage"),
        "category": value.get("category"),
        "error": value.get("error"),
        "technicalError": value.get("technicalError"),
        "diagnosticsVersion": value.get("diagnosticsVersion") or RIG_DIAGNOSTICS_VERSION,
    }
