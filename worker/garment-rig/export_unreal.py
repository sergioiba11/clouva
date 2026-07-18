import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

TOLERANCE_CM = 2.0
GROUND_TOLERANCE_CM = 2.0
SCENE_SCALE_LENGTH_METERS = 1.0
FBX_GLOBAL_SCALE = 1.0
FBX_APPLY_UNIT_SCALE = True
FBX_APPLY_SCALE_OPTIONS = "FBX_SCALE_UNITS"
FBX_DECLARED_UNIT_SCALE_CM = 100.0


def args_after_separator():
    if "--" not in sys.argv:
        raise RuntimeError("Missing Blender script arguments")
    return sys.argv[sys.argv.index("--") + 1 :]


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def configure_scene_units():
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "METERS"
    scene.unit_settings.scale_length = SCENE_SCALE_LENGTH_METERS
    return scene


def centimeters_to_scene_units(value_cm: float, scale_length: float | None = None) -> float:
    effective_scale = float(
        scale_length if scale_length is not None else bpy.context.scene.unit_settings.scale_length
    )
    if effective_scale <= 0.0:
        raise RuntimeError("Scene scale_length must be greater than zero")
    return float(value_cm) / (effective_scale * 100.0)


def scene_units_to_centimeters(value: float, scale_length: float | None = None) -> float:
    effective_scale = float(
        scale_length if scale_length is not None else bpy.context.scene.unit_settings.scale_length
    )
    if effective_scale <= 0.0:
        raise RuntimeError("Scene scale_length must be greater than zero")
    return float(value) * effective_scale * 100.0


def vector_scene_units_to_centimeters(value: Vector, scale_length: float | None = None) -> list[float]:
    return [
        round(scene_units_to_centimeters(component, scale_length), 4)
        for component in value
    ]


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


def bake_mesh_data_scale(mesh):
    scale = tuple(float(value) for value in mesh.scale)
    if all(math.isclose(value, 1.0, abs_tol=1e-6) for value in scale):
        return

    # Baking the residual child scale into the mesh datablock preserves the current
    # world-space geometry without applying the armature/root factor a second time.
    mesh.data.transform(Matrix.Diagonal((scale[0], scale[1], scale[2], 1.0)))
    mesh.scale = (1.0, 1.0, 1.0)
    mesh.data.update()


def apply_uniform_scale(objects, meshes, armatures, factor: float):
    if not math.isfinite(factor) or factor <= 0.0:
        raise RuntimeError(f"Invalid normalization scale factor: {factor}")

    before_height = float(dimensions(meshes)[2].z)
    roots = root_objects(objects)
    if not roots:
        raise RuntimeError("The imported asset has no root object")

    for obj in roots:
        obj.scale = tuple(float(value) * factor for value in obj.scale)
    bpy.context.view_layer.update()

    apply_scale_to_selection(
        roots,
        next((obj for obj in roots if obj.type == "ARMATURE"), roots[0]),
    )

    # Applying the root/armature transform can leave a compensating local scale on
    # skinned child meshes. Bake only that residual local scale once.
    for mesh in meshes:
        bake_mesh_data_scale(mesh)

    for armature in armatures:
        if any(not math.isclose(float(value), 1.0, abs_tol=1e-6) for value in armature.scale):
            apply_scale_to_selection([armature], armature)

    bpy.context.view_layer.update()
    after_height = float(dimensions(meshes)[2].z)
    expected_height = before_height * factor
    allowed_error = max(1e-5, abs(expected_height) * 1e-4)
    if not math.isclose(after_height, expected_height, rel_tol=1e-4, abs_tol=allowed_error):
        raise RuntimeError(
            "Scale normalization changed the mesh by an unexpected amount: "
            f"before={before_height}, factor={factor}, expected={expected_height}, after={after_height}"
        )


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
    scales_clean = all(
        all(math.isclose(value, 1.0, abs_tol=1e-4) for value in scale)
        for scale in all_scales
    )
    return mesh_scales, armature_scales, root_scales, scales_clean


def skeleton_height_scene_units(armatures):
    bounds = skeleton_world_bounds(armatures)
    if not bounds:
        return None
    minimum, maximum = bounds
    return float(maximum.z - minimum.z)


def validate_avatar(
    objects,
    meshes,
    armatures,
    target_height_cm: float,
    *,
    source_height_raw: float,
    target_height_scene_units: float,
    normalization_scale_factor: float,
):
    scene_scale_length = float(bpy.context.scene.unit_settings.scale_length)
    minimum, maximum, size = dimensions(meshes)
    final_mesh_height_cm = scene_units_to_centimeters(size.z, scene_scale_length)
    final_skeleton_height_units = skeleton_height_scene_units(armatures)
    final_skeleton_height_cm = (
        scene_units_to_centimeters(final_skeleton_height_units, scene_scale_length)
        if final_skeleton_height_units is not None
        else None
    )
    bone_count = count_bones(armatures)
    mesh_scales, armature_scales, root_scales, scales_clean = scales_metadata(
        objects, meshes, armatures
    )
    feet_grounded = abs(scene_units_to_centimeters(minimum.z, scene_scale_length)) <= GROUND_TOLERANCE_CM
    root_exists = has_root_bone(armatures)
    skin_weights = has_skin_weights(meshes)
    height_valid = abs(final_mesh_height_cm - target_height_cm) <= TOLERANCE_CM

    skeleton_plausible = bool(
        final_skeleton_height_cm is not None
        and final_skeleton_height_cm > 0.0
        and abs(final_skeleton_height_cm - final_mesh_height_cm)
        <= max(50.0, final_mesh_height_cm * 0.5)
    )

    metadata = {
        "target": "unreal",
        "sourceHeightRaw": round(source_height_raw, 8),
        "sourceHeightUnit": "blender_unit",
        "sceneScaleLength": round(scene_scale_length, 8),
        "targetHeightCm": round(target_height_cm, 4),
        "targetHeightInSceneUnits": round(target_height_scene_units, 8),
        "normalizationScaleFactor": round(normalization_scale_factor, 8),
        "finalMeshHeightCm": round(final_mesh_height_cm, 4),
        "finalSkeletonHeightCm": (
            round(final_skeleton_height_cm, 4)
            if final_skeleton_height_cm is not None
            else None
        ),
        # Backward-compatible fields consumed by the current endpoint/UI.
        "heightCm": round(final_mesh_height_cm, 4),
        "dimensionsCm": vector_scene_units_to_centimeters(size, scene_scale_length),
        "boundsMinCm": vector_scene_units_to_centimeters(minimum, scene_scale_length),
        "boundsMaxCm": vector_scene_units_to_centimeters(maximum, scene_scale_length),
        "meshScale": mesh_scales[0] if len(mesh_scales) == 1 else mesh_scales,
        "armatureScale": armature_scales[0] if len(armature_scales) == 1 else armature_scales,
        "rootScale": root_scales[0] if len(root_scales) == 1 else root_scales,
        "meshScales": mesh_scales,
        "armatureScales": armature_scales,
        "rootScales": root_scales,
        "meshCount": len(meshes),
        "armatureCount": len(armatures),
        "boneCount": bone_count,
        "rootBoneExists": root_exists,
        "skinWeights": skin_weights,
        "feetGrounded": feet_grounded,
        "skeletonHeightPlausible": skeleton_plausible,
        "unit": "centimeter",
        "importUniformScale": 1.0,
        "fbxGlobalScale": FBX_GLOBAL_SCALE,
        "fbxApplyUnitScale": FBX_APPLY_UNIT_SCALE,
        "fbxApplyScaleOptions": FBX_APPLY_SCALE_OPTIONS,
        "fbxDeclaredUnitScaleCm": FBX_DECLARED_UNIT_SCALE_CM,
        "readyForUnreal": bool(
            height_valid
            and scales_clean
            and feet_grounded
            and root_exists
            and skin_weights
            and bone_count > 0
            and skeleton_plausible
        ),
    }
    if not metadata["readyForUnreal"]:
        raise RuntimeError(
            f"Unreal validation failed: {json.dumps(metadata, separators=(',', ':'))}"
        )
    return metadata


def prepare_rigid_object(objects, meshes, armatures):
    # Factor 1 only cleans imported local scales; it does not change world dimensions.
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


def prepare_wearable_object(
    objects,
    meshes,
    armatures,
    target_height_scene_units: float,
):
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

    scale_factor = target_height_scene_units / source_skeleton_height
    apply_uniform_scale(objects, meshes, armatures, scale_factor)
    ground_skeleton(objects, armatures)
    return source_skeleton_height, scale_factor


def validate_object(
    objects,
    meshes,
    armatures,
    target_height_cm,
    category,
    wearable,
    *,
    source_skeleton_height,
    normalization_scale_factor,
):
    scene_scale_length = float(bpy.context.scene.unit_settings.scale_length)
    minimum, maximum, size = dimensions(meshes)
    mesh_scales, armature_scales, root_scales, scales_clean = scales_metadata(
        objects, meshes, armatures
    )
    skeleton_bounds = skeleton_world_bounds(armatures)
    skeleton_height_units = None
    skeleton_height_cm = None
    skeleton_grounded = None
    if skeleton_bounds:
        skeleton_minimum, skeleton_maximum = skeleton_bounds
        skeleton_height_units = float(skeleton_maximum.z - skeleton_minimum.z)
        skeleton_height_cm = scene_units_to_centimeters(
            skeleton_height_units, scene_scale_length
        )
        skeleton_grounded = (
            abs(scene_units_to_centimeters(skeleton_minimum.z, scene_scale_length))
            <= GROUND_TOLERANCE_CM
        )

    calibrated = bool(wearable and skeleton_height_units is not None)
    calibration_valid = (
        not calibrated
        or (
            abs(float(skeleton_height_cm) - target_height_cm) <= TOLERANCE_CM
            and skeleton_grounded is True
            and count_bones(armatures) > 0
            and has_skin_weights(meshes)
        )
    )
    ready = bool(len(meshes) > 0 and scales_clean and calibration_valid)

    metadata = {
        "target": "unreal-object",
        "category": category,
        "sourceHeightRaw": (
            round(source_skeleton_height, 8)
            if source_skeleton_height is not None
            else None
        ),
        "sourceHeightUnit": "blender_unit",
        "sceneScaleLength": round(scene_scale_length, 8),
        "targetHeightCm": round(float(target_height_cm), 4) if calibrated else None,
        "targetHeightInSceneUnits": (
            round(centimeters_to_scene_units(target_height_cm, scene_scale_length), 8)
            if calibrated
            else None
        ),
        "normalizationScaleFactor": round(normalization_scale_factor, 8),
        "finalMeshHeightCm": round(
            scene_units_to_centimeters(size.z, scene_scale_length), 4
        ),
        "finalSkeletonHeightCm": (
            round(float(skeleton_height_cm), 4)
            if skeleton_height_cm is not None
            else None
        ),
        "dimensionsCm": vector_scene_units_to_centimeters(size, scene_scale_length),
        "boundsMinCm": vector_scene_units_to_centimeters(minimum, scene_scale_length),
        "boundsMaxCm": vector_scene_units_to_centimeters(maximum, scene_scale_length),
        "meshScale": mesh_scales[0] if len(mesh_scales) == 1 else mesh_scales,
        "armatureScale": armature_scales[0] if len(armature_scales) == 1 else armature_scales,
        "rootScale": root_scales[0] if len(root_scales) == 1 else root_scales,
        "meshScales": mesh_scales,
        "armatureScales": armature_scales,
        "rootScales": root_scales,
        "meshCount": len(meshes),
        "armatureCount": len(armatures),
        "boneCount": count_bones(armatures),
        "rootBoneExists": has_root_bone(armatures) if armatures else False,
        "skinWeights": has_skin_weights(meshes),
        "calibratedToAvatar": calibrated,
        "targetAvatarHeightCm": round(float(target_height_cm), 4) if calibrated else None,
        "skeletonHeightCm": (
            round(float(skeleton_height_cm), 4)
            if skeleton_height_cm is not None
            else None
        ),
        "skeletonGrounded": skeleton_grounded,
        "unit": "centimeter",
        "importUniformScale": 1.0,
        "fbxGlobalScale": FBX_GLOBAL_SCALE,
        "fbxApplyUnitScale": FBX_APPLY_UNIT_SCALE,
        "fbxApplyScaleOptions": FBX_APPLY_SCALE_OPTIONS,
        "fbxDeclaredUnitScaleCm": FBX_DECLARED_UNIT_SCALE_CM,
        "readyForUnreal": ready,
    }
    if not ready:
        raise RuntimeError(
            f"Unreal object validation failed: {json.dumps(metadata, separators=(',', ':'))}"
        )
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

    bpy.context.view_layer.objects.active = next(
        (obj for obj in exportable if obj.type == "ARMATURE"),
        exportable[0],
    )
    bpy.ops.export_scene.fbx(
        filepath=str(path),
        use_selection=True,
        object_types={"ARMATURE", "MESH"},
        global_scale=FBX_GLOBAL_SCALE,
        apply_unit_scale=FBX_APPLY_UNIT_SCALE,
        apply_scale_options=FBX_APPLY_SCALE_OPTIONS,
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


def validate_fbx_roundtrip(path: Path, expected_height_cm: float):
    clear_scene()
    configure_scene_units()
    bpy.ops.import_scene.fbx(filepath=str(path), global_scale=1.0)

    objects = [
        obj
        for obj in bpy.context.scene.objects
        if obj.type in {"MESH", "ARMATURE"}
    ]
    meshes = [obj for obj in objects if obj.type == "MESH"]
    armatures = [obj for obj in objects if obj.type == "ARMATURE"]
    if not meshes:
        raise RuntimeError("FBX round-trip validation did not recover a mesh")

    set_rest_pose(armatures)
    minimum, maximum, size = dimensions(meshes)
    scene_scale_length = float(bpy.context.scene.unit_settings.scale_length)
    roundtrip_height_cm = scene_units_to_centimeters(size.z, scene_scale_length)
    mesh_scales, armature_scales, root_scales, scales_clean = scales_metadata(
        objects, meshes, armatures
    )

    metadata = {
        "fbxRoundTripHeightCm": round(roundtrip_height_cm, 4),
        "fbxRoundTripDimensionsCm": vector_scene_units_to_centimeters(
            size, scene_scale_length
        ),
        "fbxRoundTripBoundsMinCm": vector_scene_units_to_centimeters(
            minimum, scene_scale_length
        ),
        "fbxRoundTripBoundsMaxCm": vector_scene_units_to_centimeters(
            maximum, scene_scale_length
        ),
        "fbxRoundTripMeshScales": mesh_scales,
        "fbxRoundTripArmatureScales": armature_scales,
        "fbxRoundTripRootScales": root_scales,
        "fbxRoundTripScalesClean": scales_clean,
        "fbxRoundTripValidated": bool(
            abs(roundtrip_height_cm - expected_height_cm) <= TOLERANCE_CM
            and scales_clean
        ),
    }
    if not metadata["fbxRoundTripValidated"]:
        raise RuntimeError(
            "FBX physical-unit round-trip validation failed: "
            f"{json.dumps(metadata, separators=(',', ':'))}"
        )
    return metadata


def run_export(
    source: Path,
    output: Path,
    target_height_cm: float = 175.0,
    mode: str = "avatar",
    metadata_path: Path | None = None,
    category: str = "prop",
    object_kind: str = "rigid",
):
    source = Path(source).resolve()
    output = Path(output).resolve()
    metadata_path = (
        Path(metadata_path).resolve()
        if metadata_path is not None
        else output.with_suffix(".json")
    )
    mode = str(mode).lower()
    category = str(category).lower()
    object_kind = str(object_kind).lower()

    if target_height_cm < 80 or target_height_cm > 260:
        raise RuntimeError("target_height_cm must be between 80 and 260")

    clear_scene()
    configure_scene_units()
    objects, meshes, armatures = import_glb(source)
    set_rest_pose(armatures)

    target_height_scene_units = centimeters_to_scene_units(target_height_cm)

    if mode == "object":
        wearable = object_kind == "wearable"
        source_skeleton_height = None
        scale_factor = 1.0
        if wearable:
            source_skeleton_height, scale_factor = prepare_wearable_object(
                objects,
                meshes,
                armatures,
                target_height_scene_units,
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
            source_skeleton_height=source_skeleton_height,
            normalization_scale_factor=scale_factor,
        )
    else:
        if not armatures:
            raise RuntimeError("The processed avatar does not contain an armature")

        _, _, before_size = dimensions(meshes)
        current_height_scene_units = float(before_size.z)
        if current_height_scene_units <= 0.001:
            raise RuntimeError("Avatar height is invalid")

        scale_factor = target_height_scene_units / current_height_scene_units
        apply_uniform_scale(objects, meshes, armatures, scale_factor)
        ground_feet(objects, meshes)
        metadata = validate_avatar(
            objects,
            meshes,
            armatures,
            target_height_cm,
            source_height_raw=current_height_scene_units,
            target_height_scene_units=target_height_scene_units,
            normalization_scale_factor=scale_factor,
        )

    expected_exported_height_cm = float(metadata["finalMeshHeightCm"])
    output.parent.mkdir(parents=True, exist_ok=True)
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    export_fbx(output)
    if not output.exists() or output.stat().st_size < 1024:
        raise RuntimeError("FBX export was empty")

    roundtrip_metadata = validate_fbx_roundtrip(
        output,
        expected_exported_height_cm,
    )
    metadata.update(roundtrip_metadata)
    metadata["readyForUnreal"] = bool(
        metadata.get("readyForUnreal")
        and roundtrip_metadata.get("fbxRoundTripValidated")
    )
    if not metadata["readyForUnreal"]:
        raise RuntimeError(
            f"Final Unreal validation failed: {json.dumps(metadata, separators=(',', ':'))}"
        )

    metadata_path.write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(
        f"[clouva-unreal-metadata] {json.dumps(metadata, separators=(',', ':'))}",
        flush=True,
    )
    return metadata


def main():
    values = args_after_separator()
    if len(values) < 2:
        raise RuntimeError(
            "Usage: export_unreal.py input.glb output.fbx "
            "[target_height_cm] [mode] [metadata.json] [category] [object_kind]"
        )

    source = Path(values[0]).resolve()
    output = Path(values[1]).resolve()
    target_height_cm = float(values[2]) if len(values) > 2 else 175.0
    mode = values[3].lower() if len(values) > 3 else "avatar"
    metadata_path = (
        Path(values[4]).resolve()
        if len(values) > 4
        else output.with_suffix(".json")
    )
    category = values[5].lower() if len(values) > 5 else "prop"
    object_kind = values[6].lower() if len(values) > 6 else "rigid"

    run_export(
        source,
        output,
        target_height_cm,
        mode,
        metadata_path,
        category,
        object_kind,
    )


if __name__ == "__main__":
    main()
