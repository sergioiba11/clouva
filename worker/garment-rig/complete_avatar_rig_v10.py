import sys
from pathlib import Path

import bpy
from mathutils import Vector

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import complete_avatar_rig_v9 as v9

v8 = v9.v8
v7 = v8.v7
v5 = v9.v5
VERSION = "clouva-complete-rig-v10-hand-axis-anatomy"
PALM_ROOT_PREFIX = "clouva_palm_root_"
FINGER_OFFSETS = {
    "thumb": -1.45,
    "index": -0.62,
    "middle": 0.0,
    "ring": 0.62,
    "pinky": 1.28,
}
FINGER_FAN = {
    "thumb": -0.42,
    "index": -0.05,
    "middle": 0.0,
    "ring": 0.05,
    "pinky": 0.11,
}


def clamp(value, low, high):
    return max(low, min(high, value))


def unit(value, fallback):
    result = Vector(value)
    if result.length <= 1e-7:
        result = Vector(fallback)
    result.normalize()
    return result


def world_point(armature, point):
    return armature.matrix_world @ Vector(point)


def local_point(armature, point):
    return armature.matrix_world.inverted_safe() @ Vector(point)


def world_head(armature, bone):
    return armature.matrix_world @ bone.head_local


def set_no_inherited_scale(edit_bone):
    try:
        edit_bone.inherit_scale = "NONE"
    except (AttributeError, TypeError, ValueError):
        pass


def choose_hand_direction(armature, source, height):
    wrist = world_point(armature, source.head)
    own = world_point(armature, source.tail) - wrist
    continuation = Vector((0.0, 0.0, -1.0))
    if source.parent is not None:
        continuation = wrist - world_point(armature, source.parent.head)

    own_valid = own.length >= height * 0.006
    continuation_valid = continuation.length >= height * 0.018
    if own_valid and continuation_valid:
        own.normalize()
        continuation.normalize()
        if own.dot(continuation) < 0.0:
            own.negate()
        return unit(own * 0.62 + continuation * 0.38, continuation)
    if continuation_valid:
        return unit(continuation, (0.0, 0.0, -1.0))
    return unit(own, (0.0, 0.0, -1.0))


def estimate_head_half_width(meshes, head_center, lateral, depth, height):
    widths = []
    vertical_window = height * 0.060
    depth_window = height * 0.145
    for mesh in meshes:
        count = len(mesh.data.vertices)
        step = max(1, count // 16000)
        for index in range(0, count, step):
            point = mesh.matrix_world @ mesh.data.vertices[index].co
            delta = point - head_center
            if abs(float(delta.z)) > vertical_window:
                continue
            if abs(float(delta.dot(depth))) > depth_window:
                continue
            widths.append(abs(float(delta.dot(lateral))))
    if not widths:
        return height * 0.050
    widths.sort()
    percentile = widths[min(len(widths) - 1, int(len(widths) * 0.92))]
    return clamp(percentile, height * 0.034, height * 0.105)


def ensure_extended_bones_v10(armature, meshes):
    normalization = v8.normalize_imported_object_scales(armature, meshes)
    minimum, maximum, size = v5.legacy.world_bounds(meshes)
    height = max(float(size.z), 0.5)
    center = (minimum + maximum) * 0.5
    hands = {"l": v5.choose_hand(armature, "l"), "r": v5.choose_hand(armature, "r")}
    head = v5.legacy.head_bone(armature)
    if not hands["l"] or not hands["r"]:
        raise RuntimeError("Could not locate both real hand bones for anatomical finger rigging")
    if not head:
        raise RuntimeError("Could not locate the anatomical head bone for ear rigging")

    hand_names = {side: bone.name for side, bone in hands.items()}
    head_name = head.name
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bones = armature.data.edit_bones

    for bone in list(bones):
        if v7.is_extended_bone(bone.name):
            bones.remove(bone)

    left = bones.get(hand_names["l"])
    right = bones.get(hand_names["r"])
    head_bone = bones.get(head_name)
    if not left or not right or not head_bone:
        raise RuntimeError("Source bones disappeared while rebuilding the anatomical rig")

    left_wrist = world_point(armature, left.head)
    right_wrist = world_point(armature, right.head)
    lateral = unit(left_wrist - right_wrist, (1.0, 0.0, 0.0))
    vertical = Vector((0.0, 0.0, 1.0))
    depth = unit(vertical.cross(lateral), (0.0, 1.0, 0.0))

    added = []
    finger_names = []
    palm_root_names = []

    for side, source_name in hand_names.items():
        source = bones[source_name]
        side_sign = 1.0 if side == "l" else -1.0
        across = lateral * side_sign
        hand_direction = choose_hand_direction(armature, source, height)
        wrist_world = world_point(armature, source.head)
        source_length = (world_point(armature, source.tail) - wrist_world).length
        palm_length = clamp(max(source_length * 0.90, height * 0.033), height * 0.026, height * 0.054)
        root_length = clamp(palm_length * 0.16, height * 0.0045, height * 0.009)
        segment_length = clamp(palm_length * 0.28, height * 0.0065, height * 0.0125)
        spread_step = clamp(palm_length * 0.105, height * 0.0024, height * 0.0048)
        palm_center = wrist_world + hand_direction * palm_length * 0.62

        palm_root_name = f"{PALM_ROOT_PREFIX}{side}"
        palm_root = bones.new(palm_root_name)
        palm_root.parent = source
        palm_root.use_connect = False
        palm_root.use_deform = False
        palm_root_head = wrist_world + hand_direction * palm_length * 0.30
        palm_root.head = local_point(armature, palm_root_head)
        palm_root.tail = local_point(armature, palm_root_head + hand_direction * root_length)
        palm_root.roll = 0.0
        set_no_inherited_scale(palm_root)
        added.append(palm_root_name)
        palm_root_names.append(palm_root_name)

        for finger in v5.legacy.FINGER_NAMES:
            previous = palm_root
            root = palm_center + across * FINGER_OFFSETS[finger] * spread_step
            direction = unit(hand_direction + across * FINGER_FAN[finger], hand_direction)
            if finger == "thumb":
                root = wrist_world + hand_direction * palm_length * 0.47 + across * FINGER_OFFSETS[finger] * spread_step
                direction = unit(hand_direction * 0.66 + across * FINGER_FAN[finger] + depth * side_sign * 0.08, hand_direction)

            for segment in range(1, v5.legacy.SEGMENTS + 1):
                name = f"clouva_{finger}_{segment:02d}_{side}"
                bone = bones.new(name)
                bone.parent = previous
                if segment == 1:
                    bone.use_connect = False
                    bone.head = local_point(armature, root)
                else:
                    bone.use_connect = True
                    bone.head = previous.tail.copy()
                head_world = world_point(armature, bone.head)
                tail_world = head_world + direction * segment_length * (1.0 - (segment - 1) * 0.14)
                bone.tail = local_point(armature, tail_world)
                bone.use_deform = True
                bone.roll = 0.0
                set_no_inherited_scale(bone)
                added.append(name)
                finger_names.append(name)
                previous = bone

    head_start = world_point(armature, head_bone.head)
    head_end = world_point(armature, head_bone.tail)
    head_axis = head_end - head_start
    if head_axis.length < height * 0.045 or head_axis.length > height * 0.26:
        head_axis = vertical * height * 0.14
    elif head_axis.dot(vertical) < 0.0:
        head_axis.negate()
    head_center = head_start + head_axis * 0.48
    if float(head_center.z) < float(minimum.z) + height * 0.80:
        head_center.z = float(minimum.z) + height * 0.86

    head_half_width = estimate_head_half_width(meshes, head_center, lateral, depth, height)
    ear_span = clamp(head_half_width * 0.94, height * 0.034, height * 0.105)
    ear_length = clamp(height * 0.011, height * 0.007, height * 0.015)
    ear_names = []
    for side in ("l", "r"):
        sign = 1.0 if side == "l" else -1.0
        name = f"clouva_ear_{side}"
        ear = bones.new(name)
        ear.parent = head_bone
        ear.use_connect = False
        ear.use_deform = True
        ear_root = head_center + lateral * sign * ear_span
        ear.head = local_point(armature, ear_root)
        ear.tail = local_point(armature, ear_root + lateral * sign * ear_length)
        ear.roll = 0.0
        set_no_inherited_scale(ear)
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
        "normalization": normalization,
        "fingerAxis": "continuation-of-real-hand",
        "earPlacement": "head-bone-midpoint-and-mesh-width",
    }
    report["geometry"] = validate_geometry_v10(armature, report, roundtrip=False)
    return report


def finger_bone(armature, finger, segment, side):
    return armature.data.bones.get(f"clouva_{finger}_{segment:02d}_{side}")


def validate_geometry_v10(armature, report, roundtrip=False):
    result = v9.validate_geometry_v9(armature, report, roundtrip=roundtrip)
    errors = list(result.get("errors") or [])
    minimum, maximum, size = report["bounds"]
    height = max(float(size.z), 0.5)
    center = (minimum + maximum) * 0.5
    hands = {"l": v5.choose_hand(armature, "l"), "r": v5.choose_hand(armature, "r")}
    if hands["l"] and hands["r"]:
        lateral = unit(world_head(armature, hands["l"]) - world_head(armature, hands["r"]), (1.0, 0.0, 0.0))
    else:
        lateral = Vector((1.0, 0.0, 0.0))

    maximum_lateral_alignment = 0.0
    minimum_hand_alignment = 1.0
    maximum_hand_root_link = 0.0
    for side in ("l", "r"):
        hand = hands.get(side)
        continuation = None
        if hand is not None and hand.parent is not None:
            continuation = world_head(armature, hand) - world_head(armature, hand.parent)
            if continuation.length > 1e-7:
                continuation.normalize()
        roots = []
        for finger in v5.legacy.FINGER_NAMES:
            first = finger_bone(armature, finger, 1, side)
            second = finger_bone(armature, finger, 2, side)
            third = finger_bone(armature, finger, 3, side)
            if not first or not second or not third:
                errors.append(f"missing-anatomical-chain:{side}:{finger}")
                continue
            first_point = world_head(armature, first)
            second_point = world_head(armature, second)
            third_point = world_head(armature, third)
            roots.append(first_point)
            chain = third_point - first_point
            if chain.length <= height * 0.006:
                errors.append(f"collapsed-finger-chain:{side}:{finger}:{chain.length:.6f}")
                continue
            chain.normalize()
            lateral_alignment = abs(float(chain.dot(lateral)))
            maximum_lateral_alignment = max(maximum_lateral_alignment, lateral_alignment)
            if lateral_alignment > 0.72:
                errors.append(f"sideways-finger-chain:{side}:{finger}:{lateral_alignment:.6f}")
            if continuation is not None:
                alignment = float(chain.dot(continuation))
                minimum_hand_alignment = min(minimum_hand_alignment, alignment)
                if alignment < 0.30:
                    errors.append(f"finger-not-following-hand:{side}:{finger}:{alignment:.6f}")
            if hand is not None:
                root_link = (first_point - world_head(armature, hand)).length
                maximum_hand_root_link = max(maximum_hand_root_link, root_link)
                if root_link > height * 0.075:
                    errors.append(f"finger-root-too-far-from-hand:{side}:{finger}:{root_link:.6f}")
            if (second_point - first_point).length > height * 0.035 or (third_point - second_point).length > height * 0.035:
                errors.append(f"oversized-finger-segment:{side}:{finger}")
        if len(roots) == 5:
            spread = max((a - b).length for a in roots for b in roots)
            if spread > height * 0.075:
                errors.append(f"finger-root-spread-too-wide:{side}:{spread:.6f}")

    head = v5.legacy.head_bone(armature)
    left_ear = armature.data.bones.get("clouva_ear_l")
    right_ear = armature.data.bones.get("clouva_ear_r")
    ear_vertical_error = 0.0
    if head and left_ear and right_ear:
        head_start = world_head(armature, head)
        terminal_candidates = [
            child
            for child in head.children
            if not child.name.lower().startswith("clouva_ear_")
            and ("end" in child.name.lower() or "tip" in child.name.lower() or world_head(armature, child).z > head_start.z)
        ]
        if terminal_candidates:
            head_top = max((world_head(armature, child) for child in terminal_candidates), key=lambda point: float(point.z))
            expected_ear_z = float((head_start + head_top).z * 0.5)
        else:
            expected_ear_z = float(minimum.z) + height * 0.865
        left_point = world_head(armature, left_ear)
        right_point = world_head(armature, right_ear)
        ear_vertical_error = max(abs(float(left_point.z) - expected_ear_z), abs(float(right_point.z) - expected_ear_z))
        if ear_vertical_error > height * 0.060:
            errors.append(f"ears-not-on-head:{ear_vertical_error:.6f}")
        if abs(float(left_point.z - right_point.z)) > height * 0.020:
            errors.append(f"asymmetric-ear-height:{abs(float(left_point.z - right_point.z)):.6f}")
        left_side = float((left_point - center).dot(lateral))
        right_side = float((right_point - center).dot(lateral))
        if left_side <= height * 0.020 or right_side >= -height * 0.020:
            errors.append(f"ears-on-wrong-side:{left_side:.6f}:{right_side:.6f}")
    else:
        errors.append("missing-anatomical-head-or-ears")

    result["valid"] = not errors
    result["errors"] = errors
    result["version"] = VERSION
    result["maximumFingerLateralAlignment"] = maximum_lateral_alignment
    result["minimumFingerHandAlignment"] = minimum_hand_alignment
    result["maximumFingerRootToHand"] = maximum_hand_root_link
    result["maximumEarVerticalError"] = ear_vertical_error
    result["fingerAxis"] = "real-hand-continuation"
    result["earPlacement"] = "anatomical-head"
    return result


_original_validate_profile = v5.validate_profile


def validate_profile_v10(armature, report, finger_weighted, ear_weighted, fallback):
    profile = _original_validate_profile(armature, report, finger_weighted, ear_weighted, fallback)
    geometry = report.get("geometry") or validate_geometry_v10(armature, report, roundtrip=False)
    profile["version"] = VERSION
    profile["normalization"] = report.get("normalization")
    profile["geometry"] = geometry
    profile["fingerAxis"] = report.get("fingerAxis")
    profile["earPlacement"] = report.get("earPlacement")
    profile["complete"] = bool(profile.get("complete") and geometry.get("valid"))
    return profile


v5.VERSION = VERSION
v5.ensure_extended_bones = ensure_extended_bones_v10
v5.validate_geometry = validate_geometry_v10
v5.validate_profile = validate_profile_v10
v5.legacy.ensure_extended_bones = ensure_extended_bones_v10
v5.legacy.validate_profile = validate_profile_v10

if __name__ == "__main__":
    v5.legacy.main()
