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
RIG_OBJECT_SCRIPT_PATH = Path(__file__).with_name("rig_object.py")
ATTACH_OBJECT_SCRIPT_PATH = Path(__file__).with_name("attach_object.py")
MAX_DOWNLOAD_BYTES = int(os.getenv("MAX_DOWNLOAD_BYTES", str(120 * 1024 * 1024)))
BLENDER_TIMEOUT_SECONDS = int(os.getenv("BLENDER_TIMEOUT_SECONDS", "420"))
CLOUVA_AVATAR_URL = os.getenv("CLOUVA_AVATAR_URL") or os.getenv("CLOUVA_BASE_AVATAR_URL")
HAT_DEFAULT_LIFT_CM = float(os.getenv("HAT_DEFAULT_LIFT_CM", "12"))
VALID_CATEGORIES = {"hoodie", "shirt", "jacket", "pants", "shorts", "shoes", "hat", "accessory"}
CATEGORY_MAP = {
    "hoodie": "hoodie",
    "remera": "shirt",
    "campera": "jacket",
    "baggy": "pants",
    "zapatillas": "shoes",
    "gorra": "hat",
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


def number_or(value, fallback: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def normalize_preview_settings(category: str, preview_settings: dict | None) -> dict:
    settings = dict(preview_settings or {})
    adjustments_raw = settings.get("adjustments")
    adjustments = dict(adjustments_raw) if isinstance(adjustments_raw, dict) else {}

    if category == "hat":
        # El hueso Head suele comenzar cerca del cuello. Este desplazamiento coloca
        # la gorra sobre la coronilla y sigue permitiendo afinarla con el slider Altura.
        adjustments["height"] = number_or(adjustments.get("height"), 0.0) + HAT_DEFAULT_LIFT_CM
        settings["hatOcclusionGroup"] = "hair_top"

    settings["adjustments"] = adjustments
    return settings


def run_blender_job(
    job_id: str,
    job_dir: Path,
    avatar_path: Path,
    garment_path: Path,
    output_path: Path,
    category: str,
    art_path: Path | None = None,
    color: str = "",
    preview_settings: dict | None = None,
) -> None:
    try:
        effective_preview_settings = normalize_preview_settings(category, preview_settings)
        set_job(
            job_id,
            status="processing",
            progress=12,
            stage="Analizando rig y pesos del objeto",
            category=category,
            riggingStrategy="retarget_existing_or_category_anchor",
            effectivePreviewSettings=effective_preview_settings,
        )
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
            json.dumps(effective_preview_settings, separators=(",", ":")),
        ]
        set_job(
            job_id,
            progress=30,
            stage="Remapeando el rig del objeto al armature del avatar"
            if category != "hat"
            else "Levantando la gorra y vinculándola al hueso Head",
        )
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=BLENDER_TIMEOUT_SECONDS,
            cwd=str(job_dir),
            env={**os.environ, "PYTHONUNBUFFERED": "1"},
        )
        stdout = result.stdout[-16000:]
        stderr = result.stderr[-10000:]
        print(
            f"[worker] job={job_id} category={category} blender returncode={result.returncode}\n"
            f"[stdout]\n{stdout}\n[stderr]\n{stderr}",
            flush=True,
        )

        if result.returncode != 0 or not output_path.exists() or output_path.stat().st_size < 1024:
            set_job(
                job_id,
                status="failed",
                progress=100,
                stage="Falló la validación del rig",
                error="Automatic rig retarget validation failed",
                details={"returncode": result.returncode, "stderr": stderr, "stdout": stdout},
            )
            return

        set_job(
            job_id,
            status="completed",
            progress=100,
            stage="GLB adaptado al rig del avatar",
            resultUrl=f"/jobs/{job_id}/result",
        )
    except subprocess.TimeoutExpired:
        set_job(
            job_id,
            status="failed",
            progress=100,
            stage="Blender agotó el tiempo máximo",
            error=f"Blender exceeded {BLENDER_TIMEOUT_SECONDS}s",
        )
    except Exception as exc:
        set_job(job_id, status="failed", progress=100, stage="Error inesperado", error=str(exc))


def run_rig_object_job(job_id: str, job_dir: Path, input_path: Path, output_path: Path, category: str) -> None:
    try:
        set_job(job_id, status="processing", progress=20, stage="Armando el esqueleto propio del objeto")
        command = [
            BLENDER_BIN,
            "--background",
            "--factory-startup",
            "--python-exit-code",
            "1",
            "--python",
            str(RIG_OBJECT_SCRIPT_PATH),
            "--",
            str(input_path),
            str(output_path),
            category,
        ]
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=BLENDER_TIMEOUT_SECONDS,
            cwd=str(job_dir),
            env={**os.environ, "PYTHONUNBUFFERED": "1"},
        )
        stdout = result.stdout[-16000:]
        stderr = result.stderr[-10000:]
        print(
            f"[worker] rig-object job={job_id} category={category} returncode={result.returncode}\n"
            f"[stdout]\n{stdout}\n[stderr]\n{stderr}",
            flush=True,
        )
        if result.returncode != 0 or not output_path.exists() or output_path.stat().st_size < 1024:
            set_job(
                job_id,
                status="failed",
                progress=100,
                stage="Falló la creación del esqueleto propio",
                error="rig_object.py failed",
                details={"returncode": result.returncode, "stderr": stderr, "stdout": stdout},
            )
            return
        set_job(
            job_id,
            status="completed",
            progress=100,
            stage="Objeto rigeado con esqueleto propio",
            resultUrl=f"/jobs/{job_id}/result",
        )
    except subprocess.TimeoutExpired:
        set_job(job_id, status="failed", progress=100, stage="Blender agotó el tiempo máximo", error=f"Blender exceeded {BLENDER_TIMEOUT_SECONDS}s")
    except Exception as exc:
        set_job(job_id, status="failed", progress=100, stage="Error inesperado", error=str(exc))


def run_attach_object_job(
    job_id: str,
    job_dir: Path,
    avatar_path: Path,
    rigged_object_path: Path,
    output_path: Path,
    category: str,
    side: str,
) -> None:
    try:
        set_job(job_id, status="processing", progress=20, stage="Conectando el hueso del objeto al avatar")
        command = [
            BLENDER_BIN,
            "--background",
            "--factory-startup",
            "--python-exit-code",
            "1",
            "--python",
            str(ATTACH_OBJECT_SCRIPT_PATH),
            "--",
            str(avatar_path),
            str(rigged_object_path),
            str(output_path),
            category,
            side,
        ]
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=BLENDER_TIMEOUT_SECONDS,
            cwd=str(job_dir),
            env={**os.environ, "PYTHONUNBUFFERED": "1"},
        )
        stdout = result.stdout[-16000:]
        stderr = result.stderr[-10000:]
        print(
            f"[worker] attach-object job={job_id} category={category} side={side} returncode={result.returncode}\n"
            f"[stdout]\n{stdout}\n[stderr]\n{stderr}",
            flush=True,
        )
        if result.returncode != 0 or not output_path.exists() or output_path.stat().st_size < 1024:
            set_job(
                job_id,
                status="failed",
                progress=100,
                stage="Falló la unión con el avatar",
                error="attach_object.py failed",
                details={"returncode": result.returncode, "stderr": stderr, "stdout": stdout},
            )
            return
        set_job(
            job_id,
            status="completed",
            progress=100,
            stage="Objeto unido al avatar",
            resultUrl=f"/jobs/{job_id}/result",
        )
    except subprocess.TimeoutExpired:
        set_job(job_id, status="failed", progress=100, stage="Blender agotó el tiempo máximo", error=f"Blender exceeded {BLENDER_TIMEOUT_SECONDS}s")
    except Exception as exc:
        set_job(job_id, status="failed", progress=100, stage="Error inesperado", error=str(exc))


@app.post("/rig-object")
async def create_rig_object_job(file: UploadFile = File(...), job: str = Form("{}")):
    if not file.filename or not file.filename.lower().endswith(".glb"):
        raise HTTPException(status_code=400, detail="El archivo debe ser .glb")
    try:
        payload = json.loads(job or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="El campo job no contiene JSON válido") from exc

    category_raw = str(payload.get("category") or "accessory").strip().lower()

    job_id = uuid.uuid4().hex
    job_dir = Path(tempfile.mkdtemp(prefix=f"clouva-rig-object-{job_id}-"))
    input_path = job_dir / "object.glb"
    output_path = job_dir / "rigged-object.glb"

    content = await file.read()
    if len(content) < 16:
        cleanup(job_dir)
        raise HTTPException(status_code=400, detail="El GLB está vacío")
    if len(content) > MAX_DOWNLOAD_BYTES:
        cleanup(job_dir)
        raise HTTPException(status_code=413, detail="El GLB supera el máximo permitido")
    input_path.write_bytes(content)

    set_job(
        job_id,
        id=job_id,
        status="queued",
        progress=5,
        stage="Objeto recibido, armando esqueleto propio",
        resultUrl=None,
        error=None,
        job_dir=str(job_dir),
        output_path=str(output_path),
        category=category_raw,
        operation="rig_object",
    )
    thread = threading.Thread(
        target=run_rig_object_job,
        args=(job_id, job_dir, input_path, output_path, category_raw),
        daemon=True,
    )
    thread.start()
    return {"id": job_id, "jobId": job_id, "status": "queued", "progress": 5, "category": category_raw}


class AttachObjectRequest(BaseModel):
    riggedObjectJobId: str
    category: str
    side: str = "right"


@app.post("/attach-object")
def create_attach_object_job(request: AttachObjectRequest):
    if not CLOUVA_AVATAR_URL:
        raise HTTPException(status_code=503, detail="Falta CLOUVA_AVATAR_URL o CLOUVA_BASE_AVATAR_URL en Railway.")

    with JOBS_LOCK:
        source = JOBS.get(request.riggedObjectJobId)
    if not source or source.get("status") != "completed":
        raise HTTPException(status_code=409, detail="El objeto todavía no terminó de rigearse (paso 1).")
    rigged_object_path = Path(source.get("output_path", ""))
    if not rigged_object_path.exists():
        raise HTTPException(status_code=410, detail="El GLB rigeado ya no está disponible, volvé a rigear el objeto.")

    category_raw = str(request.category or "accessory").strip().lower()
    side = "left" if str(request.side).strip().lower() == "left" else "right"

    job_id = uuid.uuid4().hex
    job_dir = Path(tempfile.mkdtemp(prefix=f"clouva-attach-{job_id}-"))
    avatar_path = job_dir / "avatar.glb"
    output_path = job_dir / "combined.glb"

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
        stage="Uniendo objeto y avatar",
        resultUrl=None,
        error=None,
        job_dir=str(job_dir),
        output_path=str(output_path),
        category=category_raw,
        operation="attach_object",
    )
    thread = threading.Thread(
        target=run_attach_object_job,
        args=(job_id, job_dir, avatar_path, rigged_object_path, output_path, category_raw, side),
        daemon=True,
    )
    thread.start()
    return {"id": job_id, "jobId": job_id, "status": "queued", "progress": 5, "category": category_raw}


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "clouva-garment-rig",
        "blender": BLENDER_BIN,
        "script_exists": SCRIPT_PATH.exists(),
        "avatar_configured": bool(CLOUVA_AVATAR_URL),
        "object_rig_retarget_supported": True,
        "hat_head_anchor_supported": True,
        "hat_default_lift_cm": HAT_DEFAULT_LIFT_CM,
        "preview_transforms_supported": True,
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

    preview_settings = payload.get("previewSettings")
    if not isinstance(preview_settings, dict):
        preview_settings = {}

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
        category=category,
        riggingStrategy="retarget_existing_or_category_anchor",
    )
    thread = threading.Thread(
        target=run_blender_job,
        args=(job_id, job_dir, avatar_path, garment_path, output_path, category),
        kwargs={
            "color": str(payload.get("color") or ""),
            "preview_settings": preview_settings,
        },
        daemon=True,
    )
    thread.start()
    return {
        "id": job_id,
        "jobId": job_id,
        "status": "queued",
        "progress": 5,
        "category": category,
        "riggingStrategy": "retarget_existing_or_category_anchor",
    }


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
    category_raw = request.category.strip().lower()
    category = CATEGORY_MAP.get(category_raw, category_raw)
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
        run_blender_job(
            "legacy-sync",
            job_dir,
            avatar_path,
            garment_path,
            output_path,
            category,
            art_path,
            request.color or "",
            {},
        )
        if not output_path.exists() or output_path.stat().st_size < 1024:
            raise HTTPException(status_code=422, detail="Automatic rig retarget validation failed")
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
