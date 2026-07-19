import importlib.util
import json
import math
import os
import sys

from mathutils import Vector


PREVIOUS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rig_garment_v17.py")


def load_previous_pipeline():
    if not os.path.exists(PREVIOUS_PATH):
        raise RuntimeError(f"No se encontró el pipeline V17 en {PREVIOUS_PATH}")
    spec = importlib.util.spec_from_file_location("clouva_rig_v17", PREVIOUS_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("No se pudo crear el cargador del pipeline V17")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


previous = load_previous_pipeline()
legacy = previous.legacy
v9 = previous.v9


CATEGORY_PADDING = {
    "hoodie": Vector((1.04, 1.18, 1.08)),
    "shirt": Vector((1.02, 1.12, 1.04)),
    "jacket": Vector((1.06, 1.22, 1.10)),
    "pants": Vector((1.08, 1.15, 1.00)),
    "shorts": Vector((1.08, 1.15, 1.00)),
    "shoes": Vector((1.10, 1.15, 1.04)),
    "hat": Vector((1.12, 1.12, 1.03)),
    "accessory": Vector((1.05, 1.05, 1.05)),
}

CATEGORY_TARGET_FLOORS = {
    "hoodie": (0.34, 0.10, 0.30),
    "shirt": (0.32, 0.08, 0.26),
    "jacket": (0.35, 0.11, 0.31),
    "pants": (0.18, 0.08, 0.28),
    "shorts": (0.18, 0.08, 0.14),
    "shoes": (0.20, 0.08, 0.08),
    "hat": (0.12, 0.10, 0.08),
    "accessory": (0.03, 0.03, 0.03),
}


def vector_values(vector):
    return tuple(float(vector[index]) for index in range(3))


def finite_positive(value):
    return math.isfinite(float(value)) and float(value) > 0.0


def relative_dimension_contract(size, label):
    values = vector_values(size)
    if not all(finite_positive(value) for value in values):
        raise RuntimeError(f"{label} contains non-positive or non-finite dimensions: {values}")
    largest = max(values)
    smallest = min(values)
    if largest <= 1e-12:
        raise RuntimeError(f"{label} is numerically empty: {values}")
    ratio = smallest / largest
    if ratio <= 1e-8:
        raise RuntimeError(
            f"{label} is effectively flat on one axis: dimensions={values}, ratio={ratio:.10f}"
        )
    return largest, ratio


def repair_target_region(target_min, target_max, body_meshes, category):
    target_size = target_max - target_min
    body_min, body_max = legacy.combined_bbox(body_meshes)
    body_size = body_max - body_min
    body_values = [abs(float(value)) for value in body_size]
    reference = max(body_values)
    if not math.isfinite(reference) or reference <= 1e-12:
        raise RuntimeError(f"Avatar body bounds are invalid: {tuple(body_values)}")

    center = (target_min + target_max) * 0.5
    if not all(math.isfinite(float(value)) for value in center):
        center = (body_min + body_max) * 0.5

    floors = CATEGORY_TARGET_FLOORS[category]
    raw = [abs(float(target_size[index])) for index in range(3)]
    repaired = Vector(tuple(max(raw[index], reference * floors[index]) for index in range(3)))
    changed = any(repaired[index] > raw[index] + reference * 1e-9 for index in range(3))
    if not changed:
        return target_min, target_max, False

    next_min = center - repaired * 0.5
    next_max = center + repaired * 0.5
    print(
        "[rig-v18] repaired target body region "
        f"category={category} raw={tuple(round(value, 10) for value in raw)} "
        f"repaired={tuple(round(float(value), 10) for value in repaired)} "
        f"body={tuple(round(value, 10) for value in body_values)}",
        flush=True,
    )
    return next_min, next_max, True


def safe_divide(numerator, denominator, reference, label):
    numerator = float(numerator)
    denominator = float(denominator)
    floor = max(abs(float(reference)) * 1e-12, 1e-15)
    if not math.isfinite(numerator) or not math.isfinite(denominator):
        raise RuntimeError(f"Non-finite scale input for {label}: {numerator}/{denominator}")
    if abs(denominator) <= floor:
        raise RuntimeError(f"Unsafe near-zero denominator for {label}: {denominator}")
    result = numerator / denominator
    if not math.isfinite(result) or not 1e-8 <= abs(result) <= 1e8:
        raise RuntimeError(f"Unsafe unit conversion for {label}: factor={result}")
    return result


def fit_to_body_v18(garment, body_meshes, armature, category):
    if category in legacy.LOWER_GARMENTS:
        legacy.orient_lower_garment(garment)

    target_min, target_max = legacy.body_region(body_meshes, armature, category)
    target_min, target_max, target_repaired = repair_target_region(
        target_min,
        target_max,
        body_meshes,
        category,
    )
    target_size = target_max - target_min
    source_min, source_max = legacy.bbox_world(garment)
    source_size = source_max - source_min

    target_reference, target_ratio = relative_dimension_contract(target_size, "Target body region")
    source_reference, source_ratio = relative_dimension_contract(source_size, "Garment geometry")
    padding = CATEGORY_PADDING[category]
    desired = Vector((
        target_size.x * padding.x,
        target_size.y * padding.y,
        target_size.z * padding.z,
    ))

    if category == "hat":
        uniform = min(
            safe_divide(desired.x, source_size.x, source_reference, "hat width"),
            safe_divide(desired.y, source_size.y, source_reference, "hat depth"),
            safe_divide(desired.z, source_size.z, source_reference, "hat height"),
        )
        garment.scale = Vector((uniform, uniform, uniform))
    else:
        uniform = safe_divide(desired.z, source_size.z, source_reference, "garment height")
        if category in legacy.LOWER_GARMENTS:
            x_limit = (0.88, 1.22)
            y_limit = (0.82, 1.28)
        elif category in legacy.UPPER_GARMENTS:
            x_limit = (0.72, 1.75)
            y_limit = (0.75, 1.55)
        else:
            x_limit = (0.78, 1.45)
            y_limit = (0.75, 1.55)

        scaled_x = source_size.x * uniform
        scaled_y = source_size.y * uniform
        x_fix_raw = safe_divide(desired.x, scaled_x, target_reference, "garment width")
        y_fix_raw = safe_divide(desired.y, scaled_y, target_reference, "garment depth")
        x_fix = max(x_limit[0], min(x_fix_raw, x_limit[1]))
        y_fix = max(y_limit[0], min(y_fix_raw, y_limit[1]))
        garment.scale = Vector((uniform * x_fix, uniform * y_fix, uniform))

    legacy.bpy.context.view_layer.update()
    current_min, current_max = legacy.bbox_world(garment)
    current_center = (current_min + current_max) * 0.5
    target_center = (target_min + target_max) * 0.5
    if category in legacy.UPPER_GARMENTS | legacy.LOWER_GARMENTS:
        offset = Vector((
            target_center.x - current_center.x,
            target_center.y - current_center.y,
            target_max.z - current_max.z,
        ))
    elif category == "shoes":
        offset = Vector((
            target_center.x - current_center.x,
            target_center.y - current_center.y,
            target_min.z - current_min.z,
        ))
    else:
        offset = target_center - current_center

    garment.location += offset
    legacy.bpy.context.view_layer.update()
    legacy.select_only(garment)
    legacy.bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    garment["clouvaDimensionContractVersion"] = 18
    garment["clouvaSourceDimensions"] = json.dumps(vector_values(source_size), separators=(",", ":"))
    garment["clouvaTargetDimensions"] = json.dumps(vector_values(target_size), separators=(",", ":"))
    garment["clouvaSourceDimensionRatio"] = float(source_ratio)
    garment["clouvaTargetDimensionRatio"] = float(target_ratio)
    garment["clouvaTargetRegionRepaired"] = bool(target_repaired)
    print(
        "[rig-v18] unit-independent fit passed "
        f"category={category} source={tuple(round(value, 10) for value in vector_values(source_size))} "
        f"target={tuple(round(value, 10) for value in vector_values(target_size))} "
        f"ratios=({source_ratio:.8f},{target_ratio:.8f}) repaired={target_repaired}",
        flush=True,
    )
    return target_min, target_max


legacy.fit_to_body = fit_to_body_v18


if __name__ == "__main__":
    v9.main()
