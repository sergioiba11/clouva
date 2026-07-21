import sys
from pathlib import Path
import tempfile

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import bpy
from mathutils import Vector

import complete_avatar_rig_v7 as v7


def build_scaled_avatar():
    v7.v5.legacy.clear_scene()

    armature_data = bpy.data.armatures.new("Armature")
    armature = bpy.data.objects.new("Armature", armature_data)
    bpy.context.collection.objects.link(armature)
    armature.scale = (0.01, 0.01, 0.01)
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

    bpy.ops.mesh.primitive_cube_add(location=(0.0, 0.0, 0.9))
    mesh = bpy.context.object
    mesh.name = "AvatarMesh"
    mesh.dimensions = (1.25, 0.45, 1.80)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    modifier = mesh.modifiers.new(name="Armature", type="ARMATURE")
    modifier.object = armature
    root_group = mesh.vertex_groups.new(name="Root")
    root_group.add([vertex.index for vertex in mesh.data.vertices], 1.0, "REPLACE")
    return armature, [mesh]


def main():
    armature, meshes = build_scaled_avatar()
    armature.data.pose_position = "REST"
    report = v7.ensure_extended_bones_v7(armature, meshes)
    v7.v5.legacy.assign_extended_weights(armature, meshes, report)
    assert report["headSource"] == "Head", report
    assert report["geometry"]["valid"], report["geometry"]

    with tempfile.TemporaryDirectory(prefix="clouva-rig-v7-test-") as directory:
        output = Path(directory) / "roundtrip.glb"
        v7.v5.export_glb_with_roundtrip(output)
        assert output.is_file() and output.stat().st_size > 1024

    print("[clouva] Rig V7 scaled-armature roundtrip OK")


if __name__ == "__main__":
    main()
