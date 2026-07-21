import sys
from pathlib import Path

# Blender ejecuta el script desde la carpeta temporal del trabajo.
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import complete_avatar_rig_v3 as v5

VERSION = "clouva-complete-rig-v6-anatomical-head"
_TERMINAL_HEAD_TOKENS = ("end", "tip", "top", "terminal", "effector")


def choose_anatomical_head(armature):
    """Prefer the real deforming head joint, never a terminal head_end helper."""
    candidates = []
    exact_names = {
        "head",
        "headbone",
        "mixamorighead",
        "jbiphead",
        "biphead",
    }

    for bone in armature.data.bones:
        key = v5.legacy.clean_name(bone.name)
        if "head" not in key and "neck" not in key:
            continue

        score = 0.0
        if key in exact_names:
            score += 2000.0
        elif "head" in key:
            score += 900.0
        elif "neck" in key:
            score += 250.0

        if bone.use_deform:
            score += 250.0
        if bone.children:
            score += 120.0
        if any(token in key for token in _TERMINAL_HEAD_TOKENS):
            score -= 3000.0

        # Height only breaks ties; it must never make head_end win.
        score += float(bone.head_local.z) * 0.001
        candidates.append((score, bone))

    if candidates:
        return max(candidates, key=lambda item: item[0])[1]
    return v5.legacy.head_bone(armature)


def validate_geometry_v6(armature, report, roundtrip=False):
    minimum, maximum, size = report["bounds"]
    height = max(float(size.z), 0.5)
    center = (minimum + maximum) * 0.5
    padding = height * 0.10
    errors = []
    maximum_length = 0.0
    maximum_link = 0.0

    names = report["fingerNames"] + report["earNames"]
    for name in names:
        bone = armature.data.bones.get(name)
        if bone is None:
            errors.append(f"missing:{name}")
            continue

        head = armature.matrix_world @ bone.head_local
        tail = armature.matrix_world @ bone.tail_local
        length = (tail - head).length
        maximum_length = max(maximum_length, length)
        if not height * 0.0035 <= length <= height * 0.030:
            errors.append(f"invalid-length:{name}:{length:.6f}")

        for label, point in (("head", head), ("tail", tail)):
            if any(
                float(point[index]) < float(minimum[index]) - padding
                or float(point[index]) > float(maximum[index]) + padding
                for index in range(3)
            ):
                errors.append(f"outside-avatar:{name}:{label}")

        if name.startswith("clouva_ear_"):
            lateral_distance = abs(float(head.x - center.x))
            depth_distance = abs(float(head.y - center.y))
            minimum_ear_z = float(minimum.z) + height * 0.72
            maximum_ear_z = float(minimum.z) + height * 0.98
            if not minimum_ear_z <= float(head.z) <= maximum_ear_z:
                errors.append(f"invalid-ear-height:{name}:{float(head.z):.6f}")
            if not height * 0.015 <= lateral_distance <= height * 0.12:
                errors.append(f"invalid-ear-lateral:{name}:{lateral_distance:.6f}")
            if depth_distance > height * 0.12:
                errors.append(f"invalid-ear-depth:{name}:{depth_distance:.6f}")
            # Ear bones are intentionally parented but disconnected. Their anatomical
            # placement is validated above, not against an arbitrary parent endpoint.
            continue

        if bone.parent is not None:
            first_segment = "_01_" in name
            parent_reference = armature.matrix_world @ (
                bone.parent.head_local if first_segment else bone.parent.tail_local
            )
            link = (head - parent_reference).length
            maximum_link = max(maximum_link, link)
            maximum_allowed = height * (0.10 if first_segment else 0.012)
            if link > maximum_allowed:
                errors.append(f"broken-parent-link:{name}:{link:.6f}")

    return {
        "valid": not errors,
        "errors": errors,
        "avatarHeight": height,
        "maximumSegmentLength": maximum_length,
        "maximumParentLink": maximum_link,
        "space": "proportional-root-anatomical-head",
        "roundtrip": roundtrip,
    }


# V5 functions resolve these globals at execution time, so replacing them here
# updates both pre-export and post-roundtrip validation without duplicating rig code.
v5.VERSION = VERSION
v5.legacy.head_bone = choose_anatomical_head
v5.validate_geometry = validate_geometry_v6

if __name__ == "__main__":
    v5.legacy.main()
