import os
import subprocess
import tempfile
from pathlib import Path
from urllib.request import urlopen

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, HttpUrl

app = FastAPI(title="CLOUVA Garment Rig Worker")

BLENDER_BIN = os.getenv("BLENDER_BIN", "blender")
SCRIPT_PATH = Path(__file__).with_name("rig_garment.py")


class RigRequest(BaseModel):
    avatar_url: HttpUrl
    garment_url: HttpUrl
    category: str
    art_url: HttpUrl | None = None
    color: str | None = None


def download(url: str, destination: Path) -> None:
    with urlopen(url, timeout=90) as response:
        destination.write_bytes(response.read())


@app.get("/health")
def health():
    return {"ok": True, "service": "clouva-garment-rig"}


@app.post("/rig")
def rig(request: RigRequest):
    if request.category not in {"hoodie", "shirt", "jacket", "pants", "shorts", "shoes", "accessory"}:
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
            "--python",
            str(SCRIPT_PATH),
            "--",
            str(avatar_path),
            str(garment_path),
            str(output_path),
            request.category,
            str(art_path) if art_path.exists() else "",
            request.color or "#0a0a0a",
        ]
        result = subprocess.run(command, capture_output=True, text=True, timeout=420)
        if result.returncode != 0 or not output_path.exists():
            raise HTTPException(
                status_code=422,
                detail={
                    "message": "Automatic rigging or texturing failed",
                    "stderr": result.stderr[-4000:],
                    "stdout": result.stdout[-2000:],
                },
            )

        return FileResponse(output_path, media_type="model/gltf-binary", filename="rigged.glb")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
