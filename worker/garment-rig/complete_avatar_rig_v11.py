import sys
from pathlib import Path

import bpy
from mathutils import Vector

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import complete_avatar_rig_v10 as v10

v5 = v10.v5
VERSION = "clouva-complete-rig-v11-head-midpoint-ears"


def recenter_ears_on_head(armature, meshes, report):
    minimum, maximum, size = report["bounds"]
    height = max(float(size.z), 0.5)
    head = v5.legacy.head_bone(armature)
    left_hand = v5.choose_hand(armature, "l")
    right_hand = v5.choose_hand(armature, "r")
    if not head or not left_hand or not right_hand:
        raise RuntimeError("Could not resolve head and both hands while centering ears")

    head_name = head.name
    left_hand_name = left_hand.name
    right_hand_name = right_hand.name
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    if armature.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.mode_set(mode="EDIT")
    bones = armature.data.edit_bones
    head_edit = bones.get(head_name)
    left = bones.get(left_hand_name)
    right = bones.get(right_hand_name)
    left_ear = bones.get("clouva_ear_l")
    right_ear = bones.get("clouva_ear_r")
    if not head_edit or not left or not right or not left_ear or not right_ear:
        bpy.ops.object.mode_set(mode="OBJECT")
        raise RuntimeError("Generated ear bones or anatomical source bones are missing")

    vertical = Vector((0.0, 0.0, 1.0))
    head_start = v10.world_point(armature, head_edit.head)
    head_end = v10.world_point(armature, head_edit.tail)
    head_axis = head_end - head_start
    if head_axis.length < height * 0.045 or head_axis.length > height * 0.26:
        head_axis = vertical * height * 0.14
    elif head_axis.dot(vertical) < 0.0:
        head_axis.negate()

    head_center = head_start + head_axis * 0.48
    head_center.z = v10.clamp(
        float(head_center.z),
        float(minimum.z) + height * 0.72,
        float(minimum.z) + height * 0.94,
    )

    left_wrist = v10.world_point(armature, left.head)
    right_wrist = v10.world_point(armature, right.head)
    lateral = v10.unit(left_wrist - right_wrist, (1.0, 0.0, 0.0))
    depth = v10.unit(vertical.cross(lateral), (0.0, 1.0, 0.0))
    head_half_width = v10.estimate_head_half_width(meshes, head_center, lateral, depth, height)
    ear_span = v10.clamp(head_half_width * 0.94, height * 0.034, height * 0.105)
    ear_length = v10.clamp(height * 0.011, height * 0.007, height * 0.015)

    for side, ear in (("l", left_ear), ("r", right_ear)):
        sign = 1.0 if side == "l" else -1.0
        root = head_center + lateral * sign * ear_span
        ear.head = v10.local_point(armature, root)
        ear.tail = v10.local_point(armature, root + lateral * sign * ear_length)
        ear.parent = head_edit
        ear.use_connect = False
        ear.use_deform = True
        ear.roll = 0.0
        v10.set_no_inherited_scale(ear)

    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()
    report["earPlacement"] = "anatomical-head-bone-midpoint"
    report["headCenterWorld"] = [float(value) for value in head_center]
    return report


def _cap_lateral(direction, lateral, maximum=0.58):
    direction = v10.unit(direction, (0.0, 0.0, -1.0))
    component = float(direction.dot(lateral))
    if abs(component) <= maximum:
        return direction
    capped = maximum if component > 0.0 else -maximum
    direction = direction - lateral * (component - capped)
    return v10.unit(direction, (0.0, 0.0, -1.0))


def repair_thumb_axes(armature, report):
    """Keep generated thumbs inside the validated hand-forward cone.

    The repair changes only thumb directions. It preserves the detected root,
    every segment length, parenting and deform flags, so subsequent automatic
    weights still use the same anatomical chain.
    """
    hand_names = report.get("handSources") or {}
    left_name = hand_names.get("l")
    right_name = hand_names.get("r")
    if not left_name or not right_name:
        return {"applied": False, "reason": "hand-sources-missing", "sides": {}}

    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    if armature.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.mode_set(mode="EDIT")
    bones = armature.data.edit_bones
    left_hand = bones.get(left_name)
    right_hand = bones.get(right_name)
    if left_hand is None or right_hand is None:
        bpy.ops.object.mode_set(mode="OBJECT")
        return {"applied": False, "reason": "hand-bones-missing", "sides": {}}

    left_wrist = v10.world_point(armature, left_hand.head)
    right_wrist = v10.world_point(armature, right_hand.head)
    lateral = v10.unit(left_wrist - right_wrist, (1.0, 0.0, 0.0))
    vertical = Vector((0.0, 0.0, 1.0))
    depth = v10.unit(vertical.cross(lateral), (0.0, 1.0, 0.0))
    inverse = armature.matrix_world.inverted_safe()
    sides = {}

    for side, hand in (("l", left_hand), ("r", right_hand)):
        chain = [bones.get(f"clouva_thumb_{index:02d}_{side}") for index in range(1, 4)]
        if any(item is None for item in chain):
            sides[side] = {"applied": False, "reason": "thumb-chain-missing"}
            continue

        wrist = v10.world_point(armature, hand.head)
        own = v10.world_point(armature, hand.tail) - wrist
        continuation = own.copy()
        if hand.parent is not None:
            continuation = wrist - v10.world_point(armature, hand.parent.head)
        if continuation.length <= 1e-7:
            continuation = own
        continuation = v10.unit(continuation, (0.0, 0.0, -1.0))

        root = v10.world_point(armature, chain[0].head)
        existing = v10.world_point(armature, chain[-1].tail) - root
        existing = v10.unit(existing, continuation)
        before = abs(float(existing.dot(lateral)))
        if before <= 0.68:
            sides[side] = {"applied": False, "before": before, "after": before}
            continue

        non_lateral = continuation - lateral * float(continuation.dot(lateral))
        if non_lateral.length <= 1e-7:
            non_lateral = depth.copy()
            if non_lateral.dot(existing) < 0.0:
                non_lateral.negate()
        non_lateral.normalize()
        if non_lateral.dot(continuation) < 0.0:
            non_lateral.negate()

        lateral_sign = 1.0 if existing.dot(lateral) >= 0.0 else -1.0
        depth_axis = depth.copy()
        if depth_axis.dot(existing) < 0.0:
            depth_axis.negate()
        target = v10.unit(
            non_lateral * 0.86 + lateral * lateral_sign * 0.30 + depth_axis * 0.16,
            non_lateral,
        )
        target = _cap_lateral(target, lateral)
        if target.dot(continuation) < 0.30:
            target = _cap_lateral(v10.unit(target * 0.72 + continuation * 0.28, target), lateral)

        cursor = root.copy()
        lengths = []
        for index, bone in enumerate(chain):
            length = (v10.world_point(armature, bone.tail) - v10.world_point(armature, bone.head)).length
            lengths.append(float(length))
            bone.head = inverse @ cursor
            cursor = cursor + target * length
            bone.tail = inverse @ cursor
            bone.use_connect = index > 0
            bone.use_deform = True
            bone.roll = 0.0
            v10.set_no_inherited_scale(bone)

        after = abs(float(target.dot(lateral)))
        sides[side] = {
            "applied": True,
            "before": before,
            "after": after,
            "handAlignment": float(target.dot(continuation)),
            "segmentLengths": lengths,
        }

    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()
    applied = any(item.get("applied") for item in sides.values())
    report["thumbAxisRepair"] = {"method": "hand-forward-cone-v17", "applied": applied, "sides": sides}
    return report["thumbAxisRepair"]


def validate_geometry_v11(armature, report, roundtrip=False):
    repair = repair_thumb_axes(armature, report)
    result = v10.validate_geometry_v10(armature, report, roundtrip=roundtrip)
    result["version"] = VERSION
    result["earPlacement"] = "anatomical-head-bone-midpoint"
    result["thumbAxisRepair"] = repair
    return result


def ensure_extended_bones_v11(armature, meshes):
    report = v10.ensure_extended_bones_v10(armature, meshes)
    recenter_ears_on_head(armature, meshes, report)
    report["geometry"] = validate_geometry_v11(armature, report, roundtrip=False)
    return report


_original_validate_profile = v10._original_validate_profile


def validate_profile_v11(armature, report, finger_weighted, ear_weighted, fallback):
    profile = _original_validate_profile(armature, report, finger_weighted, ear_weighted, fallback)
    geometry = report.get("geometry") or validate_geometry_v11(armature, report, roundtrip=False)
    profile["version"] = VERSION
    profile["normalization"] = report.get("normalization")
    profile["geometry"] = geometry
    profile["fingerAxis"] = report.get("fingerAxis")
    profile["earPlacement"] = report.get("earPlacement")
    profile["complete"] = bool(profile.get("complete") and geometry.get("valid"))
    return profile


v5.VERSION = VERSION
v5.ensure_extended_bones = ensure_extended_bones_v11
v5.validate_geometry = validate_geometry_v11
v5.validate_profile = validate_profile_v11
v5.legacy.ensure_extended_bones = ensure_extended_bones_v11
v5.legacy.validate_geometry = validate_geometry_v11
v5.legacy.validate_profile = validate_profile_v11

if __name__ == "__main__":
    v5.legacy.main()
