import os
import threading

import app_v12 as current


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
RIG_DIAGNOSTICS_VERSION = "v38-sigkill-memory-guard"
BLENDER_SINGLE_FLIGHT_VERSION = "v38-one-process-at-a-time"


try:
    MAX_CONCURRENT_BLENDER_JOBS = max(
        1,
        int(os.getenv("CLOUVA_MAX_CONCURRENT_BLENDER_JOBS", "1")),
    )
except (TypeError, ValueError):
    MAX_CONCURRENT_BLENDER_JOBS = 1


_blender_slots = threading.BoundedSemaphore(MAX_CONCURRENT_BLENDER_JOBS)
_guarded_base_runner = legacy.run_blender_job


def _last_useful_line(details):
    if not isinstance(details, dict):
        return None
    combined = "\n".join((str(details.get("stdout") or ""), str(details.get("stderr") or "")))
    lines = [line.strip() for line in combined.splitlines() if line.strip()]
    for line in reversed(lines):
        lowered = line.lower()
        if "script failed" in lowered and "exiting" in lowered:
            continue
        if line.startswith("Blender ") or line.startswith("Read prefs"):
            continue
        return line[:600]
    return None


def _surface_sigkill(job_id: str):
    if not job_id:
        return
    with legacy.JOBS_LOCK:
        snapshot = dict(legacy.JOBS.get(job_id, {}))
    details = snapshot.get("details") if isinstance(snapshot.get("details"), dict) else {}
    try:
        returncode = int(details.get("returncode"))
    except (TypeError, ValueError):
        return
    if returncode not in {-9, 137}:
        return

    last_line = _last_useful_line(details)
    suffix = f" Último paso registrado: {last_line}" if last_line else ""
    visible = (
        "Blender fue detenido por falta de memoria mientras fabricaba la prenda. "
        "CLOUVA redujo la carga y evita ejecutar dos moldes al mismo tiempo; reintentá cuando el nuevo Worker esté desplegado."
        + suffix
    )
    legacy.set_job(
        job_id,
        status="failed",
        progress=100,
        stage="Blender fue detenido por falta de memoria",
        error=visible,
        technicalError=f"SIGKILL ({returncode}): el proceso superó la memoria disponible.{suffix}",
        diagnosticsVersion=RIG_DIAGNOSTICS_VERSION,
        memoryGuardVersion=BLENDER_SINGLE_FLIGHT_VERSION,
    )
    print(
        f"[worker-v38] SIGKILL surfaced job={job_id} returncode={returncode} last={last_line}",
        flush=True,
    )


def run_blender_job_with_memory_guard_v38(*args, **kwargs):
    job_id = str(args[0] if args else kwargs.get("job_id") or "")
    acquired_immediately = _blender_slots.acquire(blocking=False)
    if not acquired_immediately:
        if job_id:
            legacy.set_job(
                job_id,
                status="queued",
                progress=8,
                stage="Esperando que termine el molde anterior para no saturar Blender",
                memoryGuardVersion=BLENDER_SINGLE_FLIGHT_VERSION,
            )
        _blender_slots.acquire()

    try:
        _guarded_base_runner(*args, **kwargs)
        _surface_sigkill(job_id)
    finally:
        _blender_slots.release()


legacy.run_blender_job = run_blender_job_with_memory_guard_v38
