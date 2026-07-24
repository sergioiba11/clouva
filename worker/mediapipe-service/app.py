"""Standalone Cloud Run wrapper around the CLOUVA MediaPipe landmark detector.

Reuses the exact detection functions from garment-rig/landmark_detector_2d.py
unmodified: images arrive base64-encoded over HTTP, get written to temp files,
and are handed to the same _detect_face / _detect_hand pipeline that already
runs (and is tested) inside the Blender worker's local subprocess path. This
keeps Blender's own container free of MediaPipe's model + runtime footprint.
"""
from __future__ import annotations

import base64
import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

from landmark_detector_2d import (
    FACE_MODEL,
    HAND_MAP,
    HAND_MODEL,
    _collapse_errors,
    _detect_face,
    _detect_hand,
    _face_detector,
    _hand_detector,
    _prune_redundant_errors,
)

SERVICE_TOKEN = os.environ.get("CLOUVA_MEDIAPIPE_SERVICE_TOKEN")

app = FastAPI()
_face = _face_detector()
_hand = _hand_detector()


class ViewPayload(BaseModel):
    name: str
    region: str
    side: str | None = None
    pathB64: str | None = None
    edgePathB64: str | None = None
    silhouettePathB64: str | None = None


class DetectRequest(BaseModel):
    version: str | None = None
    attempt: str = "initial"
    views: list[ViewPayload] = []


def _write_temp_image(encoded: str | None, workdir: Path, suffix: str) -> str | None:
    if not encoded:
        return None
    raw = base64.b64decode(encoded)
    handle, name = tempfile.mkstemp(suffix=suffix, dir=str(workdir))
    with os.fdopen(handle, "wb") as file:
        file.write(raw)
    return name


@app.get("/health")
def health():
    return {"status": "ok", "faceModel": str(FACE_MODEL), "handModel": str(HAND_MODEL)}


@app.post("/detect")
def detect(payload: DetectRequest, authorization: str | None = Header(default=None)):
    if SERVICE_TOKEN:
        expected = f"Bearer {SERVICE_TOKEN}"
        if authorization != expected:
            raise HTTPException(status_code=401, detail="Invalid or missing bearer token")

    output = {
        "version": "clouva-mediapipe-tasks-v3.2-stylized-silhouette-retry",
        "faceModel": str(FACE_MODEL), "handModel": str(HAND_MODEL),
        "handLandmarkCount": len(HAND_MAP), "views": [], "errors": [],
    }
    with tempfile.TemporaryDirectory(prefix="clouva-mediapipe-request-") as raw_workdir:
        workdir = Path(raw_workdir)
        for view in payload.views:
            local_view = {
                "name": view.name,
                "region": view.region,
                "side": view.side,
                "path": _write_temp_image(view.pathB64, workdir, ".png"),
                "edgePath": _write_temp_image(view.edgePathB64, workdir, ".png"),
                "silhouettePath": _write_temp_image(view.silhouettePathB64, workdir, ".png"),
            }
            try:
                if view.region == "face":
                    candidates, error = _detect_face(_face, local_view)
                elif view.region == "hand":
                    candidates, error = _detect_hand(_hand, local_view)
                else:
                    candidates, error = [], {"code": "UNKNOWN_REGION", "view": view.name}
                output["views"].append({
                    "name": view.name, "region": view.region,
                    "side": view.side, "candidates": candidates,
                })
                if error:
                    output["errors"].append(error)
            except Exception as exc:
                output["errors"].append({
                    "code": "DETECTOR_VIEW_FAILED", "view": view.name, "message": str(exc),
                })
    output = _prune_redundant_errors(output)
    output["errors"] = _collapse_errors(output["errors"])
    output["attempt"] = payload.attempt
    for error in output["errors"]:
        error.setdefault("attempt", payload.attempt)
    return output
