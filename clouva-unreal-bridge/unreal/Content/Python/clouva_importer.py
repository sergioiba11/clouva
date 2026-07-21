import json
import traceback
from pathlib import Path

import unreal

PROJECT_DIR = Path(unreal.Paths.project_dir())
INBOX = PROJECT_DIR / "Saved" / "ClouvaInbox"
OUTBOX = PROJECT_DIR / "Saved" / "ClouvaOutbox"


def _write_result(job_id, payload):
    OUTBOX.mkdir(parents=True, exist_ok=True)
    (OUTBOX / f"{job_id}.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def _import_job(job_path):
    job = json.loads(job_path.read_text(encoding="utf-8"))
    job_id = str(job["id"])
    source_path = str(job["filePath"])
    destination_path = str(job.get("destinationPath") or "/Game/CLOUVA/Imports")
    try:
        task = unreal.AssetImportTask()
        task.filename = source_path
        task.destination_path = destination_path
        task.automated = True
        task.replace_existing = True
        task.save = True
        unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
        imported = [str(value) for value in task.imported_object_paths]
        if not imported:
            raise RuntimeError("Unreal no devolvió assets importados")
        _write_result(job_id, {"ok": True, "status": "succeeded", "importedObjectPaths": imported, "destinationPath": destination_path})
    except Exception as exc:
        _write_result(job_id, {"ok": False, "status": "failed", "error": str(exc), "traceback": traceback.format_exc()[-4000:]})
    finally:
        job_path.unlink(missing_ok=True)


def tick(_delta_seconds=0.0):
    INBOX.mkdir(parents=True, exist_ok=True)
    for job_path in sorted(INBOX.glob("*.json")):
        _import_job(job_path)
    return True
