import hashlib
import json
import os
import sys
import time
import uuid
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import complete_avatar_rig_v11 as v11
from avatar_reference import canonicalize_and_validate_bones

VERSION = "clouva-blender-autorig-v15-skull-hand-axis"
REFERENCE_FBX = Path(os.environ.get(
    "CLOUVA_AVATAR_REFERENCE_PATH",
    SCRIPT_DIR / "avatar-reference" / "AvatarReference.fbx",
))
REFERENCE_METADATA = Path(os.environ.get(
    "CLOUVA_AVATAR_REFERENCE_METADATA_PATH",
    SCRIPT_DIR / "avatar-reference" / "clouva_avatar_data.json",
))


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def args_after_separator():
    if "--" not in sys.argv:
        raise RuntimeError("Missing Blender script arguments")
    return sys.argv[sys.argv.index("--") + 1:]


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def bounds(meshes):
    points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    if not points:
        raise RuntimeError("Avatar has no visible mesh")
    minimum = Vector(tuple(min(point[index] for point in points) for index in range(3)))
    maximum = Vector(tuple(max(point[index] for point in points) for index in range(3)))
    size = maximum - minimum
    if min(size) <= 1e-8:
        raise RuntimeError(f"Invalid avatar bounds: {tuple(size)}")
    return minimum, maximum, size


def detach_preserve_world(obj):
    world = obj.matrix_world.copy()
    obj.parent = None
    obj.matrix_parent_inverse = Matrix.Identity(4)
    obj.matrix_world = world


def apply_rotation_scale(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True, properties=False)
    obj.select_set(False)


def normalize(objects):
    for obj in objects:
        detach_preserve_world(obj)
    bpy.context.view_layer.update()
    for obj in objects:
        apply_rotation_scale(obj)
    bpy.context.view_layer.update()


def import_original(path):
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(path))
    bpy.context.view_layer.update()
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and len(obj.data.vertices)]
    if not meshes:
        raise RuntimeError("The original Meshy avatar has no mesh")
    old_armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    normalize(meshes)
    for mesh in meshes:
        for modifier in list(mesh.modifiers):
            if modifier.type == "ARMATURE":
                mesh.modifiers.remove(modifier)
        mesh.vertex_groups.clear()
    for armature in old_armatures:
        bpy.data.objects.remove(armature, do_unlink=True)
    return meshes


def import_reference():
    if not REFERENCE_FBX.is_file() or not REFERENCE_METADATA.is_file():
        raise RuntimeError("Official Unreal AvatarReference is missing")
    metadata = json.loads(REFERENCE_METADATA.read_text(encoding="utf-8"))
    before = {obj.as_pointer() for obj in bpy.context.scene.objects}
    bpy.ops.import_scene.fbx(
        filepath=str(REFERENCE_FBX),
        use_anim=False,
        ignore_leaf_bones=False,
        automatic_bone_orientation=False,
        use_prepost_rot=True,
    )
    bpy.context.view_layer.update()
    imported = [obj for obj in bpy.context.scene.objects if obj.as_pointer() not in before]
    armatures = [obj for obj in imported if obj.type == "ARMATURE"]
    meshes = [obj for obj in imported if obj.type == "MESH" and len(obj.data.vertices)]
    if len(armatures) != 1 or not meshes:
        raise RuntimeError(f"Invalid reference import: armatures={len(armatures)} meshes={len(meshes)}")
    armature = armatures[0]
    canonicalize_and_validate_bones(armature, metadata)
    armature.data.pose_position = "REST"
    armature.animation_data_clear()
    return armature, meshes


def fit_reference(armature, reference_meshes, target_meshes):
    ref_min, ref_max, ref_size = bounds(reference_meshes)
    target_min, target_max, target_size = bounds(target_meshes)
    ref_center = (ref_min + ref_max) * 0.5
    target_center = (target_min + target_max) * 0.5
    scale = Vector(tuple(target_size[index] / ref_size[index] for index in range(3)))
    # Never allow depth/width to explode independently from height.
    height_scale = scale.z
    scale.x = max(height_scale * 0.72, min(height_scale * 1.38, scale.x))
    scale.y = max(height_scale * 0.72, min(height_scale * 1.38, scale.y))
    transform = Matrix.Translation(target_center) @ Matrix.Diagonal((*scale, 1.0)) @ Matrix.Translation(-ref_center)
    for obj in [armature, *reference_meshes]:
        detach_preserve_world(obj)
        obj.matrix_world = transform @ obj.matrix_world
    normalize([armature, *reference_meshes])
    return {
        "fitScale": [float(value) for value in scale],
        "canonicalLocalScale": [1.0, 1.0, 1.0],
        "targetSize": [float(value) for value in target_size],
    }



def _median(values, fallback=0.0):
    ordered = sorted(float(value) for value in values)
    if not ordered:
        return float(fallback)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) * 0.5


def _mean_point(points, fallback):
    if not points:
        return fallback.copy()
    total = Vector((0.0, 0.0, 0.0))
    for point in points:
        total += point
    return total / len(points)


def _find_named_bone(collection, *aliases):
    lowered = {bone.name.lower(): bone for bone in collection}
    for alias in aliases:
        bone = lowered.get(alias.lower())
        if bone is not None:
            return bone
    return None


def _point_segment_distance(point, start, end):
    direction = end - start
    length_squared = direction.length_squared
    if length_squared <= 1e-12:
        return (point - start).length
    factor = max(0.0, min(1.0, (point - start).dot(direction) / length_squared))
    return (point - (start + direction * factor)).length


def fit_major_bones_to_target_mesh(armature, meshes):
    minimum, maximum, size = bounds(meshes)
    height = float(size.z)
    width = float(size.x)
    if height <= 1e-6 or width <= 1e-6:
        raise RuntimeError("Avatar geometry is too small for landmark detection")

    points = [mesh.matrix_world @ vertex.co for mesh in meshes for vertex in mesh.data.vertices]
    center_x = float((minimum.x + maximum.x) * 0.5)
    center_y = _median([point.y for point in points], (minimum.y + maximum.y) * 0.5)
    base_z = float(minimum.z)

    def z_value(factor):
        return base_z + height * factor

    def slice_points(factor, half=0.024):
        target_z = z_value(factor)
        tolerance = height * half
        selected = [point for point in points if abs(float(point.z) - target_z) <= tolerance]
        if selected:
            return selected
        return sorted(points, key=lambda point: abs(float(point.z) - target_z))[: max(20, len(points) // 500)]

    def center_landmark(factor):
        candidates = [
            point for point in slice_points(factor, 0.026)
            if abs(float(point.x) - center_x) <= width * 0.14
        ]
        fallback = Vector((center_x, center_y, z_value(factor)))
        result = _mean_point(candidates, fallback)
        result.x = center_x
        result.z = z_value(factor)
        return result

    def side_leg_landmark(factor, sign):
        candidates = []
        for point in slice_points(factor, 0.028):
            lateral = sign * (float(point.x) - center_x)
            if width * 0.012 <= lateral <= width * 0.24:
                candidates.append(point)
        fallback = Vector((center_x + sign * width * 0.075, center_y, z_value(factor)))
        result = _mean_point(candidates, fallback)
        result.z = z_value(factor)
        return result

    def shoulder_landmark(sign):
        candidates = slice_points(0.665, 0.032)
        lateral_values = [sign * (float(point.x) - center_x) for point in candidates if sign * (float(point.x) - center_x) > 0]
        lateral = _percentile(lateral_values, 0.72, width * 0.16)
        lateral = max(width * 0.10, min(width * 0.30, lateral))
        near = [
            point for point in candidates
            if abs(sign * (float(point.x) - center_x) - lateral) <= width * 0.035
        ]
        fallback = Vector((center_x + sign * lateral, center_y, z_value(0.665)))
        result = _mean_point(near, fallback)
        result.x = center_x + sign * lateral
        result.z = z_value(0.665)
        return result

    def hand_landmark(sign):
        candidates = [
            point for point in points
            if z_value(0.24) <= float(point.z) <= z_value(0.62)
            and sign * (float(point.x) - center_x) >= width * 0.18
        ]
        lateral_values = [sign * (float(point.x) - center_x) for point in candidates]
        lateral = _percentile(lateral_values, 0.88, width * 0.42)
        near = [
            point for point in candidates
            if sign * (float(point.x) - center_x) >= lateral - width * 0.035
        ]
        fallback = Vector((center_x + sign * width * 0.43, center_y, z_value(0.38)))
        return _mean_point(near, fallback)

    pelvis = center_landmark(0.445)
    lower_spine = center_landmark(0.505)
    chest = center_landmark(0.655)
    skull_base = center_landmark(0.785)
    head_top = center_landmark(0.955)

    data_bones = armature.data.bones
    left_probe = _find_named_bone(data_bones, "LeftArm", "upperarm_l", "arm_l")
    if left_probe is None:
        raise RuntimeError("Official reference is missing the left upper-arm bone")
    left_world_x = float((armature.matrix_world @ left_probe.head_local).x)
    left_sign = 1 if left_world_x >= center_x else -1
    side_signs = {"left": left_sign, "right": -left_sign}

    armature.data.pose_position = "REST"
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    if armature.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.mode_set(mode="EDIT")
    bones = armature.data.edit_bones
    inverse = armature.matrix_world.inverted_safe()

    def set_bone(bone, head_world, tail_world, parent=None, connected=False):
        if bone is None:
            return False
        if (tail_world - head_world).length < height * 0.004:
            raise RuntimeError(f"Landmark fit collapsed bone {bone.name}")
        bone.head = inverse @ head_world
        bone.tail = inverse @ tail_world
        if parent is not None:
            bone.parent = parent
        bone.use_connect = bool(connected and parent is not None)
        bone.use_deform = True
        v11.v10.set_no_inherited_scale(bone)
        return True

    hips = _find_named_bone(bones, "Hips", "hips", "pelvis", "root")
    spine_chain = [
        _find_named_bone(bones, "Spine", "spine_01", "spine1"),
        _find_named_bone(bones, "Spine1", "Spine01", "spine_02", "spine2"),
        _find_named_bone(bones, "Spine2", "Spine02", "spine_03", "spine3", "Chest"),
    ]
    spine_chain = [bone for index, bone in enumerate(spine_chain) if bone is not None and bone not in spine_chain[:index]]
    neck_bone = _find_named_bone(bones, "Neck", "neck_01", "neck")
    head_bone = _find_named_bone(bones, "Head", "head")
    if hips is None or not spine_chain or neck_bone is None or head_bone is None:
        bpy.ops.object.mode_set(mode="OBJECT")
        raise RuntimeError("Official reference does not contain the required hips/spine/neck/head chain")

    set_bone(hips, pelvis - Vector((0.0, 0.0, height * 0.025)), pelvis)
    spine_nodes = [pelvis]
    for index in range(1, len(spine_chain) + 1):
        factor = index / len(spine_chain)
        if factor < 0.67:
            point = pelvis.lerp(lower_spine, factor / 0.67)
        else:
            point = lower_spine.lerp(chest, (factor - 0.67) / 0.33)
        spine_nodes.append(point)
    previous = hips
    for index, bone in enumerate(spine_chain):
        set_bone(bone, spine_nodes[index], spine_nodes[index + 1], previous, index > 0)
        previous = bone
    set_bone(neck_bone, chest, skull_base, previous, True)
    set_bone(head_bone, skull_base, head_top, neck_bone, True)
    head_end_bone = _find_named_bone(
        bones, "clouva_head_end", "Head_end", "head_end", "HeadEnd", "headend"
    )
    if head_end_bone is None:
        head_end_bone = bones.new("clouva_head_end")
    set_bone(
        head_end_bone,
        head_top,
        head_top + Vector((0.0, 0.0, height * 0.012)),
        head_bone,
        True,
    )
    head_end_bone.use_deform = False

    report = {
        "method": "mesh-landmarks-per-chain-v15",
        "head": {
            "method": "mesh-skull-base-to-crown-v15",
            "base": list(map(float, skull_base)),
            "crown": list(map(float, head_top)),
            "lengthRatio": float((head_top - skull_base).length / height),
            "terminalBone": head_end_bone.name,
        },
        "height": height,
        "width": width,
        "center": [center_x, center_y],
        "sides": {},
    }

    aliases = {
        "left": {
            "shoulder": ("LeftShoulder", "clavicle_l", "shoulder_l"),
            "arm": ("LeftArm", "upperarm_l", "arm_l"),
            "forearm": ("LeftForeArm", "lowerarm_l", "forearm_l"),
            "hand": ("LeftHand", "hand_l"),
            "upleg": ("LeftUpLeg", "thigh_l", "upleg_l"),
            "leg": ("LeftLeg", "calf_l", "leg_l"),
            "foot": ("LeftFoot", "foot_l"),
            "toe": ("LeftToeBase", "ball_l", "toe_l"),
        },
        "right": {
            "shoulder": ("RightShoulder", "clavicle_r", "shoulder_r"),
            "arm": ("RightArm", "upperarm_r", "arm_r"),
            "forearm": ("RightForeArm", "lowerarm_r", "forearm_r"),
            "hand": ("RightHand", "hand_r"),
            "upleg": ("RightUpLeg", "thigh_r", "upleg_r"),
            "leg": ("RightLeg", "calf_r", "leg_r"),
            "foot": ("RightFoot", "foot_r"),
            "toe": ("RightToeBase", "ball_r", "toe_r"),
        },
    }

    for side, sign in side_signs.items():
        shoulder_point = shoulder_landmark(sign)
        hand_center = hand_landmark(sign)
        inward = shoulder_point - hand_center
        if inward.length < height * 0.08:
            bpy.ops.object.mode_set(mode="OBJECT")
            raise RuntimeError(f"Could not detect the {side} arm from avatar geometry")
        inward.normalize()
        wrist = hand_center + inward * height * 0.026
        palm_tip = hand_center - inward * height * 0.022
        elbow = shoulder_point.lerp(wrist, 0.52)
        elbow.z += height * 0.008

        hip = side_leg_landmark(0.445, sign)
        knee = side_leg_landmark(0.255, sign)
        ankle = side_leg_landmark(0.085, sign)

        names = aliases[side]
        shoulder_bone = _find_named_bone(bones, *names["shoulder"])
        arm_bone = _find_named_bone(bones, *names["arm"])
        forearm_bone = _find_named_bone(bones, *names["forearm"])
        hand_bone = _find_named_bone(bones, *names["hand"])
        up_leg_bone = _find_named_bone(bones, *names["upleg"])
        leg_bone = _find_named_bone(bones, *names["leg"])
        foot_bone = _find_named_bone(bones, *names["foot"])
        toe_bone = _find_named_bone(bones, *names["toe"])
        required = [shoulder_bone, arm_bone, forearm_bone, hand_bone, up_leg_bone, leg_bone, foot_bone]
        if any(bone is None for bone in required):
            bpy.ops.object.mode_set(mode="OBJECT")
            raise RuntimeError(f"Official reference is missing required {side} limb bones")

        set_bone(shoulder_bone, chest, shoulder_point, previous, False)
        set_bone(arm_bone, shoulder_point, elbow, shoulder_bone, True)
        set_bone(forearm_bone, elbow, wrist, arm_bone, True)
        set_bone(hand_bone, wrist, palm_tip, forearm_bone, True)
        set_bone(up_leg_bone, hip, knee, hips, False)
        set_bone(leg_bone, knee, ankle, up_leg_bone, True)

        old_foot_direction = armature.matrix_world.to_3x3() @ (foot_bone.tail - foot_bone.head)
        old_foot_direction.z = 0.0
        if old_foot_direction.length < 1e-6:
            old_foot_direction = Vector((0.0, -1.0, 0.0))
        old_foot_direction.normalize()
        foot_tip = ankle + old_foot_direction * height * 0.085
        foot_tip.z = max(base_z + height * 0.025, ankle.z - height * 0.025)
        set_bone(foot_bone, ankle, foot_tip, leg_bone, True)
        if toe_bone is not None:
            toe_tip = foot_tip + old_foot_direction * height * 0.045
            set_bone(toe_bone, foot_tip, toe_tip, foot_bone, True)

        report["sides"][side] = {
            "sign": sign,
            "shoulder": list(map(float, shoulder_point)),
            "elbow": list(map(float, elbow)),
            "wrist": list(map(float, wrist)),
            "hip": list(map(float, hip)),
            "knee": list(map(float, knee)),
            "ankle": list(map(float, ankle)),
        }

    bpy.ops.armature.select_all(action="SELECT")
    try:
        bpy.ops.armature.calculate_roll(type="GLOBAL_POS_Z")
    except RuntimeError:
        pass
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()
    return report


def _fill_unweighted_vertices(mesh, armature):
    deform_bones = [bone for bone in armature.data.bones if bone.use_deform]
    if not deform_bones:
        raise RuntimeError("Armature has no deform bones")
    world_segments = [
        (
            bone.name,
            armature.matrix_world @ bone.head_local,
            armature.matrix_world @ bone.tail_local,
        )
        for bone in deform_bones
    ]
    filled = 0
    for vertex in mesh.data.vertices:
        if any(item.weight > 1e-8 for item in vertex.groups):
            continue
        point = mesh.matrix_world @ vertex.co
        name, _, _ = min(
            world_segments,
            key=lambda segment: _point_segment_distance(point, segment[1], segment[2]),
        )
        group = mesh.vertex_groups.get(name) or mesh.vertex_groups.new(name=name)
        group.add([vertex.index], 1.0, "REPLACE")
        filled += 1
    return filled


def bind_geometry_aware_weights(target_meshes, armature):
    body = max(target_meshes, key=lambda obj: len(obj.data.vertices))
    for mesh in target_meshes:
        detach_preserve_world(mesh)
        for modifier in list(mesh.modifiers):
            if modifier.type == "ARMATURE":
                mesh.modifiers.remove(modifier)
        mesh.vertex_groups.clear()

    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    try:
        bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    except RuntimeError as exc:
        raise RuntimeError(f"Blender automatic heat weights failed on the avatar body: {exc}") from exc

    if not body.vertex_groups:
        raise RuntimeError("Blender automatic heat weights created no body weights")

    filled = _fill_unweighted_vertices(body, armature)
    source_names = [group.name for group in body.vertex_groups]
    transferred_parts = 0
    for mesh in target_meshes:
        if mesh == body:
            continue
        mesh.vertex_groups.clear()
        for name in source_names:
            mesh.vertex_groups.new(name=name)
        transfer = mesh.modifiers.new("CLOUVA body weight projection", "DATA_TRANSFER")
        transfer.object = body
        transfer.use_vert_data = True
        transfer.data_types_verts = {"VGROUP_WEIGHTS"}
        transfer.vert_mapping = "POLYINTERP_NEAREST"
        transfer.layers_vgroup_select_src = "ALL"
        transfer.layers_vgroup_select_dst = "NAME"
        transfer.mix_mode = "REPLACE"
        bpy.ops.object.select_all(action="DESELECT")
        mesh.select_set(True)
        bpy.context.view_layer.objects.active = mesh
        bpy.ops.object.modifier_apply(modifier=transfer.name)
        modifier = mesh.modifiers.new("CLOUVA Armature", "ARMATURE")
        modifier.object = armature
        modifier.use_deform_preserve_volume = True
        mesh.parent = armature
        mesh.matrix_parent_inverse = armature.matrix_world.inverted_safe()
        filled += _fill_unweighted_vertices(mesh, armature)
        transferred_parts += 1

    vertices = sum(len(mesh.data.vertices) for mesh in target_meshes)
    weighted = sum(
        1 for mesh in target_meshes for vertex in mesh.data.vertices
        if any(item.weight > 1e-8 for item in vertex.groups)
    )
    ratio = weighted / max(vertices, 1)
    if ratio < 0.995:
        raise RuntimeError(f"Geometry-aware weights covered only {weighted}/{vertices} vertices")
    return {
        "method": "automatic-heat-body-plus-projected-parts-v15",
        "bodyMesh": body.name,
        "projectedParts": transferred_parts,
        "filledNearestBoneVertices": filled,
        "vertices": vertices,
        "weightedVertices": weighted,
        "weightedRatio": ratio,
    }

def join_reference_meshes(meshes):
    if len(meshes) == 1:
        source = meshes[0]
    else:
        bpy.ops.object.select_all(action="DESELECT")
        source = max(meshes, key=lambda obj: len(obj.data.vertices))
        for mesh in meshes:
            mesh.select_set(True)
        bpy.context.view_layer.objects.active = source
        bpy.ops.object.join()
    for modifier in list(source.modifiers):
        source.modifiers.remove(modifier)
    return source


def transfer_weights(source, target_meshes, armature):
    source_names = [group.name for group in source.vertex_groups]
    if not source_names:
        raise RuntimeError("Official reference has no skin weights")
    for mesh in target_meshes:
        mesh.vertex_groups.clear()
        for name in source_names:
            mesh.vertex_groups.new(name=name)
        transfer = mesh.modifiers.new("CLOUVA AutoRig weights", "DATA_TRANSFER")
        transfer.object = source
        transfer.use_vert_data = True
        transfer.data_types_verts = {"VGROUP_WEIGHTS"}
        transfer.vert_mapping = "POLYINTERP_NEAREST"
        transfer.layers_vgroup_select_src = "ALL"
        transfer.layers_vgroup_select_dst = "NAME"
        transfer.mix_mode = "REPLACE"
        bpy.ops.object.select_all(action="DESELECT")
        mesh.select_set(True)
        bpy.context.view_layer.objects.active = mesh
        bpy.ops.object.modifier_apply(modifier=transfer.name)
        modifier = mesh.modifiers.new("CLOUVA Armature", "ARMATURE")
        modifier.object = armature
        modifier.use_deform_preserve_volume = True
        mesh.parent = armature
        mesh.matrix_parent_inverse = armature.matrix_world.inverted_safe()

    vertices = sum(len(mesh.data.vertices) for mesh in target_meshes)
    weighted = sum(
        1 for mesh in target_meshes for vertex in mesh.data.vertices
        if any(item.weight > 1e-8 for item in vertex.groups)
    )
    ratio = weighted / max(vertices, 1)
    if ratio < 0.985:
        raise RuntimeError(f"Weight transfer covered only {weighted}/{vertices} vertices")
    return {"vertices": vertices, "weightedVertices": weighted, "weightedRatio": ratio}



def _percentile(values, factor, fallback):
    if not values:
        return fallback
    ordered = sorted(float(value) for value in values)
    index = min(len(ordered) - 1, max(0, int((len(ordered) - 1) * factor)))
    return ordered[index]

def fit_fingers_to_target_mesh(armature, meshes, report):
    minimum, maximum, size = bounds(meshes)
    height = max(float(size.z), 0.5)
    all_vertices = [mesh.matrix_world @ vertex.co for mesh in meshes for vertex in mesh.data.vertices]
    hand_fit = {}

    hand_names = report.get("handSources") or {}
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    if armature.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.mode_set(mode="EDIT")
    bones = armature.data.edit_bones
    left_hand = bones.get(hand_names.get("l", ""))
    right_hand = bones.get(hand_names.get("r", ""))
    if left_hand is None or right_hand is None:
        bpy.ops.object.mode_set(mode="OBJECT")
        raise RuntimeError("Missing both hand bones while deriving the palm lateral axis")
    left_wrist = armature.matrix_world @ left_hand.head
    right_wrist = armature.matrix_world @ right_hand.head
    global_lateral = v11.v10.unit(left_wrist - right_wrist, (1.0, 0.0, 0.0))

    for side in ("l", "r"):
        hand = bones.get(hand_names.get(side, ""))
        if hand is None:
            bpy.ops.object.mode_set(mode="OBJECT")
            raise RuntimeError(f"Missing hand bone while fitting fingers: {side}")
        wrist = armature.matrix_world @ hand.head
        own = armature.matrix_world.to_3x3() @ (hand.tail - hand.head)
        continuation = own.copy()
        if hand.parent is not None:
            parent_head = armature.matrix_world @ hand.parent.head
            continuation = wrist - parent_head
        if continuation.length < height * 0.015:
            continuation = own
        direction = v11.v10.unit(continuation, (0.0, 0.0, -1.0))
        if own.length > height * 0.004:
            own.normalize()
            if own.dot(direction) < 0.0:
                own.negate()
            direction = v11.v10.unit(direction * 0.75 + own * 0.25, direction)

        outward_axis = global_lateral.copy()
        if side == "r":
            outward_axis.negate()
        spread_axis = outward_axis - direction * outward_axis.dot(direction)
        if spread_axis.length < 1e-6:
            spread_axis = Vector((0.0, 0.0, 1.0)).cross(direction)
        spread_axis.normalize()

        def collect_candidates(axis):
            result = []
            for point in all_vertices:
                delta = point - wrist
                along = float(delta.dot(axis))
                perpendicular = (delta - axis * along).length
                if -height * 0.012 <= along <= height * 0.11 and perpendicular <= height * 0.055:
                    result.append((point, along))
            return result

        axis_candidates = collect_candidates(direction)
        positive = [along for _, along in axis_candidates if along > height * 0.004]
        distal_threshold = _percentile(positive, 0.72, height * 0.028)
        distal_points = [point for point, along in axis_candidates if along >= distal_threshold]
        if len(distal_points) >= 6:
            distal_center = _mean_point(distal_points, wrist + direction * height * 0.04)
            mesh_axis = distal_center - wrist
            if mesh_axis.length >= height * 0.018 and mesh_axis.dot(direction) > 0.0:
                direction = v11.v10.unit(mesh_axis * 0.88 + direction * 0.12, direction)
                spread_axis = outward_axis - direction * outward_axis.dot(direction)
                if spread_axis.length < 1e-6:
                    spread_axis = Vector((0.0, 0.0, 1.0)).cross(direction)
                spread_axis.normalize()
                axis_candidates = collect_candidates(direction)

        candidates = [
            (point, along, float((point - wrist).dot(spread_axis)))
            for point, along in axis_candidates
        ]
        positive = [along for _, along, _ in candidates if along > height * 0.004]
        extent = _percentile(positive, 0.94, height * 0.045)
        extent = max(height * 0.026, min(height * 0.070, extent))
        widths = [abs(spread) for _, along, spread in candidates if along >= extent * 0.25]
        half_width = _percentile(widths, 0.88, height * 0.016)
        half_width = max(height * 0.010, min(height * 0.032, half_width))

        palm_root = bones.get(f"clouva_palm_root_{side}")
        if palm_root is not None:
            root_head = wrist + direction * extent * 0.18
            palm_root.head = armature.matrix_world.inverted_safe() @ root_head
            palm_root.tail = armature.matrix_world.inverted_safe() @ (root_head + direction * extent * 0.08)
            palm_root.parent = hand
            palm_root.use_connect = False
            palm_root.use_deform = False

        offsets = {"thumb": -0.90, "index": -0.46, "middle": 0.0, "ring": 0.43, "pinky": 0.82}
        total_length = extent * 0.50
        for finger in v11.v5.legacy.FINGER_NAMES:
            root = wrist + direction * extent * (0.34 if finger == "thumb" else 0.44)
            root += spread_axis * offsets[finger] * half_width
            finger_direction = direction.copy()
            if finger == "thumb":
                finger_direction = v11.v10.unit(direction * 0.72 + spread_axis * offsets[finger] * 0.42, direction)
            previous = palm_root or hand
            cursor = root
            for segment in range(1, v11.v5.legacy.SEGMENTS + 1):
                bone = bones.get(f"clouva_{finger}_{segment:02d}_{side}")
                if bone is None:
                    bpy.ops.object.mode_set(mode="OBJECT")
                    raise RuntimeError(f"Missing generated finger bone: {finger} {segment} {side}")
                length = total_length / 3.0 * (1.0 - (segment - 1) * 0.12)
                bone.head = armature.matrix_world.inverted_safe() @ cursor
                cursor = cursor + finger_direction * length
                bone.tail = armature.matrix_world.inverted_safe() @ cursor
                bone.parent = previous
                bone.use_connect = segment > 1
                bone.use_deform = True
                bone.roll = 0.0
                v11.v10.set_no_inherited_scale(bone)
                previous = bone

        hand_fit[side] = {
            "sourceBone": hand.name,
            "candidateVertices": len(candidates),
            "handExtent": extent,
            "handHalfWidth": half_width,
            "fingerTotalLength": total_length,
            "method": "target-mesh-distal-axis-and-lateral-spread-v15",
        }

    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()
    return hand_fit

def validate_unit_scale(armature, meshes):
    invalid = []
    for obj in [armature, *meshes]:
        local = tuple(round(float(value), 6) for value in obj.scale)
        world = tuple(round(float(value), 6) for value in obj.matrix_world.to_scale())
        if local != (1.0, 1.0, 1.0) or world != (1.0, 1.0, 1.0):
            invalid.append({"name": obj.name, "local": local, "world": world})
    if invalid:
        raise RuntimeError(f"Mesh/Armature scale is not 1,1,1: {invalid}")


def run(input_path, output_path, metadata_path):
    started = time.perf_counter()
    run_id = uuid.uuid4().hex
    input_sha256 = sha256_file(input_path)
    reference_sha256 = sha256_file(REFERENCE_FBX)
    target_meshes = import_original(input_path)
    armature, reference_meshes = import_reference()
    fit = fit_reference(armature, reference_meshes, target_meshes)
    landmark_fit = fit_major_bones_to_target_mesh(armature, target_meshes)

    report = v11.ensure_extended_bones_v11(armature, target_meshes)
    hand_fit = fit_fingers_to_target_mesh(armature, target_meshes, report)
    report["handFit"] = hand_fit
    report["landmarkFit"] = landmark_fit
    report["geometry"] = v11.validate_geometry_v11(armature, report, roundtrip=False)

    for reference_mesh in list(reference_meshes):
        if reference_mesh.name in bpy.data.objects:
            bpy.data.objects.remove(reference_mesh, do_unlink=True)
    transferred = bind_geometry_aware_weights(target_meshes, armature)
    finger_weighted, ear_weighted, fallback = v11.v5.legacy.assign_extended_weights(
        armature, target_meshes, report
    )
    profile = v11.validate_profile_v11(
        armature, report, finger_weighted, ear_weighted, fallback
    )
    profile["version"] = VERSION
    profile["normalization"] = {**fit, "workerNormalization": report.get("normalization")}
    profile["weights"] = transferred
    profile["landmarkFit"] = landmark_fit
    profile["headFit"] = landmark_fit.get("head")
    profile["handFit"] = hand_fit
    profile["rigSource"] = "Blender geometry landmarks + official Unreal hierarchy"
    profile["inputSource"] = "original-clean-meshy-avatar"
    profile["runId"] = run_id
    profile["inputSha256"] = input_sha256
    profile["referenceSha256"] = reference_sha256
    profile["complete"] = bool(
        profile.get("complete")
        and profile.get("fingers", {}).get("complete")
        and profile.get("ears", {}).get("complete")
        and transferred.get("weightedRatio", 0.0) >= 0.995
        and landmark_fit.get("method") == "mesh-landmarks-per-chain-v15"
        and landmark_fit.get("head", {}).get("method") == "mesh-skull-base-to-crown-v15"
        and hand_fit.get("l", {}).get("method") == "target-mesh-distal-axis-and-lateral-spread-v15"
        and hand_fit.get("r", {}).get("method") == "target-mesh-distal-axis-and-lateral-spread-v15"
    )
    validate_unit_scale(armature, target_meshes)
    if not profile["complete"]:
        raise RuntimeError(f"Blender AutoRig validation failed: {profile}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    for mesh in target_meshes:
        mesh.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.export_scene.gltf(
        filepath=str(output_path),
        export_format="GLB",
        use_selection=True,
        export_skins=True,
        export_all_influences=True,
        export_animations=False,
        export_apply=False,
    )
    if not output_path.is_file() or output_path.stat().st_size < 1024:
        raise RuntimeError("Blender did not generate a valid rigged GLB")
    profile["outputSha256"] = sha256_file(output_path)
    profile["durationMs"] = max(1, int((time.perf_counter() - started) * 1000))
    if profile["inputSha256"] == profile["outputSha256"]:
        raise RuntimeError("Blender returned the original file instead of a fresh rig")
    metadata_path.write_text(json.dumps(profile, separators=(",", ":")), encoding="utf-8")
    print(f"[clouva-landmark-autorig-v15] {json.dumps(profile, separators=(',', ':'))}", flush=True)
    return profile


def main():
    args = args_after_separator()
    if len(args) < 3:
        raise RuntimeError("Usage: autorig_avatar_v12.py input.glb output.glb metadata.json")
    input_path, output_path, metadata_path = map(lambda value: Path(value).resolve(), args[:3])
    if not input_path.is_file():
        raise RuntimeError("Original clean avatar GLB not found")
    run(input_path, output_path, metadata_path)


if __name__ == "__main__":
    main()
