import bpy
from mathutils import Vector

import complete_avatar_rig as legacy

VERSION = "clouva-complete-rig-v3-world-space"
PREFIXES = tuple(f"clouva_{name}_" for name in legacy.FINGER_NAMES) + ("clouva_ear_",)


def is_generated(name):
    return any(name.lower().startswith(prefix) for prefix in PREFIXES)


def unit(value, fallback):
    result = Vector(value)
    if result.length <= 1e-6:
        result = Vector(fallback)
    result.normalize()
    return result


def clamp(value, low, high):
    return max(low, min(high, value))


def world_points(armature, bone):
    return armature.matrix_world @ bone.head, armature.matrix_world @ bone.tail


def set_world_points(armature, bone, head, tail):
    inverse = armature.matrix_world.inverted_safe()
    local_head = inverse @ Vector(head)
    local_tail = inverse @ Vector(tail)
    if (local_tail - local_head).length <= 1e-7:
        raise RuntimeError(f"Generated bone has zero length: {bone.name}")
    bone.head = local_head
    bone.tail = local_tail


def choose_hand(armature, side):
    signed = 1.0 if side == "l" else -1.0
    candidates = []
    for bone in armature.data.bones:
        if is_generated(bone.name):
            continue
        detected_side = legacy.side_from_name(bone.name)
        if detected_side and detected_side != side:
            continue
        key = legacy.clean_name(bone.name)
        if not any(token in key for token in ("hand", "wrist", "forearm", "lowerarm")):
            continue
        score = signed * max(float(bone.head_local.x), float(bone.tail_local.x))
        if "hand" in key and not any(finger in key for finger in legacy.FINGER_NAMES):
            score += 1000.0
        elif "wrist" in key:
            score += 500.0
        candidates.append((score, bone))
    if candidates:
        return max(candidates, key=lambda item: item[0])[1]
    return legacy.hand_bone(armature, side)


def distal_endpoint(first, second, center, lateral, side_sign):
    first_score = side_sign * (first - center).dot(lateral)
    second_score = side_sign * (second - center).dot(lateral)
    return (first, second) if second_score >= first_score else (second, first)


def validate_geometry(armature, report):
    minimum, maximum, size = report["bounds"]
    height = max(float(size.z), 0.5)
    padding = height * 0.10
    errors = []
    maximum_length = 0.0
    for name in report["fingerNames"] + report["earNames"]:
        bone = armature.data.bones.get(name)
        if bone is None:
            errors.append(f"missing:{name}")
            continue
        head = armature.matrix_world @ bone.head_local
        tail = armature.matrix_world @ bone.tail_local
        length = (tail - head).length
        maximum_length = max(maximum_length, length)
        minimum_length = height * (0.005 if name.startswith("clouva_ear_") else 0.006)
        if not minimum_length <= length <= height * 0.030:
            errors.append(f"invalid-length:{name}:{length:.6f}")
        for label, point in (("head", head), ("tail", tail)):
            if any(float(point[index]) < float(minimum[index]) - padding or float(point[index]) > float(maximum[index]) + padding for index in range(3)):
                errors.append(f"outside-avatar:{name}:{label}")
    return {
        "valid": not errors,
        "errors": errors,
        "avatarHeight": height,
        "maximumSegmentLength": maximum_length,
        "space": "world-to-armature-local",
    }


def ensure_extended_bones(armature, meshes):
    minimum, maximum, size = legacy.world_bounds(meshes)
    height = max(float(size.z), 0.5)
    center = (minimum + maximum) * 0.5
    hands = {"l": choose_hand(armature, "l"), "r": choose_hand(armature, "r")}
    head = legacy.head_bone(armature)
    if not hands["l"] or not hands["r"]:
        raise RuntimeError("Could not locate both real hand bones for finger rigging")
    if not head:
        raise RuntimeError("Could not locate the head bone for ear rigging")

    hand_names = {side: bone.name for side, bone in hands.items()}
    head_name = head.name
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bones = armature.data.edit_bones

    for bone in list(bones):
        if is_generated(bone.name):
            bones.remove(bone)

    left = bones.get(hand_names["l"])
    right = bones.get(hand_names["r"])
    head_bone = bones.get(head_name)
    if not left or not right or not head_bone:
        raise RuntimeError("Source bones disappeared while rebuilding the extended rig")

    left_points = world_points(armature, left)
    right_points = world_points(armature, right)
    lateral = ((left_points[0] + left_points[1]) - (right_points[0] + right_points[1])) * 0.5
    lateral.z = 0.0
    lateral = unit(lateral, (1.0, 0.0, 0.0))
    vertical = Vector((0.0, 0.0, 1.0))
    segment_length = clamp(height * 0.0145, height * 0.010, height * 0.020)
    spread_step = height * 0.0034
    spread = {"thumb": -2.0, "index": -1.0, "middle": 0.0, "ring": 1.0, "pinky": 2.0}
    added = []
    finger_names = []

    for side, source_name in hand_names.items():
        source = bones[source_name]
        side_sign = 1.0 if side == "l" else -1.0
        source_head, source_tail = world_points(armature, source)
        wrist, palm = distal_endpoint(source_head, source_tail, center, lateral, side_sign)
        outward = lateral * side_sign
        direction = unit(palm - wrist, outward)
        if direction.dot(outward) < 0.08:
            direction = unit(direction + outward * 0.85, outward)
        spread_axis = unit(vertical.cross(direction), (0.0, 1.0, 0.0))
        palm_normal = unit(direction.cross(spread_axis), vertical)

        for finger in legacy.FINGER_NAMES:
            previous = source
            direction_for_finger = direction.copy()
            offset = spread_axis * spread[finger] * spread_step
            if finger == "thumb":
                direction_for_finger = unit(direction * 0.72 - palm_normal * 0.42 - spread_axis * 0.16, direction)
                offset += -palm_normal * height * 0.0055
            next_head = palm + offset
            for segment in range(1, legacy.SEGMENTS + 1):
                name = f"clouva_{finger}_{segment:02d}_{side}"
                bone = bones.new(name)
                next_tail = next_head + direction_for_finger * segment_length * (1.0 - (segment - 1) * 0.12)
                set_world_points(armature, bone, next_head, next_tail)
                bone.parent = previous
                bone.use_connect = segment > 1
                bone.use_deform = True
                bone.roll = 0.0
                added.append(name)
                finger_names.append(name)
                previous = bone
                next_head = next_tail

    head_start, head_end = world_points(armature, head_bone)
    head_center = (head_start + head_end) * 0.5
    ear_span = clamp(height * 0.043, height * 0.032, height * 0.060)
    ear_length = clamp(height * 0.012, height * 0.008, height * 0.018)
    ear_height = clamp(head_center.z, minimum.z + height * 0.78, minimum.z + height * 0.94)
    ear_names = []
    for side in ("l", "r"):
        sign = 1.0 if side == "l" else -1.0
        name = f"clouva_ear_{side}"
        bone = bones.new(name)
        ear_head = head_center + lateral * sign * ear_span
        ear_head.z = ear_height
        set_world_points(armature, bone, ear_head, ear_head + vertical * ear_length)
        bone.parent = head_bone
        bone.use_connect = False
        bone.use_deform = True
        bone.roll = 0.0
        added.append(name)
        ear_names.append(name)

    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()
    report = {
        "added": added,
        "fingerNames": finger_names,
        "earNames": ear_names,
        "handSources": hand_names,
        "headSource": head_name,
        "bounds": (minimum, maximum, size),
    }
    report["geometry"] = validate_geometry(armature, report)
    return report


original_validate = legacy.validate_profile


def validate_profile(armature, report, finger_weighted, ear_weighted, fallback):
    profile = original_validate(armature, report, finger_weighted, ear_weighted, fallback)
    geometry = report.get("geometry", {"valid": False, "errors": ["geometry-not-run"]})
    profile["version"] = VERSION
    profile["geometry"] = geometry
    profile["complete"] = bool(profile.get("complete") and geometry.get("valid"))
    return profile


legacy.ensure_extended_bones = ensure_extended_bones
legacy.validate_profile = validate_profile

if __name__ == "__main__":
    legacy.main()
