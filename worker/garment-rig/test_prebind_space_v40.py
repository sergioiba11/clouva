import importlib.util
from pathlib import Path

from mathutils import Matrix


SCRIPT_PATH = Path(__file__).with_name("rig_garment.py")
AVATAR_PATH = Path(__file__).with_name("avatar-reference") / "AvatarReference.fbx"


def load_pipeline():
    spec = importlib.util.spec_from_file_location("clouva_rig_v40_test", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("No se pudo cargar el pipeline V40")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def retained_contract(module, name):
    """Resolve a contract retained by newer wrapper layers without weakening it."""
    current = module
    visited = set()
    while current is not None and id(current) not in visited:
        visited.add(id(current))
        value = getattr(current, name, None)
        if callable(value):
            return value
        current = getattr(current, "previous", None)
    raise AttributeError(f"El pipeline activo no conserva el contrato {name}")


def identity(matrix, epsilon=1e-5):
    expected = Matrix.Identity(4)
    return all(
        abs(float(matrix[row][column] - expected[row][column])) <= epsilon
        for row in range(4)
        for column in range(4)
    )


def test_official_avatar_is_normalized_before_weights(module):
    module.legacy.clear_scene()
    objects = module.legacy.import_glb(str(AVATAR_PATH))
    armature = module.legacy.find_armature(objects)
    body_meshes = module.legacy.body_meshes_for_rig(objects, armature)
    before = {obj.name: module.evaluated_world_points(obj).copy() for obj in body_meshes}

    metadata = module.legacy.validate_unreal_avatar_reference(
        str(AVATAR_PATH),
        objects,
        armature,
        body_meshes,
    )
    assert metadata
    assert identity(armature.matrix_world)
    assert int(armature.get("clouvaPrebindSpaceVersion", 0)) == 40

    relative_point_drift = retained_contract(module, "_relative_point_drift")
    maximum = 0.0
    for obj in body_meshes:
        assert identity(obj.matrix_world)
        assert obj.find_armature() == armature
        assert int(obj.get("clouvaPrebindSpaceVersion", 0)) == 40
        after = module.evaluated_world_points(obj).copy()
        drift, _rms = relative_point_drift(before[obj.name], after)
        maximum = max(maximum, drift)
    assert maximum < 0.015
    print(f"[clouva] V40 official avatar pre-bind normalization OK maxDrift={maximum:.8f}", flush=True)


def test_source_skinning_is_removed(module):
    bpy = module.legacy.bpy
    module.legacy.clear_scene()

    armature_data = bpy.data.armatures.new("SourceRig")
    source_armature = bpy.data.objects.new("SourceRig", armature_data)
    source_armature_name = source_armature.name
    bpy.context.collection.objects.link(source_armature)
    bpy.context.view_layer.objects.active = source_armature
    source_armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    hips = armature_data.edit_bones.new("SourceHips")
    hips.head = (0.0, 0.0, 0.0)
    hips.tail = (0.0, 0.0, 1.0)
    bpy.ops.object.mode_set(mode="OBJECT")

    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=0.5)
    source_mesh = bpy.context.object
    source_mesh.name = "ImportedHoodie"
    group = source_mesh.vertex_groups.new(name="SourceHips")
    group.add(list(range(len(source_mesh.data.vertices))), 1.0, "REPLACE")
    modifier = source_mesh.modifiers.new(name="Old Armature", type="ARMATURE")
    modifier.object = source_armature
    world = source_mesh.matrix_world.copy()
    source_mesh.parent = source_armature
    source_mesh.matrix_parent_inverse = source_armature.matrix_world.inverted()
    source_mesh.matrix_world = world
    bpy.context.view_layer.update()

    garment = module.legacy.prepare_garment([source_armature, source_mesh], "hoodie")
    assert garment.parent is None
    assert not garment.vertex_groups
    assert not any(modifier.type == "ARMATURE" for modifier in garment.modifiers)
    assert bool(garment.get("clouvaSourceSkinningRemoved", False))
    assert int(garment.get("clouvaFreshSourceVersion", 0)) == 40
    assert source_armature_name not in bpy.data.objects
    print("[clouva] V40 removes source armature, modifier and weights before Auto Rig", flush=True)


def main():
    module = load_pipeline()
    assert module.PREBIND_SPACE_VERSION == 40
    assert module.SPACE_CONTRACT_VERSION == 40
    assert module.legacy.validate_unreal_avatar_reference.__name__ == "validate_unreal_avatar_reference_v40"
    assert module.legacy.prepare_garment.__name__ == "prepare_garment_fresh_v40"
    assert module.legacy.export_glb.__name__ == "export_glb_v40"
    assert module.v9.validate_roundtrip_v9.__name__ == "validate_roundtrip_v40"
    test_official_avatar_is_normalized_before_weights(module)
    test_source_skinning_is_removed(module)


if __name__ == "__main__":
    main()
