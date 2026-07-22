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

VERSION = "clouva-blender-autorig-v12-official-reference"
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

        vertical = Vector((0.0, 0.0, 1.0))
        spread_axis = vertical.cross(direction)
        if spread_axis.length < 1e-6:
            spread_axis = Vector((1.0, 0.0, 0.0))
        spread_axis.normalize()

        candidates = []
        for point in all_vertices:
            delta = point - wrist
            along = float(delta.dot(direction))
            perpendicular = (delta - direction * along).length
            if -height * 0.012 <= along <= height * 0.11 and perpendicular <= height * 0.055:
                candidates.append((point, along, float(delta.dot(spread_axis))))
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
            "method": "target-mesh-hand-envelope",
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
    source = join_reference_meshes(reference_meshes)
    transferred = transfer_weights(source, target_meshes, armature)
    bpy.data.objects.remove(source, do_unlink=True)

    report = v11.ensure_extended_bones_v11(armature, target_meshes)
    hand_fit = fit_fingers_to_target_mesh(armature, target_meshes, report)
    report["handFit"] = hand_fit
    report["geometry"] = v11.validate_geometry_v11(armature, report, roundtrip=False)
    finger_weighted, ear_weighted, fallback = v11.v5.legacy.assign_extended_weights(
        armature, target_meshes, report
    )
    profile = v11.validate_profile_v11(
        armature, report, finger_weighted, ear_weighted, fallback
    )
    profile["version"] = VERSION
    profile["normalization"] = {**fit, "workerNormalization": report.get("normalization")}
    profile["weights"] = transferred
    profile["handFit"] = hand_fit
    profile["rigSource"] = "Blender official Unreal reference"
    profile["inputSource"] = "original-clean-meshy-avatar"
    profile["runId"] = run_id
    profile["inputSha256"] = input_sha256
    profile["referenceSha256"] = reference_sha256
    profile["complete"] = bool(
        profile.get("complete")
        and profile.get("fingers", {}).get("complete")
        and profile.get("ears", {}).get("complete")
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
    print(f"[clouva-real-blender-autorig] {json.dumps(profile, separators=(',', ':'))}", flush=True)
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
