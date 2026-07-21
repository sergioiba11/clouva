import sys
from pathlib import Path

import bpy

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import complete_avatar_rig_v8 as v8

v7 = v8.v7
v6 = v7.v6
v5 = v8.v5
VERSION = "clouva-complete-rig-v9-gltf-joint-roundtrip"


def world_head(armature, bone):
    return armature.matrix_world @ bone.head_local


def inside_bounds(point, minimum, maximum, padding):
    return all(
        float(minimum[index]) - padding <= float(point[index]) <= float(maximum[index]) + padding
        for index in range(3)
    )


def finger_segment(name):
    parts = name.split("_")
    if len(parts) != 4 or parts[0] != "clouva":
        return None
    try:
        return int(parts[2])
    except ValueError:
        return None


def expected_parent_name(name):
    parts = name.split("_")
    segment = finger_segment(name)
    if segment is None:
        return None
    side = parts[3]
    finger = parts[1]
    if segment == 1:
        return f"clouva_palm_root_{side}"
    return f"clouva_{finger}_{segment - 1:02d}_{side}"


def next_segment_name(name):
    parts = name.split("_")
    segment = finger_segment(name)
    if segment is None or segment >= v5.legacy.SEGMENTS:
        return None
    return f"clouva_{parts[1]}_{segment + 1:02d}_{parts[3]}"


def validate_roundtrip_joint_hierarchy(armature, report):
    """Validate the data glTF actually preserves: joint transforms.

    glTF stores joint positions and hierarchy, but not Blender edit-bone tails.
    Blender reconstructs tails heuristically when a GLB is imported again, so
    validating `tail_local` after roundtrip produces false 100x failures even
    when every exported joint is correctly placed. Three.js SkeletonHelper also
    draws parent-to-child joint positions, not Blender's reconstructed tails.
    """
    minimum, maximum, size = report["bounds"]
    height = max(float(size.z), 0.5)
    padding = height * 0.10
    errors = []
    joint_lengths = []
    parent_links = []

    armature_world_scale = v8.scale_tuple(armature)
    armature_local_scale = tuple(float(value) for value in armature.scale)
    mesh_scales = {}
    if not v8.is_unit_scale(armature_world_scale):
        errors.append(f"non-unit-armature-world-scale:{armature_world_scale}")
    if not v8.is_unit_scale(armature_local_scale):
        errors.append(f"non-unit-armature-local-scale:{armature_local_scale}")

    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        world = v8.scale_tuple(obj)
        local = tuple(float(value) for value in obj.scale)
        mesh_scales[obj.name] = {"world": world, "local": local}
        if not v8.is_unit_scale(world):
            errors.append(f"non-unit-mesh-world-scale:{obj.name}:{world}")
        if not v8.is_unit_scale(local):
            errors.append(f"non-unit-mesh-local-scale:{obj.name}:{local}")

    for side in ("l", "r"):
        root_name = f"clouva_palm_root_{side}"
        root = armature.data.bones.get(root_name)
        if root is None:
            errors.append(f"missing:{root_name}")
            continue
        root_head = world_head(armature, root)
        if not inside_bounds(root_head, minimum, maximum, padding):
            errors.append(f"outside-avatar:{root_name}:joint")
        if root.parent is None:
            errors.append(f"missing-parent:{root_name}")
        else:
            link = (root_head - world_head(armature, root.parent)).length
            parent_links.append(link)
            if link > height * 0.12:
                errors.append(f"broken-parent-joint-link:{root_name}:{link:.6f}")

    finger_names = sorted(report.get("fingerNames") or [])
    if len(finger_names) != 30:
        errors.append(f"invalid-finger-joint-count:{len(finger_names)}")

    for name in finger_names:
        bone = armature.data.bones.get(name)
        if bone is None:
            errors.append(f"missing:{name}")
            continue
        head = world_head(armature, bone)
        if not inside_bounds(head, minimum, maximum, padding):
            errors.append(f"outside-avatar:{name}:joint")

        expected_parent = expected_parent_name(name)
        actual_parent = bone.parent.name if bone.parent else None
        if expected_parent and actual_parent != expected_parent:
            errors.append(f"invalid-parent:{name}:{actual_parent}:expected:{expected_parent}")

        if bone.parent is not None:
            link = (head - world_head(armature, bone.parent)).length
            parent_links.append(link)
            if finger_segment(name) == 1:
                if link > height * 0.10:
                    errors.append(f"broken-parent-joint-link:{name}:{link:.6f}")
            elif not height * 0.0035 <= link <= height * 0.030:
                errors.append(f"invalid-joint-segment:{name}:{link:.6f}")

        next_name = next_segment_name(name)
        if next_name:
            child = armature.data.bones.get(next_name)
            if child is None:
                errors.append(f"missing:{next_name}")
            else:
                length = (world_head(armature, child) - head).length
                joint_lengths.append(length)
                if not height * 0.0035 <= length <= height * 0.030:
                    errors.append(f"invalid-joint-segment:{name}:{length:.6f}")

    center = (minimum + maximum) * 0.5
    ear_names = sorted(report.get("earNames") or [])
    if len(ear_names) != 2:
        errors.append(f"invalid-ear-joint-count:{len(ear_names)}")
    for name in ear_names:
        bone = armature.data.bones.get(name)
        if bone is None:
            errors.append(f"missing:{name}")
            continue
        head = world_head(armature, bone)
        if not inside_bounds(head, minimum, maximum, padding):
            errors.append(f"outside-avatar:{name}:joint")
        lateral_distance = abs(float(head.x - center.x))
        depth_distance = abs(float(head.y - center.y))
        if not float(minimum.z) + height * 0.72 <= float(head.z) <= float(minimum.z) + height * 0.98:
            errors.append(f"invalid-ear-height:{name}:{float(head.z):.6f}")
        if not height * 0.015 <= lateral_distance <= height * 0.12:
            errors.append(f"invalid-ear-lateral:{name}:{lateral_distance:.6f}")
        if depth_distance > height * 0.12:
            errors.append(f"invalid-ear-depth:{name}:{depth_distance:.6f}")
        if bone.parent is None:
            errors.append(f"missing-parent:{name}")

    return {
        "valid": not errors,
        "errors": errors,
        "version": VERSION,
        "avatarHeight": height,
        "jointSegmentCount": len(joint_lengths),
        "minimumJointSegment": min(joint_lengths) if joint_lengths else 0.0,
        "maximumJointSegment": max(joint_lengths) if joint_lengths else 0.0,
        "maximumParentJointLink": max(parent_links) if parent_links else 0.0,
        "armatureWorldScale": armature_world_scale,
        "armatureLocalScale": armature_local_scale,
        "meshScales": mesh_scales,
        "space": "gltf-joint-head-hierarchy",
        "roundtrip": True,
        "blenderTailIgnored": True,
    }


def validate_geometry_v9(armature, report, roundtrip=False):
    if not roundtrip:
        result = v8.validate_geometry_v8(armature, report, roundtrip=False)
        result["version"] = VERSION
        return result
    return validate_roundtrip_joint_hierarchy(armature, report)


def ensure_extended_bones_v9(armature, meshes):
    report = v8.ensure_extended_bones_v8(armature, meshes)
    report["geometry"] = validate_geometry_v9(armature, report, roundtrip=False)
    return report


_original_validate_profile = v5.validate_profile


def validate_profile_v9(armature, report, finger_weighted, ear_weighted, fallback):
    profile = _original_validate_profile(armature, report, finger_weighted, ear_weighted, fallback)
    profile["version"] = VERSION
    profile["geometry"] = report.get("geometry")
    profile["complete"] = bool(
        profile.get("complete")
        and profile.get("geometry")
        and profile["geometry"].get("valid")
    )
    return profile


v5.VERSION = VERSION
v5.ensure_extended_bones = ensure_extended_bones_v9
v5.validate_geometry = validate_geometry_v9
v5.validate_profile = validate_profile_v9
v5.legacy.ensure_extended_bones = ensure_extended_bones_v9
v5.legacy.validate_profile = validate_profile_v9

if __name__ == "__main__":
    v5.legacy.main()
