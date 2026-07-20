import json
import math
import sys
import tempfile
from pathlib import Path

import bpy

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import export_unreal_clean as exporter


TARGET_HEIGHT_CM = 175.0
SOURCE_FACTORS = (0.01, 1.0, 10.0)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def configure_metric_scene():
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "METERS"
    scene.unit_settings.scale_length = 1.0


def create_rigged_avatar_glb(path: Path, height_units: float):
    clear_scene()
    configure_metric_scene()

    bpy.ops.mesh.primitive_cube_add(
        location=(0.0, 0.0, height_units * 0.5),
    )
    mesh = bpy.context.object
    mesh.name = "AvatarMesh"
    mesh.scale = (
        max(height_units * 0.12, 0.001),
        max(height_units * 0.08, 0.001),
        height_units * 0.5,
    )
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    armature_data = bpy.data.armatures.new("AvatarArmature")
    armature = bpy.data.objects.new("AvatarArmature", armature_data)
    bpy.context.collection.objects.link(armature)
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    root = armature_data.edit_bones.new("root")
    root.head = (0.0, 0.0, 0.0)
    root.tail = (0.0, 0.0, height_units)
    bpy.ops.object.mode_set(mode="OBJECT")

    vertex_group = mesh.vertex_groups.new(name="root")
    vertex_group.add(
        [vertex.index for vertex in mesh.data.vertices],
        1.0,
        "REPLACE",
    )
    modifier = mesh.modifiers.new(name="Armature", type="ARMATURE")
    modifier.object = armature
    mesh.parent = armature

    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
    )
    if not path.exists() or path.stat().st_size < 1024:
        raise RuntimeError(f"Synthetic GLB was not created: {path}")


def assert_scale_list_is_clean(scales, label):
    for scale in scales:
        if len(scale) != 3 or any(
            not math.isclose(float(value), 1.0, abs_tol=1e-4)
            for value in scale
        ):
            raise AssertionError(f"{label} is not 1,1,1: {scales}")


def main():
    results = []
    with tempfile.TemporaryDirectory(prefix="clouva-unreal-units-test-") as directory:
        root = Path(directory)

        for factor in SOURCE_FACTORS:
            source = root / f"avatar-source-{factor}.glb"
            output = root / f"avatar-output-{factor}.fbx"
            metadata_path = root / f"avatar-output-{factor}.json"
            create_rigged_avatar_glb(
                source,
                (TARGET_HEIGHT_CM / 100.0) * factor,
            )

            metadata = exporter.base.run_export(
                source,
                output,
                TARGET_HEIGHT_CM,
                "avatar",
                metadata_path,
                "avatar",
                "rigid",
            )

            assert metadata["readyForUnreal"] is True
            assert metadata["fbxRoundTripValidated"] is True
            assert math.isclose(
                float(metadata["finalMeshHeightCm"]),
                TARGET_HEIGHT_CM,
                abs_tol=2.0,
            )
            assert math.isclose(
                float(metadata["fbxRoundTripHeightCm"]),
                TARGET_HEIGHT_CM,
                abs_tol=2.0,
            )
            assert math.isclose(
                float(metadata["sceneScaleLength"]),
                1.0,
                abs_tol=1e-8,
            )
            assert math.isclose(
                float(metadata["targetHeightInSceneUnits"]),
                TARGET_HEIGHT_CM / 100.0,
                abs_tol=1e-8,
            )
            assert metadata["fbxGlobalScale"] == 1.0
            assert metadata["fbxApplyUnitScale"] is True
            assert metadata["fbxApplyScaleOptions"] == "FBX_SCALE_UNITS"
            assert metadata["fbxDeclaredUnitScaleCm"] == 100.0
            assert_scale_list_is_clean(metadata["meshScales"], "meshScales")
            assert_scale_list_is_clean(metadata["armatureScales"], "armatureScales")
            assert_scale_list_is_clean(metadata["rootScales"], "rootScales")

            expected_normalization = 1.0 / factor
            assert math.isclose(
                float(metadata["normalizationScaleFactor"]),
                expected_normalization,
                rel_tol=1e-4,
                abs_tol=1e-4,
            ), (
                factor,
                metadata["normalizationScaleFactor"],
                expected_normalization,
            )

            persisted = json.loads(metadata_path.read_text(encoding="utf-8"))
            assert persisted == metadata
            assert output.exists() and output.stat().st_size >= 1024
            results.append(metadata)

    final_heights = [float(item["fbxRoundTripHeightCm"]) for item in results]
    if max(final_heights) - min(final_heights) > 0.01:
        raise AssertionError(
            f"Normalized FBX heights are not identical: {final_heights}"
        )

    normalization_factors = [
        float(item["normalizationScaleFactor"])
        for item in results
    ]
    if len(set(round(value, 6) for value in normalization_factors)) != len(SOURCE_FACTORS):
        raise AssertionError(
            "The exporter appears to be using a fixed visual scale instead of measured bounds"
        )

    print(
        "[clouva] Unreal unit normalization smoke test OK "
        f"heights={final_heights} factors={normalization_factors}",
        flush=True,
    )


if __name__ == "__main__":
    main()
