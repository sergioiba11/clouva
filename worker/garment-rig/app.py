import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from urllib.request import Request, urlopen

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, HttpUrl
from starlette.background import BackgroundTask

app = FastAPI(title="CLOUVA Garment Rig Worker")

BLENDER_BIN = os.getenv("BLENDER_BIN", "blender")
SCRIPT_PATH = Path(__file__).with_name("rig_garment.py")
MAX_DOWNLOAD_BYTES = int(os.getenv("MAX_DOWNLOAD_BYTES", str(120 * 1024 * 1024)))
BLENDER_TIMEOUT_SECONDS = int(os.getenv("BLENDER_TIMEOUT_SECONDS", "420"))
VALID_CATEGORIES = {"hoodie", "shirt", "jacket", "pants", "shorts", "shoes", "accessory"}


class RigRequest(BaseModel):
    avatar_url: HttpUrl
    garment_url: HttpUrl
    category: str
    art_url: HttpUrl | None = None
    color: str | None = None


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


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "clouva-garment-rig",
        "blender": BLENDER_BIN,
        "script_exists": SCRIPT_PATH.exists(),
    }


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
            str(art_path) if art_path.exists() else "",
            request.color or "#0a0a0a",
        ]
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
        print(f"[worker] blender returncode={result.returncode}\n[stdout]\n{stdout}\n[stderr]\n{stderr}", flush=True)

        if result.returncode != 0 or not output_path.exists() or output_path.stat().st_size < 1024:
            cleanup(job_dir)
            raise HTTPException(
                status_code=422,
                detail={
                    "message": "Automatic rigging validation failed",
                    "returncode": result.returncode,
                    "stderr": stderr,
                    "stdout": stdout,
                },
            )

        return FileResponse(
            output_path,
            media_type="model/gltf-binary",
            filename="rigged.glb",
            background=BackgroundTask(cleanup, job_dir),
            headers={
                "X-CLOUVA-Rigged": "true",
                "X-CLOUVA-Category": category,
            },
        )
    except HTTPException:
        raise
    except subprocess.TimeoutExpired as exc:
        cleanup(job_dir)
        raise HTTPException(status_code=504, detail=f"Blender exceeded {BLENDER_TIMEOUT_SECONDS}s") from exc
    except Exception as exc:
        cleanup(job_dir)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
