import importlib.util
import json
import math
import os
import sys
import tempfile

from mathutils import Vector


PREVIOUS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rig_garment_v14.py")


def load_previous_pipeline():
    if not os.path.exists(PREVIOUS_PATH):
        raise RuntimeError(f"No se encontró el pipeline V14 en {PREVIOUS_PATH}")
    spec = importlib.util.spec_from_file_location("clouva_rig_v14", PREVIOUS_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("No se pudo crear el cargador del pipeline V14")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


previous = load_previous_pipeline()
legacy = previous.legacy
v9 = previous.v9
v13 = previous.previous
v12 = v13.previous
v11 = v12.previous
v10 = v11.previous
_original_find_armature = legacy.find_armature
_original_body_region = legacy.body_region
_export_v14 = legacy.export_glb


def finite_number(value):
    try:
        return math.isfinite(float(value))
    except (TypeError, ValueError):
        return False


def percentile(values, fraction):
    ordered = sorted(float(value) for value in values if finite_number(value))
    if not ordered:
        raise RuntimeError("No hay valores corporales válidos para calcular percentiles")
    if len(ordered) == 1:
        return ordered[0]
    position = max(0.0, min(1.0, float(fraction))) * (len(ordered) - 1)
    lower = int(math.floor(position))
    upper = int(math.ceil(position))
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1.0 - weight) + ordered[upper] * weight


def find_armature_v15(objects):
    armature = _original_find_armature(objects)
    armature.data.pose_position = "REST"
    legacy.bpy.context.scene.frame_set(0)
    legacy.bpy.context.view_layer.update()
    print(
        "[rig-v15] avatar forced to REST pose before body measurements "
        f"armature={armature.name} scale={tuple(round(float(v), 6) for v in armature.scale)}",
        flush=True,
    )
    return armature


legacy.find_armature = find_armature_v15


def body_points_world(body_meshes):
    points = []
    for obj in body_meshes:
        matrix = obj.matrix_world
        points.extend(matrix @ vertex.co for vertex in obj.data.vertices)
    if len(points) < 20:
        raise RuntimeError("La malla corporal no tiene suficientes vértices para medir el cuerpo")
    return points


def lower_body_contract(body_meshes, armature, category):
    body_min, body_max = legacy.combined_bbox(body_meshes)
    body_size = body_max - body_min
    body_height = max(float(body_size.z), 1e-8)
    if not 0.05 <= body_height <= 100.0:
        raise RuntimeError(f"La altura corporal del avatar es inválida: {body_height:.6f}")

    marks = legacy.lower_landmarks(armature)
    raw_hips_z = float(marks["hips"].z)
    safe_hips_min = float(body_min.z) + body_height * 0.30
    safe_hips_max = float(body_min.z) + body_height * 0.68
    hips_is_body_sane = finite_number(raw_hips_z) and safe_hips_min <= raw_hips_z <= safe_hips_max
    hips_z = raw_hips_z if hips_is_body_sane else float(body_min.z) + body_height * 0.46

    all_points = body_points_world(body_meshes)
    lower_ceiling = min(hips_z + body_height * 0.06, float(body_min.z) + body_height * 0.74)
    lower_points = [
        point for point in all_points
        if float(body_min.z) - body_height * 0.01 <= point.z <= lower_ceiling
    ]
    if len(lower_points) < 20:
        raise RuntimeError("No se pudo aislar el volumen real de cadera y piernas en la malla corporal")

    x_low = percentile([point.x for point in lower_points], 0.04)
    x_high = percentile([point.x for point in lower_points], 0.96)
    y_low = percentile([point.y for point in lower_points], 0.04)
    y_high = percentile([point.y for point in lower_points], 0.96)
    lower_width = max(x_high - x_low, float(body_size.x) * 0.12, 1e-8)
    lower_depth = max(y_high - y_low, float(body_size.y) * 0.18, 1e-8)

    x_margin = lower_width * 0.055
    y_margin = lower_depth * 0.09
    target_min_x = x_low - x_margin
    target_max_x = x_high + x_margin
    target_min_y = y_low - y_margin
    target_max_y = y_high + y_margin

    leg_span = max(hips_z - float(body_min.z), body_height * 0.20)
    target_top = hips_z + leg_span * 0.025
    if category == "shorts":
        knee_candidates = [
            float(marks["left_knee"].z),
            float(marks["right_knee"].z),
        ]
        knee_candidates = [
            value for value in knee_candidates
            if finite_number(value)
            and float(body_min.z) + body_height * 0.16 <= value <= hips_z - body_height * 0.04
        ]
        knee_z = sum(knee_candidates) / len(knee_candidates) if knee_candidates else hips_z - leg_span * 0.48
        target_bottom = knee_z + leg_span * 0.07
        minimum_ratio, maximum_ratio = 0.12, 0.46
    else:
        target_bottom = float(body_min.z) + body_height * 0.018
        minimum_ratio, maximum_ratio = 0.24, 0.72

    target_height = target_top - target_bottom
    target_height_ratio = target_height / body_height
    if not minimum_ratio <= target_height_ratio <= maximum_ratio:
        raise RuntimeError(
            "La región inferior calculada desde el cuerpo quedó fuera de proporción: "
            f"category={category}, targetHeight={target_height:.6f}, "
            f"bodyHeight={body_height:.6f}, ratio={target_height_ratio:.4f}"
        )

    center_x = (target_min_x + target_max_x) * 0.5
    center_y = (target_min_y + target_max_y) * 0.5
    print(
        "[rig-v15] body-mesh lower contract "
        f"category={category} bodyHeight={body_height:.6f} "
        f"bodyZ=({body_min.z:.6f}, {body_max.z:.6f}) "
        f"rawHipsZ={raw_hips_z:.6f} acceptedHips={hips_is_body_sane} hipsZ={hips_z:.6f} "
        f"target=({target_max_x-target_min_x:.6f}, {target_max_y-target_min_y:.6f}, {target_height:.6f}) "
        f"heightRatio={target_height_ratio:.4f}",
        flush=True,
    )

    return {
        "body_min": body_min,
        "body_max": body_max,
        "body_height": body_height,
        "hips_z": hips_z,
        "target_min": Vector((target_min_x, target_min_y, target_bottom)),
        "target_max": Vector((target_max_x, target_max_y, target_top)),
        "target_center_x": center_x,
        "target_center_y": center_y,
        "target_height_ratio": target_height_ratio,
        "hips_from_body_fallback": not hips_is_body_sane,
    }


def body_region_v15(body_meshes, armature, category):
    if category not in legacy.LOWER_GARMENTS:
        return _original_body_region(body_meshes, armature, category)
    contract = lower_body_contract(body_meshes, armature, category)
    return contract["target_min"], contract["target_max"]


legacy.body_region = body_region_v15


def vector_json(vector):
    return json.dumps([float(vector.x), float(vector.y), float(vector.z)], separators=(",", ":"))


def snap_lower_garment_v15(garment, body_meshes, armature, category, preview_settings):
    contract = lower_body_contract(body_meshes, armature, category)
    target_min = contract["target_min"]
    target_max = contract["target_max"]
    target_size = target_max - target_min

    garment_min, garment_max = legacy.bbox_world(garment)
    current_height = max(float(garment_max.z - garment_min.z), 1e-9)
    height_factor = v10.exact_scale_factor(float(target_size.z), current_height, "largo corporal")
    v10.scale_vertices_in_world(garment, sz=height_factor)

    width_factor, depth_factor = v9.lower_fit_factors(preview_settings)
    desired_width = float(target_size.x) * width_factor
    desired_depth = float(target_size.y) * depth_factor
    width_ratio, depth_ratio, passes = v10.normalize_cross_section(
        garment,
        desired_width,
        desired_depth,
    )

    garment_min, garment_max = legacy.bbox_world(garment)
    garment_center = (garment_min + garment_max) * 0.5
    garment.location += Vector((
        contract["target_center_x"] - garment_center.x,
        contract["target_center_y"] - garment_center.y,
        target_max.z - garment_max.z,
    ))
    legacy.bpy.context.view_layer.update()

    final_min, final_max = legacy.bbox_world(garment)
    final_size = final_max - final_min
    height_error = abs(float(final_size.z) - float(target_size.z)) / max(float(target_size.z), 1e-8)
    top_error = abs(float(final_max.z) - float(target_max.z)) / max(float(target_size.z), 1e-8)
    center_error_x = abs(((final_min.x + final_max.x) * 0.5) - contract["target_center_x"]) / max(float(target_size.x), 1e-8)
    center_error_y = abs(((final_min.y + final_max.y) * 0.5) - contract["target_center_y"]) / max(float(target_size.y), 1e-8)
    if max(height_error, top_error, center_error_x, center_error_y) > 0.045:
        raise RuntimeError(
            "El pantalón no coincidió con el volumen medido directamente sobre el cuerpo: "
            f"heightError={height_error:.4f}, topError={top_error:.4f}, "
            f"centerErrors=({center_error_x:.4f}, {center_error_y:.4f})"
        )

    garment["clouvaBodyContractVersion"] = 15
    garment["clouvaBodyContractCategory"] = category
    garment["clouvaAvatarBodyHeight"] = float(contract["body_height"])
    garment["clouvaBodyBBoxMin"] = vector_json(contract["body_min"])
    garment["clouvaBodyBBoxMax"] = vector_json(contract["body_max"])
    garment["clouvaBodyTargetMin"] = vector_json(target_min)
    garment["clouvaBodyTargetMax"] = vector_json(target_max)
    garment["clouvaBodyTargetSize"] = vector_json(target_size)
    garment["clouvaBodyTargetCenterX"] = float(contract["target_center_x"])
    garment["clouvaBodyTargetCenterY"] = float(contract["target_center_y"])
    garment["clouvaBodyHeightRatio"] = float(contract["target_height_ratio"])
    garment["clouvaHipsFallbackToBody"] = bool(contract["hips_from_body_fallback"])

    print(
        "[rig-v15] garment fitted to body-mesh contract "
        f"size=({final_size.x:.6f}, {final_size.y:.6f}, {final_size.z:.6f}) "
        f"unitRatios=({width_ratio:.4f}, {depth_ratio:.4f}) passes={passes}",
        flush=True,
    )
    return {
        "targetTop": float(target_max.z),
        "targetBottom": float(target_min.z),
        "legLength": float(target_size.z),
        "widthRatio": float(final_size.x) / max(float(target_size.x), 1e-8),
        "depthRatio": float(final_size.y) / max(float(target_size.y), 1e-8),
        "bodyMeshContract": True,
    }


v9.snap_lower_garment = snap_lower_garment_v15


def parse_vector_property(obj, key):
    raw = obj.get(key)
    try:
        values = json.loads(str(raw))
        if not isinstance(values, list) or len(values) != 3:
            raise ValueError
        vector = Vector(tuple(float(value) for value in values))
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"La prenda perdió la propiedad corporal {key}") from exc
    if not all(math.isfinite(value) for value in vector):
        raise RuntimeError(f"La propiedad corporal {key} contiene valores inválidos")
    return vector


def validate_lower_geometry_and_weights_v15(garment, armature, category):
    if int(garment.get("clouvaBodyContractVersion", 0)) != 15:
        raise RuntimeError("La prenda inferior no tiene el contrato corporal V15")

    target_min = parse_vector_property(garment, "clouvaBodyTargetMin")
    target_max = parse_vector_property(garment, "clouvaBodyTargetMax")
    target_size = target_max - target_min
    garment_min, garment_max = legacy.bbox_world(garment)
    garment_size = garment_max - garment_min

    height_error = abs(float(garment_size.z) - float(target_size.z)) / max(float(target_size.z), 1e-8)
    top_error = abs(float(garment_max.z) - float(target_max.z)) / max(float(target_size.z), 1e-8)
    bottom_error = abs(float(garment_min.z) - float(target_min.z)) / max(float(target_size.z), 1e-8)
    if height_error > 0.06 or top_error > 0.06 or (category == "pants" and bottom_error > 0.08):
        raise RuntimeError(
            "La prenda dejó de coincidir con el cuerpo antes de exportar: "
            f"heightError={height_error:.4f}, topError={top_error:.4f}, bottomError={bottom_error:.4f}"
        )

    target_center_x = float(garment.get("clouvaBodyTargetCenterX"))
    garment_center_x = float((garment_min.x + garment_max.x) * 0.5)
    if abs(garment_center_x - target_center_x) / max(float(target_size.x), 1e-8) > 0.08:
        raise RuntimeError("El pantalón quedó desplazado horizontalmente respecto del cuerpo real")

    left_names = legacy.canonical_bone_names(
        armature, {"left_up_leg", "left_leg", "left_foot", "left_toe"}
    )
    right_names = legacy.canonical_bone_names(
        armature, {"right_up_leg", "right_leg", "right_foot", "right_toe"}
    )
    minimum = max(8, int(len(garment.data.vertices) * 0.006))
    left_count = legacy.group_vertex_count(garment, left_names, threshold=0.03)
    right_count = legacy.group_vertex_count(garment, right_names, threshold=0.03)
    if left_count < minimum or right_count < minimum:
        raise RuntimeError(
            "Las dos perneras no recibieron pesos suficientes: "
            f"left={left_count}, right={right_count}, minimum={minimum}"
        )

    return {
        "bodyContractVersion": 15,
        "heightError": round(height_error, 5),
        "topError": round(top_error, 5),
        "leftWeighted": left_count,
        "rightWeighted": right_count,
    }


# V9.main() vuelve a asignar esta función al iniciar cada trabajo.
v9.validate_lower_geometry_and_weights_v9 = validate_lower_geometry_and_weights_v15


def export_glb_v15(output_path, garment, armature):
    garment["clouvaBodyMeshSizing"] = True
    garment["clouvaRigPipelineVersion"] = 15
    _export_v14(output_path, garment, armature)


legacy.export_glb = export_glb_v15


def relative_error(actual, expected):
    return abs(float(actual) - float(expected)) / max(abs(float(expected)), 1e-8)


def validate_roundtrip_v15(output_path):
    if not os.path.exists(output_path) or os.path.getsize(output_path) < 1024:
        raise RuntimeError("El GLB exportado está vacío")

    with tempfile.TemporaryDirectory(prefix="clouva-validate-v15-"):
        legacy.clear_scene()
        imported = legacy.import_glb(output_path)
        armatures = [obj for obj in imported if obj.type == "ARMATURE"]
        skinned = [obj for obj in imported if obj.type == "MESH" and obj.find_armature()]
        if len(armatures) != 1 or not skinned:
            raise RuntimeError("El GLB exportado no contiene un único rig vestible")

        armature = armatures[0]
        garment = max(skinned, key=lambda obj: len(obj.data.vertices))
        if garment.find_armature() != armature:
            raise RuntimeError("La prenda reabierta no está vinculada al armature exportado")
        if int(garment.get("clouvaBodyContractVersion", 0)) != 15:
            raise RuntimeError("El GLB perdió el contrato corporal V15")

        expected_size = v12.parse_vector_property(garment, "clouvaPreExportSize")
        expected_center = v12.parse_vector_property(garment, "clouvaPreExportCenter")
        actual_min, actual_max = legacy.bbox_world(garment)
        actual_size_vector = actual_max - actual_min
        actual_center_vector = (actual_min + actual_max) * 0.5
        actual_size = [float(actual_size_vector.x), float(actual_size_vector.y), float(actual_size_vector.z)]
        actual_center = [float(actual_center_vector.x), float(actual_center_vector.y), float(actual_center_vector.z)]

        size_errors = [relative_error(actual_size[index], expected_size[index]) for index in range(3)]
        center_scale = max(max(abs(value) for value in expected_size), 1e-6)
        center_errors = [abs(actual_center[index] - expected_center[index]) / center_scale for index in range(3)]
        if max(size_errors) > 0.08:
            raise RuntimeError(
                "El GLB cambió la escala de la prenda al exportar: "
                f"errores={tuple(round(value, 4) for value in size_errors)}"
            )
        if max(center_errors) > 0.08:
            raise RuntimeError(
                "El GLB desplazó la prenda respecto del esqueleto al exportar: "
                f"errores={tuple(round(value, 4) for value in center_errors)}"
            )

        target_min = parse_vector_property(garment, "clouvaBodyTargetMin")
        target_max = parse_vector_property(garment, "clouvaBodyTargetMax")
        target_size = target_max - target_min
        body_height = float(garment.get("clouvaAvatarBodyHeight", 0.0))
        category = str(garment.get("clouvaBodyContractCategory", ""))
        if body_height <= 1e-8:
            raise RuntimeError("El GLB perdió la altura corporal de referencia")

        body_ratio = float(actual_size_vector.z) / body_height
        expected_ratio = float(target_size.z) / body_height
        ratio_error = abs(body_ratio - expected_ratio)
        top_error = abs(float(actual_max.z) - float(target_max.z)) / max(float(target_size.z), 1e-8)
        bottom_error = abs(float(actual_min.z) - float(target_min.z)) / max(float(target_size.z), 1e-8)
        maximum_body_ratio = 0.74 if category == "pants" else 0.48
        if body_ratio > maximum_body_ratio:
            raise RuntimeError(
                "El pantalón volvió a quedar gigante respecto del cuerpo real: "
                f"garmentBodyRatio={body_ratio:.4f}, maximum={maximum_body_ratio:.4f}"
            )
        if ratio_error > 0.06 or top_error > 0.08 or (category == "pants" and bottom_error > 0.10):
            raise RuntimeError(
                "El GLB reabierto dejó de coincidir con el contrato corporal: "
                f"ratioError={ratio_error:.4f}, topError={top_error:.4f}, bottomError={bottom_error:.4f}"
            )

        print(
            "[rig-v15] roundtrip body-mesh contract passed "
            f"category={category} garmentBodyRatio={body_ratio:.4f} "
            f"sizeErrors={tuple(round(value, 5) for value in size_errors)} "
            f"centerErrors={tuple(round(value, 5) for value in center_errors)}",
            flush=True,
        )


v9.validate_roundtrip_v9 = validate_roundtrip_v15


if __name__ == "__main__":
    v9.main()
