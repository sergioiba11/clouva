from __future__ import annotations

import hashlib
import sys
import urllib.request
from pathlib import Path

MODELS = {
    "pose_landmarker.task": "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
    "face_landmarker.task": "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task",
    "hand_landmarker.task": "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task",
}

def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()

def main() -> int:
    models_dir = Path(__file__).resolve().parent / "models"
    models_dir.mkdir(parents=True, exist_ok=True)
    for filename, url in MODELS.items():
        target = models_dir / filename
        if target.is_file() and target.stat().st_size > 100_000:
            print(f"[modelos] {filename} ya existe · sha256={sha256(target)[:16]}…")
            continue
        print(f"[modelos] descargando {filename}")
        temp = target.with_suffix(target.suffix + ".part")
        try:
            with urllib.request.urlopen(url, timeout=120) as response, temp.open("wb") as output:
                while chunk := response.read(1024 * 1024):
                    output.write(chunk)
            if temp.stat().st_size < 100_000:
                raise RuntimeError(f"La descarga de {filename} quedó incompleta")
            temp.replace(target)
            print(f"[modelos] listo {filename} · {target.stat().st_size / 1024 / 1024:.1f} MB · sha256={sha256(target)[:16]}…")
        except Exception as exc:
            temp.unlink(missing_ok=True)
            print(f"[modelos] ERROR {filename}: {exc}", file=sys.stderr)
            return 1
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
