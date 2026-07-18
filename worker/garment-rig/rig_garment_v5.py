import copy
import json
import os
import sys
import tempfile

import bpy
from mathutils import Vector

import rig_garment_legacy as legacy


LOWER_GARMENTS = {"pants", "shorts"}


def clamp(value, minimum, maximum, fallback):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return max(minimum, min(maximum, number))


def sanitize_preview_settings(category, preview_settings):
    settings = copy.deepcopy(preview_settings) if isinstance(preview_settings, dict) else {}
    adjustments = settings.get("adjustments")
    adjustments = dict(adjustments) if isinstance(adjustments, dict) else {}

    if category in LOWER_GARMENTS:
        # Los ajustes guardados por versiones anteriores podían contener desplazamientos
        # enormes que volvían a colocar el pantalón sobre el torso. El rig automático usa
        # únicamente proporciones seguras y vuelve a anclar la cintura a Hips.
        adjustments["x"] = 0
        adjustments["y"] = 0
        adjustments["height"] = 0
        adjustments["rotation"] = 0
        adjustments["scale"] = clamp(adjustments.get("scale"), 85, 120, 100)
        adjustments["width"] = clamp(adjustments.get("width"), 85, 140, 100)
        adjustments["length"] = clamp(adjustments.get("length"), 90, 120, 100)
        adjustments["distance"] = clamp(adjustments.get("distance"), -5, 20, 8)
        settings["fit"] = settings.get("fit") if settings.get("fit") in {"Slim", "Regular", "Oversize"} else "Regular"

    settings["adjustments"] = adjustments
    settings["rigProfileVersion"] = 5
    settings["canonicalSnap"] = True
    return settings


def apply_object_scale(garment, sx=1.0, sy=1.0, sz=1.0):
    garment.scale.x *= sx
    garment.scale.y *= sy
    garment.scale.z *= sz
    bpy.context.view_layer.update()
    legacy.select_only(garment)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)


def snap_lower_garment(garment, armature, category):
    marks = legacy.lower_landmarks(armature)
    waist_z = marks["waist"].z
    feet_z = min(marks["left_foot"].z, marks["right_foot"].z)
    knees_z = min(marks["left_knee"].z, marks["right_knee"].z)
    leg_length = max(waist_z - feet_z, 1e-6)

    target_top = waist_z + leg_length * 0.025
    target_bottom = (
        knees_z + leg_length * 0.14
        if category == "shorts"
        else feet_z + leg_length * 0.035
    )
    target_height = max(target_top - target_bottom, leg_length * 0.25)

    garment_min, garment_max = legacy.bbox_world(garment)
    current_height = max(garment_max.z - garment_min.z, 1e-6)
    apply_object_scale(garment, sz=target_height / current_height)

    leg_x = [
        marks["left_up"].x,
        marks["right_up"].x,
        marks["left_knee"].x,
        marks["right_knee"].x,
        marks["left_foot"].x,
        marks["right_foot"].x,
    ]
    leg_span = max(leg_x) - min(leg_x)
    hip_span = max(abs(marks["left_up"].x - marks["right_up"].x), leg_length * 0.08)
    target_width = max(leg_span + hip_span * 0.72, hip_span * 1.55)
    garment_min, garment_max = legacy.bbox_world(garment)
    current_width = max(garment_max.x - garment_min.x, 1e-6)
    if current_width < target_width:
        apply_object_scale(garment, sx=min(target_width / current_width, 1.35))

    garment_min, garment_max = legacy.bbox_world(garment)
    garment_center = (garment_min + garment_max) * 0.5
    target_center_x = (marks["left_up"].x + marks["right_up"].x) * 0.5
    target_center_y = marks["waist"].y
    garment.location += Vector((
        target_center_x - garment_center.x,
        target_center_y - garment_center.y,
        target_top - garment_max.z,
    ))
    bpy.context.view_layer.update()

    final_min, final_max = legacy.bbox_world(garment)
    print(
        "[rig-v5] lower snap "
        f"top={final_max.z:.5f}/{target_top:.5f} "
        f"bottom={final_min.z:.5f}/{target_bottom:.5f} "
        f"width={final_max.x-final_min.x:.5f}",
        flush=True,
    )
    return {
        "targetTop": target_top,
        "targetBottom": target_bottom,
        "legLength": leg_length,
    }


def validate_lower_geometry_and_weights_v5(garment, armature, category):
    marks = legacy.lower_landmarks(armature)
    garment_min, garment_max = legacy.bbox_world(garment)
    waist_z = marks["waist"].z
    feet_z = min(marks["left_foot"].z, marks["right_foot"].z)
    knees_z = min(marks["left_knee"].z, marks["right_knee"].z)
    leg_length = max(waist_z - feet_z, 1e-6)

    expected_top = waist_z + leg_length * 0.025
    waist_error = abs(garment_max.z - expected_top) / leg_length
    if waist_error > 0.08:
        raise RuntimeError(
            "La cintura no quedó alineada con Hips: "
            f"garment_top={garment_max.z:.4f}, target={expected_top:.4f}, error={waist_error:.3f}"
        )

    if category == "pants" and garment_min.z > knees_z + leg_length * 0.10:
        raise RuntimeError(
            "El pantalón no alcanza las rodillas: "
            f"garment_bottom={garment_min.z:.4f}, knees={knees_z:.4f}"
        )

    garment_center_x = (garment_min.x + garment_max.x) * 0.5
    legs_center_x = (marks["left_up"].x + marks["right_up"].x) * 0.5
    hip_span = max(abs(marks["left_up"].x - marks["right_up"].x), leg_length * 0.08)
    if abs(garment_center_x - legs_center_x) > hip_span * 0.32:
        raise RuntimeError("El pantalón quedó desplazado horizontalmente respecto de la cadera")

    margin = hip_span * 0.30
    for label, point in (("izquierdo", marks["left_up"]), ("derecho", marks["right_up"])):
        if not (garment_min.x - margin <= point.x <= garment_max.x + margin):
            raise RuntimeError(f"El muslo {label} quedó fuera de la malla del pantalón")

    left_names = legacy.canonical_bone_names(
        armature,
        {"left_up_leg", "left_leg", "left_foot", "left_toe"},
    )
    right_names = legacy.canonical_bone_names(
        armature,
        {"right_up_leg", "right_leg", "right_foot", "right_toe"},
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
        "waistError": round(waist_error, 4),
        "leftWeighted": left_count,
        "rightWeighted": right_count,
        "garmentTop": round(garment_max.z, 5),
        "targetTop": round(expected_top, 5),
        "garmentBottom": round(garment_min.z, 5),
        "kneesZ": round(knees_z, 5),
        "canonicalSnap": True,
    }


def validate_roundtrip_v5(output_path):
    if not os.path.exists(output_path) or os.path.getsize(output_path) < 1024:
        raise RuntimeError("El GLB exportado está vacío")
    with tempfile.TemporaryDirectory(prefix="clouva-validate-v5-"):
        legacy.clear_scene()
        imported = legacy.import_glb(output_path)
        armatures = [obj for obj in imported if obj.type == "ARMATURE"]
        skinned = [obj for obj in imported if obj.type == "MESH" and obj.find_armature()]
        if len(armatures) != 1 or not skinned:
            raise RuntimeError("El GLB exportado no contiene un único rig vestible")
        garment = max(skinned, key=lambda obj: len(obj.data.vertices))
        if int(garment.get("clouvaRigVersion", 0)) < 4:
            raise RuntimeError("El GLB perdió la metadata de validación CLOUVA")
        garment["clouvaRigVersion"] = 5
        print(
            f"[rig-v5] roundtrip ok meshes={len(skinned)} vertices={sum(len(obj.data.vertices) for obj in skinned)}",
            flush=True,
        )


def main():
    avatar_path, garment_path, output_path, category, art_path, color, preview_settings = legacy.args()
    if category not in legacy.VALID_CATEGORIES:
        raise RuntimeError(f"Categoría inválida: {category}")

    legacy.validate_lower_geometry_and_weights = validate_lower_geometry_and_weights_v5

    legacy.clear_scene()
    avatar_objects = legacy.import_glb(avatar_path)
    armature = legacy.find_armature(avatar_objects)
    body_meshes = legacy.body_meshes_for_rig(avatar_objects, armature)
    body_min, body_max = legacy.combined_bbox(body_meshes)
    avatar_height = max(body_max.z - body_min.z, 1e-6)

    garment_objects = legacy.import_glb(garment_path)
    garment = legacy.prepare_garment(garment_objects, category)
    target_min, target_max = legacy.fit_to_body(garment, body_meshes, armature, category)

    safe_settings = sanitize_preview_settings(category, preview_settings)
    legacy.apply_preview_adjustments(garment, safe_settings, avatar_height)
    if category in LOWER_GARMENTS:
        snap_lower_garment(garment, armature, category)
        target_min, target_max = legacy.body_region(body_meshes, armature, category)

    if category == "hat":
        legacy.assign_rigid_bone_weights(garment, armature, "head")
    elif category == "accessory":
        legacy.assign_rigid_bone_weights(garment, armature, "chest")
    else:
        legacy.copy_weights(body_meshes, garment, armature, category)

    legacy.apply_material(garment, art_path, color)
    legacy.attach_armature(garment, armature)
    legacy.validate(garment, armature, target_min, target_max, category)
    garment["clouvaRigVersion"] = 5
    garment["clouvaCanonicalSnap"] = category in LOWER_GARMENTS
    legacy.export_glb(output_path, garment, armature)
    validate_roundtrip_v5(output_path)


if __name__ == "__main__":
    main()
