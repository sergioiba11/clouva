import json
import os
import sys

import bpy
from mathutils import Vector


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from avatar_reference import canonicalize_and_validate_bones


REFERENCE_DIR = os.path.join(SCRIPT_DIR, "avatar-reference")
FBX_PATH = os.path.join(REFERENCE_DIR, "AvatarReference.fbx")
METADATA_PATH = os.path.join(REFERENCE_DIR, "clouva_avatar_data.json")


def bbox_world(objects):
    points = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    return (
        Vector((min(point.x for point in points), min(point.y for point in points), min(point.z for point in points))),
        Vector((max(point.x for point in points), max(point.y for point in points), max(point.z for point in points))),
    )


def main():
    assert os.path.getsize(FBX_PATH) > 1024, "AvatarReference.fbx is missing or empty"
    with open(METADATA_PATH, encoding="utf-8") as handle:
        metadata = json.load(handle)
    assert metadata.get("schemaVersion") == 1
    assert metadata.get("fbx", {}).get("exported") is True
    assert not metadata.get("fbx", {}).get("errors")

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.fbx(
        filepath=FBX_PATH,
        use_anim=False,
        ignore_leaf_bones=False,
        automatic_bone_orientation=False,
        use_prepost_rot=True,
    )
    bpy.context.view_layer.update()

    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    assert len(armatures) == 1, f"Expected one armature, found {len(armatures)}"
    assert meshes, "The Unreal FBX contains no body mesh"
    armature = armatures[0]

    expected_parents = canonicalize_and_validate_bones(armature, metadata)
    actual = {bone.name for bone in armature.data.bones}

    vertices = sum(len(mesh.data.vertices) for mesh in meshes)
    weighted = sum(
        1
        for mesh in meshes
        for vertex in mesh.data.vertices
        if any(group.weight > 0.0 for group in vertex.groups)
    )
    assert vertices > 0, "The body mesh contains no vertices"
    assert weighted / vertices >= 0.95, f"Only {weighted}/{vertices} body vertices have skin weights"

    minimum, maximum = bbox_world(meshes)
    blender_height = float(maximum.z - minimum.z)
    unreal_height_cm = float(metadata["bounds"]["imported"]["sizeCm"]["z"])
    possible_cm = (blender_height, blender_height * 100.0)
    scale_error = min(abs(candidate - unreal_height_cm) / unreal_height_cm for candidate in possible_cm)
    assert scale_error <= 0.02, (
        f"FBX scale does not match Unreal bounds: blender={blender_height}, unrealCm={unreal_height_cm}"
    )
    print(
        "[clouva] Unreal AvatarReference validated "
        f"bones={len(actual)}/{len(expected_parents)} meshes={len(meshes)} "
        f"vertices={vertices} weighted={weighted} "
        f"height={blender_height:.6f} unrealHeightCm={unreal_height_cm:.6f}",
        flush=True,
    )


if __name__ == "__main__":
    main()
