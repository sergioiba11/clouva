import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

FINGER_NAMES = ("thumb", "index", "middle", "ring", "pinky")
SEGMENTS = 3
FALLBACK_VERTICES_PER_SIDE = 96
FALLBACK_VERTICES_PER_EAR = 40


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
    size = maximum - minimum
    if any(not math.isfinite(float(value)) or float(value) <= 1e-8 for value in size):
        raise RuntimeError(f"The avatar visible bounds are invalid: {tuple(float(value) for value in size)}")
    return minimum, maximum, size


def choose_armature(armatures):
    if not armatures:
        raise RuntimeError("The avatar has no armature")
    return max(armatures, key=lambda item: len(item.data.bones))


def side_from_name(name):
    raw = name.lower()
    key = clean_name(name)
    if any(token in raw for token in ("left", ".l", "_l", "-l", " l")) or key.startswith("left") or key.endswith("left"):
        return "l"
    if any(token in raw for token in ("right", ".r", "_r", "-r", " r")) or key.startswith("right") or key.endswith("right"):
        return "r"
    return None


def find_bone(armature, aliases, side=None):
    candidates = []
    for bone in armature.data.bones:
        key = clean_name(bone.name)
        if not any(alias in key for alias in aliases):
            continue
        explicit_side = side_from_name(bone.name)
        if side and explicit_side and explicit_side != side:
            continue
        candidates.append(bone)
    if not candidates:
        return None
    if side:
        signed = 1.0 if side == "l" else -1.0
        explicit = [bone for bone in candidates if side_from_name(bone.name) == side]
        pool = explicit or candidates
        return max(pool, key=lambda bone: signed * float(bone.head_local.x))
    return max(candidates, key=lambda bone: float(bone.head_local.z))


def arm_chain_candidates(armature, side):
    signed = 1.0 if side == "l" else -1.0
    aliases = ("hand", "wrist", "lowerarm", "forearm", "arm")
    candidates = []
    for bone in armature.data.bones:
        key = clean_name(bone.name)
        if not any(alias in key for alias in aliases):
            continue
        explicit_side = side_from_name(bone.name)
        if explicit_side and explicit_side != side:
            continue
        score = signed * max(float(bone.head_local.x), float(bone.tail_local.x))
        if score > 0:
            candidates.append((score, bone))
    candidates.sort(key=lambda item: item[0], reverse=True)
    return [bone for _, bone in candidates]


def hand_bone(armature, side):
    exact = find_bone(armature, ("hand", "wrist"), side)
    if exact:
        return exact
    chain = arm_chain_candidates(armature, side)
    if chain:
        return chain[0]
    signed = 1.0 if side == "l" else -1.0
    spatial = [bone for bone in armature.data.bones if signed * float(bone.head_local.x) > 0.0]
    if not spatial:
        return None
    return max(spatial, key=lambda bone: signed * max(float(bone.head_local.x), float(bone.tail_local.x)))


def head_bone(armature):
    return find_bone(armature, ("head",)) or find_bone(armature, ("neck",)) or max(
        armature.data.bones,
        key=lambda bone: max(float(bone.head_local.z), float(bone.tail_local.z)),
        default=None,
    )


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

    left_hand = hand_bone(armature, "l")
    right_hand = hand_bone(armature, "r")
    head = head_bone(armature)
    if not left_hand or not right_hand:
        available = [bone.name for bone in armature.data.bones]
        raise RuntimeError(
            "Could not locate both hand bones for finger rigging. "
            f"Detected {len(available)} bones; sample={available[:30]}"
        )
    if not head:
        raise RuntimeError("Could not locate the head or highest bone for ear rigging")

    hand_sources = {"l": left_hand.name, "r": right_hand.name}
    head_name = head.name

    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    edit_bones = armature.data.edit_bones

    for side, source_name in hand_sources.items():
        source = edit_bones.get(source_name)
        if source is None:
            raise RuntimeError(f"Hand edit bone missing for side {side}: {source_name}")
        side_sign = 1.0 if side == "l" else -1.0
        direction = safe_direction(source.tail - source.head, (side_sign, 0.0, 0.0))
        if direction.x * side_sign < 0.15:
            direction = safe_direction((direction.x + side_sign, direction.y, direction.z), (side_sign, 0.0, 0.0))
        spread_axis = safe_direction(Vector((0.0, 0.0, 1.0)).cross(direction), (0.0, 1.0, 0.0))
        vertical_axis = safe_direction(direction.cross(spread_axis), (0.0, 0.0, 1.0))
        palm = source.tail.copy()
        segment_length = max(height * 0.015, source.length * 0.20, 0.008)
        spread_values = {"thumb": -2.0, "index": -1.0, "middle": 0.0, "ring": 1.0, "pinky": 2.0}

        for finger in FINGER_NAMES:
            previous = source
            offset = spread_axis * spread_values[finger] * height * 0.0045
            finger_direction = direction.copy()
            if finger == "thumb":
                finger_direction = safe_direction(direction * 0.72 - vertical_axis * 0.40 + spread_axis * -0.16, direction)
                offset += -vertical_axis * height * 0.006
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
        raise RuntimeError(f"Head edit bone missing: {head_name}")

    head_world = armature.matrix_world @ ((head_edit.head + head_edit.tail) * 0.5)
    lateral = safe_direction(
        (armature.matrix_world @ edit_bones[hand_sources["l"]].head)
        - (armature.matrix_world @ edit_bones[hand_sources["r"]].head),
        (1.0, 0.0, 0.0),
    )
    ear_span = max(float(size.x), float(size.y)) * 0.19
    ear_height = max(height * 0.018, 0.012)

    for side in ("l", "r"):
        side_sign = 1.0 if side == "l" else -1.0
        name = f"clouva_ear_{side}"
        ear = edit_bones.get(name)
        if ear is None:
            world_position = head_world + lateral * side_sign * ear_span
            world_position.z = max(world_position.z, minimum.z + float(size.z) * 0.78)
            world_position = Vector((world_position.x, world_position.y, min(world_position.z, maximum.z)))
            local_position = inverse_armature @ world_position
            ear = edit_bones.new(name)
            ear.head = local_position
            ear.tail = local_position + Vector((0.0, 0.0, ear_height))
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


def all_world_vertices(meshes):
    return [
        (mesh, vertex.index, mesh.matrix_world @ vertex.co)
        for mesh in meshes
        for vertex in mesh.data.vertices
    ]


def assign_nearest(vertices, targets, groups_by_mesh, limit, weight):
    if not vertices or not targets:
        return 0
    selected = sorted(
        vertices,
        key=lambda item: min((item[2] - target).length_squared for target in targets.values()),
    )[: max(1, min(limit, len(vertices)))]
    assigned = 0
    for mesh, vertex_index, world in selected:
        name = min(targets, key=lambda key: (world - targets[key]).length_squared)
        groups_by_mesh[mesh][name].add([vertex_index], weight, "REPLACE")
        assigned += 1
    return assigned


def assign_extended_weights(armature, meshes, report):
    minimum, maximum, size = report["bounds"]
    height = max(float(size.z), 0.5)
    finger_radius = max(height * 0.045, 0.03)
    ear_radius = max(height * 0.055, 0.04)
    finger_weighted = 0
    ear_weighted = 0

    finger_segments = {
        name: bone_segment_world(armature, name)
        for name in report["fingerNames"]
    }
    finger_segments = {name: value for name, value in finger_segments.items() if value is not None}
    ear_targets = {
        name: bone_segment_world(armature, name)[0]
        for name in report["earNames"]
        if bone_segment_world(armature, name) is not None
    }
    vertices = all_world_vertices(meshes)
    center = (minimum + maximum) * 0.5

    finger_groups_by_mesh = {
        mesh: {name: mesh.vertex_groups.get(name) or mesh.vertex_groups.new(name=name) for name in finger_segments}
        for mesh in meshes
    }
    ear_groups_by_mesh = {
        mesh: {name: mesh.vertex_groups.get(name) or mesh.vertex_groups.new(name=name) for name in ear_targets}
        for mesh in meshes
    }

    for mesh, vertex_index, world in vertices:
        side = "l" if world.x >= center.x else "r"
        side_segments = [(name, segment) for name, segment in finger_segments.items() if name.endswith(f"_{side}")]
        if side_segments:
            nearest_name, nearest_distance = min(
                ((name, point_segment_distance(world, segment[0], segment[1])) for name, segment in side_segments),
                key=lambda item: item[1],
            )
            if nearest_distance <= finger_radius:
                weight = max(0.30, min(0.90, 1.0 - nearest_distance / finger_radius))
                finger_groups_by_mesh[mesh][nearest_name].add([vertex_index], weight, "REPLACE")
                finger_weighted += 1

        high_enough = world.z >= minimum.z + float(size.z) * 0.68
        if high_enough and ear_targets:
            ear_name = min(ear_targets, key=lambda name: (world - ear_targets[name]).length_squared)
            if (world - ear_targets[ear_name]).length <= ear_radius:
                ear_groups_by_mesh[mesh][ear_name].add([vertex_index], 0.68, "REPLACE")
                ear_weighted += 1

    fallback = {"fingers": False, "ears": False}
    if finger_weighted == 0:
        fallback["fingers"] = True
        for side in ("l", "r"):
            side_names = [name for name in finger_segments if name.endswith(f"_{side}")]
            side_targets = {
                name: (finger_segments[name][0] + finger_segments[name][1]) * 0.5
                for name in side_names
            }
            side_vertices = [item for item in vertices if (item[2].x >= center.x) == (side == "l")]
            finger_weighted += assign_nearest(
                side_vertices,
                side_targets,
                finger_groups_by_mesh,
                FALLBACK_VERTICES_PER_SIDE,
                0.58,
            )

    if ear_weighted == 0:
        fallback["ears"] = True
        high_vertices = [item for item in vertices if item[2].z >= minimum.z + float(size.z) * 0.64]
        for side in ("l", "r"):
            name = f"clouva_ear_{side}"
            if name not in ear_targets:
                continue
            side_vertices = [item for item in high_vertices if (item[2].x >= center.x) == (side == "l")]
            ear_weighted += assign_nearest(
                side_vertices,
                {name: ear_targets[name]},
                ear_groups_by_mesh,
                FALLBACK_VERTICES_PER_EAR,
                0.62,
            )

    for mesh in meshes:
        mesh.data.update()

    return finger_weighted, ear_weighted, fallback


def validate_profile(armature, report, finger_weighted, ear_weighted, fallback):
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
        "version": "clouva-complete-rig-v2",
        "complete": bool(fingers_complete and ears_complete),
        "boneCount": len(names),
        "addedBones": report["added"],
        "weightFallback": fallback,
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
    finger_weighted, ear_weighted, fallback = assign_extended_weights(armature, meshes, report)
    profile = validate_profile(armature, report, finger_weighted, ear_weighted, fallback)
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
