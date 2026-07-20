import re

import app_v11 as current


app = current.app
base = current.base
legacy = current.legacy
WORKER_INSPECTOR_VERSION = current.WORKER_INSPECTOR_VERSION
INSPECT_SCRIPT_PATH = current.INSPECT_SCRIPT_PATH
RIG_ROUTE_VERSION = current.RIG_ROUTE_VERSION
GARMENT_SOURCE_ROUTING_VERSION = current.GARMENT_SOURCE_ROUTING_VERSION
UNREAL_EXPORT_VERSION = current.UNREAL_EXPORT_VERSION
EXPORT_UNREAL_SCRIPT_PATH = current.EXPORT_UNREAL_SCRIPT_PATH
RIG_DIAGNOSTICS_VERSION = "v37-python-exception-surface"


# Python exceptions are not limited to the handful originally listed in V34.
# AttributeError was the exact production failure after V36. Match any normal Python
# exception class while continuing to expose only the final sanitized line.
_EXCEPTION_PATTERN = re.compile(
    r"(?P<kind>[A-Za-z_][A-Za-z0-9_]*(?:Error|Exception)):\s*(?P<message>.+)",
    re.IGNORECASE,
)


def extract_blender_failure(stdout: str | None, stderr: str | None) -> str | None:
    combined = "\n".join((str(stdout or ""), str(stderr or "")))
    lines = [line.strip() for line in combined.splitlines() if line.strip()]

    for line in reversed(lines):
        match = _EXCEPTION_PATTERN.search(line)
        if match:
            kind = match.group("kind")
            message = match.group("message").strip()
            return f"{kind}: {message}"[:1800]

    # Prefer a traceback frame/message above Blender's generic final
    # "script failed ... exiting" line when no typed exception was printed.
    generic_script_failure = None
    for line in reversed(lines):
        lowered = line.lower()
        if "script failed" in lowered and "exiting" in lowered:
            generic_script_failure = line[:1800]
            continue
        if "traceback" in lowered:
            continue
        if "error" in lowered or "failed" in lowered or "exception" in lowered:
            return line[:1800]
    return generic_script_failure


def user_facing_failure(technical: str | None, returncode: object = None) -> str:
    if technical:
        return technical
    if returncode not in (None, 0, "0"):
        return f"Blender terminó con código {returncode} sin generar un GLB válido."
    return "Blender no generó un GLB riggeado válido."


# Bypass the V34 wrapper and run the original job exactly once, then enrich its
# failure snapshot using the broader V37 exception matcher.
_original_run_blender_job = current._original_run_blender_job


def run_blender_job_with_diagnostics_v37(*args, **kwargs):
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
    print(f"[worker-v37] surfaced Blender failure job={job_id} error={visible}", flush=True)


legacy.run_blender_job = run_blender_job_with_diagnostics_v37
