import importlib.util
from pathlib import Path

from mathutils import Matrix


SCRIPT_PATH = Path(__file__).with_name("rig_garment.py")


def load_pipeline():
    spec = importlib.util.spec_from_file_location("clouva_rig_v39_test", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("No se pudo cargar el pipeline V39")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def identity(matrix, epsilon=1e-5):
    expected = Matrix.Identity(4)
    return all(
        abs(float(matrix[row][column] - expected[row][column])) <= epsilon
        for row in range(4)
        for column in range(4)
    )


def main():
    module = load_pipeline()
    bpy = module.legacy.bpy
    module.legacy.clear_scene()

    armature_data = bpy.data.armatures.new("TestArmature")
    armature = bpy.data.objects.new("TestArmature", armature_data)
    bpy.context.collection.objects.link(armature)
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    hips = armature_data.edit_bones.new("Hips")
    hips.head = (0.0, 0.0, 0.0)
    hips.tail = (0.0, 0.0, 0.01)
    bpy.ops.object.mode_set(mode="OBJECT")
    armature.scale = (100.0, 100.0, 100.0)

    bpy.ops.mesh.primitive_cube_add(size=0.45, location=(0.0, 0.0, 0.5))
    garment = bpy.context.object
    garment.name = "CLOUVA_Test_Garment"
    group = garment.vertex_groups.new(name="Hips")
    group.add(list(range(len(garment.data.vertices))), 1.0, "REPLACE")
    modifier = garment.modifiers.new(name="CLOUVA Armature", type="ARMATURE")
    modifier.object = armature

    world = garment.matrix_world.copy()
    garment.parent = armature
    garment.matrix_parent_inverse = armature.matrix_world.inverted()
    garment.matrix_world = world
    bpy.context.view_layer.update()

    before = module.evaluated_world_points(garment).copy()
    report = module.normalize_shared_space_v39(garment, armature)
    after = module.evaluated_world_points(garment).copy()
    maximum_drift, _rms = module._points_metrics(before, after)

    assert identity(armature.matrix_world)
    assert identity(garment.matrix_world)
    assert garment.find_armature() == armature
    assert int(garment.get("clouvaSharedSpaceVersion", 0)) == 39
    assert maximum_drift < 0.015
    assert report["before"]["armature"]["scale"][0] == 100.0
    print(
        "[clouva] V39 shared-space normalization smoke test OK "
        f"maximumDrift={maximum_drift:.8f}",
        flush=True,
    )


if __name__ == "__main__":
    main()
