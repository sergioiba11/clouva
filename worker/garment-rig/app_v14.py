import hashlib
import json
import shutil
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
MAX_CONCURRENT_BLENDER_JOBS = current.MAX_CONCURRENT_BLENDER_JOBS
RIG_DIAGNOSTICS_VERSION = "v43-canonical-bind-rest"
CLEAN_SOURCE_ATTEMPT_VERSION = "v43-pristine-source-copy"


_previous_runner = legacy.run_blender_job


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _argument(args, kwargs, index, name):
    if len(args) > index:
        return args[index]
    return kwargs.get(name)


def _replace_argument(args, kwargs, index, name, value):
    positional = list(args)
    keyword = dict(kwargs)
    if len(positional) > index:
        positional[index] = value
    else:
        keyword[name] = value
    return tuple(positional), keyword


def _read_diagnostics(output_path: Path):
    sidecar = output_path.with_suffix(".diagnostics.json")
    if not sidecar.exists():
        return None
    try:
        payload = json.loads(sidecar.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return {"version": 43, "readError": str(exc), "path": str(sidecar)}
    return payload if isinstance(payload, dict) else {"version": 43, "payload": payload}


def run_blender_job_from_pristine_sources_v43(*args, **kwargs):
    job_id = str(_argument(args, kwargs, 0, "job_id") or "")
    job_dir = Path(_argument(args, kwargs, 1, "job_dir"))
    avatar_path = Path(_argument(args, kwargs, 2, "avatar_path"))
    garment_path = Path(_argument(args, kwargs, 3, "garment_path"))
    output_path = Path(_argument(args, kwargs, 4, "output_path"))

    if not avatar_path.is_file() or not garment_path.is_file():
        raise RuntimeError("El reintento limpio no encontró los archivos originales del avatar y la prenda")

    avatar_hash = _sha256(avatar_path)
    garment_hash = _sha256(garment_path)
    attempt_id = uuid.uuid4().hex
    attempt_dir = job_dir / f"clean-attempt-{attempt_id}"
    attempt_dir.mkdir(parents=True, exist_ok=False)
    clean_avatar = attempt_dir / avatar_path.name
    clean_garment = attempt_dir / garment_path.name
    shutil.copy2(avatar_path, clean_avatar)
    shutil.copy2(garment_path, clean_garment)

    metadata_source = avatar_path.parent / "clouva_avatar_data.json"
    if metadata_source.is_file():
        shutil.copy2(metadata_source, attempt_dir / metadata_source.name)

    output_path.unlink(missing_ok=True)
    output_path.with_suffix(".diagnostics.json").unlink(missing_ok=True)

    legacy.set_job(
        job_id,
        cleanSourceAttemptVersion=CLEAN_SOURCE_ATTEMPT_VERSION,
        cleanAttemptId=attempt_id,
        freshBlenderScene=True,
        reusedPartialScene=False,
        sourceHashes={"avatar": avatar_hash, "garment": garment_hash},
        diagnosticsVersion=RIG_DIAGNOSTICS_VERSION,
    )

    clean_args, clean_kwargs = _replace_argument(args, kwargs, 1, "job_dir", attempt_dir)
    clean_args, clean_kwargs = _replace_argument(clean_args, clean_kwargs, 2, "avatar_path", clean_avatar)
    clean_args, clean_kwargs = _replace_argument(clean_args, clean_kwargs, 3, "garment_path", clean_garment)

    try:
        _previous_runner(*clean_args, **clean_kwargs)

        source_unchanged = _sha256(avatar_path) == avatar_hash and _sha256(garment_path) == garment_hash
        copied_sources_match = _sha256(clean_avatar) == avatar_hash and _sha256(clean_garment) == garment_hash
        diagnostics = _read_diagnostics(output_path)

        if not source_unchanged or not copied_sources_match:
            output_path.unlink(missing_ok=True)
            legacy.set_job(
                job_id,
                status="failed",
                progress=100,
                stage="Los archivos originales cambiaron durante el molde",
                error="Rig incompatible: la fuente original dejó de ser inmutable",
                sourceUnchanged=source_unchanged,
                cleanCopiesMatch=copied_sources_match,
                rigDiagnostics=diagnostics,
            )
            return

        legacy.set_job(
            job_id,
            sourceUnchanged=True,
            cleanCopiesMatch=True,
            cleanRetryReady=True,
            rigDiagnostics=diagnostics,
            diagnosticsVersion=RIG_DIAGNOSTICS_VERSION,
        )
        print(
            f"[worker-v43] pristine attempt complete job={job_id} attempt={attempt_id} "
            f"avatar={avatar_hash[:12]} garment={garment_hash[:12]}",
            flush=True,
        )
    finally:
        shutil.rmtree(attempt_dir, ignore_errors=True)


legacy.run_blender_job = run_blender_job_from_pristine_sources_v43
