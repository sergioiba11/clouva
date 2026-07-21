import sys
from pathlib import Path

import bpy
from mathutils import Vector

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import complete_avatar_rig_v6 as v6

v5 = v6.v5
VERSION = "clouva-complete-rig-v7-neutral-palm-roots"
PALM_ROOT_PREFIX = "clouva_palm_root_"


def set_no_inherited_scale(edit_bone):
    try:
        edit_bone.inherit_scale = "NONE"
    except (AttributeError, TypeError, ValueError):
        pass


def is_extended_bone(name):
    lowered = name.lower()
    return v5.is_generated(lowered) or lowered.startswith(PALM_ROOT_PREFIX)


def inside_bounds(point, minimum, maximum, padding):
    return all(
        float(minimum[index]) - padding <= float(point[index]) <= float(maximum[index]) + padding
        for index in range(3)
    )


def validate_geometry_v7(armature, report, roundtrip=False):
    result = v6.validate_geometry_v6(armature, report, roundtrip=roundtrip)
    minimum, maximum, size = report["bounds"]
    height = max(float(size.z), 0.5)
    padding = height * 0.10
    errors = list(result.get("errors") or [])
    maximum_root_length = 0.0

    for side in ("l", "r"):
        name = f"{PALM_ROOT_PREFIX}{side}"
        bone = armature.data.bones.get(name)
        if bone is None:
            errors.append(f"missing:{name}")
            continue

        head = armature.matrix_world @ bone.head_local
        tail = armature.matrix_world @ bone.tail_local
        length = (tail - head).length
        maximum_root_length = max(maximum_root_length, length)
        if not height * 0.003 <= length <= height * 0.025:
            errors.append(f"invalid-length:{name}:{length:.6f}")
        if not inside_bounds(head, minimum, maximum, padding):
            errors.append(f"outside-avatar:{name}:head")
        if not inside_bounds(tail, minimum, maximum, padding):
            errors.append(f"outside-avatar:{name}:tail")
        if bone.parent is None:
            errors.append(f"missing-parent:{name}")
        elif not roundtrip and getattr(bone, "inherit_scale", "NONE") not in {"NONE", "NONE_LEGACY"}:
            errors.append(f"inherits-scale:{name}:{getattr(bone, 'inherit_scale', 'unknown')}")

    result["valid"] = not errors
    result["errors"] = errors
    result["maximumPalmRootLength"] = maximum_root_length
    result["space"] = "neutral-palm-root-no-inherited-scale"
    return result


def ensure_extended_bones_v7(armature, meshes):
    minimum, maximum, size = v5.legacy.world_bounds(meshes)
    height = max(float(size.z), 0.5)
    center = (minimum + maximum) * 0.5
    hands = {"l": v5.choose_hand(armature, "l"), "r": v5.choose_hand(armature, "r")}
    head = v5.legacy.head_bone(armature)
    if not hands["l"] or not hands["r"]:
        raise RuntimeError("Could not locate both real hand bones for finger rigging")
    if not head:
        raise RuntimeError("Could not locate the anatomical head bone for ear rigging")

    hand_names = {side: bone.name for side, bone in hands.items()}
    head_name = head.name
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bones = armature.data.edit_bones

    for bone in list(bones):
        if is_extended_bone(bone.name):
            bones.remove(bone)

    left = bones.get(hand_names["l"])
    right = bones.get(hand_names["r"])
    head_bone = bones.get(head_name)
    if not left or not right or not head_bone:
        raise RuntimeError("Source bones disappeared while rebuilding the extended rig")

    left_head_world = v5.world_point(armature, left.head)
    right_head_world = v5.world_point(armature, right.head)
    lateral = left_head_world - right_head_world
    lateral.z = 0.0
    lateral = v5.unit(lateral, (1.0, 0.0, 0.0))
    vertical = Vector((0.0, 0.0, 1.0))
    palm_length = v5.clamp(height * 0.026, height * 0.018, height * 0.034)
    root_length = v5.clamp(height * 0.007, height * 0.0045, height * 0.010)
    segment_length = v5.clamp(height * 0.0115, height * 0.0075, height * 0.015)
    spread_step = height * 0.0032
    fan = {
        "thumb": -0.34,
        "index": -0.15,
        "middle": 0.0,
        "ring": 0.15,
        "pinky": 0.30,
    }
    spread_index = {
        "thumb": -1.6,
        "index": -0.8,
        "middle": 0.0,
        "ring": 0.8,
        "pinky": 1.6,
    }
    added = []
    finger_names = []
    palm_root_names = []

    for side, source_name in hand_names.items():
        source = bones[source_name]
        side_sign = 1.0 if side == "l" else -1.0
        outward = lateral * side_sign
        wrist_world = v5.world_point(armature, source.head)
        palm_center = wrist_world + outward * palm_length
        spread_axis = v5.unit(vertical.cross(outward), (0.0, 1.0, 0.0))

        palm_root_name = f"{PALM_ROOT_PREFIX}{side}"
        palm_root = bones.new(palm_root_name)
        palm_root.parent = source
        palm_root.use_connect = False
        palm_root.use_deform = False
        palm_root_head = wrist_world + outward * palm_length * 0.42
        palm_root.head = v5.local_point(armature, palm_root_head)
        palm_root.tail = v5.local_point(armature, palm_root_head + outward * root_length)
        palm_root.roll = 0.0
        set_no_inherited_scale(palm_root)
        added.append(palm_root_name)
        palm_root_names.append(palm_root_name)

        for finger in v5.legacy.FINGER_NAMES:
            previous = palm_root
            direction = v5.unit(outward + spread_axis * fan[finger], outward)
            root = palm_center + spread_axis * spread_index[finger] * spread_step
            if finger == "thumb":
                root = wrist_world + outward * palm_length * 0.62 + spread_axis * spread_index[finger] * spread_step
                direction = v5.unit(direction - vertical * 0.24, direction)

            for segment in range(1, v5.legacy.SEGMENTS + 1):
                name = f"clouva_{finger}_{segment:02d}_{side}"
                bone = bones.new(name)
                bone.parent = previous
                if segment == 1:
                    bone.use_connect = False
                    bone.head = v5.local_point(armature, root)
                else:
                    bone.use_connect = True
                    bone.head = previous.tail.copy()
                head_world = v5.world_point(armature, bone.head)
                tail_world = head_world + direction * segment_length * (1.0 - (segment - 1) * 0.12)
                bone.tail = v5.local_point(armature, tail_world)
                bone.use_deform = True
                bone.roll = 0.0
                set_no_inherited_scale(bone)
                added.append(name)
                finger_names.append(name)
                previous = bone

    head_joint_world = v5.world_point(armature, head_bone.head)
    head_center = Vector((center.x, center.y, minimum.z + height * 0.875))
    if (head_center - head_joint_world).length > height * 0.16:
        head_center = head_joint_world + vertical * height * 0.055
    ear_span = v5.clamp(height * 0.040, height * 0.030, height * 0.050)
    ear_length = v5.clamp(height * 0.010, height * 0.007, height * 0.014)
    ear_names = []
    for side in ("l", "r"):
        sign = 1.0 if side == "l" else -1.0
        name = f"clouva_ear_{side}"
        bone = bones.new(name)
        bone.parent = head_bone
        bone.use_connect = False
        ear_root = head_center + lateral * sign * ear_span
        bone.head = v5.local_point(armature, ear_root)
        bone.tail = v5.local_point(armature, ear_root + vertical * ear_length)
        bone.use_deform = True
        bone.roll = 0.0
        set_no_inherited_scale(bone)
        added.append(name)
        ear_names.append(name)

    bpy.ops.object.mode_set(mode="OBJECT")
    for name in palm_root_names + finger_names + ear_names:
        data_bone = armature.data.bones.get(name)
        if data_bone is not None:
            try:
                data_bone.inherit_scale = "NONE"
            except (AttributeError, TypeError, ValueError):
                pass
    bpy.context.view_layer.update()

    report = {
        "added": added,
        "fingerNames": finger_names,
        "earNames": ear_names,
        "palmRootNames": palm_root_names,
        "handSources": hand_names,
        "headSource": head_name,
        "bounds": (minimum, maximum, size),
    }
    report["geometry"] = validate_geometry_v7(armature, report)
    return report


v5.VERSION = VERSION
v5.ensure_extended_bones = ensure_extended_bones_v7
v5.validate_geometry = validate_geometry_v7
v5.legacy.ensure_extended_bones = ensure_extended_bones_v7

if __name__ == "__main__":
    v5.legacy.main()
