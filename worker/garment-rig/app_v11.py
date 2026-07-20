import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import app_v10 as current
from fastapi import HTTPException
from pydantic import BaseModel, HttpUrl


app = current.app
base = current.base
legacy = current.base.legacy
WORKER_INSPECTOR_VERSION = current.WORKER_INSPECTOR_VERSION
INSPECT_SCRIPT_PATH = current.INSPECT_SCRIPT_PATH
RIG_ROUTE_VERSION = current.RIG_ROUTE_VERSION
GARMENT_SOURCE_ROUTING_VERSION = current.GARMENT_SOURCE_ROUTING_VERSION
UNREAL_EXPORT_VERSION = current.UNREAL_EXPORT_VERSION
EXPORT_UNREAL_SCRIPT_PATH = current.EXPORT_UNREAL_SCRIPT_PATH
BODY_CONTRACT_VERSION = "body-contract-v1"
BODY_CONTRACT_SCRIPT_PATH = Path(__file__).with_name("body_contract.py")


class BodyContractRequest(BaseModel):
    avatar_source_url: HttpUrl | None = None
    user_id: str | None = None
    category: str = "hoodie"


def run_body_contract(job_dir: Path, avatar_path: Path, output_path: Path, category: str) -> dict:
    command = [
        legacy.BLENDER_BIN,
        "--background",
        "--factory-startup",
        "--python-exit-code",
        "1",
        "--python",
        str(BODY_CONTRACT_SCRIPT_PATH),
        "--",
        str(avatar_path),
        str(output_path),
        category,
    ]
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=legacy.BLENDER_TIMEOUT_SECONDS,
        cwd=str(job_dir),
        env={**os.environ, "PYTHONUNBUFFERED": "1"},
    )
    if result.returncode != 0 or not output_path.exists():
        detail = current.base.base.extract_validation_error(result.stdout, result.stderr)
        raise RuntimeError(
            detail
            or result.stderr[-2400:]
            or "Blender no pudo medir el cuerpo del avatar"
        )
    contract = json.loads(output_path.read_text(encoding="utf-8"))
    contract["worker"] = {
        "contractVersion": BODY_CONTRACT_VERSION,
        "rigVersion": os.environ.get("CLOUVA_RIG_VERSION", "unknown"),
        "blenderExecutable": legacy.BLENDER_BIN,
    }
    return contract


@app.post("/body-contract")
def body_contract(request: BodyContractRequest):
    if not BODY_CONTRACT_SCRIPT_PATH.exists():
        raise HTTPException(status_code=500, detail="Falta body_contract.py en el Worker")

    category_raw = str(request.category or "hoodie").strip().lower()
    category = legacy.CATEGORY_MAP.get(category_raw, category_raw)
    if category not in legacy.VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail="Categoría de prenda inválida")

    job_dir = Path(tempfile.mkdtemp(prefix="clouva-body-contract-"))
    avatar_path = job_dir / "avatar-active.glb"
    output_path = job_dir / "body-contract.json"

    try:
        avatar_url = (
            str(request.avatar_source_url)
            if request.avatar_source_url
            else current.base.base.resolve_user_avatar_url(request.user_id)
        )
        if not avatar_url:
            raise RuntimeError("No se pudo resolver el avatar activo")
        legacy.download(avatar_url, avatar_path)
        return run_body_contract(job_dir, avatar_path, output_path, category)
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="Blender agotó el tiempo al medir el avatar") from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"No se pudo crear el contrato corporal: {exc}") from exc
    finally:
        shutil.rmtree(job_dir, ignore_errors=True)
