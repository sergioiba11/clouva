import json
import os
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen

import app_v7 as base
import app_legacy as legacy
from fastapi import HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, HttpUrl
from starlette.background import BackgroundTask


app = base.app
EXPORT_UNREAL_SCRIPT_PATH = base.EXPORT_UNREAL_SCRIPT_PATH
RIG_ROUTE_VERSION = "v8-diagnostic-sync"
UNREAL_EXPORT_VERSION = "v28-active-avatar-reference"


# Replace the legacy synchronous /rig route and the previous Unreal V2 route.
app.router.routes[:] = [
    route
    for route in app.router.routes
    if not (
        getattr(route, "path", None) in {"/rig", "/export/unreal-v2"}
        and "POST" in (getattr(route, "methods", set()) or set())
    )
]


def pop_job(job_id: str) -> dict:
    with legacy.JOBS_LOCK:
        return dict(legacy.JOBS.pop(job_id, {}))


@app.post("/rig")
def rig_with_diagnostics(request: legacy.RigRequest):
    category_raw = request.category.strip().lower()
    category = legacy.CATEGORY_MAP.get(category_raw, category_raw)
    if category not in legacy.VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail="Invalid category")

    job_id = f"sync-{uuid.uuid4().hex}"
    job_dir = Path(tempfile.mkdtemp(prefix="clouva-rig-sync-"))
    avatar_path = job_dir / "avatar.glb"
    garment_path = job_dir / "garment.glb"
    output_path = job_dir / "rigged.glb"
    art_path = job_dir / "art.png"

    try:
        legacy.download(str(request.avatar_url), avatar_path)
        legacy.download(str(request.garment_url), garment_path)
        if request.art_url:
            legacy.download(str(request.art_url), art_path)

        legacy.run_blender_job(
            job_id,
            job_dir,
            avatar_path,
            garment_path,
            output_path,
            category,
            art_path if art_path.exists() else None,
            request.color or "",
            {},
        )
        snapshot = pop_job(job_id)

        if not output_path.exists() or output_path.stat().st_size < 1024:
            visible_error = str(snapshot.get("error") or "").strip()
            technical_error = str(snapshot.get("technicalError") or "").strip()
            detail = visible_error or technical_error or "Blender no pudo producir un GLB riggeado válido"
            raise HTTPException(status_code=422, detail=detail)

        return FileResponse(
            output_path,
            media_type="model/gltf-binary",
            filename="rigged.glb",
            background=BackgroundTask(legacy.cleanup, job_dir),
            headers={
                "X-Clouva-Rig-Route": RIG_ROUTE_VERSION,
                "X-Clouva-Rig-Category": category,
            },
        )
    except HTTPException:
        pop_job(job_id)
        legacy.cleanup(job_dir)
        raise
    except Exception as exc:
        pop_job(job_id)
        legacy.cleanup(job_dir)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class ValidatedUnrealExportRequestV28(BaseModel):
    avatar_id: str | None = None
    asset_id: str | None = None
    user_id: str | None = None
    source_url: HttpUrl
    avatar_source_url: HttpUrl | None = None
    target_height_cm: float = 175.0
    avatar_height_cm: float | None = None
    garment_target_height_cm: float | None = None
    asset_type: str = "avatar"
    category: str = "prop"
    preserve_armature: bool = True
    preserve_skin_weights: bool = True


def extract_validation_error(stdout: str, stderr: str) -> str | None:
    try:
        helper = base.base.base.extract_validation_error
        return helper({"stdout": stdout, "stderr": stderr})
    except Exception:
        combined = "\n".join((stdout or "", stderr or ""))
        for line in reversed(combined.splitlines()):
            stripped = line.strip()
            if stripped.startswith("RuntimeError:"):
                return stripped
        return None


def dimensions_header(metadata: dict) -> str:
    values = metadata.get("fbxRoundTripDimensionsCm") or metadata.get("dimensionsCm") or []
    try:
        return "x".join(str(round(float(value), 3)) for value in values)
    except (TypeError, ValueError):
        return "unknown"


def _supabase_json(path: str):
    if not (legacy.SUPABASE_URL and legacy.SUPABASE_SERVICE_ROLE_KEY):
        return None
    request = Request(
        f"{legacy.SUPABASE_URL}{path}",
        headers={
            "apikey": legacy.SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {legacy.SUPABASE_SERVICE_ROLE_KEY}",
        },
    )
    with urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def resolve_user_avatar_url(user_id: str | None) -> str | None:
    if user_id and legacy.SUPABASE_URL and legacy.SUPABASE_SERVICE_ROLE_KEY:
        encoded_user = quote(str(user_id), safe="")
        try:
            rows = _supabase_json(
                "/rest/v1/user_avatars"
                f"?user_id=eq.{encoded_user}"
                "&is_active=eq.true&status=eq.ready&archived_at=is.null"
                "&select=*&order=updated_at.desc&limit=1"
            )
            if rows:
                row = rows[0]
                for key in ("processed_glb_url", "rigged_url", "model_url"):
                    value = row.get(key)
                    if isinstance(value, str) and value.startswith("https://"):
                        return value
        except Exception as exc:
            print(f"[worker-v28] active avatar lookup failed: {exc}", flush=True)

        try:
            rows = _supabase_json(
                f"/rest/v1/profiles?id=eq.{encoded_user}&select=avatar_3d_url&limit=1"
            )
            if rows:
                value = rows[0].get("avatar_3d_url")
                if isinstance(value, str) and value.startswith("https://"):
                    return value
        except Exception as exc:
            print(f"[worker-v28] profile avatar lookup failed: {exc}", flush=True)

    try:
        return legacy.resolve_avatar_url()
    except Exception:
        return None


def run_fresh_garment_rig(
    job_dir: Path,
    avatar_path: Path,
    source_path: Path,
    output_path: Path,
    category: str,
) -> None:
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
        str(source_path),
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
    print(
        f"[worker-v28] fresh garment rig category={category} returncode={result.returncode}\n"
        f"[stdout]\n{result.stdout[-12000:]}\n[stderr]\n{result.stderr[-8000:]}",
        flush=True,
    )
    if result.returncode != 0 or not output_path.exists() or output_path.stat().st_size < 1024:
        details = extract_validation_error(result.stdout, result.stderr)
        raise RuntimeError(
            details
            or result.stderr[-1800:]
            or "Blender no pudo reajustar la prenda al avatar activo"
        )


@app.post("/export/unreal-v2")
def export_for_unreal_v28(request: ValidatedUnrealExportRequestV28):
    if not EXPORT_UNREAL_SCRIPT_PATH.exists():
        raise HTTPException(status_code=500, detail="Falta export_unreal_clean.py en el Blender Worker")
    if request.target_height_cm < 80 or request.target_height_cm > 260:
        raise HTTPException(status_code=400, detail="target_height_cm debe estar entre 80 y 260")

    asset_type = str(request.asset_type or "avatar").strip().lower()
    is_garment = asset_type == "garment"
    category = legacy.CATEGORY_MAP.get(
        str(request.category or "prop").strip().lower(),
        str(request.category or "prop").strip().lower(),
    )
    if is_garment and category not in legacy.VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail="Categoría de prenda inválida")

    avatar_height_cm = float(request.avatar_height_cm or (175.0 if is_garment else request.target_height_cm))
    garment_target_height_cm = float(request.garment_target_height_cm or request.target_height_cm)
    if not 80.0 <= avatar_height_cm <= 260.0:
        raise HTTPException(status_code=400, detail="avatar_height_cm debe estar entre 80 y 260")

    job_dir = Path(tempfile.mkdtemp(prefix="clouva-unreal-garment-" if is_garment else "clouva-unreal-v2-"))
    input_path = job_dir / ("garment-source.glb" if is_garment else "avatar-rigged.glb")
    refitted_path = job_dir / "garment-refitted-v28.glb"
    avatar_reference_path = job_dir / "avatar-reference.glb"
    output_path = job_dir / ("garment-unreal.fbx" if is_garment else "avatar-unreal.fbx")
    metadata_path = job_dir / ("garment-unreal.json" if is_garment else "avatar-unreal.json")

    try:
        legacy.download(str(request.source_url), input_path)
        export_source_path = input_path

        if is_garment:
            avatar_url = str(request.avatar_source_url) if request.avatar_source_url else resolve_user_avatar_url(request.user_id)
            if not avatar_url:
                raise RuntimeError("No se pudo resolver el GLB del avatar activo para recalibrar la prenda")
            legacy.download(avatar_url, avatar_reference_path)
            run_fresh_garment_rig(
                job_dir,
                avatar_reference_path,
                input_path,
                refitted_path,
                category,
            )
            export_source_path = refitted_path

        command = [
            legacy.BLENDER_BIN,
            "--background",
            "--factory-startup",
            "--python-exit-code",
            "1",
            "--python",
            str(EXPORT_UNREAL_SCRIPT_PATH),
            "--",
            str(export_source_path),
            str(output_path),
            str(avatar_height_cm if is_garment else request.target_height_cm),
            "object" if is_garment else "avatar",
            str(metadata_path),
        ]
        if is_garment:
            command.extend([category, "wearable-preserve"])

        process_env = {**os.environ, "PYTHONUNBUFFERED": "1"}
        if is_garment:
            process_env.update({
                "CLOUVA_AVATAR_REFERENCE_PATH": str(avatar_reference_path),
                "CLOUVA_TARGET_AVATAR_HEIGHT_CM": str(avatar_height_cm),
                "CLOUVA_GARMENT_TARGET_HEIGHT_CM": str(garment_target_height_cm),
            })

        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=legacy.BLENDER_TIMEOUT_SECONDS,
            cwd=str(job_dir),
            env=process_env,
        )
        if result.returncode != 0 or not output_path.exists() or output_path.stat().st_size < 1024:
            details = extract_validation_error(result.stdout, result.stderr)
            raise RuntimeError(
                details
                or result.stderr[-1800:]
                or "Blender no pudo generar el FBX validado"
            )
        if not metadata_path.exists():
            raise RuntimeError("Blender no generó metadata de validación")

        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        if is_garment:
            metadata["freshRigApplied"] = True
            metadata["freshRigVersion"] = 28
            metadata["avatarHeightCm"] = avatar_height_cm
            metadata["garmentTargetHeightCm"] = garment_target_height_cm
            physically_valid = bool(
                metadata.get("readyForUnreal")
                and metadata.get("fbxRoundTripValidated")
                and metadata.get("fbxRoundTripDimensionsValidated")
                and metadata.get("garmentVolumeValid")
                and metadata.get("skeletal")
                and metadata.get("skinWeights")
                and metadata.get("sourceDimensionsPreserved")
                and metadata.get("avatarReferenceNormalized")
                and metadata.get("fbxGlobalScale") == 1.0
                and metadata.get("fbxApplyUnitScale") is True
                and metadata.get("fbxApplyScaleOptions") == "FBX_SCALE_UNITS"
                and metadata.get("fbxDeclaredUnitScaleCm") == 100.0
            )
        else:
            final_height_cm = float(metadata.get("finalMeshHeightCm", metadata.get("heightCm", 0.0)))
            roundtrip_height_cm = float(metadata.get("fbxRoundTripHeightCm", 0.0))
            physically_valid = bool(
                metadata.get("readyForUnreal")
                and metadata.get("fbxRoundTripValidated")
                and abs(final_height_cm - request.target_height_cm) <= base.UNREAL_HEIGHT_TOLERANCE_CM
                and abs(roundtrip_height_cm - request.target_height_cm) <= base.UNREAL_HEIGHT_TOLERANCE_CM
                and metadata.get("fbxGlobalScale") == 1.0
                and metadata.get("fbxApplyUnitScale") is True
                and metadata.get("fbxApplyScaleOptions") == "FBX_SCALE_UNITS"
                and metadata.get("fbxDeclaredUnitScaleCm") == 100.0
            )

        if not physically_valid:
            raise RuntimeError(f"La validación física para Unreal fue rechazada: {metadata}")

        suffix = (request.asset_id or request.avatar_id or "activo")[:8]
        compact_metadata = json.dumps(metadata, separators=(",", ":"))
        filename = (
            f"clouva-{category}-{suffix}-unreal.fbx"
            if is_garment
            else f"clouva-avatar-{suffix}-unreal.fbx"
        )
        headers = {
            "X-Clouva-Target": "unreal-garment" if is_garment else "unreal",
            "X-Clouva-Ready": "true",
            "X-Clouva-Import-Uniform-Scale": "1.0",
            "X-Clouva-Metadata": compact_metadata,
            "X-Clouva-Exporter": UNREAL_EXPORT_VERSION,
            "X-Clouva-Dimensions-Cm": dimensions_header(metadata),
        }
        if is_garment:
            headers["X-Clouva-Scale"] = "active-avatar-reference-normalized"
            headers["X-Clouva-Rig-Preserved"] = "true"
            headers["X-Clouva-Fresh-Rig"] = "v28"
        else:
            headers["X-Clouva-Height-Cm"] = str(metadata.get("finalMeshHeightCm", ""))
            headers["X-Clouva-Roundtrip-Height-Cm"] = str(metadata.get("fbxRoundTripHeightCm", ""))

        return FileResponse(
            output_path,
            media_type="application/octet-stream",
            filename=filename,
            background=BackgroundTask(shutil.rmtree, job_dir, True),
            headers=headers,
        )
    except HTTPException:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise
    except subprocess.TimeoutExpired as exc:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(status_code=504, detail="Blender agotó el tiempo al exportar para Unreal") from exc
    except Exception as exc:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(status_code=422, detail=f"No se pudo exportar para Unreal: {exc}") from exc
