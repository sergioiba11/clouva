import json
import math
import os
from pathlib import Path

from mathutils import Vector

import export_unreal_clean as previous


base = previous.base
EXPORT_VERSION = "v31-garment-mesh-target-height"

_previous_prepare = base.prepare_wearable_object
_previous_validate = base.validate_object
_previous_volume_repair = previous._repair_collapsed_garment_volume

_GARMENT_HEIGHT_METADATA = None


def _finite_positive(value, label):
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise RuntimeError(f"{label} no es numérico") from exc
    if not math.isfinite(number) or number <= 0.0:
        raise RuntimeError(f"{label} debe ser positivo")
    return number


def _scale_mesh_vertices_world(meshes, center, factors):
    snapshots = [
        (mesh, [mesh.matrix_world @ vertex.co.copy() for vertex in mesh.data.vertices])
        for mesh in meshes
    ]
    for mesh, world_vertices in snapshots:
        inverse = mesh.matrix_world.inverted_safe()
        for vertex, world in zip(mesh.data.vertices, world_vertices):
            delta = world - center
            scaled = center + Vector((
                delta.x * float(factors[0]),
                delta.y * float(factors[1]),
                delta.z * float(factors[2]),
            ))
            vertex.co = inverse @ scaled
        mesh.data.update()
    base.bpy.context.view_layer.update()


def _horizontal_contract(meshes, category, target_height_units):
    minimum, maximum, size = base.dimensions(meshes)
    center = (minimum + maximum) * 0.5
    limits_cm = previous.CATEGORY_VOLUME_LIMITS_CM.get(category)
    major_floor, minor_floor = previous.CATEGORY_ASPECT_FLOORS.get(category, (0.55, 0.16))

    current_x = _finite_positive(size.x, "ancho de la prenda")
    current_y = _finite_positive(size.y, "profundidad de la prenda")
    height = _finite_positive(target_height_units, "altura objetivo de la prenda")

    if limits_cm is None:
        major_min_cm, major_max_cm = 3.0, 180.0
        minor_min_cm, minor_max_cm = 1.0, 100.0
    else:
        major_min_cm, major_max_cm, minor_min_cm, minor_max_cm, _, _ = limits_cm

    major_min = base.centimeters_to_scene_units(major_min_cm)
    major_max = base.centimeters_to_scene_units(major_max_cm)
    minor_min = base.centimeters_to_scene_units(minor_min_cm)
    minor_max = base.centimeters_to_scene_units(minor_max_cm)

    current_major = max(current_x, current_y)
    current_minor = min(current_x, current_y)
    desired_major = min(major_max, max(major_min, current_major, height * major_floor))
    desired_minor = min(minor_max, max(minor_min, current_minor, height * minor_floor))

    if current_x >= current_y:
        desired_x, desired_y = desired_major, desired_minor
    else:
        desired_x, desired_y = desired_minor, desired_major

    factor_x = desired_x / current_x
    factor_y = desired_y / current_y
    _scale_mesh_vertices_world(meshes, center, (factor_x, factor_y, 1.0))

    _, _, final_size = base.dimensions(meshes)
    return {
        "beforeSceneUnits": [round(float(value), 8) for value in size],
        "afterSceneUnits": [round(float(value), 8) for value in final_size],
        "axisFactors": [round(float(factor_x), 8), round(float(factor_y), 8), 1.0],
        "majorFloorRatio": float(major_floor),
        "minorFloorRatio": float(minor_floor),
    }


def prepare_wearable_object_v31(objects, meshes, armatures, target_height_scene_units):
    global _GARMENT_HEIGHT_METADATA

    if not previous._PRESERVE_WEARABLE_SOURCE:
        return _previous_prepare(objects, meshes, armatures, target_height_scene_units)

    # V28 correctly normalises the shared armature against the active avatar, but its
    # volume repair ran while the garment still had the oversized intermediate height.
    # Defer that repair until the visible mesh is at its category target height.
    previous._repair_collapsed_garment_volume = lambda _meshes, _category: {
        "applied": False,
        "source": "deferred-to-v31",
    }
    try:
        source_skeleton_height, avatar_scale_factor = _previous_prepare(
            objects,
            meshes,
            armatures,
            target_height_scene_units,
        )
    finally:
        previous._repair_collapsed_garment_volume = _previous_volume_repair

    category = str(getattr(base, "_clouva_active_category", "prop"))
    garment_target_cm = _finite_positive(
        os.environ.get("CLOUVA_GARMENT_TARGET_HEIGHT_CM", "80"),
        "CLOUVA_GARMENT_TARGET_HEIGHT_CM",
    )
    garment_target_units = base.centimeters_to_scene_units(garment_target_cm)

    minimum, maximum, before_size = base.dimensions(meshes)
    before_height = _finite_positive(before_size.z, "altura visible intermedia de la prenda")
    center = (minimum + maximum) * 0.5
    mesh_height_factor = garment_target_units / before_height

    # Scale only mesh vertices. The armature remains calibrated to the complete avatar
    # height, while the hoodie/pants/shoes keep their own physical category height.
    _scale_mesh_vertices_world(
        meshes,
        center,
        (mesh_height_factor, mesh_height_factor, mesh_height_factor),
    )
    horizontal = _horizontal_contract(meshes, category, garment_target_units)
    _, _, final_size = base.dimensions(meshes)

    final_height_cm = base.scene_units_to_centimeters(
        float(final_size.z),
        float(base.bpy.context.scene.unit_settings.scale_length),
    )
    _GARMENT_HEIGHT_METADATA = {
        "version": EXPORT_VERSION,
        "targetHeightCm": round(garment_target_cm, 4),
        "beforeHeightSceneUnits": round(before_height, 8),
        "targetHeightSceneUnits": round(float(garment_target_units), 8),
        "meshHeightFactor": round(mesh_height_factor, 10),
        "finalHeightCm": round(float(final_height_cm), 4),
        "armatureScalePreserved": True,
        "horizontalContract": horizontal,
    }
    previous._LAST_VOLUME_REPAIR = {
        "applied": True,
        "source": "v31-category-height-and-aspect",
        **horizontal,
    }
    if isinstance(previous._AVATAR_REFERENCE_METADATA, dict):
        previous._AVATAR_REFERENCE_METADATA["garmentMeshTargetHeightCm"] = round(garment_target_cm, 4)
        previous._AVATAR_REFERENCE_METADATA["garmentMeshHeightFactor"] = round(mesh_height_factor, 10)
        previous._AVATAR_REFERENCE_METADATA["armatureScalePreserved"] = True

    return source_skeleton_height, avatar_scale_factor


def validate_object_v31(
    objects,
    meshes,
    armatures,
    target_height_cm,
    category,
    wearable,
    *,
    source_skeleton_height,
    normalization_scale_factor,
):
    metadata = _previous_validate(
        objects,
        meshes,
        armatures,
        target_height_cm,
        category,
        wearable,
        source_skeleton_height=source_skeleton_height,
        normalization_scale_factor=normalization_scale_factor,
    )

    if not (previous._PRESERVE_WEARABLE_SOURCE and wearable):
        return metadata

    garment_target_cm = _finite_positive(
        os.environ.get("CLOUVA_GARMENT_TARGET_HEIGHT_CM", "80"),
        "CLOUVA_GARMENT_TARGET_HEIGHT_CM",
    )
    final_height_cm = float(metadata.get("finalMeshHeightCm", 0.0))
    tolerance_cm = max(1.5, garment_target_cm * 0.025)
    height_valid = bool(
        math.isfinite(final_height_cm)
        and abs(final_height_cm - garment_target_cm) <= tolerance_cm
    )

    metadata.update({
        "target": "unreal-garment",
        "targetHeightCm": round(garment_target_cm, 4),
        "targetHeightInSceneUnits": round(
            float(base.centimeters_to_scene_units(garment_target_cm)),
            8,
        ),
        "garmentMeshTargetHeightCm": round(garment_target_cm, 4),
        "garmentMeshHeightValid": height_valid,
        "garmentMeshHeightToleranceCm": round(tolerance_cm, 4),
        "garmentHeightNormalization": _GARMENT_HEIGHT_METADATA,
        "armatureTargetHeightCm": round(float(target_height_cm), 4),
        "readyForUnreal": bool(metadata.get("readyForUnreal") and height_valid),
    })
    if not metadata["readyForUnreal"]:
        raise RuntimeError(
            f"Unreal V31 garment validation failed: {json.dumps(metadata, separators=(',', ':'))}"
        )
    return metadata


base.prepare_wearable_object = prepare_wearable_object_v31
base.validate_object = validate_object_v31


if __name__ == "__main__":
    base.main()
