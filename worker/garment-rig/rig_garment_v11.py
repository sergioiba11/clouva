import importlib.util
import os
import sys


PREVIOUS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rig_garment_v10.py")


def load_previous_pipeline():
    if not os.path.exists(PREVIOUS_PATH):
        raise RuntimeError(f"No se encontró el pipeline V10 en {PREVIOUS_PATH}")
    spec = importlib.util.spec_from_file_location("clouva_rig_v10", PREVIOUS_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("No se pudo crear el cargador del pipeline V10")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


previous = load_previous_pipeline()
v9 = previous.previous
legacy = previous.legacy


def sanitize_preview_settings_v11(category, preview_settings):
    settings = previous.sanitize_preview_settings_v10(category, preview_settings)
    settings["rigProfileVersion"] = 11
    settings["singleLowerBodyVolumeContract"] = True
    return settings


# V9.main() usa sus propios globals. Reemplazamos allí la sanitización y el snap.
v9.sanitize_preview_settings = sanitize_preview_settings_v11


def snap_lower_garment_v11(garment, body_meshes, armature, category, preview_settings):
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
    height_factor = previous.exact_scale_factor(target_height, current_height, "largo")
    previous.scale_vertices_in_world(garment, sz=height_factor)

    width_factor, depth_factor = v9.lower_fit_factors(preview_settings)

    # body_region() ya incluye márgenes de cadera, muslos, rodillas, pies y profundidad
    # corporal. Usamos exactamente esa caja como contrato para ajustar y validar.
    # No agregamos mínimos por largo de pierna: eran los que producían ratios
    # (1.476, 2.433, 1.000) aunque la conversión de unidades hubiera sido correcta.
    desired_width = target_size.x * width_factor
    desired_depth = target_size.y * depth_factor

    unit_width_ratio, unit_depth_ratio, passes = previous.normalize_cross_section(
        garment,
        desired_width,
        desired_depth,
    )

    garment_min, garment_max = legacy.bbox_world(garment)
    garment_center = (garment_min + garment_max) * 0.5
    target_center = (target_min + target_max) * 0.5
    garment.location.x += target_center.x - garment_center.x
    garment.location.y += target_center.y - garment_center.y
    garment.location.z += target_top - garment_max.z
    legacy.bpy.context.view_layer.update()

    final_min, final_max = legacy.bbox_world(garment)
    final_size = final_max - final_min
    body_width_ratio = final_size.x / max(target_size.x, 1e-9)
    body_depth_ratio = final_size.y / max(target_size.y, 1e-9)
    body_height_ratio = final_size.z / max(target_size.z, 1e-9)

    expected_width_ratio = width_factor
    expected_depth_ratio = depth_factor
    width_error = abs(body_width_ratio - expected_width_ratio)
    depth_error = abs(body_depth_ratio - expected_depth_ratio)

    print(
        "[rig-v11] single lower-body volume contract "
        f"category={category} target=({target_size.x:.6f}, {target_size.y:.6f}, {target_size.z:.6f}) "
        f"expectedRatios=({expected_width_ratio:.3f}, {expected_depth_ratio:.3f}) "
        f"actualRatios=({body_width_ratio:.3f}, {body_depth_ratio:.3f}, {body_height_ratio:.3f}) "
        f"errors=({width_error:.5f}, {depth_error:.5f}) passes={passes}",
        flush=True,
    )

    if width_error > 0.035 or depth_error > 0.035:
        raise RuntimeError(
            "El pantalón no coincidió con el volumen objetivo de cadera y piernas: "
            f"esperado=({expected_width_ratio:.3f}, {expected_depth_ratio:.3f}), "
            f"obtenido=({body_width_ratio:.3f}, {body_depth_ratio:.3f})"
        )

    garment["clouvaUnitScalePasses"] = str(passes)
    garment["clouvaLowerBodyTargetWidth"] = float(target_size.x)
    garment["clouvaLowerBodyTargetDepth"] = float(target_size.y)
    garment["clouvaLowerBodyWidthRatio"] = float(body_width_ratio)
    garment["clouvaLowerBodyDepthRatio"] = float(body_depth_ratio)

    return {
        "targetTop": target_top,
        "targetBottom": target_bottom,
        "legLength": leg_length,
        "widthRatio": body_width_ratio,
        "depthRatio": body_depth_ratio,
        "unitScalePasses": passes,
        "singleVolumeContract": True,
    }


v9.snap_lower_garment = snap_lower_garment_v11


_original_export_glb = legacy.export_glb


def export_glb_v11(output_path, garment, armature):
    garment["clouvaRigVersion"] = 11
    garment["clouvaUnitScaleNormalization"] = True
    garment["clouvaSingleLowerBodyVolumeContract"] = True
    _original_export_glb(output_path, garment, armature)


legacy.export_glb = export_glb_v11


if __name__ == "__main__":
    v9.main()
