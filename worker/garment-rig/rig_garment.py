import bpy
import json
import os
import re
import sys
import tempfile
from math import radians

from mathutils import Vector
from mathutils.kdtree import KDTree


VALID_CATEGORIES = {"hoodie", "shirt", "jacket", "pants", "shorts", "shoes", "hat", "accessory"}
UPPER_GARMENTS = {"hoodie", "shirt", "jacket"}
LOWER_GARMENTS = {"pants", "shorts"}
DEFORMABLE_CATEGORIES = UPPER_GARMENTS | LOWER_GARMENTS | {"shoes"}

BONE_ALIASES = {
    "hips": ["Hips", "mixamorig:Hips", "pelvis", "Pelvis", "hips", "hips_ctrl"],
    "spine": ["Spine", "Spine01", "mixamorig:Spine", "spine_01"],
    "chest": ["Spine02", "Spine2", "Spine1", "mixamorig:Spine2", "chest", "Chest", "UpperChest"],
    "neck": ["neck", "Neck", "mixamorig:Neck"],
    "head": ["head", "Head", "mixamorig:Head", "J_Bip_C_Head", "Bip01 Head"],
    "left_shoulder": ["LeftShoulder", "mixamorig:LeftShoulder", "shoulder.L", "Shoulder_L", "clavicle.L"],
    "right_shoulder": ["RightShoulder", "mixamorig:RightShoulder", "shoulder.R", "Shoulder_R", "clavicle.R"],
    "left_upper_arm": ["LeftArm", "mixamorig:LeftArm", "upper_arm.L", "UpperArm_L", "LeftUpperArm"],
    "right_upper_arm": ["RightArm", "mixamorig:RightArm", "upper_arm.R", "UpperArm_R", "RightUpperArm"],
    "left_lower_arm": ["LeftForeArm", "mixamorig:LeftForeArm", "forearm.L", "LowerArm_L", "LeftLowerArm"],
    "right_lower_arm": ["RightForeArm", "mixamorig:RightForeArm", "forearm.R", "LowerArm_R", "RightLowerArm"],
    "left_hand": ["LeftHand", "mixamorig:LeftHand", "hand.L", "Hand_L"],
    "right_hand": ["RightHand", "mixamorig:RightHand", "hand.R", "Hand_R"],
    "left_up_leg": ["LeftUpLeg", "mixamorig:LeftUpLeg", "thigh.L", "UpLeg_L", "LeftUpperLeg"],
    "right_up_leg": ["RightUpLeg", "mixamorig:RightUpLeg", "thigh.R", "UpLeg_R", "RightUpperLeg"],
    "left_leg": ["LeftLeg", "mixamorig:LeftLeg", "shin.L", "LowerLeg_L", "LeftLowerLeg"],
    "right_leg": ["RightLeg", "mixamorig:RightLeg", "shin.R", "LowerLeg_R", "RightLowerLeg"],
    "left_foot": ["LeftFoot", "mixamorig:LeftFoot", "foot.L", "Foot_L"],
    "right_foot": ["RightFoot", "mixamorig:RightFoot", "foot.R", "Foot_R"],
    "left_toe": ["LeftToeBase", "mixamorig:LeftToeBase", "toe.L"],
    "right_toe": ["RightToeBase", "mixamorig:RightToeBase", "toe.R"],
}

EXCLUDED_BODY_TOKENS = {
    "hair", "eye", "brow", "lash", "teeth", "tongue", "mouth", "shoe", "sock",
    "hoodie", "shirt", "jacket", "pants", "short", "cloth", "garment", "accessory",
    "hat", "cap", "necklace", "glasses", "backpack",
}


def args():
    values = sys.argv[sys.argv.index("--") + 1:]
    if len(values) not in {6, 7}:
        raise RuntimeError(
            "Expected avatar.glb garment.glb output.glb category art.png color [preview_settings_json]"
        )
    preview_settings = {}
    if len(values) == 7 and values[6]:
        try:
            decoded = json.loads(values[6])
            if isinstance(decoded, dict):
                preview_settings = decoded
        except json.JSONDecodeError as exc:
            raise RuntimeError("preview_settings_json is invalid") from exc
    return (*values[:6], preview_settings)


def clear_scene():
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def import_glb(path):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    bpy.context.view_layer.update()
    return [obj for obj in bpy.context.scene.objects if obj not in before]


def select_only(obj):
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def clean_bone_name(value):
    text = str(value or "").lower()
    text = re.sub(r"^(mixamorig:|mixamorig_|armature\||bip01[\s_:.-]*)", "", text)
    return re.sub(r"[^a-z0-9]", "", text)


def find_armature(objects):
    armatures = [obj for obj in objects if obj.type == "ARMATURE"]
    if not armatures:
        raise RuntimeError("Official avatar has no armature")
    return max(armatures, key=lambda obj: len(obj.data.bones))


def find_pose_bone(armature, aliases):
    exact = {bone.name: bone for bone in armature.pose.bones}
    for name in aliases:
        if name in exact:
            return exact[name]
    normalized = {clean_bone_name(bone.name): bone for bone in armature.pose.bones}
    for name in aliases:
        cleaned = clean_bone_name(name)
        if cleaned in normalized:
            return normalized[cleaned]
    for name in aliases:
        cleaned = clean_bone_name(name)
        for candidate_name, bone in normalized.items():
            if cleaned and (cleaned in candidate_name or candidate_name in cleaned):
                return bone
    return None


def infer_head_bone(armature):
    candidates = []
    excluded = ("hand", "finger", "thumb", "toe", "foot", "weapon", "eye")
    for bone in armature.pose.bones:
        cleaned = clean_bone_name(bone.name)
        if any(token in cleaned for token in excluded):
            continue
        world_head = armature.matrix_world @ bone.head
        world_tail = armature.matrix_world @ bone.tail
        candidates.append((max(world_head.z, world_tail.z), -len(bone.children), bone))
    return max(candidates, key=lambda item: (item[0], item[1]))[2] if candidates else None


def common_ancestor(left, right):
    if left is None or right is None:
        return None
    left_ancestors = []
    current = left
    while current is not None:
        left_ancestors.append(current)
        current = current.parent
    current = right
    while current is not None:
        if current in left_ancestors:
            return current
        current = current.parent
    return None


def infer_hips_bone(armature):
    left = find_pose_bone(armature, BONE_ALIASES["left_up_leg"])
    right = find_pose_bone(armature, BONE_ALIASES["right_up_leg"])
    ancestor = common_ancestor(left, right)
    if ancestor is not None:
        cleaned = clean_bone_name(ancestor.name)
        if "root" not in cleaned and "master" not in cleaned:
            return ancestor

    candidates = []
    for bone in armature.pose.bones:
        cleaned = clean_bone_name(bone.name)
        if any(token in cleaned for token in ("pelvis", "hips", "hip")):
            world = armature.matrix_world @ bone.head
            candidates.append((len(bone.children), world.z, bone))
    if candidates:
        return max(candidates, key=lambda item: (item[0], item[1]))[2]

    for bone in armature.pose.bones:
        child_names = " ".join(clean_bone_name(child.name) for child in bone.children)
        if "left" in child_names and "right" in child_names and ("leg" in child_names or "thigh" in child_names):
            return bone
    return None


def resolve_bone(armature, canonical):
    if canonical == "hips":
        direct = find_pose_bone(armature, BONE_ALIASES["hips"])
        if direct is not None and "root" not in clean_bone_name(direct.name):
            return direct
        return infer_hips_bone(armature)

    bone = find_pose_bone(armature, BONE_ALIASES[canonical])
    if bone is not None:
        return bone
    if canonical == "head":
        return infer_head_bone(armature)
    if canonical == "neck":
        head = infer_head_bone(armature)
        return head.parent if head is not None else None
    return None


def bone_head_world(armature, canonical):
    bone = resolve_bone(armature, canonical)
    return armature.matrix_world @ bone.head if bone is not None else None


def bone_tail_world(armature, canonical):
    bone = resolve_bone(armature, canonical)
    return armature.matrix_world @ bone.tail if bone is not None else None


def bone_center_world(armature, canonical):
    head = bone_head_world(armature, canonical)
    tail = bone_tail_world(armature, canonical)
    if head is None:
        return tail
    if tail is None:
        return head
    return (head + tail) * 0.5


def bbox_world(obj):
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return (
        Vector((min(v.x for v in corners), min(v.y for v in corners), min(v.z for v in corners))),
        Vector((max(v.x for v in corners), max(v.y for v in corners), max(v.z for v in corners))),
    )


def combined_bbox(objects):
    points = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    if not points:
        raise RuntimeError("Cannot calculate an empty bounding box")
    return (
        Vector((min(v.x for v in points), min(v.y for v in points), min(v.z for v in points))),
        Vector((max(v.x for v in points), max(v.y for v in points), max(v.z for v in points))),
    )


def body_meshes_for_rig(objects, armature):
    meshes = []
    for obj in objects:
        if obj.type != "MESH" or len(obj.data.vertices) < 20 or obj.find_armature() != armature:
            continue
        normalized_name = clean_bone_name(obj.name)
        if any(clean_bone_name(token) in normalized_name for token in EXCLUDED_BODY_TOKENS):
            continue
        if obj.vertex_groups:
            meshes.append(obj)
    if not meshes:
        meshes = [
            obj for obj in objects
            if obj.type == "MESH" and obj.find_armature() == armature and obj.vertex_groups
        ]
    if not meshes:
        raise RuntimeError("Official avatar has no usable skinned body meshes")
    print("[rig-v4] body meshes", [(obj.name, len(obj.data.vertices)) for obj in meshes], flush=True)
    return meshes


def prepare_garment(objects, category):
    meshes = [obj for obj in objects if obj.type == "MESH" and len(obj.data.vertices) >= 3]
    source_armatures = [obj for obj in objects if obj.type == "ARMATURE"]
    if not meshes:
        raise RuntimeError("Garment GLB has no usable mesh")

    original_vertices = sum(len(obj.data.vertices) for obj in meshes)
    for obj in meshes:
        world = obj.matrix_world.copy()
        obj.animation_data_clear()
        obj.parent = None
        obj.matrix_world = world
        for modifier in list(obj.modifiers):
            if modifier.type == "ARMATURE":
                obj.modifiers.remove(modifier)
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.hide_render = False

    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    active = max(meshes, key=lambda obj: len(obj.data.vertices))
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = active
    if len(meshes) > 1:
        bpy.ops.object.join()

    garment = bpy.context.view_layer.objects.active
    garment.name = "CLOUVA_Garment"
    garment.animation_data_clear()
    select_only(garment)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    try:
        bpy.ops.mesh.remove_doubles(threshold=0.000001)
    except Exception:
        bpy.ops.mesh.merge_by_distance(threshold=0.000001)
    try:
        bpy.ops.mesh.normals_make_consistent(inside=False)
    except Exception:
        pass
    bpy.ops.object.mode_set(mode="OBJECT")
    garment.data.validate(verbose=False)
    bpy.context.view_layer.update()

    if category in DEFORMABLE_CATEGORIES:
        garment.vertex_groups.clear()

    for source_armature in source_armatures:
        source_armature.animation_data_clear()
        if source_armature.name in bpy.data.objects:
            bpy.data.objects.remove(source_armature, do_unlink=True)

    final_vertices = len(garment.data.vertices)
    if final_vertices < max(50, int(original_vertices * 0.90)):
        raise RuntimeError(f"Garment geometry was unexpectedly reduced: {original_vertices} -> {final_vertices}")
    print(f"[rig-v4] garment vertices={final_vertices} source_armatures={len(source_armatures)}", flush=True)
    return garment


def orient_lower_garment(garment):
    minimum, maximum = bbox_world(garment)
    size = maximum - minimum
    if size.z >= max(size.x, size.y) * 0.72:
        return

    if size.x >= size.y:
        garment.rotation_euler.y += radians(90)
        axis = "X→Z"
    else:
        garment.rotation_euler.x += radians(90)
        axis = "Y→Z"
    bpy.context.view_layer.update()
    select_only(garment)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    print(f"[rig-v4] auto-oriented lower garment {axis}", flush=True)


def lower_landmarks(armature):
    hips = bone_center_world(armature, "hips")
    left_up = bone_head_world(armature, "left_up_leg")
    right_up = bone_head_world(armature, "right_up_leg")
    left_knee = bone_head_world(armature, "left_leg")
    right_knee = bone_head_world(armature, "right_leg")
    left_foot = bone_head_world(armature, "left_foot")
    right_foot = bone_head_world(armature, "right_foot")

    if left_up is None or right_up is None:
        raise RuntimeError("Avatar rig is missing left/right upper-leg bones")
    if hips is None:
        hips = (left_up + right_up) * 0.5
    if left_knee is None:
        left_knee = bone_tail_world(armature, "left_up_leg")
    if right_knee is None:
        right_knee = bone_tail_world(armature, "right_up_leg")
    if left_foot is None:
        left_foot = bone_tail_world(armature, "left_leg")
    if right_foot is None:
        right_foot = bone_tail_world(armature, "right_leg")
    if left_knee is None or right_knee is None or left_foot is None or right_foot is None:
        raise RuntimeError("Avatar rig is missing knee/foot landmarks required for pants")

    waist_center = Vector((
        (left_up.x + right_up.x + hips.x) / 3.0,
        (left_up.y + right_up.y + hips.y) / 3.0,
        max(left_up.z, right_up.z, hips.z),
    ))

    # DIAGNOSTICO TEMPORAL: confirmar si armature.matrix_world / las posiciones locales de
    # los huesos son la fuente de la altura objetivo de 6.07 vista en el pantalon.
    hips_bone = resolve_bone(armature, "hips")
    left_foot_bone = resolve_bone(armature, "left_foot")
    print(
        "[rig-diag] armature.matrix_world=" + repr(list(armature.matrix_world)) +
        f" armature.scale={tuple(armature.scale)}" +
        f" hips_bone_name={hips_bone.name if hips_bone else None}" +
        f" hips_local_head={tuple(hips_bone.head) if hips_bone else None}" +
        f" left_foot_bone_name={left_foot_bone.name if left_foot_bone else None}" +
        f" left_foot_local_head={tuple(left_foot_bone.head) if left_foot_bone else None}" +
        f" waist_world={tuple(waist_center)}" +
        f" left_foot_world={tuple(left_foot)}" +
        f" right_foot_world={tuple(right_foot)}",
        flush=True,
    )

    return {
        "hips": hips,
        "waist": waist_center,
        "left_up": left_up,
        "right_up": right_up,
        "left_knee": left_knee,
        "right_knee": right_knee,
        "left_foot": left_foot,
        "right_foot": right_foot,
    }


def body_region(body_meshes, armature, category):
    body_min, body_max = combined_bbox(body_meshes)
    height = max(body_max.z - body_min.z, 1e-6)
    hips = bone_center_world(armature, "hips")
    chest = bone_center_world(armature, "chest")
    neck = bone_center_world(armature, "neck")
    head = bone_center_world(armature, "head")

    if category in UPPER_GARMENTS:
        bottom_z = hips.z if hips else body_min.z + height * 0.43
        top_anchor = neck or chest or head
        top_z = top_anchor.z if top_anchor else body_min.z + height * 0.82
        arm_points = [
            bone_head_world(armature, "left_shoulder"),
            bone_head_world(armature, "right_shoulder"),
            bone_head_world(armature, "left_upper_arm"),
            bone_head_world(armature, "right_upper_arm"),
            bone_head_world(armature, "left_lower_arm"),
            bone_head_world(armature, "right_lower_arm"),
            bone_head_world(armature, "left_hand"),
            bone_head_world(armature, "right_hand"),
        ]
        arm_points = [point for point in arm_points if point is not None]
        if len(arm_points) >= 4:
            margin = height * 0.035
            min_x = min(point.x for point in arm_points) - margin
            max_x = max(point.x for point in arm_points) + margin
        else:
            min_x, max_x = body_min.x, body_max.x
        center_y = (body_min.y + body_max.y) * 0.5
        half_y = (body_max.y - body_min.y) * 0.43
        return Vector((min_x, center_y - half_y, bottom_z)), Vector((max_x, center_y + half_y, top_z))

    if category in LOWER_GARMENTS:
        marks = lower_landmarks(armature)
        leg_length = max(marks["waist"].z - min(marks["left_foot"].z, marks["right_foot"].z), height * 0.2)
        top_z = marks["waist"].z + leg_length * 0.025
        if category == "shorts":
            knee_z = min(marks["left_knee"].z, marks["right_knee"].z)
            bottom_z = knee_z + leg_length * 0.14
        else:
            bottom_z = min(marks["left_foot"].z, marks["right_foot"].z) + leg_length * 0.035

        limb_x = [
            marks["left_up"].x, marks["right_up"].x,
            marks["left_knee"].x, marks["right_knee"].x,
            marks["left_foot"].x, marks["right_foot"].x,
        ]
        margin_x = max(abs(marks["left_up"].x - marks["right_up"].x) * 0.42, height * 0.045)
        min_x = min(limb_x) - margin_x
        max_x = max(limb_x) + margin_x
        center_y = marks["waist"].y
        half_y = max((body_max.y - body_min.y) * 0.30, height * 0.07)
        print(
            f"[rig-v4] lower target waist={top_z:.4f} bottom={bottom_z:.4f} width={max_x-min_x:.4f}",
            flush=True,
        )
        return Vector((min_x, center_y - half_y, bottom_z)), Vector((max_x, center_y + half_y, top_z))

    if category == "shoes":
        feet = [
            bone_head_world(armature, "left_foot"),
            bone_head_world(armature, "right_foot"),
            bone_head_world(armature, "left_toe"),
            bone_head_world(armature, "right_toe"),
        ]
        feet = [point for point in feet if point is not None]
        if not feet:
            raise RuntimeError("Avatar rig is missing foot bones")
        min_x = min(point.x for point in feet) - height * 0.05
        max_x = max(point.x for point in feet) + height * 0.05
        min_z = min(point.z for point in feet) - height * 0.02
        max_z = max(point.z for point in feet) + height * 0.10
        center_y = sum(point.y for point in feet) / len(feet)
        half_y = height * 0.11
        return Vector((min_x, center_y - half_y, min_z)), Vector((max_x, center_y + half_y, max_z))

    if category == "hat":
        anchor = head or neck
        if anchor is None:
            anchor = Vector(((body_min.x + body_max.x) * 0.5, (body_min.y + body_max.y) * 0.5, body_min.z + height * 0.88))
        center = Vector((anchor.x, anchor.y, anchor.z + height * 0.055))
        half = Vector((height * 0.115, height * 0.12, height * 0.085))
        return center - half, center + half

    return body_min, body_max


def fit_to_body(garment, body_meshes, armature, category):
    if category in LOWER_GARMENTS:
        orient_lower_garment(garment)

    target_min, target_max = body_region(body_meshes, armature, category)
    target_size = target_max - target_min
    source_min, source_max = bbox_world(garment)
    source_size = source_max - source_min
    if min(target_size) <= 1e-6 or min(source_size) <= 1e-6:
        raise RuntimeError("Garment or target body region has invalid dimensions")

    padding = {
        "hoodie": Vector((1.04, 1.18, 1.08)),
        "shirt": Vector((1.02, 1.12, 1.04)),
        "jacket": Vector((1.06, 1.22, 1.10)),
        "pants": Vector((1.08, 1.15, 1.00)),
        "shorts": Vector((1.08, 1.15, 1.00)),
        "shoes": Vector((1.10, 1.15, 1.04)),
        "hat": Vector((1.12, 1.12, 1.03)),
        "accessory": Vector((1.05, 1.05, 1.05)),
    }[category]
    desired = Vector((target_size.x * padding.x, target_size.y * padding.y, target_size.z * padding.z))

    if category == "hat":
        uniform = min(
            desired.x / max(source_size.x, 1e-6),
            desired.y / max(source_size.y, 1e-6),
            desired.z / max(source_size.z, 1e-6),
        )
        garment.scale = Vector((uniform, uniform, uniform))
    else:
        uniform = desired.z / max(source_size.z, 1e-6)
        if category in LOWER_GARMENTS:
            x_limit = (0.88, 1.22)
            y_limit = (0.82, 1.28)
        elif category in UPPER_GARMENTS:
            x_limit = (0.72, 1.75)
            y_limit = (0.75, 1.55)
        else:
            x_limit = (0.78, 1.45)
            y_limit = (0.75, 1.55)
        x_fix = max(x_limit[0], min(desired.x / max(source_size.x * uniform, 1e-6), x_limit[1]))
        y_fix = max(y_limit[0], min(desired.y / max(source_size.y * uniform, 1e-6), y_limit[1]))
        garment.scale = Vector((uniform * x_fix, uniform * y_fix, uniform))

    bpy.context.view_layer.update()
    current_min, current_max = bbox_world(garment)
    current_center = (current_min + current_max) * 0.5
    target_center = (target_min + target_max) * 0.5
    if category in UPPER_GARMENTS | LOWER_GARMENTS:
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
    bpy.context.view_layer.update()
    select_only(garment)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return target_min, target_max


def clamp_number(value, minimum, maximum, fallback):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return max(minimum, min(maximum, number))


def apply_preview_adjustments(garment, preview_settings, avatar_height):
    if not isinstance(preview_settings, dict):
        return
    adjustments = preview_settings.get("adjustments")
    if not isinstance(adjustments, dict):
        adjustments = {}

    fit = str(preview_settings.get("fit") or "Regular")
    fit_scale = 0.92 if fit == "Slim" else 1.10 if fit == "Oversize" else 1.0
    user_scale = clamp_number(adjustments.get("scale"), 25, 300, 100) / 100.0
    width = clamp_number(adjustments.get("width"), 35, 240, 100) / 100.0
    length = clamp_number(adjustments.get("length"), 35, 240, 100) / 100.0
    depth = clamp_number(1 + clamp_number(adjustments.get("distance"), -40, 60, 8) / 100.0, 0.5, 1.8, 1.08)
    x = clamp_number(adjustments.get("x"), -150, 150, 0) / 100.0 * avatar_height
    vertical = (
        clamp_number(adjustments.get("y"), -150, 150, 0)
        + clamp_number(adjustments.get("height"), -100, 100, 0)
    ) / 100.0 * avatar_height
    rotation = clamp_number(adjustments.get("rotation"), -180, 180, 0)

    garment.scale.x *= user_scale * fit_scale * width
    garment.scale.y *= user_scale * fit_scale * depth
    garment.scale.z *= user_scale * length
    garment.location.x += x
    garment.location.z += vertical
    garment.rotation_euler.z += radians(rotation)
    bpy.context.view_layer.update()
    select_only(garment)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    print(f"[rig-v4] preview fit={fit} scale={user_scale:.3f}", flush=True)


def build_weight_kdtree(body_meshes, armature):
    bone_names = {bone.name for bone in armature.data.bones}
    total = sum(len(obj.data.vertices) for obj in body_meshes)
    kd = KDTree(total)
    records = []
    index = 0
    for obj in body_meshes:
        names = {group.index: group.name for group in obj.vertex_groups if group.name in bone_names}
        for vertex in obj.data.vertices:
            memberships = [
                (names[membership.group], membership.weight)
                for membership in vertex.groups
                if membership.group in names and membership.weight > 0.0001
            ]
            kd.insert(obj.matrix_world @ vertex.co, index)
            records.append(memberships)
            index += 1
    kd.balance()
    return kd, records


def canonical_bone_names(armature, canonicals):
    names = set()
    for canonical in canonicals:
        bone = resolve_bone(armature, canonical)
        if bone is not None:
            names.add(bone.name)
    return names


def choose_leg_side(world, marks):
    left_distance = abs(world.x - marks["left_up"].x)
    right_distance = abs(world.x - marks["right_up"].x)
    return "left" if left_distance <= right_distance else "right"


def filter_influences(blended, armature, category, world):
    if category in LOWER_GARMENTS:
        marks = lower_landmarks(armature)
        side = choose_leg_side(world, marks)
        center_names = canonical_bone_names(armature, {"hips", "spine"})
        left_names = canonical_bone_names(armature, {"left_up_leg", "left_leg", "left_foot", "left_toe"})
        right_names = canonical_bone_names(armature, {"right_up_leg", "right_leg", "right_foot", "right_toe"})
        allowed = center_names | (left_names if side == "left" else right_names)
        filtered = {name: value for name, value in blended.items() if name in allowed}
        if filtered:
            return filtered, side
        fallback = resolve_bone(armature, f"{side}_up_leg") or resolve_bone(armature, "hips")
        return ({fallback.name: 1.0} if fallback else {}), side

    if category == "shoes":
        marks = lower_landmarks(armature)
        side = choose_leg_side(world, marks)
        names = canonical_bone_names(armature, {f"{side}_foot", f"{side}_toe"})
        filtered = {name: value for name, value in blended.items() if name in names}
        if filtered:
            return filtered, side
        fallback = resolve_bone(armature, f"{side}_foot")
        return ({fallback.name: 1.0} if fallback else {}), side

    if category in UPPER_GARMENTS:
        allowed = canonical_bone_names(armature, {
            "hips", "spine", "chest", "neck",
            "left_shoulder", "right_shoulder",
            "left_upper_arm", "right_upper_arm",
            "left_lower_arm", "right_lower_arm",
            "left_hand", "right_hand",
        })
        filtered = {name: value for name, value in blended.items() if name in allowed}
        return filtered or blended, None

    return blended, None


def copy_weights(body_meshes, garment, armature, category):
    garment.vertex_groups.clear()
    kd, records = build_weight_kdtree(body_meshes, armature)
    destination = {}
    fallback_canonical = "hips" if category in LOWER_GARMENTS | {"shoes"} else "chest"
    fallback_bone = resolve_bone(armature, fallback_canonical) or resolve_bone(armature, "hips")
    if fallback_bone is None:
        raise RuntimeError("Avatar rig has no fallback body bone")

    side_counts = {"left": 0, "right": 0}
    for vertex in garment.data.vertices:
        world = garment.matrix_world @ vertex.co
        blended = {}
        denominator = 0.0
        for _position, record_index, distance in kd.find_n(world, 16):
            factor = 1.0 / max(distance, 1e-5) ** 2
            denominator += factor
            for name, weight in records[record_index]:
                blended[name] = blended.get(name, 0.0) + weight * factor

        normalized = (
            {name: value / denominator for name, value in blended.items()}
            if denominator and blended
            else {fallback_bone.name: 1.0}
        )
        filtered, side = filter_influences(normalized, armature, category, world)
        if side:
            side_counts[side] += 1
        influences = sorted(filtered.items(), key=lambda item: item[1], reverse=True)[:4]
        total = sum(value for _, value in influences) or 1.0
        for name, value in influences:
            group = destination.get(name)
            if group is None:
                group = garment.vertex_groups.new(name=name)
                destination[name] = group
            group.add([vertex.index], value / total, "REPLACE")

    print(
        f"[rig-v4] transferred groups={len(destination)} vertices={len(garment.data.vertices)} sides={side_counts}",
        flush=True,
    )


def ensure_uv_map(obj):
    if obj.data.uv_layers:
        return
    select_only(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=1.15192, island_margin=0.02, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode="OBJECT")


def hex_to_rgba(value):
    value = (value or "#0a0a0a").strip().lstrip("#")
    if len(value) != 6:
        value = "0a0a0a"
    return tuple(int(value[i:i + 2], 16) / 255.0 for i in (0, 2, 4)) + (1.0,)


def apply_material(garment, art_path, color):
    if not (art_path and os.path.exists(art_path)) and not str(color or "").strip():
        print("[rig-v4] preserving original materials", flush=True)
        return
    ensure_uv_map(garment)
    material = bpy.data.materials.new(name="CLOUVA_Garment_Material")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Roughness"].default_value = 0.72
    base = nodes.new("ShaderNodeRGB")
    base.outputs[0].default_value = hex_to_rgba(color)
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    if art_path and os.path.exists(art_path):
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = bpy.data.images.load(art_path, check_existing=False)
        mix = nodes.new("ShaderNodeMixRGB")
        links.new(texture.outputs["Alpha"], mix.inputs["Fac"])
        links.new(base.outputs["Color"], mix.inputs[1])
        links.new(texture.outputs["Color"], mix.inputs[2])
        links.new(mix.outputs["Color"], shader.inputs["Base Color"])
    else:
        links.new(base.outputs["Color"], shader.inputs["Base Color"])
    garment.data.materials.clear()
    garment.data.materials.append(material)


def assign_rigid_bone_weights(garment, armature, canonical):
    bone = resolve_bone(armature, canonical)
    if bone is None:
        raise RuntimeError(f"Avatar rig is missing required {canonical} bone")
    garment.vertex_groups.clear()
    group = garment.vertex_groups.new(name=bone.name)
    group.add(list(range(len(garment.data.vertices))), 1.0, "REPLACE")


def attach_armature(garment, armature):
    for modifier in list(garment.modifiers):
        if modifier.type == "ARMATURE":
            garment.modifiers.remove(modifier)
    modifier = garment.modifiers.new(name="CLOUVA Armature", type="ARMATURE")
    modifier.object = armature
    world = garment.matrix_world.copy()
    garment.parent = armature
    garment.matrix_parent_inverse = armature.matrix_world.inverted()
    garment.matrix_world = world
    bpy.context.view_layer.update()


def group_vertex_count(garment, group_names, threshold=0.05):
    indices = {group.index for group in garment.vertex_groups if group.name in group_names}
    if not indices:
        return 0
    count = 0
    for vertex in garment.data.vertices:
        total = sum(membership.weight for membership in vertex.groups if membership.group in indices)
        if total >= threshold:
            count += 1
    return count


def validate_upper_weights(garment, armature):
    left_names = canonical_bone_names(armature, {"left_shoulder", "left_upper_arm", "left_lower_arm", "left_hand"})
    right_names = canonical_bone_names(armature, {"right_shoulder", "right_upper_arm", "right_lower_arm", "right_hand"})
    if not left_names or not right_names:
        raise RuntimeError("Avatar rig is missing arm bones required for sleeves")
    minimum = max(8, int(len(garment.data.vertices) * 0.008))
    left_count = group_vertex_count(garment, left_names)
    right_count = group_vertex_count(garment, right_names)
    if left_count < minimum or right_count < minimum:
        raise RuntimeError(
            f"Sleeve weight validation failed: left={left_count}, right={right_count}, minimum={minimum}"
        )
    return {"leftWeighted": left_count, "rightWeighted": right_count}


def validate_lower_geometry_and_weights(garment, armature, category):
    marks = lower_landmarks(armature)
    garment_min, garment_max = bbox_world(garment)
    waist_z = marks["waist"].z
    feet_z = min(marks["left_foot"].z, marks["right_foot"].z)
    knees_z = min(marks["left_knee"].z, marks["right_knee"].z)
    leg_length = max(waist_z - feet_z, 1e-6)

    waist_error = abs(garment_max.z - waist_z) / leg_length
    center_z = (garment_min.z + garment_max.z) * 0.5
    if waist_error > 0.16:
        raise RuntimeError(
            f"Waist alignment failed: garment_top={garment_max.z:.4f}, hips={waist_z:.4f}, error={waist_error:.3f}"
        )
    if center_z >= waist_z - leg_length * 0.12:
        raise RuntimeError("Lower garment is centered above the legs instead of around them")
    if category == "pants" and garment_min.z > knees_z + leg_length * 0.08:
        raise RuntimeError(
            f"Pants end above the knees: garment_bottom={garment_min.z:.4f}, knees={knees_z:.4f}"
        )

    garment_center_x = (garment_min.x + garment_max.x) * 0.5
    legs_center_x = (marks["left_up"].x + marks["right_up"].x) * 0.5
    hip_span = max(abs(marks["left_up"].x - marks["right_up"].x), leg_length * 0.08)
    if abs(garment_center_x - legs_center_x) > hip_span * 0.55:
        raise RuntimeError("Lower garment is horizontally displaced from the avatar hips")

    margin = hip_span * 0.35
    for label, point in (("left", marks["left_up"]), ("right", marks["right_up"])):
        if not (garment_min.x - margin <= point.x <= garment_max.x + margin):
            raise RuntimeError(f"{label} thigh is outside the garment bounds")

    left_names = canonical_bone_names(armature, {"left_up_leg", "left_leg", "left_foot", "left_toe"})
    right_names = canonical_bone_names(armature, {"right_up_leg", "right_leg", "right_foot", "right_toe"})
    minimum = max(12, int(len(garment.data.vertices) * 0.02))
    left_count = group_vertex_count(garment, left_names)
    right_count = group_vertex_count(garment, right_names)
    if left_count < minimum or right_count < minimum:
        raise RuntimeError(
            f"Leg weight validation failed: left={left_count}, right={right_count}, minimum={minimum}"
        )

    return {
        "waistError": round(waist_error, 4),
        "leftWeighted": left_count,
        "rightWeighted": right_count,
        "garmentTop": round(garment_max.z, 5),
        "hipsZ": round(waist_z, 5),
        "garmentBottom": round(garment_min.z, 5),
        "kneesZ": round(knees_z, 5),
    }


def validate(garment, armature, target_min, target_max, category):
    count = len(garment.data.vertices)
    if count < 50:
        raise RuntimeError("Garment mesh is too small")
    weighted = sum(1 for vertex in garment.data.vertices if vertex.groups)
    if weighted / max(count, 1) < 0.995:
        raise RuntimeError(f"Only {weighted}/{count} vertices received weights")
    if garment.find_armature() != armature:
        raise RuntimeError("Garment is not connected to official armature")

    metrics = {"weightedRatio": round(weighted / max(count, 1), 4)}
    if category in UPPER_GARMENTS:
        metrics.update(validate_upper_weights(garment, armature))
    elif category in LOWER_GARMENTS:
        metrics.update(validate_lower_geometry_and_weights(garment, armature, category))

    garment_min, garment_max = bbox_world(garment)
    target_size = target_max - target_min
    garment_size = garment_max - garment_min
    ratios = Vector((
        garment_size.x / max(target_size.x, 1e-6),
        garment_size.y / max(target_size.y, 1e-6),
        garment_size.z / max(target_size.z, 1e-6),
    ))
    if ratios.x > 2.3 or ratios.y > 2.2 or ratios.z > 1.8:
        raise RuntimeError(f"Garment outside safe bounds: {tuple(round(v, 3) for v in ratios)}")

    garment["clouvaRigVersion"] = 4
    garment["clouvaValidation"] = "passed"
    garment["clouvaCategory"] = category
    garment["clouvaMetrics"] = json.dumps(metrics, separators=(",", ":"))
    print(f"[rig-v4] validation passed {metrics}", flush=True)


def export_glb(output_path, garment, armature):
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    garment.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_animations=True,
        export_skins=True,
        export_all_influences=False,
        export_materials="EXPORT",
        export_extras=True,
    )


def validate_roundtrip(output_path):
    if not os.path.exists(output_path) or os.path.getsize(output_path) < 1024:
        raise RuntimeError("Exported GLB is missing or empty")
    with tempfile.TemporaryDirectory(prefix="clouva-validate-"):
        clear_scene()
        imported = import_glb(output_path)
        armatures = [obj for obj in imported if obj.type == "ARMATURE"]
        skinned = [obj for obj in imported if obj.type == "MESH" and obj.find_armature()]
        if len(armatures) != 1 or not skinned:
            raise RuntimeError("Exported GLB is not a valid single-rig wearable")
        garment = max(skinned, key=lambda obj: len(obj.data.vertices))
        if int(garment.get("clouvaRigVersion", 0)) != 4:
            raise RuntimeError("Exported GLB lost CLOUVA rig validation metadata")
        print(
            f"[rig-v4] roundtrip ok meshes={len(skinned)} vertices={sum(len(obj.data.vertices) for obj in skinned)}",
            flush=True,
        )


def main():
    avatar_path, garment_path, output_path, category, art_path, color, preview_settings = args()
    if category not in VALID_CATEGORIES:
        raise RuntimeError(f"Invalid category: {category}")

    clear_scene()
    avatar_objects = import_glb(avatar_path)
    armature = find_armature(avatar_objects)
    body_meshes = body_meshes_for_rig(avatar_objects, armature)
    body_min, body_max = combined_bbox(body_meshes)
    avatar_height = max(body_max.z - body_min.z, 1e-6)

    garment_objects = import_glb(garment_path)
    garment = prepare_garment(garment_objects, category)
    target_min, target_max = fit_to_body(garment, body_meshes, armature, category)
    apply_preview_adjustments(garment, preview_settings, avatar_height)

    if category == "hat":
        assign_rigid_bone_weights(garment, armature, "head")
    elif category == "accessory":
        assign_rigid_bone_weights(garment, armature, "chest")
    else:
        copy_weights(body_meshes, garment, armature, category)

    apply_material(garment, art_path, color)
    attach_armature(garment, armature)
    validate(garment, armature, target_min, target_max, category)
    export_glb(output_path, garment, armature)
    validate_roundtrip(output_path)


if __name__ == "__main__":
    main()
