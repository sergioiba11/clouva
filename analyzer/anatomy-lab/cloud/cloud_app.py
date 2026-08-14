from __future__ import annotations

import sys
from pathlib import Path

from fastapi.staticfiles import StaticFiles

BACKEND_DIR = Path(__file__).resolve().parent / "backend"
FRONTEND_DIR = Path(__file__).resolve().parent / "frontend"

backend_path = str(BACKEND_DIR)
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)

from main import app  # noqa: E402

app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
