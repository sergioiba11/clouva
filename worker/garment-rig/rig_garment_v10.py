import importlib.util
import math
import os
import sys

import bpy
from mathutils import Vector


PREVIOUS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rig_garment_v9.py")


def load_previous_pipeline():
    if not os.path.exists(PREVIOUS_PATH):
        raise RuntimeError(f"No se encontró el pipeline V9 en {PREVIOUS_PATH}")
    spec = importlib.util.spec_from_file_location("clouva_rig_v9", PREVIOUS_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("No se pudo crear el cargador del pipeline V9")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


previous = load_previous_pipeline()
legacy = previous.legacy


def exact_scale_factor(desired, current, label):
    desired = float(desired)
    current = float(current)
    if not math.isfinite(desired) or not math.isfinite(current):
        raise RuntimeError(f"Dimensión no finita al normalizar {label}")
    if desired <= 1e-9 or current <= 1e-9:
        raise RuntimeError(
            f"Dimensión inválida al normalizar {label}: desired={desired:.8f}, current={current:.8f}"
        )
    factor = desired / current
    # Los GLB pueden venir en metros, centímetros o milímetros. No imponemos un piso
    # visual como 0.03x: aceptamos conversiones de unidades amplias pero finitas.
    if not 1e-8 <= factor <= 1e8:
        raise RuntimeError(f"Conversión de unidades insegura para {label}: factor={factor:.10f}")
    return factor


def scale_vertices_in_world(garment, sx=1.0, sy=1.0, sz=1.0):
    matrix_world = garment.matrix_world.copy()
    inverse_world = matrix_world.inverted_safe()
    minimum, maximum = legacy.bbox_world(garment)
    center = (minimum + maximum) * 0.5

    for vertex in garment.data.vertices:
        world = matrix_world @ vertex.co
        scaled = Vector((
            center.x + (world.x - center.x) * sx,
            center.y + (world.y - center.y) * sy,
            center.z + (world.z - center.z) * sz,
        ))
        vertex.co = inverse_world @ scaled

    garment.data.update()
    bpy.context.view_layer.update()


def normalize_cross_section(garment, desired_width, desired_depth):
    passes = []
    for pass_index in range(6):
        minimum, maximum = legacy.bbox_world(garment)
        size = maximum - minimum
        width_ratio = size.x / max(desired_width, 1e-9)
        depth_ratio = size.y / max(desired_depth, 1e-9)
        passes.append((round(width_ratio, 6), round(depth_ratio, 6)))

        if abs(width_ratio - 1.0) <= 0.005 and abs(depth_ratio - 1.0) <= 0.005:
            break

        sx = exact_scale_factor(desired_width, size.x, "ancho")
        sy = exact_scale_factor(desired_depth, size.y, "profundidad")
        scale_vertices_in_world(garment, sx=sx, sy=sy)

    minimum, maximum = legacy.bbox_world(garment)
    size = maximum - minimum
    final_width_ratio = size.x / max(desired_width, 1e-9)
    final_depth_ratio = size.y / max(desired_depth, 1e-9)

    if not 0.97 <= final_width_ratio <= 1.03 or not 0.97 <= final_depth_ratio <= 1.03:
        raise RuntimeError(
            "No se pudo convertir las unidades del pantalón: "
            f"desired=({desired_width:.6f}, {desired_depth:.6f}), "
            f"actual=({size.x:.6f}, {size.y:.6f}), passes={passes}"
        )

    return final_width_ratio, final_depth_ratio, passes


def sanitize_preview_settings_v10(category, preview_settings):
    settings = previous._original_sanitize_preview_settings(category, preview_settings)
    settings["rigProfileVersion"] = 10
    settings["unitScaleNormalization"] = True
    return settings


# Guardamos la implementación V9 antes de reemplazarla para que el wrapper pueda seguir
# delegando todo lo que no sea la conversión exacta de unidades.
previous._original_sanitize_preview_settings = previous.sanitize_preview_settings
previous.sanitize_preview_settings = sanitize_preview_settings_v10


def snap_lower_garment_v10(garment, body_meshes, armature, category, preview_settings):
    marks = legacy.lower_landmarks(armature)
    target_min, target_max = legacy.body_region(body_meshes, armature, category)
    target_size = target_max - target_min

    waist_z = marks["waist"].z
    feet_z = min(marks["left_foot"].z, marks["right_foot"].z)
    knees_z = min(marks["left_knee"].z, marks["right_knee"].z)
    leg_length = max(waist_z - feet_z, 1e-6)

    target_top = waist_z + leg_length * 0.025
    target_bottom = knees_z + leg_length * 0.14 if category == "shorts" else feet_z + leg_length * 0.035
    target_height = max(target_top - target_bottom, leg_length * 0.25)

    garment_min, garment_max = legacy.bbox_world(garment)
    current_height = max(garment_max.z - garment_min.z, 1e-9)
    height_factor = exact_scale_factor(target_height, current_height, "largo")
    scale_vertices_in_world(garment, sz=height_factor)

    width_factor, depth_factor = previous.lower_fit_factors(preview_settings)
    desired_width = max(target_size.x * width_factor, leg_length * 0.12)
    desired_depth = max(target_size.y * depth_factor, leg_length * 0.10)
    unit_width_ratio, unit_depth_ratio, passes = normalize_cross_section(
        garment,
        desired_width,
        desired_depth,
    )

    garment_min, garment_max = legacy.bbox_world(garment)
    garment_center = (garment_min + garment_max) * 0.5
    target_center_x = (marks["left_up"].x + marks["right_up"].x) * 0.5
    target_center_y = (target_min.y + target_max.y) * 0.5
    garment.location += Vector((
        target_center_x - garment_center.x,
        target_center_y - garment_center.y,
        target_top - garment_max.z,
    ))
    bpy.context.view_layer.update()

    final_min, final_max = legacy.bbox_world(garment)
    final_size = final_max - final_min
    width_ratio = final_size.x / max(target_size.x, 1e-9)
    depth_ratio = final_size.y / max(target_size.y, 1e-9)
    height_ratio = final_size.z / max(target_size.z, 1e-9)
    print(
        "[rig-v10] unit-normalized lower garment "
        f"category={category} unitRatios=({unit_width_ratio:.4f}, {unit_depth_ratio:.4f}) "
        f"targetRatios=({width_ratio:.3f}, {depth_ratio:.3f}, {height_ratio:.3f}) "
        f"passes={passes}",
        flush=True,
    )

    # Estos límites se comparan con la región corporal, no con el tamaño de entrada.
    # El fit Oversize puede superar 1.0 deliberadamente, pero nunca debe volver a 2x–6x.
    if width_ratio > 1.60 or depth_ratio > 1.60:
        raise RuntimeError(
            "La prenda siguió fuera del volumen corporal después de convertir unidades: "
            f"ratios=({width_ratio:.3f}, {depth_ratio:.3f}, {height_ratio:.3f})"
        )

    garment["clouvaUnitScalePasses"] = str(passes)
    return {
        "targetTop": target_top,
        "targetBottom": target_bottom,
        "legLength": leg_length,
        "widthRatio": width_ratio,
        "depthRatio": depth_ratio,
        "unitScalePasses": passes,
    }


previous.snap_lower_garment = snap_lower_garment_v10


_original_export_glb = legacy.export_glb


def export_glb_v10(output_path, garment, armature):
    garment["clouvaRigVersion"] = 10
    garment["clouvaUnitScaleNormalization"] = True
    _original_export_glb(output_path, garment, armature)


legacy.export_glb = export_glb_v10


if __name__ == "__main__":
    previous.main()
