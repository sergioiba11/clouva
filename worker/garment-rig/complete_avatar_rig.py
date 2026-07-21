import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

FINGER_NAMES = ("thumb", "index", "middle", "ring", "pinky")
SEGMENTS = 3


def args_after_separator():
    if "--" not in sys.argv:
        raise RuntimeError("Missing Blender script arguments")
    return sys.argv[sys.argv.index("--") + 1 :]


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def clean_name(value):
    return "".join(character for character in value.lower() if character.isalnum())


def imported_objects():
    return [obj for obj in bpy.context.scene.objects if obj.type in {"MESH", "ARMATURE"}]


def world_bounds(meshes):
    points = []
    for mesh in meshes:
        points.extend(mesh.matrix_world @ Vector(corner) for corner in mesh.bound_box)
    if not points:
        raise RuntimeError("The avatar has no visible mesh bounds")
    minimum = Vector((min(point.x for point in points), min(point.y for point in points), min(point.z for point in points)))
    maximum = Vector((max(point.x for point in points), max(point.y for point in points), max(point.z for point in points)))
    return minimum, maximum, maximum - minimum


def choose_armature(armatures):
    if not armatures:
        raise RuntimeError("The avatar has no armature")
    return max(armatures, key=lambda item: len(item.data.bones))


def find_bone(armature, aliases, side=None):
    candidates = []
    for bone in armature.data.bones:
        key = clean_name(bone.name)
        if not any(alias in key for alias in aliases):
            continue
        if side == "l" and not any(token in key for token in ("left", "l", "_l")):
            if bone.head_local.x <= 0.0:
                continue
        if side == "r" and not any(token in key for token in ("right", "r", "_r")):
            if bone.head_local.x >= 0.0:
                continue
        candidates.append(bone)
    if not candidates:
        return None
    if side == "l":
        return max(candidates, key=lambda bone: bone.head_local.x)
    if side == "r":
        return min(candidates, key=lambda bone: bone.head_local.x)
    return max(candidates, key=lambda bone: bone.head_local.z)


def hand_bone(armature, side):
    exact = find_bone(armature, ("hand", "wrist"), side)
    if exact:
        return exact
    side_sign = 1.0 if side == "l" else -1.0
    candidates = [bone for bone in armature.data.bones if bone.head_local.x * side_sign > 0.0]
    if not candidates:
        return None
    return max(candidates, key=lambda bone: abs(bone.head_local.x))


def head_bone(armature):
    return find_bone(armature, ("head",)) or find_bone(armature, ("neck",))


def safe_direction(value, fallback):
    vector = Vector(value)
    if vector.length <= 1e-6 or any(not math.isfinite(float(component)) for component in vector):
        vector = Vector(fallback)
    vector.normalize()
    return vector


def ensure_extended_bones(armature, meshes):
    minimum, maximum, size = world_bounds(meshes)
    height = max(float(size.z), 0.5)
    added = []
    created_finger_names = []
    created_ear_names = []
    hand_sources = {}

    left_hand = hand_bone(armature, "l")
    right_hand = hand_bone(armature, "r")
    head = head_bone(armature)
    if not left_hand or not right_hand:
        raise RuntimeError("Could not locate both hand bones for finger rigging")
    if not head:
        raise RuntimeError("Could not locate the head bone for ear rigging")

    hand_sources["l"] = left_hand.name
    hand_sources["r"] = right_hand.name
    head_name = head.name

    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    edit_bones = armature.data.edit_bones

    for side, source_name in hand_sources.items():
        source = edit_bones.get(source_name)
        if source is None:
            raise RuntimeError(f"Hand edit bone missing for side {side}")
        side_sign = 1.0 if side == "l" else -1.0
        direction = safe_direction(source.tail - source.head, (side_sign, 0.0, 0.0))
        if direction.x * side_sign < 0.15:
            direction = safe_direction((direction.x + side_sign, direction.y, direction.z), (side_sign, 0.0, 0.0))
        spread_axis = safe_direction(Vector((0.0, 0.0, 1.0)).cross(direction), (0.0, 1.0, 0.0))
        vertical_axis = safe_direction(direction.cross(spread_axis), (0.0, 0.0, 1.0))
        palm = source.tail.copy()
        segment_length = max(height * 0.018, source.length * 0.23, 0.012)
        spread_values = {
            "thumb": -2.0,
            "index": -1.0,
            "middle": 0.0,
            "ring": 1.0,
            "pinky": 2.0,
        }

        for finger in FINGER_NAMES:
            previous = source
            offset = spread_axis * spread_values[finger] * height * 0.006
            finger_direction = direction.copy()
            if finger == "thumb":
                finger_direction = safe_direction(direction * 0.7 - vertical_axis * 0.45 + spread_axis * -0.15, direction)
                offset += -vertical_axis * height * 0.008
            origin = palm + offset
            for segment in range(1, SEGMENTS + 1):
                name = f"clouva_{finger}_{segment:02d}_{side}"
                bone = edit_bones.get(name)
                if bone is None:
                    bone = edit_bones.new(name)
                    bone.head = origin if segment == 1 else previous.tail.copy()
                    bone.tail = bone.head + finger_direction * segment_length * (1.0 - (segment - 1) * 0.12)
                    bone.parent = previous
                    bone.use_connect = False
                    bone.use_deform = True
                    added.append(name)
                previous = bone
                created_finger_names.append(name)

    inverse_armature = armature.matrix_world.inverted_safe()
    visible_center = (minimum + maximum) * 0.5
    head_edit = edit_bones.get(head_name)
    if head_edit is None:
        raise RuntimeError("Head edit bone missing")

    for side in ("l", "r"):
        side_sign = 1.0 if side == "l" else -1.0
        name = f"clouva_ear_{side}"
        ear = edit_bones.get(name)
        if ear is None:
            world_position = Vector((
                visible_center.x + side_sign * float(size.x) * 0.47,
                visible_center.y,
                minimum.z + float(size.z) * 0.82,
            ))
            local_position = inverse_armature @ world_position
            ear = edit_bones.new(name)
            ear.head = local_position
            ear.tail = local_position + Vector((0.0, 0.0, max(height * 0.025, 0.018)))
            ear.parent = head_edit
            ear.use_connect = False
            ear.use_deform = True
            added.append(name)
        created_ear_names.append(name)

    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()
    return {
        "added": added,
        "fingerNames": created_finger_names,
        "earNames": created_ear_names,
        "handSources": hand_sources,
        "headSource": head_name,
        "bounds": (minimum, maximum, size),
    }


def bone_segment_world(armature, bone_name):
    bone = armature.data.bones.get(bone_name)
    if bone is None:
        return None
    return armature.matrix_world @ bone.head_local, armature.matrix_world @ bone.tail_local


def point_segment_distance(point, start, end):
    segment = end - start
    length_squared = segment.length_squared
    if length_squared <= 1e-12:
        return (point - start).length
    factor = max(0.0, min(1.0, (point - start).dot(segment) / length_squared))
    return (point - (start + segment * factor)).length


def assign_extended_weights(armature, meshes, report):
    minimum, maximum, size = report["bounds"]
    height = max(float(size.z), 0.5)
    finger_radius = max(height * 0.04, 0.035)
    finger_weighted = 0
    ear_weighted = 0

    finger_segments = {
        name: bone_segment_world(armature, name)
        for name in report["fingerNames"]
    }
    finger_segments = {name: value for name, value in finger_segments.items() if value is not None}

    for mesh in meshes:
        finger_groups = {name: mesh.vertex_groups.get(name) or mesh.vertex_groups.new(name=name) for name in finger_segments}
        ear_groups = {name: mesh.vertex_groups.get(name) or mesh.vertex_groups.new(name=name) for name in report["earNames"]}

        for vertex in mesh.data.vertices:
            world = mesh.matrix_world @ vertex.co
            side = "l" if world.x >= (minimum.x + maximum.x) * 0.5 else "r"
            side_segments = [(name, segment) for name, segment in finger_segments.items() if name.endswith(f"_{side}")]
            if side_segments and abs(world.x - ((maximum.x if side == "l" else minimum.x))) <= float(size.x) * 0.24:
                nearest_name, nearest_distance = min(
                    ((name, point_segment_distance(world, segment[0], segment[1])) for name, segment in side_segments),
                    key=lambda item: item[1],
                )
                if nearest_distance <= finger_radius:
                    weight = max(0.35, min(0.92, 1.0 - nearest_distance / finger_radius))
                    finger_groups[nearest_name].add([vertex.index], weight, "REPLACE")
                    finger_weighted += 1

            high_enough = world.z >= minimum.z + float(size.z) * 0.70
            side_band = abs(world.x - (maximum.x if side == "l" else minimum.x)) <= max(float(size.x) * 0.12, height * 0.035)
            if high_enough and side_band:
                ear_name = f"clouva_ear_{side}"
                ear_groups[ear_name].add([vertex.index], 0.72, "REPLACE")
                ear_weighted += 1

        mesh.data.update()

    return finger_weighted, ear_weighted


def validate_profile(armature, report, finger_weighted, ear_weighted):
    names = {bone.name for bone in armature.data.bones}
    left_chains = sum(
        all(f"clouva_{finger}_{segment:02d}_l" in names for segment in range(1, SEGMENTS + 1))
        for finger in FINGER_NAMES
    )
    right_chains = sum(
        all(f"clouva_{finger}_{segment:02d}_r" in names for segment in range(1, SEGMENTS + 1))
        for finger in FINGER_NAMES
    )
    left_ear = "clouva_ear_l" in names
    right_ear = "clouva_ear_r" in names
    fingers_complete = left_chains == 5 and right_chains == 5 and finger_weighted > 0
    ears_complete = left_ear and right_ear and ear_weighted > 0
    return {
        "version": "clouva-complete-rig-v1",
        "complete": bool(fingers_complete and ears_complete),
        "boneCount": len(names),
        "addedBones": report["added"],
        "fingers": {
            "complete": fingers_complete,
            "leftChains": left_chains,
            "rightChains": right_chains,
            "segmentsPerChain": SEGMENTS,
            "weightedVertices": finger_weighted,
        },
        "ears": {
            "complete": ears_complete,
            "left": left_ear,
            "right": right_ear,
            "weightedVertices": ear_weighted,
        },
        "sourceBones": {
            "leftHand": report["handSources"]["l"],
            "rightHand": report["handSources"]["r"],
            "head": report["headSource"],
        },
    }


def export_glb(path):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=False,
        export_skins=True,
        export_all_influences=True,
        export_animations=False,
        export_apply=False,
    )


def main():
    arguments = args_after_separator()
    if len(arguments) < 3:
        raise RuntimeError("Usage: complete_avatar_rig.py input.glb output.glb metadata.json")
    input_path = Path(arguments[0]).resolve()
    output_path = Path(arguments[1]).resolve()
    metadata_path = Path(arguments[2]).resolve()
    if not input_path.is_file():
        raise RuntimeError("Input avatar GLB not found")

    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(input_path))
    objects = imported_objects()
    meshes = [obj for obj in objects if obj.type == "MESH" and len(obj.data.vertices) > 0]
    armatures = [obj for obj in objects if obj.type == "ARMATURE"]
    if not meshes:
        raise RuntimeError("The avatar GLB has no mesh")
    armature = choose_armature(armatures)
    armature.data.pose_position = "REST"
    armature.animation_data_clear()

    report = ensure_extended_bones(armature, meshes)
    finger_weighted, ear_weighted = assign_extended_weights(armature, meshes, report)
    profile = validate_profile(armature, report, finger_weighted, ear_weighted)
    if not profile["complete"]:
        raise RuntimeError(f"Extended rig validation failed: {json.dumps(profile, separators=(',', ':'))}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    export_glb(output_path)
    if not output_path.is_file() or output_path.stat().st_size < 1024:
        raise RuntimeError("Blender did not generate a valid completed GLB")
    metadata_path.write_text(json.dumps(profile, separators=(",", ":")), encoding="utf-8")
    print(f"[clouva-complete-rig] {json.dumps(profile, separators=(',', ':'))}")


if __name__ == "__main__":
    main()
