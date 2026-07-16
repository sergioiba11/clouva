import json
import os
import shutil
import subprocess
import tempfile
import threading
import uuid
from pathlib import Path
from urllib.request import Request, urlopen

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, HttpUrl
from starlette.background import BackgroundTask

app = FastAPI(title="CLOUVA Garment Rig Worker")

BLENDER_BIN = os.getenv("BLENDER_BIN", "blender")
SCRIPT_PATH = Path(__file__).with_name("rig_garment.py")
MAX_DOWNLOAD_BYTES = int(os.getenv("MAX_DOWNLOAD_BYTES", str(120 * 1024 * 1024)))
BLENDER_TIMEOUT_SECONDS = int(os.getenv("BLENDER_TIMEOUT_SECONDS", "420"))
CLOUVA_AVATAR_URL = os.getenv("CLOUVA_AVATAR_URL") or os.getenv("CLOUVA_BASE_AVATAR_URL")
VALID_CATEGORIES = {"hoodie", "shirt", "jacket", "pants", "shorts", "shoes", "accessory"}
CATEGORY_MAP = {
    "hoodie": "hoodie",
    "remera": "shirt",
    "campera": "jacket",
    "baggy": "pants",
    "zapatillas": "shoes",
    "gorra": "accessory",
    "cadena": "accessory",
    "lentes": "accessory",
    "mochila": "accessory",
    "aros": "accessory",
    "guantes": "accessory",
    "pulseras": "accessory",
    "anillos": "accessory",
}

JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.Lock()


class RigRequest(BaseModel):
    avatar_url: HttpUrl
    garment_url: HttpUrl
    category: str
    art_url: HttpUrl | None = None
    color: str | None = None


def set_job(job_id: str, **changes) -> None:
    with JOBS_LOCK:
        JOBS.setdefault(job_id, {}).update(changes)


def download(url: str, destination: Path) -> None:
    request = Request(url, headers={"User-Agent": "CLOUVA-Garment-Rig/1.0"})
    with urlopen(request, timeout=90) as response, destination.open("wb") as output:
        declared_size = response.headers.get("Content-Length")
        if declared_size and int(declared_size) > MAX_DOWNLOAD_BYTES:
            raise RuntimeError(f"Remote file exceeds {MAX_DOWNLOAD_BYTES} bytes")
        downloaded = 0
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            downloaded += len(chunk)
            if downloaded > MAX_DOWNLOAD_BYTES:
                raise RuntimeError(f"Remote file exceeds {MAX_DOWNLOAD_BYTES} bytes")
            output.write(chunk)
    if destination.stat().st_size < 16:
        raise RuntimeError(f"Downloaded file is empty: {url}")


def cleanup(path: Path) -> None:
    shutil.rmtree(path, ignore_errors=True)


def run_blender_job(job_id: str, job_dir: Path, avatar_path: Path, garment_path: Path, output_path: Path, category: str, art_path: Path | None = None, color: str = "#0a0a0a") -> None:
    try:
        set_job(job_id, status="processing", progress=12, stage="Importando en Blender")
        command = [
            BLENDER_BIN,
            "--background",
            "--factory-startup",
            "--python-exit-code",
            "1",
            "--python",
            str(SCRIPT_PATH),
            "--",
            str(avatar_path),
            str(garment_path),
            str(output_path),
            category,
            str(art_path) if art_path and art_path.exists() else "",
            color,
        ]
        set_job(job_id, progress=30, stage="Alineando con clouva_base_v1")
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=BLENDER_TIMEOUT_SECONDS,
            cwd=str(job_dir),
            env={**os.environ, "PYTHONUNBUFFERED": "1"},
        )
        stdout = result.stdout[-12000:]
        stderr = result.stderr[-8000:]
        print(f"[worker] job={job_id} blender returncode={result.returncode}\n[stdout]\n{stdout}\n[stderr]\n{stderr}", flush=True)

        if result.returncode != 0 or not output_path.exists() or output_path.stat().st_size < 1024:
            set_job(
                job_id,
                status="failed",
                progress=100,
                stage="Falló la validación del rig",
                error="Automatic rigging validation failed",
                details={"returncode": result.returncode, "stderr": stderr, "stdout": stdout},
            )
            return

        set_job(job_id, status="completed", progress=100, stage="GLB riggeado listo", resultUrl=f"/jobs/{job_id}/result")
    except subprocess.TimeoutExpired:
        set_job(job_id, status="failed", progress=100, stage="Blender agotó el tiempo máximo", error=f"Blender exceeded {BLENDER_TIMEOUT_SECONDS}s")
    except Exception as exc:
        set_job(job_id, status="failed", progress=100, stage="Error inesperado", error=str(exc))


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "clouva-garment-rig",
        "blender": BLENDER_BIN,
        "script_exists": SCRIPT_PATH.exists(),
        "avatar_configured": bool(CLOUVA_AVATAR_URL),
    }


@app.post("/jobs")
async def create_job(file: UploadFile = File(...), job: str = Form("{}")):
    if not CLOUVA_AVATAR_URL:
        raise HTTPException(status_code=503, detail="Falta CLOUVA_AVATAR_URL o CLOUVA_BASE_AVATAR_URL en Railway.")
    if not file.filename or not file.filename.lower().endswith(".glb"):
        raise HTTPException(status_code=400, detail="El archivo debe ser .glb")

    try:
        payload = json.loads(job or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="El campo job no contiene JSON válido") from exc

    category_raw = str(payload.get("category") or "accessory").strip().lower()
    category = CATEGORY_MAP.get(category_raw, category_raw)
    if category not in VALID_CATEGORIES:
        category = "accessory"

    job_id = uuid.uuid4().hex
    job_dir = Path(tempfile.mkdtemp(prefix=f"clouva-rig-{job_id}-"))
    avatar_path = job_dir / "avatar.glb"
    garment_path = job_dir / "garment.glb"
    output_path = job_dir / "rigged.glb"

    content = await file.read()
    if len(content) < 16:
        cleanup(job_dir)
        raise HTTPException(status_code=400, detail="El GLB está vacío")
    if len(content) > MAX_DOWNLOAD_BYTES:
        cleanup(job_dir)
        raise HTTPException(status_code=413, detail="El GLB supera el máximo permitido")
    garment_path.write_bytes(content)

    try:
        download(CLOUVA_AVATAR_URL, avatar_path)
    except Exception as exc:
        cleanup(job_dir)
        raise HTTPException(status_code=502, detail=f"No se pudo descargar el avatar base: {exc}") from exc

    set_job(
        job_id,
        id=job_id,
        status="queued",
        progress=5,
        stage="GLB recibido y en cola",
        resultUrl=None,
        error=None,
        job_dir=str(job_dir),
        output_path=str(output_path),
    )
    thread = threading.Thread(
        target=run_blender_job,
        args=(job_id, job_dir, avatar_path, garment_path, output_path, category),
        daemon=True,
    )
    thread.start()
    return {"id": job_id, "jobId": job_id, "status": "queued", "progress": 5}


@app.get("/jobs/{job_id}")
def get_job(job_id: str):
    with JOBS_LOCK:
        data = JOBS.get(job_id)
        if not data:
            raise HTTPException(status_code=404, detail="Trabajo no encontrado")
        result = {key: value for key, value in data.items() if key not in {"job_dir", "output_path"}}
    if result.get("resultUrl"):
        result["resultUrl"] = f"https://rig.clouva.com.ar{result['resultUrl']}"
    return result


@app.get("/jobs/{job_id}/result")
def get_job_result(job_id: str):
    with JOBS_LOCK:
        data = JOBS.get(job_id)
        if not data:
            raise HTTPException(status_code=404, detail="Trabajo no encontrado")
        output_path = Path(data.get("output_path", ""))
        if data.get("status") != "completed" or not output_path.exists():
            raise HTTPException(status_code=409, detail="El resultado todavía no está listo")
    return FileResponse(output_path, media_type="model/gltf-binary", filename=f"{job_id}-rigged.glb")


@app.post("/rig")
def rig(request: RigRequest):
    category = request.category.strip().lower()
    if category not in VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail="Invalid category")

    job_dir = Path(tempfile.mkdtemp(prefix="clouva-rig-"))
    avatar_path = job_dir / "avatar.glb"
    garment_path = job_dir / "garment.glb"
    output_path = job_dir / "rigged.glb"
    art_path = job_dir / "art.png"

    try:
        download(str(request.avatar_url), avatar_path)
        download(str(request.garment_url), garment_path)
        if request.art_url:
            download(str(request.art_url), art_path)
        run_blender_job("legacy-sync", job_dir, avatar_path, garment_path, output_path, category, art_path, request.color or "#0a0a0a")
        if not output_path.exists() or output_path.stat().st_size < 1024:
            raise HTTPException(status_code=422, detail="Automatic rigging validation failed")
        return FileResponse(
            output_path,
            media_type="model/gltf-binary",
            filename="rigged.glb",
            background=BackgroundTask(cleanup, job_dir),
        )
    except HTTPException:
        raise
    except Exception as exc:
        cleanup(job_dir)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
