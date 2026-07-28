"""Cloud Run runtime wrapper exposing immutable deployment metadata.

The production API remains the existing app module. This wrapper only enriches
the Avatar Analyzer health response with the exact source commit/ref and Cloud
Run revision used by the deployment workflow.
"""
from __future__ import annotations

import inspect
import os
from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse

from app import app as app


_HEALTH_PATH = "/diagnostics/avatar-analyzer-v4"


def _health_endpoint():
    for route in app.routes:
        if getattr(route, "path", None) == _HEALTH_PATH and "GET" in (getattr(route, "methods", None) or set()):
            return route.endpoint
    raise RuntimeError(f"Avatar Analyzer health endpoint not registered: {_HEALTH_PATH}")


_BASE_HEALTH_ENDPOINT = _health_endpoint()


@app.middleware("http")
async def include_deployment_metadata(request: Request, call_next):
    if request.method == "GET" and request.url.path == _HEALTH_PATH:
        payload: Any = _BASE_HEALTH_ENDPOINT()
        if inspect.isawaitable(payload):
            payload = await payload
        if not isinstance(payload, dict):
            return await call_next(request)
        enriched = dict(payload)
        enriched.update({
            "sourceCommit": os.environ.get("CLOUVA_DEPLOYED_COMMIT") or None,
            "sourceRef": os.environ.get("CLOUVA_DEPLOYED_REF") or None,
            "revision": os.environ.get("K_REVISION") or None,
        })
        return JSONResponse(enriched, headers={"Cache-Control": "no-store"})
    return await call_next(request)


__all__ = ["app"]
