import sys
from pathlib import Path
import tempfile

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import bpy
from mathutils import Vector

import complete_avatar_rig_v8 as v8


def build_parent_scaled_avatar():
    v8.v5.legacy.clear_scene()

    scaled_root = bpy.data.objects.new("ImportedRootScale001", None)
    bpy.context.collection.objects.link(scaled_root)
    scaled_root.scale = (0.01, 0.01, 0.01)

    armature_data = bpy.data.armatures.new("Armature")
    armature = bpy.data.objects.new("Armature", armature_data)
    bpy.context.collection.objects.link(armature)
    armature.parent = scaled_root
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bones = armature.data.edit_bones

    root = bones.new("Root")
    root.head = Vector((0.0, 0.0, 0.0))
    root.tail = Vector((0.0, 0.0, 90.0))

    spine = bones.new("Spine")
    spine.head = root.tail.copy()
    spine.tail = Vector((0.0, 0.0, 125.0))
    spine.parent = root
    spine.use_connect = True

    head = bones.new("Head")
    head.head = Vector((0.0, 0.0, 125.0))
    head.tail = Vector((0.0, 0.0, 155.0))
    head.parent = spine
    head.use_connect = True
    head.use_deform = True

    head_end = bones.new("head_end")
    head_end.head = head.tail.copy()
    head_end.tail = Vector((0.0, 0.0, 185.0))
    head_end.parent = head
    head_end.use_connect = True
    head_end.use_deform = False

    left = bones.new("LeftHand")
    left.head = Vector((48.0, 0.0, 105.0))
    left.tail = Vector((60.0, 0.0, 105.0))
    left.parent = spine
    left.use_deform = True

    right = bones.new("RightHand")
    right.head = Vector((-48.0, 0.0, 105.0))
    right.tail = Vector((-60.0, 0.0, 105.0))
    right.parent = spine
    right.use_deform = True

    bpy.ops.object.mode_set(mode="OBJECT")
    armature.select_set(False)

    bpy.ops.mesh.primitive_cube_add(location=(0.0, 0.0, 90.0))
    mesh = bpy.context.object
    mesh.name = "AvatarMesh"
    mesh.dimensions = (125.0, 45.0, 180.0)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    mesh.parent = scaled_root
    modifier = mesh.modifiers.new(name="Armature", type="ARMATURE")
    modifier.object = armature
    root_group = mesh.vertex_groups.new(name="Root")
    root_group.add([vertex.index for vertex in mesh.data.vertices], 1.0, "REPLACE")
    bpy.context.view_layer.update()
    return armature, [mesh]


def assert_unit_scale(obj):
    local = tuple(float(value) for value in obj.scale)
    world = tuple(float(value) for value in obj.matrix_world.to_scale())
    assert v8.is_unit_scale(local), (obj.name, "local", local)
    assert v8.is_unit_scale(world), (obj.name, "world", world)


def main():
    armature, meshes = build_parent_scaled_avatar()
    before_height = float(v8.v5.legacy.world_bounds(meshes)[2].z)
    assert 1.7 <= before_height <= 1.9, before_height
    assert not v8.is_unit_scale(tuple(float(value) for value in armature.matrix_world.to_scale()))

    armature.data.pose_position = "REST"
    report = v8.ensure_extended_bones_v8(armature, meshes)
    assert report["headSource"] == "Head", report
    assert report["geometry"]["valid"], report["geometry"]
    assert report["normalization"]["before"]["Armature"]["worldScale"][0] < 0.02
    assert_unit_scale(armature)
    for mesh in meshes:
        assert_unit_scale(mesh)
        assert mesh.parent is None
    assert armature.parent is None

    v8.v5.legacy.assign_extended_weights(armature, meshes, report)

    with tempfile.TemporaryDirectory(prefix="clouva-rig-v8-test-") as directory:
        output = Path(directory) / "roundtrip.glb"
        v8.v5.export_glb_with_roundtrip(output)
        assert output.is_file() and output.stat().st_size > 1024

    imported_armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    imported_meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    imported = v8.v5.legacy.choose_armature(imported_armatures)
    assert_unit_scale(imported)
    for mesh in imported_meshes:
        assert_unit_scale(mesh)

    finger_lengths = []
    for bone in imported.data.bones:
        if bone.name.startswith("clouva_") and any(
            finger in bone.name for finger in v8.v5.legacy.FINGER_NAMES
        ):
            head_world = imported.matrix_world @ bone.head_local
            tail_world = imported.matrix_world @ bone.tail_local
            finger_lengths.append((tail_world - head_world).length)
    assert len(finger_lengths) == 30, len(finger_lengths)
    assert max(finger_lengths) < 0.06, max(finger_lengths)
    assert min(finger_lengths) > 0.004, min(finger_lengths)

    print(
        "[clouva] Rig V8 inherited 0.01 root scale normalized and roundtrip OK",
        min(finger_lengths),
        max(finger_lengths),
    )


if __name__ == "__main__":
    main()
