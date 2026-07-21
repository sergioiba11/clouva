import sys
from pathlib import Path

import bpy
from mathutils import Matrix

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import complete_avatar_rig_v7 as v7

v5 = v7.v5
VERSION = "clouva-complete-rig-v8-canonical-object-scale"
_SCALE_EPSILON = 1e-5


def scale_tuple(obj):
    return tuple(float(value) for value in obj.matrix_world.to_scale())


def is_unit_scale(values, epsilon=_SCALE_EPSILON):
    return all(abs(abs(float(value)) - 1.0) <= epsilon for value in values)


def max_vector_delta(first, second):
    return max(abs(float(first[index]) - float(second[index])) for index in range(3))


def apply_object_scale(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True, properties=False)
    obj.select_set(False)


def normalize_imported_object_scales(armature, meshes):
    """Bake inherited/object scale before creating any CLOUVA bones.

    Production GLBs can carry a 0.01 scale on an Empty/root parent. Blender's
    glTF exporter may remove that parent scale but retain newly-created bone
    coordinates, turning 3 cm fingers into 3 m fingers after roundtrip.
    Detaching the deforming objects and applying their resulting world scale
    makes Mesh and Armature canonical at local/world scale 1,1,1 while keeping
    the visible Rest Pose unchanged.
    """
    if armature.mode != "OBJECT":
        bpy.context.view_layer.objects.active = armature
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()

    objects = [armature, *meshes]
    before_bounds = v5.legacy.world_bounds(meshes)
    before_bones = {
        bone.name: (
            armature.matrix_world @ bone.head_local,
            armature.matrix_world @ bone.tail_local,
        )
        for bone in armature.data.bones
    }
    before = {
        obj.name: {
            "worldScale": scale_tuple(obj),
            "localScale": tuple(float(value) for value in obj.scale),
            "parent": obj.parent.name if obj.parent else None,
        }
        for obj in objects
    }

    # Convert inherited scale from imported Empty/root nodes into local scale.
    for obj in objects:
        world = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_parent_inverse = Matrix.Identity(4)
        obj.matrix_world = world

    bpy.context.view_layer.update()

    # Bake local scale into Mesh/Armature data. Blender preserves world geometry
    # and Rest Pose while setting object scale to 1,1,1.
    for obj in objects:
        if not is_unit_scale(tuple(float(value) for value in obj.scale)):
            apply_object_scale(obj)

    bpy.context.view_layer.update()

    after_bounds = v5.legacy.world_bounds(meshes)
    after = {
        obj.name: {
            "worldScale": scale_tuple(obj),
            "localScale": tuple(float(value) for value in obj.scale),
            "parent": obj.parent.name if obj.parent else None,
        }
        for obj in objects
    }

    height = max(float(before_bounds[2].z), 0.5)
    tolerance = max(height * 1e-4, 1e-6)
    bounds_drift = max(
        max_vector_delta(before_bounds[0], after_bounds[0]),
        max_vector_delta(before_bounds[1], after_bounds[1]),
        max_vector_delta(before_bounds[2], after_bounds[2]),
    )
    bone_drift = 0.0
    for name, (head_before, tail_before) in before_bones.items():
        bone = armature.data.bones.get(name)
        if bone is None:
            raise RuntimeError(f"Scale normalization lost source bone: {name}")
        head_after = armature.matrix_world @ bone.head_local
        tail_after = armature.matrix_world @ bone.tail_local
        bone_drift = max(
            bone_drift,
            (head_after - head_before).length,
            (tail_after - tail_before).length,
        )

    invalid_objects = [
        name
        for name, data in after.items()
        if not is_unit_scale(data["worldScale"]) or not is_unit_scale(data["localScale"])
    ]
    if invalid_objects:
        raise RuntimeError(f"Could not normalize object scale to 1,1,1: {invalid_objects}; after={after}")
    if bounds_drift > tolerance:
        raise RuntimeError(
            f"Scale normalization changed avatar bounds: drift={bounds_drift:.8f}, tolerance={tolerance:.8f}"
        )
    if bone_drift > tolerance:
        raise RuntimeError(
            f"Scale normalization changed the Rest Pose: drift={bone_drift:.8f}, tolerance={tolerance:.8f}"
        )

    return {
        "version": VERSION,
        "before": before,
        "after": after,
        "boundsDrift": bounds_drift,
        "boneDrift": bone_drift,
        "tolerance": tolerance,
        "canonicalLocalScale": [1.0, 1.0, 1.0],
    }


def validate_geometry_v8(armature, report, roundtrip=False):
    result = v7.validate_geometry_v7(armature, report, roundtrip=roundtrip)
    errors = list(result.get("errors") or [])
    armature_world_scale = scale_tuple(armature)
    armature_local_scale = tuple(float(value) for value in armature.scale)
    mesh_scales = {}

    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        mesh_scales[obj.name] = {
            "world": scale_tuple(obj),
            "local": tuple(float(value) for value in obj.scale),
        }
        if not is_unit_scale(mesh_scales[obj.name]["world"]):
            errors.append(f"non-unit-mesh-world-scale:{obj.name}:{mesh_scales[obj.name]['world']}")
        if not is_unit_scale(mesh_scales[obj.name]["local"]):
            errors.append(f"non-unit-mesh-local-scale:{obj.name}:{mesh_scales[obj.name]['local']}")

    if not is_unit_scale(armature_world_scale):
        errors.append(f"non-unit-armature-world-scale:{armature_world_scale}")
    if not is_unit_scale(armature_local_scale):
        errors.append(f"non-unit-armature-local-scale:{armature_local_scale}")

    result["valid"] = not errors
    result["errors"] = errors
    result["version"] = VERSION
    result["armatureWorldScale"] = armature_world_scale
    result["armatureLocalScale"] = armature_local_scale
    result["meshScales"] = mesh_scales
    result["space"] = "canonical-object-scale-1-world-and-local"
    return result


def ensure_extended_bones_v8(armature, meshes):
    normalization = normalize_imported_object_scales(armature, meshes)
    report = v7.ensure_extended_bones_v7(armature, meshes)
    report["normalization"] = normalization
    report["geometry"] = validate_geometry_v8(armature, report)
    return report


_original_validate_profile = v5.validate_profile


def validate_profile_v8(armature, report, finger_weighted, ear_weighted, fallback):
    profile = _original_validate_profile(armature, report, finger_weighted, ear_weighted, fallback)
    profile["version"] = VERSION
    profile["normalization"] = report.get("normalization")
    profile["geometry"] = report.get("geometry")
    profile["complete"] = bool(
        profile.get("complete")
        and profile["geometry"]
        and profile["geometry"].get("valid")
    )
    return profile


v5.VERSION = VERSION
v5.ensure_extended_bones = ensure_extended_bones_v8
v5.validate_geometry = validate_geometry_v8
v5.validate_profile = validate_profile_v8
v5.legacy.ensure_extended_bones = ensure_extended_bones_v8
v5.legacy.validate_profile = validate_profile_v8

if __name__ == "__main__":
    v5.legacy.main()
