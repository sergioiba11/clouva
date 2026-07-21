import bpy
from mathutils import Vector

import complete_avatar_rig as legacy

VERSION = "clouva-complete-rig-v4-connected-roundtrip"
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


def world_point(armature, point):
    return armature.matrix_world @ Vector(point)


def local_point(armature, point):
    return armature.matrix_world.inverted_safe() @ Vector(point)


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


def validate_geometry(armature, report, roundtrip=False):
    minimum, maximum, size = report["bounds"]
    height = max(float(size.z), 0.5)
    padding = height * 0.10
    errors = []
    maximum_length = 0.0
    maximum_link = 0.0

    for name in report["fingerNames"] + report["earNames"]:
        bone = armature.data.bones.get(name)
        if bone is None:
            errors.append(f"missing:{name}")
            continue
        head = armature.matrix_world @ bone.head_local
        tail = armature.matrix_world @ bone.tail_local
        length = (tail - head).length
        maximum_length = max(maximum_length, length)
        minimum_length = height * 0.004
        maximum_allowed = height * 0.035
        if not minimum_length <= length <= maximum_allowed:
            errors.append(f"invalid-length:{name}:{length:.6f}")
        for label, point in (("head", head), ("tail", tail)):
            if any(
                float(point[index]) < float(minimum[index]) - padding
                or float(point[index]) > float(maximum[index]) + padding
                for index in range(3)
            ):
                errors.append(f"outside-avatar:{name}:{label}")
        if bone.parent is not None:
            parent_tail = armature.matrix_world @ bone.parent.tail_local
            link = (head - parent_tail).length
            maximum_link = max(maximum_link, link)
            if link > height * 0.025:
                errors.append(f"broken-parent-link:{name}:{link:.6f}")

    return {
        "valid": not errors,
        "errors": errors,
        "avatarHeight": height,
        "maximumSegmentLength": maximum_length,
        "maximumParentLink": maximum_link,
        "space": "connected-armature-local",
        "roundtrip": roundtrip,
    }


def ensure_extended_bones(armature, meshes):
    minimum, maximum, size = legacy.world_bounds(meshes)
    height = max(float(size.z), 0.5)
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

    left_world = world_point(armature, left.tail)
    right_world = world_point(armature, right.tail)
    lateral = left_world - right_world
    lateral.z = 0.0
    lateral = unit(lateral, (1.0, 0.0, 0.0))
    vertical = Vector((0.0, 0.0, 1.0))
    segment_length = clamp(height * 0.0135, height * 0.009, height * 0.018)
    fan = {
        "thumb": -0.42,
        "index": -0.18,
        "middle": 0.0,
        "ring": 0.18,
        "pinky": 0.36,
    }
    added = []
    finger_names = []

    for side, source_name in hand_names.items():
        source = bones[source_name]
        side_sign = 1.0 if side == "l" else -1.0
        source_head_world = world_point(armature, source.head)
        source_tail_world = world_point(armature, source.tail)
        outward = lateral * side_sign
        hand_direction = unit(source_tail_world - source_head_world, outward)
        if hand_direction.dot(outward) < 0.05:
            hand_direction = unit(hand_direction + outward, outward)
        spread_axis = unit(vertical.cross(hand_direction), (0.0, 1.0, 0.0))

        for finger in legacy.FINGER_NAMES:
            previous = source
            direction = unit(hand_direction + spread_axis * fan[finger], hand_direction)
            if finger == "thumb":
                direction = unit(direction - vertical * 0.28, direction)
            for segment in range(1, legacy.SEGMENTS + 1):
                name = f"clouva_{finger}_{segment:02d}_{side}"
                bone = bones.new(name)
                bone.parent = previous
                bone.use_connect = True
                bone.head = previous.tail.copy()
                head_world = world_point(armature, bone.head)
                tail_world = head_world + direction * segment_length * (1.0 - (segment - 1) * 0.12)
                bone.tail = local_point(armature, tail_world)
                bone.use_deform = True
                bone.roll = 0.0
                added.append(name)
                finger_names.append(name)
                previous = bone

    head_tail_world = world_point(armature, head_bone.tail)
    ear_length = clamp(height * 0.020, height * 0.014, height * 0.026)
    ear_names = []
    for side in ("l", "r"):
        sign = 1.0 if side == "l" else -1.0
        name = f"clouva_ear_{side}"
        bone = bones.new(name)
        bone.parent = head_bone
        bone.use_connect = True
        bone.head = head_bone.tail.copy()
        ear_direction = unit(lateral * sign - vertical * 0.20, lateral * sign)
        bone.tail = local_point(armature, head_tail_world + ear_direction * ear_length)
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
original_export = legacy.export_glb


def validate_profile(armature, report, finger_weighted, ear_weighted, fallback):
    profile = original_validate(armature, report, finger_weighted, ear_weighted, fallback)
    geometry = report.get("geometry", {"valid": False, "errors": ["geometry-not-run"]})
    profile["version"] = VERSION
    profile["geometry"] = geometry
    profile["complete"] = bool(profile.get("complete") and geometry.get("valid"))
    return profile


def export_glb_with_roundtrip(path):
    original_export(path)
    legacy.clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(path))
    objects = legacy.imported_objects()
    meshes = [obj for obj in objects if obj.type == "MESH" and len(obj.data.vertices) > 0]
    armatures = [obj for obj in objects if obj.type == "ARMATURE"]
    if not meshes or not armatures:
        raise RuntimeError("Roundtrip validation could not reload the exported avatar")
    armature = legacy.choose_armature(armatures)
    minimum, maximum, size = legacy.world_bounds(meshes)
    names = [bone.name for bone in armature.data.bones if is_generated(bone.name)]
    report = {
        "fingerNames": [name for name in names if not name.startswith("clouva_ear_")],
        "earNames": [name for name in names if name.startswith("clouva_ear_")],
        "bounds": (minimum, maximum, size),
    }
    geometry = validate_geometry(armature, report, roundtrip=True)
    if not geometry["valid"]:
        raise RuntimeError(f"Exported GLB roundtrip rig validation failed: {geometry}")


legacy.ensure_extended_bones = ensure_extended_bones
legacy.validate_profile = validate_profile
legacy.export_glb = export_glb_with_roundtrip

if __name__ == "__main__":
    legacy.main()
