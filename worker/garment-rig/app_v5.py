import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import app_legacy as legacy
from fastapi import HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, HttpUrl
from starlette.background import BackgroundTask


app = legacy.app
_original_run_blender_job = legacy.run_blender_job
EXPORT_UNREAL_SCRIPT_PATH = Path(__file__).with_name("export_unreal.py")

_GENERIC_BLENDER_LINES = (
    "script failed",
    "exiting",
    "error: python: traceback",
    "blender quit",
)
_EXCEPTION_PATTERN = re.compile(
    r"^\s*(RuntimeError|ValueError|TypeError|AttributeError|KeyError|IndexError|"
    r"ImportError|ModuleNotFoundError|AssertionError|OSError|Exception):\s*(.+?)\s*$",
    re.MULTILINE,
)


def extract_validation_error(details):
    if not isinstance(details, dict):
        return None

    combined = "\n".join(
        str(details.get(key) or "")
        for key in ("stdout", "stderr")
    )

    exceptions = [
        f"{kind}: {message.strip()}"
        for kind, message in _EXCEPTION_PATTERN.findall(combined)
        if message.strip()
    ]
    if exceptions:
        return exceptions[-1]

    runtime_matches = re.findall(r"RuntimeError:\s*([^\n\r]+)", combined)
    if runtime_matches:
        return f"RuntimeError: {runtime_matches[-1].strip()}"

    candidates = []
    for raw_line in combined.splitlines():
        line = raw_line.strip()
        lowered = line.lower()
        if not line or any(marker in lowered for marker in _GENERIC_BLENDER_LINES):
            continue
        if any(token in lowered for token in (
            "traceback", "error", "exception", "failed", "missing", "invalid",
            "no module named", "not found", "cannot", "could not",
        )):
            candidates.append(line)
    return candidates[-1] if candidates else None


def humanize_validation_error(message):
    if not message:
        return "Blender no pudo validar el rig. Revisá la posición de la prenda y volvé a intentarlo."

    translations = (
        ("Waist alignment failed", "La cintura del pantalón no pudo alinearse con Hips"),
        ("La cintura no quedó alineada", "La cintura del pantalón no pudo alinearse con Hips"),
        ("Leg weight validation failed", "Una de las dos perneras no recibió pesos suficientes"),
        ("Las dos perneras no recibieron", "Las dos perneras no recibieron pesos suficientes"),
        ("Lower garment is centered above", "El pantalón quedó colocado sobre el torso en vez de las piernas"),
        ("Pants end above the knees", "El pantalón quedó demasiado corto y no alcanzó las rodillas"),
        ("horizontally displaced", "El pantalón quedó desplazado respecto de la cadera"),
        ("thigh is outside", "Uno de los muslos quedó fuera de la malla"),
        ("missing left/right upper-leg", "El avatar no tiene identificados los huesos de ambos muslos"),
        ("missing knee/foot landmarks", "El avatar no tiene identificadas correctamente rodillas y pies"),
        ("Sleeve weight validation failed", "Una de las mangas no recibió pesos de brazo suficientes"),
        ("missing arm bones", "El avatar no tiene identificados correctamente los huesos de ambos brazos"),
        ("Upper garment", "La remera no pudo alinearse con el torso y los hombros"),
        ("outside safe bounds", "La escala final de la prenda quedó fuera de los límites seguros"),
        ("Only ", "Algunos vértices de la prenda quedaron sin pesos"),
        ("No module named", "El worker de Blender no pudo cargar un módulo interno"),
        ("ImportError", "El worker de Blender no pudo cargar un módulo interno"),
        ("AttributeError", "El script de rig intentó usar una operación incompatible con este GLB"),
        ("TypeError", "El GLB contiene una estructura que el rig automático todavía no pudo interpretar"),
    )
    for source, translated in translations:
        if source.lower() in message.lower():
            return f"{translated}. Detalle técnico: {message}"
    return message


def run_blender_job_with_diagnostics(*args, **kwargs):
    _original_run_blender_job(*args, **kwargs)
    job_id = args[0] if args else kwargs.get("job_id")
    if not job_id:
        return

    with legacy.JOBS_LOCK:
        snapshot = dict(legacy.JOBS.get(job_id, {}))

    if snapshot.get("status") != "failed":
        return

    raw_error = extract_validation_error(snapshot.get("details"))
    visible_error = humanize_validation_error(raw_error)
    legacy.set_job(
        job_id,
        progress=0,
        stage="El rig fue rechazado antes de publicarse",
        error=visible_error,
        technicalError=raw_error,
        validationFailed=True,
    )


legacy.run_blender_job = run_blender_job_with_diagnostics


class UnrealExportRequest(BaseModel):
    avatar_id: str | None = None
    user_id: str | None = None
    source_url: HttpUrl
    output_format: str = "fbx"
    target: str = "unreal"
    target_height_cm: float = 180.0
    preserve_armature: bool = True
    apply_transforms: bool = True
    pose: str = "A"


@app.post("/export/unreal")
def export_avatar_for_unreal(request: UnrealExportRequest):
    if request.output_format.lower() != "fbx":
        raise HTTPException(status_code=400, detail="El formato de salida para Unreal debe ser FBX")
    if not EXPORT_UNREAL_SCRIPT_PATH.exists():
        raise HTTPException(status_code=500, detail="Falta export_unreal.py en el Blender Worker")

    job_dir = Path(tempfile.mkdtemp(prefix="clouva-unreal-export-"))
    input_path = job_dir / "avatar-rigged.glb"
    output_path = job_dir / "avatar-unreal.fbx"

    try:
        legacy.download(str(request.source_url), input_path)
        command = [
            legacy.BLENDER_BIN,
            "--background",
            "--factory-startup",
            "--python-exit-code",
            "1",
            "--python",
            str(EXPORT_UNREAL_SCRIPT_PATH),
            "--",
            str(input_path),
            str(output_path),
            str(request.target_height_cm),
        ]
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=legacy.BLENDER_TIMEOUT_SECONDS,
            cwd=str(job_dir),
        )
        if result.returncode != 0 or not output_path.exists() or output_path.stat().st_size < 1024:
            details = extract_validation_error({"stdout": result.stdout, "stderr": result.stderr})
            raise RuntimeError(details or result.stderr[-1000:] or "Blender no pudo generar el FBX")

        avatar_suffix = (request.avatar_id or "activo")[:8]
        return FileResponse(
            output_path,
            media_type="application/octet-stream",
            filename=f"clouva-avatar-{avatar_suffix}-unreal.fbx",
            background=BackgroundTask(shutil.rmtree, job_dir, True),
            headers={
                "X-Clouva-Target": "unreal",
                "X-Clouva-Height-Cm": str(request.target_height_cm),
                "X-Clouva-Rig-Preserved": "true",
            },
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
