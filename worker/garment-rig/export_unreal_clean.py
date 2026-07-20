import json
import math
import sys
from pathlib import Path

from mathutils import Vector

# Blender executes --python files from a temporary working directory and does not
# always add /app (the Worker scripts directory) to sys.path.
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import export_unreal as base


# Some valid CLOUVA rigs contain helper/control bones whose endpoints extend far
# outside the visible body. The mesh can be exactly 175 cm, grounded, weighted and
# clean while the raw all-bone bounds look implausible. Keep the diagnostic, but do
# not reject an otherwise valid avatar only because of helper-bone bounds.
_original_validate_avatar = base.validate_avatar


def validate_avatar_without_helper_bone_false_positive(*args, **kwargs):
    try:
        return _original_validate_avatar(*args, **kwargs)
    except RuntimeError as exc:
        prefix = "Unreal validation failed: "
        message = str(exc)
        if not message.startswith(prefix):
            raise

        try:
            metadata = json.loads(message[len(prefix):])
        except json.JSONDecodeError:
            raise

        only_skeleton_bounds_failed = bool(
            metadata.get("skeletonHeightPlausible") is False
            and abs(float(metadata.get("finalMeshHeightCm", 0.0)) - float(metadata.get("targetHeightCm", 0.0))) <= base.TOLERANCE_CM
            and metadata.get("feetGrounded") is True
            and metadata.get("rootBoneExists") is True
            and metadata.get("skinWeights") is True
            and int(metadata.get("boneCount", 0)) > 0
            and all(
                all(abs(float(value) - 1.0) <= 1e-4 for value in scale)
                for key in ("meshScales", "armatureScales", "rootScales")
                for scale in metadata.get(key, [])
            )
        )
        if not only_skeleton_bounds_failed:
            raise

        metadata["skeletonBoundsWarning"] = (
            "Raw skeleton bounds include helper/control bones outside the visible body; "
            "mesh height, grounding, weights and transforms are valid."
        )
        metadata["readyForUnreal"] = True
        return metadata


base.validate_avatar = validate_avatar_without_helper_bone_false_positive


# ---------------------------------------------------------------------------
# V27: garment-aware Unreal export
# ---------------------------------------------------------------------------
# A rigged garment already shares the avatar armature. Treating it as a complete
# avatar and normalising only its visible height can destroy the width/depth stored
# by the rigging pass. The active API now calls the exporter with
# object_kind=wearable-preserve. In that mode we keep the skeleton scale, recover
# the fitted garment volume from GLB extras, repair only collapsed horizontal axes,
# and validate all three dimensions after an FBX round-trip.

_PRESERVE_WEARABLE_SOURCE = False
_EXPECTED_DIMENSIONS_CM = None
_LAST_VOLUME_REPAIR = None

CATEGORY_PADDING = {
    "hoodie": Vector((1.04, 1.18, 1.08)),
    "shirt": Vector((1.02, 1.12, 1.04)),
    "jacket": Vector((1.06, 1.22, 1.10)),
    "pants": Vector((1.08, 1.15, 1.00)),
    "shorts": Vector((1.08, 1.15, 1.00)),
    "shoes": Vector((1.10, 1.15, 1.04)),
}

# (horizontal major min/max, horizontal minor min/max, vertical min/max), cm.
# These are deliberately broad game-avatar limits. They reject physically absurd
# outputs such as 8 x 6 x 69 cm without forcing every CLOUVA design into one cut.
CATEGORY_VOLUME_LIMITS_CM = {
    "hoodie": (35.0, 120.0, 10.0, 65.0, 35.0, 110.0),
    "shirt": (30.0, 110.0, 8.0, 55.0, 30.0, 100.0),
    "jacket": (35.0, 130.0, 10.0, 75.0, 35.0, 120.0),
    "pants": (20.0, 90.0, 8.0, 60.0, 50.0, 135.0),
    "shorts": (20.0, 95.0, 8.0, 60.0, 18.0, 80.0),
    "shoes": (18.0, 90.0, 6.0, 55.0, 5.0, 45.0),
}

# Used only when an older GLB does not contain fitting metadata.
CATEGORY_ASPECT_FLOORS = {
    "hoodie": (0.72, 0.20),
    "shirt": (0.65, 0.16),
    "jacket": (0.72, 0.22),
    "pants": (0.25, 0.14),
    "shorts": (0.42, 0.18),
    "shoes": (0.55, 0.22),
}


def _finite_positive_vector(values):
    try:
        vector = Vector(tuple(abs(float(value)) for value in values))
    except (TypeError, ValueError):
        return None
    if len(vector) != 3 or any(not math.isfinite(float(value)) or float(value) <= 0.0 for value in vector):
        return None
    return vector


def _decode_vector_property(raw):
    if raw is None:
        return None
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return None
    if isinstance(raw, (list, tuple)) and len(raw) == 3:
        return _finite_positive_vector(raw)
    try:
        if len(raw) == 3:
            return _finite_positive_vector(raw)
    except TypeError:
        pass
    return None


def _stored_expected_dimensions(meshes, category, current_size):
    # New V27 GLBs store the exact fitted mesh dimensions. Older V18/V20 files
    # store the body-region contract, so reapply the same category padding.
    for mesh in meshes:
        exact = _decode_vector_property(mesh.get("clouvaFinalDimensions"))
        if exact is not None:
            return exact, "clouvaFinalDimensions"

    for key in ("clouvaSafeBoundsDimensions", "clouvaTargetDimensions"):
        for mesh in meshes:
            target = _decode_vector_property(mesh.get(key))
            if target is not None:
                padding = CATEGORY_PADDING.get(category, Vector((1.0, 1.0, 1.0)))
                return Vector((target.x * padding.x, target.y * padding.y, target.z * padding.z)), key

    major_ratio, minor_ratio = CATEGORY_ASPECT_FLOORS.get(category, (0.55, 0.16))
    vertical = max(float(current_size.z), 1e-6)
    # Preserve the larger current horizontal axis when it is already healthy.
    horizontal_major = max(float(current_size.x), float(current_size.y), vertical * major_ratio)
    horizontal_minor = max(min(float(current_size.x), float(current_size.y)), vertical * minor_ratio)
    if float(current_size.x) >= float(current_size.y):
        return Vector((horizontal_major, horizontal_minor, vertical)), "category-aspect-fallback"
    return Vector((horizontal_minor, horizontal_major, vertical)), "category-aspect-fallback"


def _repair_collapsed_garment_volume(meshes, category):
    global _LAST_VOLUME_REPAIR

    minimum, maximum, current_size = base.dimensions(meshes)
    desired_size, source = _stored_expected_dimensions(meshes, category, current_size)
    center = (minimum + maximum) * 0.5

    factors = [1.0, 1.0, 1.0]
    # Only expand axes that lost most of the fitted volume. Never silently shrink a
    # creator design and never alter the vertical fit here.
    for axis in (0, 1):
        current = max(float(current_size[axis]), 1e-9)
        desired = max(float(desired_size[axis]), current)
        if current < desired * 0.82:
            factors[axis] = min(desired / current, 16.0)

    repaired = any(factor > 1.0001 for factor in factors)
    if repaired:
        snapshots = []
        for mesh in meshes:
            snapshots.append((mesh, [mesh.matrix_world @ vertex.co.copy() for vertex in mesh.data.vertices]))

        for mesh, world_vertices in snapshots:
            inverse = mesh.matrix_world.inverted_safe()
            for vertex, world in zip(mesh.data.vertices, world_vertices):
                delta = world - center
                repaired_world = center + Vector((
                    delta.x * factors[0],
                    delta.y * factors[1],
                    delta.z,
                ))
                vertex.co = inverse @ repaired_world
            mesh.data.update()
        base.bpy.context.view_layer.update()

    _, _, final_size = base.dimensions(meshes)
    _LAST_VOLUME_REPAIR = {
        "applied": repaired,
        "source": source,
        "beforeSceneUnits": [round(float(value), 8) for value in current_size],
        "desiredSceneUnits": [round(float(value), 8) for value in desired_size],
        "afterSceneUnits": [round(float(value), 8) for value in final_size],
        "axisFactors": [round(float(value), 8) for value in factors],
    }
    return _LAST_VOLUME_REPAIR


def _volume_contract(dimensions_cm, category):
    values = [abs(float(value)) for value in dimensions_cm]
    if len(values) != 3 or any(not math.isfinite(value) or value <= 0.0 for value in values):
        return False, {"reason": "non-finite-or-empty", "dimensionsCm": values}

    horizontal_major = max(values[0], values[1])
    horizontal_minor = min(values[0], values[1])
    vertical = values[2]
    limits = CATEGORY_VOLUME_LIMITS_CM.get(category)
    if limits is None:
        valid = horizontal_major >= 3.0 and horizontal_minor >= 1.0 and vertical >= 3.0
    else:
        major_min, major_max, minor_min, minor_max, vertical_min, vertical_max = limits
        valid = bool(
            major_min <= horizontal_major <= major_max
            and minor_min <= horizontal_minor <= minor_max
            and vertical_min <= vertical <= vertical_max
        )

    return valid, {
        "dimensionsCm": [round(value, 4) for value in values],
        "horizontalMajorCm": round(horizontal_major, 4),
        "horizontalMinorCm": round(horizontal_minor, 4),
        "verticalCm": round(vertical, 4),
        "limitsCm": list(limits) if limits is not None else None,
    }


_original_prepare_wearable_object = base.prepare_wearable_object
_original_validate_object = base.validate_object
_original_validate_fbx_roundtrip = base.validate_fbx_roundtrip
_original_run_export = base.run_export


def prepare_wearable_object_v27(objects, meshes, armatures, target_height_scene_units):
    if not _PRESERVE_WEARABLE_SOURCE:
        return _original_prepare_wearable_object(
            objects,
            meshes,
            armatures,
            target_height_scene_units,
        )

    if not armatures or base.count_bones(armatures) <= 0:
        raise RuntimeError("The wearable object has no armature")
    if not base.has_skin_weights(meshes):
        raise RuntimeError("The wearable object has no skin weights")

    skeleton_bounds = base.skeleton_world_bounds(armatures)
    if not skeleton_bounds:
        raise RuntimeError("Could not measure the wearable skeleton")
    source_skeleton_height = float(skeleton_bounds[1].z - skeleton_bounds[0].z)
    if source_skeleton_height <= 0.001:
        raise RuntimeError("Wearable skeleton height is invalid")

    # Clean imported object scales without normalising the garment as if it were a
    # complete avatar. Then restore the fitted horizontal volume from GLB metadata.
    base.apply_uniform_scale(objects, meshes, armatures, 1.0)
    category = str(getattr(base, "_clouva_active_category", "prop"))
    _repair_collapsed_garment_volume(meshes, category)
    base.ground_skeleton(objects, armatures)
    return source_skeleton_height, 1.0


def validate_object_v27(
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
    global _EXPECTED_DIMENSIONS_CM

    if not (_PRESERVE_WEARABLE_SOURCE and wearable):
        return _original_validate_object(
            objects,
            meshes,
            armatures,
            target_height_cm,
            category,
            wearable,
            source_skeleton_height=source_skeleton_height,
            normalization_scale_factor=normalization_scale_factor,
        )

    metadata = _original_validate_object(
        objects,
        meshes,
        armatures,
        target_height_cm,
        category,
        False,
        source_skeleton_height=source_skeleton_height,
        normalization_scale_factor=normalization_scale_factor,
    )
    dimensions_cm = metadata.get("dimensionsCm") or []
    volume_valid, volume = _volume_contract(dimensions_cm, category)
    skeletal_valid = bool(
        armatures
        and base.count_bones(armatures) > 0
        and base.has_root_bone(armatures)
        and base.has_skin_weights(meshes)
    )

    metadata.update({
        "target": "unreal-garment",
        "category": category,
        "sourceDimensionsPreserved": True,
        "calibratedToAvatar": True,
        "garmentVolumeRepair": _LAST_VOLUME_REPAIR,
        "garmentVolumeValid": volume_valid,
        "garmentVolume": volume,
        "skeletal": skeletal_valid,
        "readyForUnreal": bool(metadata.get("readyForUnreal") and volume_valid and skeletal_valid),
    })
    _EXPECTED_DIMENSIONS_CM = [float(value) for value in dimensions_cm]

    if not metadata["readyForUnreal"]:
        raise RuntimeError(
            f"Unreal garment validation failed: {json.dumps(metadata, separators=(',', ':'))}"
        )
    return metadata


def validate_fbx_roundtrip_v27(path, expected_height_cm):
    metadata = _original_validate_fbx_roundtrip(path, expected_height_cm)
    if not (_PRESERVE_WEARABLE_SOURCE and _EXPECTED_DIMENSIONS_CM):
        metadata["fbxRoundTripDimensionsValidated"] = True
        return metadata

    actual = [float(value) for value in metadata.get("fbxRoundTripDimensionsCm", [])]
    expected = [float(value) for value in _EXPECTED_DIMENSIONS_CM]
    if len(actual) != 3 or len(expected) != 3:
        metadata["fbxRoundTripDimensionsValidated"] = False
    else:
        actual_horizontal = sorted(actual[:2])
        expected_horizontal = sorted(expected[:2])
        pairs = list(zip(actual_horizontal, expected_horizontal)) + [(actual[2], expected[2])]
        metadata["fbxRoundTripDimensionsValidated"] = all(
            abs(observed - wanted) <= max(2.0, abs(wanted) * 0.05)
            for observed, wanted in pairs
        )

    metadata["fbxRoundTripExpectedDimensionsCm"] = [round(value, 4) for value in expected]
    if not metadata["fbxRoundTripDimensionsValidated"]:
        raise RuntimeError(
            "FBX garment-volume round-trip validation failed: "
            f"{json.dumps(metadata, separators=(',', ':'))}"
        )
    return metadata


def run_export_v27(
    source,
    output,
    target_height_cm=175.0,
    mode="avatar",
    metadata_path=None,
    category="prop",
    object_kind="rigid",
):
    global _PRESERVE_WEARABLE_SOURCE, _EXPECTED_DIMENSIONS_CM, _LAST_VOLUME_REPAIR

    preserve = str(object_kind).lower() == "wearable-preserve"
    _PRESERVE_WEARABLE_SOURCE = preserve
    _EXPECTED_DIMENSIONS_CM = None
    _LAST_VOLUME_REPAIR = None
    base._clouva_active_category = str(category).lower()
    try:
        return _original_run_export(
            source,
            output,
            target_height_cm,
            mode,
            metadata_path,
            category,
            "wearable" if preserve else object_kind,
        )
    finally:
        _PRESERVE_WEARABLE_SOURCE = False
        _EXPECTED_DIMENSIONS_CM = None
        _LAST_VOLUME_REPAIR = None
        base._clouva_active_category = "prop"


base.prepare_wearable_object = prepare_wearable_object_v27
base.validate_object = validate_object_v27
base.validate_fbx_roundtrip = validate_fbx_roundtrip_v27
base.run_export = run_export_v27


if __name__ == "__main__":
    base.main()
