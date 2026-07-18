import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

TOLERANCE_CM = 2.0


def args_after_separator():
    if "--" not in sys.argv:
        raise RuntimeError("Missing Blender script arguments")
    return sys.argv[sys.argv.index("--") + 1 :]


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def import_glb(path: Path):
    bpy.ops.import_scene.gltf(filepath=str(path))
    objects = [obj for obj in bpy.context.scene.objects if obj.type in {"MESH", "ARMATURE"}]
    meshes = [obj for obj in objects if obj.type == "MESH"]
    armatures = [obj for obj in objects if obj.type == "ARMATURE"]
    if not meshes:
        raise RuntimeError("The GLB does not contain a mesh")
    return objects, meshes, armatures


def world_bounds(meshes):
    points = []
    for obj in meshes:
        points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    if not points:
        raise RuntimeError("Could not calculate avatar dimensions")
    minimum = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    maximum = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    return minimum, maximum


def dimensions(meshes):
    minimum, maximum = world_bounds(meshes)
    return minimum, maximum, maximum - minimum


def skeleton_world_bounds(armatures):
    points = []
    for armature in armatures:
        matrix = armature.matrix_world
        for bone in armature.data.bones:
            points.append(matrix @ bone.head_local)
            points.append(matrix @ bone.tail_local)
    if not points:
        return None
    minimum = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    maximum = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    return minimum, maximum


def set_rest_pose(armatures):
    for armature in armatures:
        armature.data.pose_position = "REST"
        armature.animation_data_clear()
        for pose_bone in armature.pose.bones:
            pose_bone.scale = (1.0, 1.0, 1.0)


def root_objects(objects):
    object_set = set(objects)
    return [obj for obj in objects if obj.parent is None or obj.parent not in object_set]


def apply_scale_to_selection(objects, active=None):
    if not objects:
        return
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = active or objects[0]
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.context.view_layer.update()


def apply_uniform_scale(objects, meshes, armatures, factor: float):
    roots = root_objects(objects)
    for obj in roots:
        obj.scale = tuple(value * factor for value in obj.scale)
    bpy.context.view_layer.update()

    apply_scale_to_selection(
        roots,
        next((obj for obj in roots if obj.type == "ARMATURE"), roots[0]),
    )

    dirty_meshes = [
        mesh
        for mesh in meshes
        if any(not math.isclose(float(value), 1.0, abs_tol=1e-6) for value in mesh.scale)
    ]
    for mesh in dirty_meshes:
        apply_scale_to_selection([mesh], mesh)

    dirty_armatures = [
        armature
        for armature in armatures
        if any(not math.isclose(float(value), 1.0, abs_tol=1e-6) for value in armature.scale)
    ]
    for armature in dirty_armatures:
        apply_scale_to_selection([armature], armature)

    bpy.context.view_layer.update()


def apply_root_location(objects):
    roots = root_objects(objects)
    if not roots:
        return
    bpy.ops.object.select_all(action="DESELECT")
    for obj in roots:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = next((obj for obj in roots if obj.type == "ARMATURE"), roots[0])
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    bpy.context.view_layer.update()


def ground_feet(objects, meshes):
    minimum, _, _ = dimensions(meshes)
    roots = root_objects(objects)
    for obj in roots:
        obj.location.z -= minimum.z
    bpy.context.view_layer.update()
    apply_root_location(objects)


def ground_skeleton(objects, armatures):
    bounds = skeleton_world_bounds(armatures)
    if not bounds:
        raise RuntimeError("Could not calculate skeleton bounds")
    minimum, _ = bounds
    roots = root_objects(objects)
    for obj in roots:
        obj.location.z -= minimum.z
    bpy.context.view_layer.update()
    apply_root_location(objects)


def count_bones(armatures):
    return sum(len(armature.data.bones) for armature in armatures)


def has_root_bone(armatures):
    for armature in armatures:
        for bone in armature.data.bones:
            if bone.parent is None or bone.name.lower() in {"root", "armature", "hips", "pelvis"}:
                return True
    return False


def has_skin_weights(meshes):
    for mesh in meshes:
        if not mesh.vertex_groups:
            continue
        if any(vertex.groups for vertex in mesh.data.vertices):
            return True
    return False


def clean_scale(obj):
    return [round(float(value), 6) for value in obj.scale]


def scales_metadata(objects, meshes, armatures):
    mesh_scales = [clean_scale(mesh) for mesh in meshes]
    armature_scales = [clean_scale(armature) for armature in armatures]
    root_scales = [clean_scale(obj) for obj in root_objects(objects)]
    all_scales = mesh_scales + armature_scales + root_scales
    scales_clean = all(all(math.isclose(value, 1.0, abs_tol=1e-4) for value in scale) for scale in all_scales)
    return mesh_scales, armature_scales, root_scales, scales_clean


def validate(objects, meshes, armatures, target_height_cm: float):
    minimum, maximum, size = dimensions(meshes)
    height_cm = float(size.z)
    bone_count = count_bones(armatures)
    mesh_scales, armature_scales, root_scales, scales_clean = scales_metadata(objects, meshes, armatures)
    feet_grounded = abs(float(minimum.z)) <= 0.02
    root_exists = has_root_bone(armatures)
    skin_weights = has_skin_weights(meshes)
    height_valid = abs(height_cm - target_height_cm) <= TOLERANCE_CM

    metadata = {
        "target": "unreal",
        "heightCm": round(height_cm, 4),
        "targetHeightCm": round(target_height_cm, 4),
        "dimensionsCm": [round(float(size.x), 4), round(float(size.y), 4), round(float(size.z), 4)],
        "boundsMinCm": [round(float(minimum.x), 4), round(float(minimum.y), 4), round(float(minimum.z), 4)],
        "boundsMaxCm": [round(float(maximum.x), 4), round(float(maximum.y), 4), round(float(maximum.z), 4)],
        "meshScale": mesh_scales[0] if len(mesh_scales) == 1 else mesh_scales,
        "armatureScale": armature_scales[0] if len(armature_scales) == 1 else armature_scales,
        "rootScale": root_scales[0] if len(root_scales) == 1 else root_scales,
        "meshCount": len(meshes),
        "armatureCount": len(armatures),
        "boneCount": bone_count,
        "rootBoneExists": root_exists,
        "skinWeights": skin_weights,
        "feetGrounded": feet_grounded,
        "unit": "centimeter",
        "importUniformScale": 1.0,
        "readyForUnreal": bool(height_valid and scales_clean and feet_grounded and root_exists and skin_weights and bone_count > 0),
    }
    if not metadata["readyForUnreal"]:
        raise RuntimeError(f"Unreal validation failed: {json.dumps(metadata, separators=(',', ':'))}")
    return metadata


def prepare_rigid_object(objects, meshes, armatures):
    # Factor 1 cleans imported local scales without changing the world dimensions.
    apply_uniform_scale(objects, meshes, armatures, 1.0)
    minimum, maximum, _ = dimensions(meshes)
    center = (minimum + maximum) * 0.5
    roots = root_objects(objects)
    for obj in roots:
        obj.location.x -= center.x
        obj.location.y -= center.y
        obj.location.z -= minimum.z
    bpy.context.view_layer.update()
    apply_root_location(objects)


def prepare_wearable_object(objects, meshes, armatures, target_height_cm):
    if not armatures or count_bones(armatures) <= 0:
        raise RuntimeError("The wearable object has no armature")
    if not has_skin_weights(meshes):
        raise RuntimeError("The wearable object has no skin weights")

    before_bounds = skeleton_world_bounds(armatures)
    if not before_bounds:
        raise RuntimeError("Could not measure the wearable skeleton")
    before_minimum, before_maximum = before_bounds
    source_skeleton_height = float(before_maximum.z - before_minimum.z)
    if source_skeleton_height <= 0.001:
        raise RuntimeError("Wearable skeleton height is invalid")

    scale_factor = target_height_cm / source_skeleton_height
    apply_uniform_scale(objects, meshes, armatures, scale_factor)
    ground_skeleton(objects, armatures)
    return source_skeleton_height, scale_factor


def validate_object(objects, meshes, armatures, target_height_cm, category, wearable):
    minimum, maximum, size = dimensions(meshes)
    mesh_scales, armature_scales, root_scales, scales_clean = scales_metadata(objects, meshes, armatures)
    skeleton_bounds = skeleton_world_bounds(armatures)
    skeleton_height = None
    skeleton_grounded = None
    if skeleton_bounds:
        skeleton_minimum, skeleton_maximum = skeleton_bounds
        skeleton_height = float(skeleton_maximum.z - skeleton_minimum.z)
        skeleton_grounded = abs(float(skeleton_minimum.z)) <= 0.02

    calibrated = bool(wearable and skeleton_height is not None)
    calibration_valid = (
        not calibrated
        or (
            abs(float(skeleton_height) - target_height_cm) <= TOLERANCE_CM
            and skeleton_grounded is True
            and count_bones(armatures) > 0
            and has_skin_weights(meshes)
        )
    )
    ready = bool(len(meshes) > 0 and scales_clean and calibration_valid)

    metadata = {
        "target": "unreal-object",
        "category": category,
        "dimensionsCm": [round(float(size.x), 4), round(float(size.y), 4), round(float(size.z), 4)],
        "boundsMinCm": [round(float(minimum.x), 4), round(float(minimum.y), 4), round(float(minimum.z), 4)],
        "boundsMaxCm": [round(float(maximum.x), 4), round(float(maximum.y), 4), round(float(maximum.z), 4)],
        "meshScale": mesh_scales[0] if len(mesh_scales) == 1 else mesh_scales,
        "armatureScale": armature_scales[0] if len(armature_scales) == 1 else armature_scales,
        "rootScale": root_scales[0] if len(root_scales) == 1 else root_scales,
        "meshCount": len(meshes),
        "armatureCount": len(armatures),
        "boneCount": count_bones(armatures),
        "rootBoneExists": has_root_bone(armatures) if armatures else False,
        "skinWeights": has_skin_weights(meshes),
        "calibratedToAvatar": calibrated,
        "targetAvatarHeightCm": round(float(target_height_cm), 4) if calibrated else None,
        "skeletonHeightCm": round(float(skeleton_height), 4) if skeleton_height is not None else None,
        "skeletonGrounded": skeleton_grounded,
        "unit": "centimeter",
        "importUniformScale": 1.0,
        "readyForUnreal": ready,
    }
    if not ready:
        raise RuntimeError(f"Unreal object validation failed: {json.dumps(metadata, separators=(',', ':'))}")
    return metadata


def export_fbx(path: Path):
    bpy.ops.object.select_all(action="DESELECT")
    exportable = []
    for obj in bpy.context.scene.objects:
        if obj.type in {"MESH", "ARMATURE"}:
            obj.select_set(True)
            exportable.append(obj)
    if not exportable:
        raise RuntimeError("Nothing to export")

    bpy.context.view_layer.objects.active = next((obj for obj in exportable if obj.type == "ARMATURE"), exportable[0])
    bpy.ops.export_scene.fbx(
        filepath=str(path),
        use_selection=True,
        object_types={"ARMATURE", "MESH"},
        global_scale=1.0,
        apply_unit_scale=False,
        apply_scale_options="FBX_SCALE_NONE",
        use_space_transform=True,
        bake_space_transform=False,
        axis_forward="-Y",
        axis_up="Z",
        add_leaf_bones=False,
        primary_bone_axis="Y",
        secondary_bone_axis="X",
        armature_nodetype="NULL",
        use_armature_deform_only=True,
        bake_anim=False,
        path_mode="COPY",
        embed_textures=True,
    )


def main():
    values = args_after_separator()
    if len(values) < 2:
        raise RuntimeError("Usage: export_unreal.py input.glb output.fbx [target_height_cm] [mode] [metadata.json] [category] [object_kind]")

    source = Path(values[0]).resolve()
    output = Path(values[1]).resolve()
    target_height_cm = float(values[2]) if len(values) > 2 else 175.0
    mode = values[3].lower() if len(values) > 3 else "avatar"
    metadata_path = Path(values[4]).resolve() if len(values) > 4 else output.with_suffix(".json")
    category = values[5].lower() if len(values) > 5 else "prop"
    object_kind = values[6].lower() if len(values) > 6 else "rigid"

    clear_scene()
    objects, meshes, armatures = import_glb(source)
    set_rest_pose(armatures)

    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "CENTIMETERS"
    scene.unit_settings.scale_length = 0.01

    if target_height_cm < 80 or target_height_cm > 260:
        raise RuntimeError("target_height_cm must be between 80 and 260")

    if mode == "object":
        wearable = object_kind == "wearable"
        source_skeleton_height = None
        scale_factor = 1.0
        if wearable:
            source_skeleton_height, scale_factor = prepare_wearable_object(
                objects,
                meshes,
                armatures,
                target_height_cm,
            )
        else:
            prepare_rigid_object(objects, meshes, armatures)

        metadata = validate_object(
            objects,
            meshes,
            armatures,
            target_height_cm,
            category,
            wearable,
        )
        metadata.update({
            "sourceSkeletonHeight": round(source_skeleton_height, 6) if source_skeleton_height is not None else None,
            "normalizationScaleFactor": round(scale_factor, 8),
        })
    else:
        if not armatures:
            raise RuntimeError("The processed avatar does not contain an armature")
        _, _, before_size = dimensions(meshes)
        current_height = float(before_size.z)
        if current_height <= 0.001:
            raise RuntimeError("Avatar height is invalid")
        scale_factor = target_height_cm / current_height
        apply_uniform_scale(objects, meshes, armatures, scale_factor)
        ground_feet(objects, meshes)
        metadata = validate(objects, meshes, armatures, target_height_cm)
        metadata.update({
            "sourceHeight": round(current_height, 6),
            "normalizationScaleFactor": round(scale_factor, 8),
        })

    output.parent.mkdir(parents=True, exist_ok=True)
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    export_fbx(output)
    if not output.exists() or output.stat().st_size < 1024:
        raise RuntimeError("FBX export was empty")
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[clouva-unreal-metadata] {json.dumps(metadata, separators=(',', ':'))}", flush=True)


if __name__ == "__main__":
    main()
