import json
import sys
import tempfile
from pathlib import Path

import bpy
from mathutils import Matrix

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import autorig_avatar_v16 as autorig


def make_unrigged_input(path):
    autorig.v15.clear_scene()
    bpy.ops.import_scene.fbx(
        filepath=str(autorig.v15.REFERENCE_FBX),
        use_anim=False,
        ignore_leaf_bones=False,
        automatic_bone_orientation=False,
        use_prepost_rot=True,
    )
    bpy.context.view_layer.update()
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and len(obj.data.vertices)]
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    assert meshes and len(armatures) == 1

    for mesh in meshes:
        world = mesh.matrix_world.copy()
        mesh.parent = None
        mesh.matrix_parent_inverse = Matrix.Identity(4)
        mesh.matrix_world = world
        for modifier in list(mesh.modifiers):
            if modifier.type == "ARMATURE":
                mesh.modifiers.remove(modifier)
        mesh.vertex_groups.clear()
        mesh.scale = (1.08, 0.94, 1.12)
        autorig.v15.apply_rotation_scale(mesh)

    for armature in armatures:
        bpy.data.objects.remove(armature, do_unlink=True)

    bpy.ops.object.select_all(action="DESELECT")
    for mesh in meshes:
        mesh.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_skins=False,
        export_animations=False,
        export_apply=False,
    )


def validate_output(path):
    autorig.v15.clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(path))
    bpy.context.view_layer.update()
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and len(obj.data.vertices)]
    assert len(armatures) == 1 and meshes

    armature = armatures[0]
    names = {bone.name for bone in armature.data.bones}
    lower_names = {name.lower() for name in names}
    assert len(names) >= 50
    assert "head_end" in lower_names
    assert "headfront" in lower_names

    minimum, maximum, size = autorig.v15.bounds(meshes)
    head = next(bone for bone in armature.data.bones if bone.name.lower() == "head")
    head_end = next(bone for bone in armature.data.bones if bone.name.lower() == "head_end")
    head_vector = head_end.head_local - head.head_local
    head_ratio = (armature.matrix_world.to_3x3() @ head_vector).length / max(float(size.z), 1e-6)
    assert 0.10 <= head_ratio <= 0.20, head_ratio

    weighted = sum(
        1
        for mesh in meshes
        for vertex in mesh.data.vertices
        if any(group.weight > 1e-8 for group in vertex.groups)
    )
    vertices = sum(len(mesh.data.vertices) for mesh in meshes)
    assert weighted / vertices >= 0.995

    for obj in [armature, *meshes]:
        assert tuple(round(float(value), 6) for value in obj.scale) == (1.0, 1.0, 1.0)


def main():
    with tempfile.TemporaryDirectory(prefix="clouva-real-autorig-v16-") as directory:
        root = Path(directory)
        source = root / "original-unrigged.glb"
        output = root / "fresh-schema-rigged.glb"
        metadata = root / "fresh-schema-rigged.json"

        make_unrigged_input(source)
        profile = autorig.run(source, output, metadata)
        stored = json.loads(metadata.read_text(encoding="utf-8"))

        assert profile["complete"] is True
        assert stored["version"] == "clouva-blender-autorig-v16-fresh-schema"
        assert stored["rigSource"] == "Blender fresh CLOUVA schema"
        assert stored["inputSource"] == "original-clean-meshy-avatar"
        assert stored["schemaBuild"]["bonesCreated"] == 24
        assert stored["schemaBuild"]["reusedArmature"] is False
        assert stored["sourceCleanup"]["source"] == "original-clean-glb"
        assert stored["sourceCleanup"]["oldArmaturesRemoved"] == 0
        assert stored["landmarkFit"]["method"] == "fresh-schema-mesh-landmarks-v16"
        assert stored["headFit"]["method"] == "mesh-neck-section-to-crown-v16"
        assert 0.10 <= stored["headFit"]["lengthRatio"] <= 0.20
        assert stored["handFit"]["l"]["method"] == "target-mesh-distal-axis-and-lateral-spread-v16"
        assert stored["handFit"]["r"]["method"] == "target-mesh-distal-axis-and-lateral-spread-v16"
        assert stored["weights"]["weightedRatio"] >= 0.995
        assert stored["weights"]["maxObservedInfluences"] <= 4
        assert stored["poseValidation"]["passed"] is True
        assert stored["rigVersionId"].startswith("rig-")
        assert stored["inputSha256"] != stored["outputSha256"]

        validate_output(output)
        print("[clouva] AutoRig V16 fresh schema end-to-end validated", flush=True)


if __name__ == "__main__":
    main()
