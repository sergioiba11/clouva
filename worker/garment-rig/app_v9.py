import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import app_v8 as base
from fastapi import HTTPException
from pydantic import BaseModel, HttpUrl


app = base.app
legacy = base.legacy
WORKER_INSPECTOR_VERSION = "v1-pipeline-visibility"
INSPECT_SCRIPT_PATH = Path(__file__).with_name("inspect_garment.py")


class GarmentDiagnosticsRequest(BaseModel):
    source_url: HttpUrl
    avatar_source_url: HttpUrl | None = None
    user_id: str | None = None
    category: str = "hoodie"
    run_pipeline: bool = True


def run_inspector(
    job_dir: Path,
    garment_path: Path,
    avatar_path: Path,
    output_path: Path,
    category: str,
) -> dict:
    command = [
        legacy.BLENDER_BIN,
        "--background",
        "--factory-startup",
        "--python-exit-code",
        "1",
        "--python",
        str(INSPECT_SCRIPT_PATH),
        "--",
        str(garment_path),
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
        detail = base.extract_validation_error(result.stdout, result.stderr)
        raise RuntimeError(
            detail
            or result.stderr[-2400:]
            or "Blender no pudo inspeccionar la prenda"
        )
    report = json.loads(output_path.read_text(encoding="utf-8"))
    report["logs"] = {
        "stdout": result.stdout[-6000:],
        "stderr": result.stderr[-3000:],
    }
    return report


def run_rig_probe(
    job_dir: Path,
    avatar_path: Path,
    garment_path: Path,
    output_path: Path,
    category: str,
) -> dict:
    command = [
        legacy.BLENDER_BIN,
        "--background",
        "--factory-startup",
        "--python-exit-code",
        "1",
        "--python",
        str(legacy.SCRIPT_PATH),
        "--",
        str(avatar_path),
        str(garment_path),
        str(output_path),
        category,
        "",
        "",
        "{}",
    ]
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=legacy.BLENDER_TIMEOUT_SECONDS,
        cwd=str(job_dir),
        env={**os.environ, "PYTHONUNBUFFERED": "1"},
    )
    error = None
    if result.returncode != 0 or not output_path.exists() or output_path.stat().st_size < 1024:
        error = (
            base.extract_validation_error(result.stdout, result.stderr)
            or result.stderr[-2400:]
            or "El rig de prueba no produjo un GLB válido"
        )
    return {
        "ok": error is None,
        "returnCode": result.returncode,
        "outputBytes": output_path.stat().st_size if output_path.exists() else 0,
        "error": error,
        "stdout": result.stdout[-12000:],
        "stderr": result.stderr[-6000:],
    }


def worker_tools():
    return [
        {
            "id": "gltf-import",
            "name": "Importador GLB",
            "script": "inspect_garment.py",
            "purpose": "Lee mallas, materiales, jerarquía y transformaciones.",
            "status": "ready" if INSPECT_SCRIPT_PATH.exists() else "missing",
        },
        {
            "id": "geometry-cleanup",
            "name": "Limpieza de geometría",
            "script": "rig_garment_v17.py",
            "purpose": "Une duplicados, conserva el volumen y recupera prendas antiguas.",
            "version": os.environ.get("CLOUVA_LEGACY_GARMENT_RECOVERY", "unknown"),
            "status": "ready",
        },
        {
            "id": "body-fitting",
            "name": "Fitting al avatar",
            "script": "rig_garment_v18.py / rig_garment_v20.py",
            "purpose": "Mide torso, brazos o piernas y ajusta la prenda.",
            "status": "ready",
        },
        {
            "id": "skinning",
            "name": "Transferencia de pesos",
            "script": "rig_garment_v19.py",
            "purpose": "Copia huesos y skin weights desde el avatar activo.",
            "status": "ready",
        },
        {
            "id": "unreal-export",
            "name": "Exportador FBX Unreal",
            "script": "export_unreal_clean.py",
            "purpose": "Normaliza unidades, escala, rig y valida el FBX reimportado.",
            "version": base.UNREAL_EXPORT_VERSION,
            "status": "ready" if base.EXPORT_UNREAL_SCRIPT_PATH.exists() else "missing",
        },
    ]


@app.get("/diagnostics/health")
def diagnostics_health():
    return {
        "ok": True,
        "inspectorVersion": WORKER_INSPECTOR_VERSION,
        "rigVersion": os.environ.get("CLOUVA_RIG_VERSION", "unknown"),
        "legacyRecoveryVersion": os.environ.get("CLOUVA_LEGACY_GARMENT_RECOVERY", "unknown"),
        "exportVersion": base.UNREAL_EXPORT_VERSION,
        "rigRouteVersion": base.RIG_ROUTE_VERSION,
        "tools": worker_tools(),
    }


@app.post("/diagnostics/garment")
def diagnose_garment(request: GarmentDiagnosticsRequest):
    if not INSPECT_SCRIPT_PATH.exists():
        raise HTTPException(status_code=500, detail="Falta inspect_garment.py en el Worker")

    category_raw = str(request.category or "hoodie").strip().lower()
    category = legacy.CATEGORY_MAP.get(category_raw, category_raw)
    if category not in legacy.VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail="Categoría de prenda inválida")

    job_dir = Path(tempfile.mkdtemp(prefix="clouva-worker-inspector-"))
    garment_path = job_dir / "garment-source.glb"
    avatar_path = job_dir / "avatar-active.glb"
    preflight_path = job_dir / "preflight.json"
    rigged_path = job_dir / "garment-probe-rigged.glb"
    output_inspection_path = job_dir / "output-inspection.json"

    try:
        avatar_url = (
            str(request.avatar_source_url)
            if request.avatar_source_url
            else base.resolve_user_avatar_url(request.user_id)
        )
        if not avatar_url:
            raise RuntimeError("No se pudo resolver el avatar activo para el diagnóstico")

        legacy.download(str(request.source_url), garment_path)
        legacy.download(avatar_url, avatar_path)
        preflight = run_inspector(
            job_dir,
            garment_path,
            avatar_path,
            preflight_path,
            category,
        )

        pipeline = {
            "requested": bool(request.run_pipeline),
            "ok": None,
            "error": None,
            "returnCode": None,
            "outputBytes": 0,
            "stdout": "",
            "stderr": "",
        }
        output_inspection = None

        if request.run_pipeline:
            pipeline = run_rig_probe(
                job_dir,
                avatar_path,
                garment_path,
                rigged_path,
                category,
            )
            if pipeline["ok"]:
                output_inspection = run_inspector(
                    job_dir,
                    rigged_path,
                    avatar_path,
                    output_inspection_path,
                    category,
                )

        stages = list(preflight.get("stages") or [])
        stages.append({
            "id": "fresh-rig-probe",
            "label": "Prueba real de fitting + rig",
            "status": (
                "ok"
                if pipeline.get("ok") is True
                else "error"
                if pipeline.get("ok") is False
                else "pending"
            ),
            "summary": (
                f"GLB riggeado generado: {pipeline.get('outputBytes', 0):,} bytes"
                if pipeline.get("ok") is True
                else str(pipeline.get("error") or "La prueba profunda no fue ejecutada")
            ),
        })
        stages.append({
            "id": "fbx-export",
            "label": "Exportación y validación FBX",
            "status": "pending",
            "summary": "Se ejecuta al tocar Generar y descargar objeto FBX.",
        })

        result = {
            "ok": bool(preflight.get("ok") and pipeline.get("ok") is not False),
            "category": category,
            "worker": {
                "inspectorVersion": WORKER_INSPECTOR_VERSION,
                "rigVersion": os.environ.get("CLOUVA_RIG_VERSION", "unknown"),
                "legacyRecoveryVersion": os.environ.get("CLOUVA_LEGACY_GARMENT_RECOVERY", "unknown"),
                "exportVersion": base.UNREAL_EXPORT_VERSION,
                "rigRouteVersion": base.RIG_ROUTE_VERSION,
                "blenderVersion": preflight.get("garment", {}).get("blenderVersion"),
            },
            "tools": worker_tools(),
            "stages": stages,
            "garment": preflight.get("garment"),
            "avatar": preflight.get("avatar"),
            "pipeline": pipeline,
            "outputInspection": output_inspection,
            "diagnosis": {
                "legacyGeometryDifferenceDetected": bool(
                    preflight.get("garment", {}).get("legacyRecoveryRecommended")
                ),
                "recommendedAction": (
                    "Hornear la geometría evaluada antes de quitar el rig anterior."
                    if preflight.get("garment", {}).get("legacyRecoveryRecommended")
                    else "La forma cruda y la visible coinciden; revisar la siguiente etapa fallida."
                ),
            },
        }
        return result
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="Blender agotó el tiempo durante el diagnóstico") from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"No se pudo diagnosticar la prenda: {exc}") from exc
    finally:
        shutil.rmtree(job_dir, ignore_errors=True)
