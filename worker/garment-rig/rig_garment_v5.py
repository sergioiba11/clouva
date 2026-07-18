import copy
import json
import os
import sys
import tempfile

import bpy
from mathutils import Vector

import rig_garment_legacy as legacy


UPPER_GARMENTS = {"hoodie", "shirt", "jacket"}
LOWER_GARMENTS = {"pants", "shorts"}
DEFORMABLE_CATEGORIES = UPPER_GARMENTS | LOWER_GARMENTS | {"shoes"}

# Los avatares generados/importados por distintas herramientas no siempre usan los
# nombres Mixamo. Estas variantes cubren Blender, Ready Player Me, VRM, CC/iClone,
# Unreal y rigs custom frecuentes sin obligar a renombrar el GLB.
EXTRA_BONE_ALIASES = {
    "left_shoulder": [
        "shoulder_l", "shoulderl", "l_shoulder", "lshoulder", "clavicle_l",
        "clavicle_l", "clavicle.L", "J_Bip_L_Shoulder", "CC_Base_L_Clavicle",
        "DEF-shoulder.L", "DEF-clavicle.L",
    ],
    "right_shoulder": [
        "shoulder_r", "shoulderr", "r_shoulder", "rshoulder", "clavicle_r",
        "clavicle_r", "clavicle.R", "J_Bip_R_Shoulder", "CC_Base_R_Clavicle",
        "DEF-shoulder.R", "DEF-clavicle.R",
    ],
    "left_upper_arm": [
        "upperarm_l", "upperarml", "upper_arm_l", "arm_l", "arml", "l_arm",
        "lupperarm", "J_Bip_L_UpperArm", "CC_Base_L_Upperarm", "DEF-upper_arm.L",
        "ORG-upper_arm.L", "b_LeftUpperArm", "Left_UpperArm",
    ],
    "right_upper_arm": [
        "upperarm_r", "upperarmr", "upper_arm_r", "arm_r", "armr", "r_arm",
        "rupperarm", "J_Bip_R_UpperArm", "CC_Base_R_Upperarm", "DEF-upper_arm.R",
        "ORG-upper_arm.R", "b_RightUpperArm", "Right_UpperArm",
    ],
    "left_lower_arm": [
        "forearm_l", "forearml", "lowerarm_l", "lowerarml", "lower_arm_l",
        "l_forearm", "lforearm", "J_Bip_L_LowerArm", "CC_Base_L_Forearm",
        "DEF-forearm.L", "ORG-forearm.L", "b_LeftLowerArm", "Left_LowerArm",
    ],
    "right_lower_arm": [
        "forearm_r", "forearmr", "lowerarm_r", "lowerarmr", "lower_arm_r",
        "r_forearm", "rforearm", "J_Bip_R_LowerArm", "CC_Base_R_Forearm",
        "DEF-forearm.R", "ORG-forearm.R", "b_RightLowerArm", "Right_LowerArm",
    ],
    "left_hand": [
        "hand_l", "handl", "l_hand", "lhand", "J_Bip_L_Hand", "CC_Base_L_Hand",
        "DEF-hand.L", "b_LeftHand", "Left_Hand",
    ],
    "right_hand": [
        "hand_r", "handr", "r_hand", "rhand", "J_Bip_R_Hand", "CC_Base_R_Hand",
        "DEF-hand.R", "b_RightHand", "Right_Hand",
    ],
    "chest": ["upper_chest", "upperchest", "spine_02", "spine_03", "J_Bip_C_Chest", "CC_Base_Spine02"],
    "spine": ["spine_01", "spine1", "J_Bip_C_Spine", "CC_Base_Spine01"],
    "hips": ["hip", "pelvis_ctrl", "J_Bip_C_Hips", "CC_Base_Hip", "DEF-pelvis"],
}

for canonical, aliases in EXTRA_BONE_ALIASES.items():
    existing = legacy.BONE_ALIASES.setdefault(canonical, [])
    for alias in aliases:
        if alias not in existing:
            existing.append(alias)


_original_resolve_bone = legacy.resolve_bone


def clamp(value, minimum, maximum, fallback):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return max(minimum, min(maximum, number))


def resolve_bone_v6(armature, canonical):
    bone = _original_resolve_bone(armature, canonical)
    if bone is not None:
        return bone

    # Último fallback por tokens normalizados. Se exige lado + región para evitar
    # confundir dedos, piernas u otros huesos con los brazos.
    side = "left" if canonical.startswith("left_") else "right" if canonical.startswith("right_") else None
    region_tokens = {
        "left_shoulder": ("shoulder", "clavicle"),
        "right_shoulder": ("shoulder", "clavicle"),
        "left_upper_arm": ("upperarm", "uparm", "arm"),
        "right_upper_arm": ("upperarm", "uparm", "arm"),
        "left_lower_arm": ("forearm", "lowerarm"),
        "right_lower_arm": ("forearm", "lowerarm"),
        "left_hand": ("hand", "wrist"),
        "right_hand": ("hand", "wrist"),
    }.get(canonical)
    if not side or not region_tokens:
        return None

    candidates = []
    for candidate in armature.pose.bones:
        cleaned = legacy.clean_bone_name(candidate.name)
        side_match = (
            side in cleaned
            or (side == "left" and (cleaned.startswith("l") or cleaned.endswith("l")))
            or (side == "right" and (cleaned.startswith("r") or cleaned.endswith("r")))
        )
        if not side_match:
            continue
        if any(token in cleaned for token in ("finger", "thumb", "toe", "leg", "thigh", "calf")):
            continue
        score = sum(5 for token in region_tokens if token in cleaned)
        if canonical.endswith("upper_arm") and "forearm" in cleaned:
            score -= 8
        if score > 0:
            world = armature.matrix_world @ candidate.head
            candidates.append((score, abs(world.x), candidate))
    return max(candidates, key=lambda item: (item[0], item[1]))[2] if candidates else None


legacy.resolve_bone = resolve_bone_v6


def sanitize_preview_settings(category, preview_settings):
    settings = copy.deepcopy(preview_settings) if isinstance(preview_settings, dict) else {}
    adjustments = settings.get("adjustments")
    adjustments = dict(adjustments) if isinstance(adjustments, dict) else {}

    if category in DEFORMABLE_CATEGORIES:
        # El ajuste manual sirve como referencia visual, pero el rig final debe volver a
        # una pose canónica. Nunca heredamos traslaciones/rotaciones de versiones viejas.
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
    settings["rigProfileVersion"] = 9
    settings["canonicalSnap"] = True
    settings["crossSectionNormalization"] = True
    return settings


def apply_object_scale(garment, sx=1.0, sy=1.0, sz=1.0):
    garment.scale.x *= sx
    garment.scale.y *= sy
    garment.scale.z *= sz
    bpy.context.view_layer.update()
    legacy.select_only(garment)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)


def lower_fit_factors(preview_settings):
    settings = preview_settings if isinstance(preview_settings, dict) else {}
    adjustments = settings.get("adjustments")
    adjustments = adjustments if isinstance(adjustments, dict) else {}
    fit = str(settings.get("fit") or "Regular")

    fit_width = {"Slim": 0.94, "Regular": 1.00, "Oversize": 1.12}.get(fit, 1.00)
    fit_depth = {"Slim": 0.96, "Regular": 1.02, "Oversize": 1.12}.get(fit, 1.02)
    manual_width = clamp(adjustments.get("width"), 90, 115, 100) / 100.0
    manual_depth = clamp(
        1.0 + clamp(adjustments.get("distance"), -5, 12, 5) / 100.0,
        0.95,
        1.12,
        1.05,
    )
    return fit_width * manual_width, fit_depth * manual_depth


def snap_lower_garment(garment, body_meshes, armature, category, preview_settings):
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
    current_size = garment_max - garment_min
    current_height = max(current_size.z, 1e-6)
    apply_object_scale(garment, sz=target_height / current_height)

    width_factor, depth_factor = lower_fit_factors(preview_settings)
    desired_width = max(target_size.x * width_factor, leg_length * 0.12)
    desired_depth = max(target_size.y * depth_factor, leg_length * 0.10)

    garment_min, garment_max = legacy.bbox_world(garment)
    current_size = garment_max - garment_min
    sx = clamp(desired_width / max(current_size.x, 1e-6), 0.03, 20.0, 1.0)
    sy = clamp(desired_depth / max(current_size.y, 1e-6), 0.03, 20.0, 1.0)
    apply_object_scale(garment, sx=sx, sy=sy)

    # Segunda pasada exacta: algunas mallas importadas traen jerarquías o transformaciones
    # que introducen pequeñas diferencias después de aplicar la primera escala.
    garment_min, garment_max = legacy.bbox_world(garment)
    current_size = garment_max - garment_min
    correction_x = desired_width / max(current_size.x, 1e-6)
    correction_y = desired_depth / max(current_size.y, 1e-6)
    if abs(correction_x - 1.0) > 0.01 or abs(correction_y - 1.0) > 0.01:
        apply_object_scale(
            garment,
            sx=clamp(correction_x, 0.5, 2.0, 1.0),
            sy=clamp(correction_y, 0.5, 2.0, 1.0),
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
    width_ratio = final_size.x / max(target_size.x, 1e-6)
    depth_ratio = final_size.y / max(target_size.y, 1e-6)
    height_ratio = final_size.z / max(target_size.z, 1e-6)
    print(
        "[rig-v9] lower cross-section "
        f"category={category} sx={sx:.4f} sy={sy:.4f} "
        f"ratios=({width_ratio:.3f}, {depth_ratio:.3f}, {height_ratio:.3f})",
        flush=True,
    )

    if width_ratio > 1.45 or depth_ratio > 1.45:
        raise RuntimeError(
            "No se pudo normalizar el ancho/profundidad del pantalón: "
            f"ratios=({width_ratio:.3f}, {depth_ratio:.3f}, {height_ratio:.3f})"
        )

    return {
        "targetTop": target_top,
        "targetBottom": target_bottom,
        "legLength": leg_length,
        "widthRatio": width_ratio,
        "depthRatio": depth_ratio,
    }


def upper_landmarks(armature):
    shoulders = [
        legacy.bone_center_world(armature, "left_shoulder"),
        legacy.bone_center_world(armature, "right_shoulder"),
    ]
    upper_arms = [
        legacy.bone_center_world(armature, "left_upper_arm"),
        legacy.bone_center_world(armature, "right_upper_arm"),
    ]
    chest = legacy.bone_center_world(armature, "chest") or legacy.bone_center_world(armature, "spine")
    neck = legacy.bone_center_world(armature, "neck") or legacy.bone_center_world(armature, "head")
    hips = legacy.bone_center_world(armature, "hips")
    valid_shoulders = [point for point in shoulders if point is not None]
    valid_arms = [point for point in upper_arms if point is not None]
    if chest is None or hips is None or len(valid_arms) < 2:
        raise RuntimeError("Avatar rig is missing arm bones required for the upper garment")
    return {
        "chest": chest,
        "neck": neck or chest,
        "hips": hips,
        "shoulders": valid_shoulders,
        "upper_arms": valid_arms,
    }


def snap_upper_garment(garment, armature, category):
    marks = upper_landmarks(armature)
    torso_height = max(marks["neck"].z - marks["hips"].z, 1e-6)
    target_top = marks["neck"].z + torso_height * (0.05 if category == "hoodie" else 0.01)
    target_bottom = marks["hips"].z + torso_height * 0.04
    target_height = max(target_top - target_bottom, torso_height * 0.55)

    garment_min, garment_max = legacy.bbox_world(garment)
    current_height = max(garment_max.z - garment_min.z, 1e-6)
    height_scale = max(0.82, min(target_height / current_height, 1.22))
    apply_object_scale(garment, sz=height_scale)

    points = marks["shoulders"] + marks["upper_arms"]
    target_center_x = sum(point.x for point in points) / len(points)
    target_center_y = marks["chest"].y
    garment_min, garment_max = legacy.bbox_world(garment)
    garment_center = (garment_min + garment_max) * 0.5
    garment.location += Vector((
        target_center_x - garment_center.x,
        target_center_y - garment_center.y,
        target_top - garment_max.z,
    ))
    bpy.context.view_layer.update()
    print(
        f"[rig-v6] upper snap category={category} top={target_top:.5f} bottom={target_bottom:.5f}",
        flush=True,
    )


def normalize_vertex_groups(garment):
    legacy.select_only(garment)
    try:
        bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    except Exception as exc:
        print(f"[rig-v6] normalize weights warning: {exc}", flush=True)


def ensure_upper_arm_weights(garment, armature):
    left_bone = legacy.resolve_bone(armature, "left_upper_arm")
    right_bone = legacy.resolve_bone(armature, "right_upper_arm")
    if left_bone is None or right_bone is None:
        raise RuntimeError("Avatar rig is missing arm bones required for sleeves")

    left_names = legacy.canonical_bone_names(
        armature, {"left_shoulder", "left_upper_arm", "left_lower_arm", "left_hand"}
    )
    right_names = legacy.canonical_bone_names(
        armature, {"right_shoulder", "right_upper_arm", "right_lower_arm", "right_hand"}
    )
    minimum = max(6, int(len(garment.data.vertices) * 0.004))
    left_count = legacy.group_vertex_count(garment, left_names, threshold=0.025)
    right_count = legacy.group_vertex_count(garment, right_names, threshold=0.025)
    if left_count >= minimum and right_count >= minimum:
        return

    garment_min, garment_max = legacy.bbox_world(garment)
    center_x = (garment_min.x + garment_max.x) * 0.5
    width = max(garment_max.x - garment_min.x, 1e-6)
    height = max(garment_max.z - garment_min.z, 1e-6)
    shoulder_floor = garment_min.z + height * 0.43
    left_center = armature.matrix_world @ left_bone.center
    right_center = armature.matrix_world @ right_bone.center

    groups = {group.name: group for group in garment.vertex_groups}
    left_group = groups.get(left_bone.name) or garment.vertex_groups.new(name=left_bone.name)
    right_group = groups.get(right_bone.name) or garment.vertex_groups.new(name=right_bone.name)
    repaired = {"left": 0, "right": 0}

    for vertex in garment.data.vertices:
        world = garment.matrix_world @ vertex.co
        if world.z < shoulder_floor or abs(world.x - center_x) < width * 0.18:
            continue
        left_distance = (world - left_center).length
        right_distance = (world - right_center).length
        if left_distance <= right_distance and left_count < minimum:
            left_group.add([vertex.index], 0.55, "ADD")
            repaired["left"] += 1
        elif right_count < minimum:
            right_group.add([vertex.index], 0.55, "ADD")
            repaired["right"] += 1

    normalize_vertex_groups(garment)
    print(f"[rig-v6] repaired sleeve candidates={repaired}", flush=True)


def validate_upper_weights_v6(garment, armature):
    left_names = legacy.canonical_bone_names(
        armature, {"left_shoulder", "left_upper_arm", "left_lower_arm", "left_hand"}
    )
    right_names = legacy.canonical_bone_names(
        armature, {"right_shoulder", "right_upper_arm", "right_lower_arm", "right_hand"}
    )
    if not left_names or not right_names:
        raise RuntimeError("Avatar rig is missing arm bones required for sleeves")
    minimum = max(6, int(len(garment.data.vertices) * 0.004))
    left_count = legacy.group_vertex_count(garment, left_names, threshold=0.025)
    right_count = legacy.group_vertex_count(garment, right_names, threshold=0.025)
    if left_count < minimum or right_count < minimum:
        raise RuntimeError(
            f"Sleeve weight validation failed: left={left_count}, right={right_count}, minimum={minimum}"
        )
    return {"leftWeighted": left_count, "rightWeighted": right_count, "armAliasVersion": 6}


def validate_lower_geometry_and_weights_v9(garment, armature, category):
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

    left_names = legacy.canonical_bone_names(armature, {"left_up_leg", "left_leg", "left_foot", "left_toe"})
    right_names = legacy.canonical_bone_names(armature, {"right_up_leg", "right_leg", "right_foot", "right_toe"})
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
        "canonicalSnap": True,
        "crossSectionVersion": 9,
    }


def validate_roundtrip_v9(output_path):
    if not os.path.exists(output_path) or os.path.getsize(output_path) < 1024:
        raise RuntimeError("El GLB exportado está vacío")
    with tempfile.TemporaryDirectory(prefix="clouva-validate-v9-"):
        legacy.clear_scene()
        imported = legacy.import_glb(output_path)
        armatures = [obj for obj in imported if obj.type == "ARMATURE"]
        skinned = [obj for obj in imported if obj.type == "MESH" and obj.find_armature()]
        if len(armatures) != 1 or not skinned:
            raise RuntimeError("El GLB exportado no contiene un único rig vestible")
        garment = max(skinned, key=lambda obj: len(obj.data.vertices))
        if int(garment.get("clouvaRigVersion", 0)) < 9:
            raise RuntimeError("El GLB perdió la metadata de validación CLOUVA V9")
        print(
            f"[rig-v9] roundtrip ok meshes={len(skinned)} vertices={sum(len(obj.data.vertices) for obj in skinned)}",
            flush=True,
        )


def main():
    avatar_path, garment_path, output_path, category, art_path, color, preview_settings = legacy.args()
    if category not in legacy.VALID_CATEGORIES:
        raise RuntimeError(f"Categoría inválida: {category}")

    legacy.validate_lower_geometry_and_weights = validate_lower_geometry_and_weights_v9
    legacy.validate_upper_weights = validate_upper_weights_v6

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
        snap_lower_garment(garment, body_meshes, armature, category, safe_settings)
        target_min, target_max = legacy.body_region(body_meshes, armature, category)
    elif category in UPPER_GARMENTS:
        snap_upper_garment(garment, armature, category)
        target_min, target_max = legacy.body_region(body_meshes, armature, category)

    if category == "hat":
        legacy.assign_rigid_bone_weights(garment, armature, "head")
    elif category == "accessory":
        legacy.assign_rigid_bone_weights(garment, armature, "chest")
    else:
        legacy.copy_weights(body_meshes, garment, armature, category)
        if category in UPPER_GARMENTS:
            ensure_upper_arm_weights(garment, armature)

    legacy.apply_material(garment, art_path, color)
    legacy.attach_armature(garment, armature)
    legacy.validate(garment, armature, target_min, target_max, category)
    garment["clouvaRigVersion"] = 9
    garment["clouvaCanonicalSnap"] = category in DEFORMABLE_CATEGORIES
    garment["clouvaCrossSectionNormalization"] = category in LOWER_GARMENTS
    legacy.export_glb(output_path, garment, armature)
    validate_roundtrip_v9(output_path)


if __name__ == "__main__":
    main()
