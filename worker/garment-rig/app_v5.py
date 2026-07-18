import re

import app_legacy as legacy


app = legacy.app
_original_run_blender_job = legacy.run_blender_job


def extract_validation_error(details):
    if not isinstance(details, dict):
        return None
    combined = "\n".join(
        str(details.get(key) or "")
        for key in ("stderr", "stdout")
    )
    matches = re.findall(r"RuntimeError:\s*([^\n\r]+)", combined)
    if matches:
        return matches[-1].strip()
    matches = re.findall(r"(?:Error|Exception):\s*([^\n\r]+)", combined)
    return matches[-1].strip() if matches else None


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
        ("outside safe bounds", "La escala final de la prenda quedó fuera de los límites seguros"),
        ("Only ", "Algunos vértices de la prenda quedaron sin pesos"),
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
