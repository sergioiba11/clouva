import sys
from pathlib import Path
import tempfile

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import bpy
from mathutils import Vector

import complete_avatar_rig_v9 as v9
import test_complete_avatar_rig_v8 as fixture


def generated_report(armature, meshes):
    minimum, maximum, size = v9.v5.legacy.world_bounds(meshes)
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
    armature, meshes = fixture.build_parent_scaled_avatar()
    armature.data.pose_position = "REST"
    report = v9.ensure_extended_bones_v9(armature, meshes)
    assert report["geometry"]["valid"], report["geometry"]
    v9.v5.legacy.assign_extended_weights(armature, meshes, report)

    with tempfile.TemporaryDirectory(prefix="clouva-rig-v9-test-") as directory:
        output = Path(directory) / "roundtrip.glb"
        v9.v5.export_glb_with_roundtrip(output)
        assert output.is_file() and output.stat().st_size > 1024

    imported_armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    imported_meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    imported = v9.v5.legacy.choose_armature(imported_armatures)
    roundtrip_report = generated_report(imported, imported_meshes)
    geometry = v9.validate_roundtrip_joint_hierarchy(imported, roundtrip_report)
    assert geometry["valid"], geometry
    assert geometry["jointSegmentCount"] == 20, geometry
    assert geometry["maximumJointSegment"] < 0.06, geometry
    assert geometry["blenderTailIgnored"], geometry

    # glTF stores joints, not Blender edit-bone tails. A leaf tail may be rebuilt
    # arbitrarily by Blender and must not invalidate a correct exported skeleton.
    bpy.context.view_layer.objects.active = imported
    imported.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    leaf = imported.data.edit_bones.get("clouva_pinky_03_l")
    assert leaf is not None
    leaf.tail = leaf.head + Vector((0.0, 0.0, 5.0))
    bpy.ops.object.mode_set(mode="OBJECT")
    tail_only_geometry = v9.validate_roundtrip_joint_hierarchy(imported, roundtrip_report)
    assert tail_only_geometry["valid"], tail_only_geometry

    # Moving an actual joint must still be rejected because Three.js draws and
    # animates parent-to-child joint positions.
    bpy.ops.object.mode_set(mode="EDIT")
    joint = imported.data.edit_bones.get("clouva_index_02_l")
    assert joint is not None
    joint.use_connect = False
    joint.head += Vector((5.0, 0.0, 0.0))
    joint.tail += Vector((5.0, 0.0, 0.0))
    bpy.ops.object.mode_set(mode="OBJECT")
    broken_geometry = v9.validate_roundtrip_joint_hierarchy(imported, roundtrip_report)
    assert not broken_geometry["valid"], broken_geometry
    assert any(
        error.startswith("outside-avatar:clouva_index_02_l:joint")
        or error.startswith("invalid-joint-segment:clouva_index_02_l")
        for error in broken_geometry["errors"]
    ), broken_geometry

    print("[clouva] Rig V9 validates glTF joints and ignores reconstructed Blender tails")


if __name__ == "__main__":
    main()
