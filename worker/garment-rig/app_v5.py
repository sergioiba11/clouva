import re

import app_legacy as legacy


app = legacy.app
_original_run_blender_job = legacy.run_blender_job

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

    # Blender siempre agrega al final una línea genérica como
    # "Error: script failed, file: '/app/rig_garment.py', exiting". Esa línea no
    # explica la causa. Priorizamos la última excepción real del traceback.
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

    # Algunos errores de importación/sintaxis aparecen sin un traceback completo.
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
