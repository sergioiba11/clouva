import sys
from pathlib import Path
import tempfile

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import bpy
from mathutils import Vector

import complete_avatar_rig_v10 as v10


def build_anatomical_avatar():
    v10.v5.legacy.clear_scene()

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
    head_end.tail = Vector((0.0, 0.0, 165.0))
    head_end.parent = head
    head_end.use_connect = True
    head_end.use_deform = False

    left_forearm = bones.new("LeftForeArm")
    left_forearm.head = Vector((34.0, 0.0, 116.0))
    left_forearm.tail = Vector((48.0, 0.0, 105.0))
    left_forearm.parent = spine
    left_forearm.use_deform = True

    left_hand = bones.new("LeftHand")
    left_hand.head = left_forearm.tail.copy()
    left_hand.tail = Vector((53.0, 0.0, 96.0))
    left_hand.parent = left_forearm
    left_hand.use_connect = True
    left_hand.use_deform = True

    right_forearm = bones.new("RightForeArm")
    right_forearm.head = Vector((-34.0, 0.0, 116.0))
    right_forearm.tail = Vector((-48.0, 0.0, 105.0))
    right_forearm.parent = spine
    right_forearm.use_deform = True

    right_hand = bones.new("RightHand")
    right_hand.head = right_forearm.tail.copy()
    right_hand.tail = Vector((-53.0, 0.0, 96.0))
    right_hand.parent = right_forearm
    right_hand.use_connect = True
    right_hand.use_deform = True

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


def generated_report(armature, meshes):
    minimum, maximum, size = v10.v5.legacy.world_bounds(meshes)
    names = [bone.name for bone in armature.data.bones]
    return {
        "fingerNames": sorted(
            name
            for name in names
            if name.startswith("clouva_")
            and not name.startswith("clouva_ear_")
            and not name.startswith("clouva_palm_root_")
        ),
        "earNames": sorted(name for name in names if name.startswith("clouva_ear_")),
        "bounds": (minimum, maximum, size),
    }


def main():
    armature, meshes = build_anatomical_avatar()
    armature.data.pose_position = "REST"
    report = v10.ensure_extended_bones_v10(armature, meshes)
    assert report["geometry"]["valid"], report["geometry"]
    assert report["geometry"]["maximumFingerLateralAlignment"] < 0.72, report["geometry"]
    assert report["geometry"]["minimumFingerHandAlignment"] > 0.30, report["geometry"]
    assert report["fingerAxis"] == "continuation-of-real-hand"
    assert report["earPlacement"] == "head-bone-midpoint-and-mesh-width"

    v10.v5.legacy.assign_extended_weights(armature, meshes, report)
    with tempfile.TemporaryDirectory(prefix="clouva-rig-v10-test-") as directory:
        output = Path(directory) / "roundtrip.glb"
        v10.v5.export_glb_with_roundtrip(output)
        assert output.is_file() and output.stat().st_size > 1024

    imported_armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    imported_meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    imported = v10.v5.legacy.choose_armature(imported_armatures)
    roundtrip_report = generated_report(imported, imported_meshes)
    geometry = v10.validate_geometry_v10(imported, roundtrip_report, roundtrip=True)
    assert geometry["valid"], geometry
    assert geometry["maximumFingerLateralAlignment"] < 0.72, geometry

    bpy.context.view_layer.objects.active = imported
    imported.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    first = imported.data.edit_bones.get("clouva_index_01_l")
    second = imported.data.edit_bones.get("clouva_index_02_l")
    third = imported.data.edit_bones.get("clouva_index_03_l")
    assert first and second and third
    second.use_connect = False
    third.use_connect = False
    second.head = first.head + Vector((0.08, 0.0, 0.0))
    second.tail = second.head + Vector((0.08, 0.0, 0.0))
    third.head = second.head + Vector((0.08, 0.0, 0.0))
    third.tail = third.head + Vector((0.08, 0.0, 0.0))
    bpy.ops.object.mode_set(mode="OBJECT")
    broken = v10.validate_geometry_v10(imported, roundtrip_report, roundtrip=True)
    assert not broken["valid"], broken
    assert any(error.startswith("sideways-finger-chain:l:index") for error in broken["errors"]), broken

    print("[clouva] Rig V10 follows the real hand axis and keeps ears on the anatomical head")


if __name__ == "__main__":
    main()
