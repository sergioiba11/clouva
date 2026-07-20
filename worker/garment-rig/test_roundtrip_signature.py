import importlib.util
import math
from pathlib import Path


SCRIPT_PATH = Path(__file__).with_name("rig_garment.py")


def load_pipeline():
    spec = importlib.util.spec_from_file_location("clouva_rig_v36_test", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("No se pudo cargar el pipeline V36")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def axis_size(module, obj):
    minimum, maximum = module.legacy.bbox_world(obj)
    return maximum - minimum


def test_rotation_invariant_shape(module, garment):
    bpy = module.legacy.bpy
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
        raise AssertionError("V36 accepted a real non-uniform scale change")

    return old_depth_error


def test_near_centroid_anchor(module):
    # Reproduces the exact production diagnostics. Hips is close to the hoodie
    # centroid, so a tiny absolute delta looked like 19.04% under the V35 denominator.
    expected_distances = {
        "hips": 0.040000,
        "chest": 0.250000,
        "neck": 0.330000,
        "left_upper_arm": 0.285000,
        "right_upper_arm": 0.286000,
    }
    production_relative_errors = {
        "hips": 0.1904,
        "chest": 0.0025,
        "neck": 0.0003,
        "left_upper_arm": 0.0000,
        "right_upper_arm": 0.0001,
    }
    actual_distances = {
        key: value * (1.0 + production_relative_errors[key])
        for key, value in expected_distances.items()
    }
    expected = {"distances": expected_distances, "referenceScale": 0.34}
    actual = {"distances": actual_distances, "referenceScale": 0.34}

    metrics = module.validate_anchor_metrics(expected, actual)
    assert round(metrics["relativeErrors"]["hips"], 4) == 0.1904
    assert metrics["normalizedErrors"]["hips"] < 0.03
    assert metrics["second"] < 0.01

    # A real coherent shift changes several independent anchors and must still fail.
    shifted = {
        "distances": dict(expected_distances),
        "referenceScale": 0.34,
    }
    shifted["distances"]["chest"] += 0.050
    shifted["distances"]["neck"] += 0.045
    shifted["distances"]["left_upper_arm"] += 0.044
    try:
        module.validate_anchor_metrics(expected, shifted)
    except RuntimeError as exc:
        assert "desplazó la prenda" in str(exc)
    else:
        raise AssertionError("V36 accepted a coherent garment displacement")

    return metrics


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

    old_depth_error = test_rotation_invariant_shape(module, garment)
    anchor_metrics = test_near_centroid_anchor(module)

    print(
        "[clouva] V36 stable GLB roundtrip regression OK "
        f"oldDepthError={old_depth_error:.4f} hipsRelative="
        f"{anchor_metrics['relativeErrors']['hips']:.4f} hipsNormalized="
        f"{anchor_metrics['normalizedErrors']['hips']:.4f}",
        flush=True,
    )


if __name__ == "__main__":
    main()
