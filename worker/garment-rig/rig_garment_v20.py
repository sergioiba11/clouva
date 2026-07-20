import importlib.util
import json
import math
import os
import sys

from mathutils import Vector


PREVIOUS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rig_garment_v19.py")


def load_previous_pipeline():
    if not os.path.exists(PREVIOUS_PATH):
        raise RuntimeError(f"No se encontró el pipeline V19 en {PREVIOUS_PATH}")
    spec = importlib.util.spec_from_file_location("clouva_rig_v19", PREVIOUS_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("No se pudo crear el cargador del pipeline V19")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


previous = load_previous_pipeline()
v18 = previous.previous
legacy = previous.legacy
v9 = previous.v9
_original_body_region = legacy.body_region
_original_validate = legacy.validate


def finite_vector(vector):
    return vector is not None and all(math.isfinite(float(vector[index])) for index in range(3))


def parse_target_dimensions(garment):
    raw = garment.get("clouvaTargetDimensions")
    if raw is None:
        return None
    try:
        values = json.loads(str(raw))
        if not isinstance(values, list) or len(values) != 3:
            return None
        vector = Vector(tuple(abs(float(value)) for value in values))
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    if not finite_vector(vector) or min(vector) <= 0.0:
        return None
    return vector


def stable_target_bounds(target_min, target_max, garment, category):
    """Reuse the repaired target measured during fitting for final validation.

    The upper-garment snap uses arm/neck landmarks. Some stylized rigs expose valid
    horizontal landmarks but a nearly-zero neck-to-hips Z span. The garment was already
    fitted with V18's body-mesh repair, so validating against the later degenerate box
    produces ratios such as 478223 even though the mesh itself is correctly sized.
    """
    target_size = target_max - target_min
    stored_size = parse_target_dimensions(garment)
    largest = max(abs(float(value)) for value in target_size) if finite_vector(target_size) else 0.0
    smallest = min(abs(float(value)) for value in target_size) if finite_vector(target_size) else 0.0
    degenerate = largest <= 1e-12 or smallest / max(largest, 1e-12) <= 1e-6

    if stored_size is None and not degenerate:
        return target_min, target_max, False
    if stored_size is None:
        raise RuntimeError(
            "La región final del torso quedó degenerada y no existe una medida reparada para validarla"
        )

    center = (target_min + target_max) * 0.5
    if not finite_vector(center):
        garment_min, garment_max = legacy.bbox_world(garment)
        center = (garment_min + garment_max) * 0.5

    # The stored V18 dimensions are the body-region contract used to fit the garment.
    # Always reuse it for upper garments so fitting and final validation share one source.
    stable_min = center - stored_size * 0.5
    stable_max = center + stored_size * 0.5
    print(
        "[rig-v20] stable upper target bounds "
        f"category={category} raw={tuple(round(float(v), 10) for v in target_size)} "
        f"stored={tuple(round(float(v), 10) for v in stored_size)} degenerate={degenerate}",
        flush=True,
    )
    return stable_min, stable_max, True


def body_region_v20(body_meshes, armature, category):
    target_min, target_max = _original_body_region(body_meshes, armature, category)
    if category not in legacy.UPPER_GARMENTS:
        return target_min, target_max

    repaired_min, repaired_max, repaired = v18.repair_target_region(
        target_min,
        target_max,
        body_meshes,
        category,
    )
    if repaired:
        print(
            f"[rig-v20] upper body region repaired at source category={category}",
            flush=True,
        )
    return repaired_min, repaired_max


def validate_v20(garment, armature, target_min, target_max, category):
    repaired = False
    if category in legacy.UPPER_GARMENTS:
        target_min, target_max, repaired = stable_target_bounds(
            target_min,
            target_max,
            garment,
            category,
        )

    result = _original_validate(garment, armature, target_min, target_max, category)
    if category in legacy.UPPER_GARMENTS:
        garment["clouvaSafeBoundsVersion"] = 20
        garment["clouvaSafeBoundsReusedFitContract"] = bool(repaired)
        safe_size = target_max - target_min
        garment["clouvaSafeBoundsDimensions"] = json.dumps(
            [float(safe_size.x), float(safe_size.y), float(safe_size.z)],
            separators=(",", ":"),
        )
    return result


legacy.body_region = body_region_v20
legacy.validate = validate_v20


if __name__ == "__main__":
    v9.main()
