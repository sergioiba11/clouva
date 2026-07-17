from __future__ import annotations

import json
import os
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

APP_ROOT = Path(os.getenv("APP_ROOT", "/app"))
JOBS_ROOT = Path(os.getenv("JOBS_ROOT", "/tmp/clouva-garment-jobs"))
AVATAR_PATH = Path(os.getenv("CLOUVA_AVATAR_PATH", str(APP_ROOT / "models" / "clouva-base-rig-v1.glb")))
RIG_SCRIPT = Path(os.getenv("CLOUVA_RIG_SCRIPT", str(APP_ROOT / "rig_clothing.py")))
BLENDER_BIN = os.getenv("BLENDER_BIN", "blender")
WORKER_TOKEN = os.getenv("GARMENT_WORKER_TOKEN") or os.getenv("BLENDER_WORKER_TOKEN")
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "").rstrip("/")
MAX_FILE_SIZE = int(os.getenv("MAX_GLB_BYTES", str(80 * 1024 * 1024)))
JOB_TIMEOUT_SECONDS = int(os.getenv("BLENDER_JOB_TIMEOUT_SECONDS", "900"))
JOB_RETENTION_SECONDS = int(os.getenv("JOB_RETENTION_SECONDS", "86400"))

app = FastAPI(title="CLOUVA Garment Worker", version="1.0.0")

allowed_origins = [
    value.strip()
    for value in os.getenv(
        "CORS_ORIGINS",
        "https://clouva.com.ar,https://www.clouva.com.ar,http://localhost:3000",
    ).split(",")
    if value.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

jobs: dict[str, dict[str, Any]] = {}
jobs_lock = threading.Lock()


def require_auth(authorization: str | None) -> None:
    if not WORKER_TOKEN:
        return
    if authorization != f"Bearer {WORKER_TOKEN}":
        raise HTTPException(status_code=401, detail="Token del Garment Worker inválido")


def update_job(job_id: str, **changes: Any) -> None:
    with jobs_lock:
        if job_id in jobs:
            jobs[job_id].update(changes)
            jobs[job_id]["updatedAt"] = time.time()


def get_job(job_id: str) -> dict[str, Any]:
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Trabajo no encontrado")
        return dict(job)


def cleanup_old_jobs() -> None:
    now = time.time()
    with jobs_lock:
        expired = [
            job_id
            for job_id, job in jobs.items()
            if now - float(job.get("updatedAt", now)) > JOB_RETENTION_SECONDS
        ]
        for job_id in expired:
            jobs.pop(job_id, None)

    for directory in JOBS_ROOT.iterdir() if JOBS_ROOT.exists() else []:
        try:
            if now - directory.stat().st_mtime > JOB_RETENTION_SECONDS:
                for child in directory.iterdir():
                    child.unlink(missing_ok=True)
                directory.rmdir()
        except OSError:
            continue


def validate_glb(data: bytes) -> None:
    if not data:
        raise HTTPException(status_code=400, detail="El GLB está vacío")
    if len(data) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="El GLB supera el tamaño máximo permitido")
    if data[:4] != b"glTF":
        raise HTTPException(status_code=400, detail="El archivo no tiene un encabezado GLB válido")


def result_url(request: Request, job_id: str) -> str:
    base = PUBLIC_BASE_URL or str(request.base_url).rstrip("/")
    return f"{base}/jobs/{job_id}/result.glb"


def build_blender_command(job_id: str, source_path: Path, output_path: Path, job: dict[str, Any]) -> list[str]:
    preview = job.get("previewSettings") or {}
    adjustments = preview.get("adjustments") if isinstance(preview, dict) else {}
    if not isinstance(adjustments, dict):
        adjustments = {}

    command = [
        BLENDER_BIN,
        "--background",
        "--python",
        str(RIG_SCRIPT),
        "--",
        "--avatar",
        str(AVATAR_PATH),
        "--garment",
        str(source_path),
        "--output",
        str(output_path),
        "--category",
        str(job.get("category") or "accessory"),
        "--adjustments-json",
        json.dumps(adjustments, separators=(",", ":")),
        "--report",
        str(output_path.with_suffix(".report.json")),
    ]
    if bool(job.get("templateMode")) or job.get("riggingStrategy") == "preserve_existing_skinning":
        command.append("--template-mode")
    return command


def run_blender_job(job_id: str, source_path: Path, output_path: Path, job: dict[str, Any]) -> None:
    update_job(job_id, status="processing", progress=10, stage="Preparando Blender")
    log_path = source_path.parent / "blender.log"
    try:
        if not AVATAR_PATH.exists():
            raise RuntimeError(f"No existe el avatar oficial en {AVATAR_PATH}")
        if not RIG_SCRIPT.exists():
            raise RuntimeError(f"No existe el script de rigging en {RIG_SCRIPT}")

        command = build_blender_command(job_id, source_path, output_path, job)
        update_job(job_id, progress=25, stage="Transfiriendo rig y validando pesos", command=command)
        result = subprocess.run(
            command,
            cwd=str(source_path.parent),
            capture_output=True,
            text=True,
            timeout=JOB_TIMEOUT_SECONDS,
            check=False,
        )
        log_path.write_text(
            f"COMMAND: {' '.join(command)}\n\nSTDOUT:\n{result.stdout}\n\nSTDERR:\n{result.stderr}",
            encoding="utf-8",
        )
        if result.returncode != 0:
            error_text = (result.stderr or result.stdout or "Blender terminó con error").strip()
            raise RuntimeError(error_text[-4000:])
        if not output_path.exists() or output_path.stat().st_size == 0:
            raise RuntimeError("Blender terminó sin producir el GLB de salida")
        if output_path.read_bytes()[:4] != b"glTF":
            raise RuntimeError("El archivo exportado no es un GLB válido")

        update_job(
            job_id,
            status="completed",
            progress=100,
            stage="GLB riggeado y validado",
            outputPath=str(output_path),
            outputSize=output_path.stat().st_size,
            error=None,
        )
    except subprocess.TimeoutExpired:
        update_job(
            job_id,
            status="failed",
            progress=100,
            stage="Tiempo máximo excedido",
            error=f"Blender superó {JOB_TIMEOUT_SECONDS} segundos",
        )
    except Exception as exc:
        update_job(
            job_id,
            status="failed",
            progress=100,
            stage="Falló el rigging",
            error=str(exc),
        )


@app.on_event("startup")
def startup() -> None:
    JOBS_ROOT.mkdir(parents=True, exist_ok=True)
    if not AVATAR_PATH.exists():
        raise RuntimeError(f"Falta el avatar oficial: {AVATAR_PATH}")
    if AVATAR_PATH.read_bytes()[:4] != b"glTF":
        raise RuntimeError("El avatar oficial reconstruido no es un GLB válido")


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "clouva-garment-worker",
        "avatarReady": AVATAR_PATH.exists(),
        "rigScriptReady": RIG_SCRIPT.exists(),
        "activeJobs": sum(1 for job in jobs.values() if job.get("status") in {"queued", "processing"}),
    }


@app.post("/jobs")
async def create_job(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    job: str = Form("{}"),
    authorization: str | None = Header(default=None),
) -> JSONResponse:
    require_auth(authorization)
    cleanup_old_jobs()
    try:
        payload = json.loads(job or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="El payload job no es JSON válido") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="El payload job debe ser un objeto JSON")

    data = await file.read()
    validate_glb(data)
    job_id = uuid.uuid4().hex
    job_dir = JOBS_ROOT / job_id
    job_dir.mkdir(parents=True, exist_ok=False)
    safe_name = Path(file.filename or "input.glb").name
    if not safe_name.lower().endswith(".glb"):
        safe_name += ".glb"
    source_path = job_dir / safe_name
    output_path = job_dir / "output.glb"
    source_path.write_bytes(data)
    (job_dir / "job.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    now = time.time()
    with jobs_lock:
        jobs[job_id] = {
            "jobId": job_id,
            "status": "queued",
            "progress": 1,
            "stage": "Trabajo recibido",
            "createdAt": now,
            "updatedAt": now,
            "category": payload.get("category"),
            "templateMode": bool(payload.get("templateMode")),
            "riggingStrategy": payload.get("riggingStrategy"),
            "sourceName": safe_name,
            "outputPath": str(output_path),
            "error": None,
        }

    background_tasks.add_task(run_blender_job, job_id, source_path, output_path, payload)
    return JSONResponse({"ok": True, "jobId": job_id, "status": "queued", "progress": 1})


@app.get("/jobs/{job_id}")
def job_status(job_id: str, request: Request, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_auth(authorization)
    job = get_job(job_id)
    response = {
        "ok": job.get("status") != "failed",
        "jobId": job_id,
        "status": job.get("status"),
        "progress": job.get("progress", 0),
        "stage": job.get("stage"),
        "error": job.get("error"),
        "riggingStrategy": job.get("riggingStrategy"),
        "templateMode": job.get("templateMode", False),
    }
    if job.get("status") == "completed":
        response["resultUrl"] = result_url(request, job_id)
    return response


@app.get("/jobs/{job_id}/result.glb")
def download_result(job_id: str, authorization: str | None = Header(default=None)) -> FileResponse:
    require_auth(authorization)
    job = get_job(job_id)
    if job.get("status") != "completed":
        raise HTTPException(status_code=409, detail="El trabajo todavía no terminó")
    output_path = Path(str(job.get("outputPath")))
    if not output_path.exists():
        raise HTTPException(status_code=404, detail="El GLB de salida ya no está disponible")
    return FileResponse(output_path, media_type="model/gltf-binary", filename=f"clouva-rigged-{job_id}.glb")


@app.get("/jobs/{job_id}/report")
def download_report(job_id: str, authorization: str | None = Header(default=None)) -> FileResponse:
    require_auth(authorization)
    job = get_job(job_id)
    report_path = Path(str(job.get("outputPath"))).with_suffix(".report.json")
    if not report_path.exists():
        raise HTTPException(status_code=404, detail="El reporte todavía no está disponible")
    return FileResponse(report_path, media_type="application/json", filename=f"clouva-rig-report-{job_id}.json")
