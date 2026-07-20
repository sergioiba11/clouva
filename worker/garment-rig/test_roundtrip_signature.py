import importlib.util
import math
from pathlib import Path


SCRIPT_PATH = Path(__file__).with_name("rig_garment.py")


def load_pipeline():
    spec = importlib.util.spec_from_file_location("clouva_rig_v35_test", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("No se pudo cargar el pipeline V35")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def axis_size(module, obj):
    minimum, maximum = module.legacy.bbox_world(obj)
    return maximum - minimum


def main():
    module = load_pipeline()
    bpy = module.legacy.bpy
    module.legacy.clear_scene()

    bpy.ops.mesh.primitive_cube_add()
    garment = bpy.context.object
    garment.dimensions = (0.416829, 0.179497, 0.298890)
    bpy.context.view_layer.update()
    module.legacy.select_only(garment)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    before_aabb = axis_size(module, garment)
    expected, _centroid = module.shape_signature(module.evaluated_world_points(garment))

    # This reproduces the production failure: a harmless X rotation makes the old
    # world-axis AABB look roughly 47% deeper even though the cuboid was not scaled.
    garment.rotation_euler.x = math.radians(18.3)
    bpy.context.view_layer.update()
    rotated_aabb = axis_size(module, garment)
    old_depth_error = abs(float(rotated_aabb.y - before_aabb.y)) / float(before_aabb.y)
    assert old_depth_error > 0.35, old_depth_error

    rotated, _centroid = module.shape_signature(module.evaluated_world_points(garment))
    module.validate_shape_metrics(expected, rotated)

    # A real non-uniform scale must still be rejected by the new contract.
    garment.scale.y *= 1.45
    bpy.context.view_layer.update()
    distorted, _centroid = module.shape_signature(module.evaluated_world_points(garment))
    try:
        module.validate_shape_metrics(expected, distorted)
    except RuntimeError as exc:
        assert "deformó o escaló" in str(exc)
    else:
        raise AssertionError("V35 accepted a real non-uniform scale change")

    print(
        "[clouva] V35 rotation-invariant roundtrip regression OK "
        f"oldDepthError={old_depth_error:.4f}",
        flush=True,
    )


if __name__ == "__main__":
    main()
