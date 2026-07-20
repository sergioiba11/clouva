import importlib.util
import json
import math
import os
import sys

from mathutils import Matrix, Vector


PREVIOUS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rig_garment_v31.py")


def load_previous_pipeline():
    if not os.path.exists(PREVIOUS_PATH):
        raise RuntimeError(f"No se encontró el pipeline V42 en {PREVIOUS_PATH}")
    spec = importlib.util.spec_from_file_location("clouva_rig_v42_active", PREVIOUS_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("No se pudo crear el cargador del pipeline V42")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


previous = load_previous_pipeline()
legacy = previous.legacy
v9 = previous.v9
v40 = previous.previous.previous

CANONICAL_BIND_VERSION = 43
ANATOMICAL_FIT_VERSION = previous.ANATOMICAL_FIT_VERSION
PREBIND_SPACE_VERSION = previous.PREBIND_SPACE_VERSION
SPACE_CONTRACT_VERSION = previous.SPACE_CONTRACT_VERSION
MAX_GARMENT_POLYGONS = previous.MAX_GARMENT_POLYGONS
ROUNDTRIP_SIGNATURE_VERSION = previous.ROUNDTRIP_SIGNATURE_VERSION
RIG_ERROR = previous.RIG_ERROR

_original_validate_unreal_avatar_reference = v40._original_validate_unreal_avatar_reference


def _matrix_values(matrix):
    return [[float(matrix[row][column]) for column in range(4)] for row in range(4)]


def _matrix_delta(matrix, expected=None):
    target = expected or Matrix.Identity(4)
    return max(
        abs(float(matrix[row][column] - target[row][column]))
        for row in range(4)
        for column in range(4)
    )


def _vector_values(value):
    return [float(value.x), float(value.y), float(value.z)]


def _unit_scale(value):
    return all(math.isfinite(float(component)) and abs(float(component) - 1.0) <= 1e-6 for component in value)


def _mesh_armature(obj):
    try:
        found = obj.find_armature()
        if found is not None:
            return found
    except Exception:
        pass
    for modifier in obj.modifiers:
        if modifier.type == "ARMATURE" and modifier.object is not None:
            return modifier.object
    return None


def _world_points(obj):
    matrix = obj.matrix_world
    return [matrix @ vertex.co for vertex in obj.data.vertices]


def _combined_points(objects):
    points = []
    for obj in objects:
        points.extend(_world_points(obj))
    if not points:
        raise RuntimeError("El cuerpo oficial no contiene vértices para calcular su escala")
    return points


def _bounds(points):
    minimum = Vector((
        min(point.x for point in points),
        min(point.y for point in points),
        min(point.z for point in points),
    ))
    maximum = Vector((
        max(point.x for point in points),
        max(point.y for point in points),
        max(point.z for point in points),
    ))
    return minimum, maximum


def _height(points):
    minimum, maximum = _bounds(points)
    return float(maximum.z - minimum.z)


def _expected_height_meters(metadata):
    try:
        centimeters = float(metadata["bounds"]["imported"]["sizeCm"]["z"])
    except (KeyError, TypeError, ValueError):
        return None
    if not math.isfinite(centimeters) or centimeters <= 0:
        return None
    return centimeters / 100.0


def _resolve_canonical_scale(measured_height, metadata):
    if not math.isfinite(measured_height) or measured_height <= 1e-8:
        raise RuntimeError("El bounding box del avatar oficial tiene una altura inválida")

    scene = legacy.bpy.context.scene
    unit_settings = scene.unit_settings
    scene_scale = float(getattr(unit_settings, "scale_length", 1.0) or 1.0)
    scene_system = str(getattr(unit_settings, "system", "NONE"))
    expected_height = _expected_height_meters(metadata)

    if expected_height is not None:
        scale = expected_height / measured_height
        reason = "unreal-metadata-bounds"
    else:
        physical_height = measured_height * scene_scale
        if 0.25 <= physical_height <= 3.5:
            scale = scene_scale
            expected_height = physical_height
            reason = "scene-units-and-bounding-box"
        elif 0.25 <= measured_height <= 3.5:
            scale = 1.0
            expected_height = measured_height
            reason = "bounding-box-already-in-meters"
        else:
            raise RuntimeError(
                "No se pudo detectar la unidad del avatar desde scene units y bounding box; "
                f"height={measured_height:.8f} scale_length={scene_scale:.8f}"
            )

    if not math.isfinite(scale) or scale <= 1e-8 or scale >= 1e8:
        raise RuntimeError("La escala canónica detectada para el avatar no es válida")
    return scale, expected_height, reason, scene_scale, scene_system


def _pose_basis_delta(armature):
    if not armature.pose:
        return 0.0
    return max((_matrix_delta(bone.matrix_basis) for bone in armature.pose.bones), default=0.0)


def _identity_object(obj):
    obj.parent = None
    obj.matrix_parent_inverse = Matrix.Identity(4)
    obj.matrix_world = Matrix.Identity(4)
    obj.location = (0.0, 0.0, 0.0)
    obj.rotation_mode = "XYZ"
    obj.rotation_euler = (0.0, 0.0, 0.0)
    obj.scale = (1.0, 1.0, 1.0)


def _transform_mesh_data(obj, matrix):
    if obj.data.users > 1:
        obj.data = obj.data.copy()
    try:
        obj.data.transform(matrix, shape_keys=True)
    except TypeError:
        obj.data.transform(matrix)


def _raw_drift(expected, actual, reference_height):
    if len(expected) != len(actual) or not expected:
        return float("inf")
    denominator = max(float(reference_height), 1e-8)
    return max(float((left - right).length) for left, right in zip(expected, actual)) / denominator


def normalize_official_avatar_canonical_v43(avatar_objects, armature, body_meshes, metadata=None):
    """Create one meter-based rest/bind space before fitting or creating garment weights.

    The conversion is derived from Unreal metadata or Blender scene units plus the measured
    body bounding box. No guessed 0.01/100 multiplier is applied. Armature rest bones and all
    already-skinned avatar meshes are baked into the same canonical world matrix before the
    garment exists, then every object transform is reset to identity.
    """
    if armature is None or armature.type != "ARMATURE":
        raise RuntimeError(RIG_ERROR)

    if legacy.bpy.context.object and legacy.bpy.context.object.mode != "OBJECT":
        legacy.bpy.ops.object.mode_set(mode="OBJECT")

    skinned_meshes = [
        obj for obj in avatar_objects
        if getattr(obj, "type", None) == "MESH" and _mesh_armature(obj) == armature
    ]
    if not skinned_meshes:
        raise RuntimeError("El cuerpo oficial no contiene mallas vinculadas al armature")

    pose_mode_before = str(armature.data.pose_position)
    pose_delta_before = _pose_basis_delta(armature)
    armature.data.pose_position = "REST"
    for pose_bone in armature.pose.bones:
        pose_bone.matrix_basis = Matrix.Identity(4)
    legacy.bpy.context.view_layer.update()

    source_body_points = _combined_points(body_meshes)
    source_min, source_max = _bounds(source_body_points)
    source_height = float(source_max.z - source_min.z)
    canonical_scale, expected_height, scale_reason, scene_scale, scene_system = _resolve_canonical_scale(
        source_height,
        metadata,
    )
    canonical_matrix = Matrix.Scale(canonical_scale, 4)

    armature_world_before = armature.matrix_world.copy()
    armature_local_before = armature.matrix_local.copy()
    mesh_snapshots = []
    expected_points = {}
    bind_rest_difference_before = 0.0

    for obj in skinned_meshes:
        world = obj.matrix_world.copy()
        local = obj.matrix_local.copy()
        parent_inverse = obj.matrix_parent_inverse.copy()
        relative = armature_world_before.inverted_safe() @ world
        bind_rest_difference_before = max(bind_rest_difference_before, _matrix_delta(relative))
        expected_points[obj.name] = [canonical_matrix @ point for point in _world_points(obj)]
        mesh_snapshots.append({
            "name": obj.name,
            "world": world,
            "local": local,
            "parentInverse": parent_inverse,
            "scale": _vector_values(obj.scale),
            "vertices": len(obj.data.vertices),
        })

    # Rest bones and source meshes receive their final common conversion before any new
    # garment skinning is generated. Nothing scales the skeleton after this point.
    armature.data.transform(canonical_matrix @ armature_world_before)
    _identity_object(armature)

    mesh_reports = []
    maximum_geometry_drift = 0.0
    for obj, snapshot in zip(skinned_meshes, mesh_snapshots):
        _transform_mesh_data(obj, canonical_matrix @ snapshot["world"])
        _identity_object(obj)

        modifiers = [modifier for modifier in obj.modifiers if modifier.type == "ARMATURE"]
        for modifier in modifiers[1:]:
            obj.modifiers.remove(modifier)
        modifier = modifiers[0] if modifiers else obj.modifiers.new(name="CLOUVA Armature", type="ARMATURE")
        modifier.object = armature
        if hasattr(modifier, "use_deform_preserve_volume"):
            modifier.use_deform_preserve_volume = False

        obj.parent = armature
        obj.parent_type = "OBJECT"
        obj.matrix_parent_inverse = Matrix.Identity(4)
        obj.location = (0.0, 0.0, 0.0)
        obj.rotation_mode = "XYZ"
        obj.rotation_euler = (0.0, 0.0, 0.0)
        obj.scale = (1.0, 1.0, 1.0)

        legacy.bpy.context.view_layer.update()
        actual_points = _world_points(obj)
        drift = _raw_drift(expected_points[obj.name], actual_points, expected_height)
        maximum_geometry_drift = max(maximum_geometry_drift, drift)
        mesh_reports.append({
            "name": obj.name,
            "vertices": snapshot["vertices"],
            "scaleBefore": snapshot["scale"],
            "localMatrixBefore": _matrix_values(snapshot["local"]),
            "worldMatrixBefore": _matrix_values(snapshot["world"]),
            "parentInverseBefore": _matrix_values(snapshot["parentInverse"]),
            "localMatrixAfter": _matrix_values(obj.matrix_local),
            "worldMatrixAfter": _matrix_values(obj.matrix_world),
            "geometryDrift": drift,
        })

    legacy.bpy.context.view_layer.update()
    canonical_body_points = _combined_points(body_meshes)
    canonical_min, canonical_max = _bounds(canonical_body_points)
    canonical_height = float(canonical_max.z - canonical_min.z)
    height_error = abs(canonical_height - expected_height) / max(expected_height, 1e-8)
    pose_delta_after = _pose_basis_delta(armature)
    bind_rest_difference_after = max(
        (_matrix_delta(armature.matrix_world.inverted_safe() @ obj.matrix_world) for obj in skinned_meshes),
        default=0.0,
    )

    invalid_transform = (
        _matrix_delta(armature.matrix_world) > 1e-6
        or _matrix_delta(armature.matrix_local) > 1e-6
        or not _unit_scale(armature.scale)
        or any(_matrix_delta(obj.matrix_world) > 1e-6 or not _unit_scale(obj.scale) for obj in skinned_meshes)
    )
    wrong_armature = any(_mesh_armature(obj) != armature for obj in skinned_meshes)
    if (
        invalid_transform
        or wrong_armature
        or pose_delta_after > 1e-7
        or bind_rest_difference_after > 1e-6
        or maximum_geometry_drift > 1e-6
        or height_error > 0.005
    ):
        raise RuntimeError(RIG_ERROR)

    scene = legacy.bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0

    report = {
        "version": CANONICAL_BIND_VERSION,
        "armature": armature.name,
        "boneCount": len(armature.data.bones),
        "poseModeBefore": pose_mode_before,
        "poseModeAfter": str(armature.data.pose_position),
        "restPoseDifferenceBefore": pose_delta_before,
        "restPoseDifferenceAfter": pose_delta_after,
        "bindRestDifferenceBefore": bind_rest_difference_before,
        "bindRestDifferenceAfter": bind_rest_difference_after,
        "sourceUnits": {
            "system": scene_system,
            "scaleLengthBefore": scene_scale,
        },
        "canonicalUnits": {"system": "METRIC", "scaleLength": 1.0},
        "scaleReason": scale_reason,
        "detectedScale": canonical_scale,
        "sourceHeight": source_height,
        "expectedHeightMeters": expected_height,
        "canonicalHeight": canonical_height,
        "heightError": height_error,
        "sourceBounds": {"min": _vector_values(source_min), "max": _vector_values(source_max)},
        "canonicalBounds": {"min": _vector_values(canonical_min), "max": _vector_values(canonical_max)},
        "armatureLocalMatrixBefore": _matrix_values(armature_local_before),
        "armatureWorldMatrixBefore": _matrix_values(armature_world_before),
        "armatureLocalMatrixAfter": _matrix_values(armature.matrix_local),
        "armatureWorldMatrixAfter": _matrix_values(armature.matrix_world),
        "maximumGeometryDrift": maximum_geometry_drift,
        "meshes": mesh_reports,
    }
    encoded = json.dumps(report, separators=(",", ":"))
    try:
        with open(os.path.join(os.getcwd(), "canonical-bind-diagnostics.json"), "w", encoding="utf-8") as handle:
            handle.write(encoded)
    except OSError as exc:
        print(f"[rig-v43] could not persist diagnostics sidecar: {exc}", flush=True)
    armature["clouvaCanonicalBindVersion"] = CANONICAL_BIND_VERSION
    armature["clouvaCanonicalBindReport"] = encoded
    armature["clouvaPrebindSpaceVersion"] = PREBIND_SPACE_VERSION
    armature["clouvaPrebindSpace"] = encoded
    armature["clouvaOfficialPrebindValidated"] = True
    armature["clouvaPrebindReport"] = encoded
    for obj in skinned_meshes:
        obj["clouvaCanonicalBindVersion"] = CANONICAL_BIND_VERSION
        obj["clouvaPrebindSpaceVersion"] = PREBIND_SPACE_VERSION

    print(f"[rig-v43] canonical diagnostics {encoded}", flush=True)
    print(
        "[rig-v43] avatar normalized before mold generation "
        f"armature={armature.name} bones={len(armature.data.bones)} "
        f"height={canonical_height:.8f} scale={canonical_scale:.10f} reason={scale_reason}",
        flush=True,
    )
    return report


def validate_unreal_avatar_reference_v43(avatar_path, avatar_objects, armature, body_meshes):
    metadata = _original_validate_unreal_avatar_reference(
        avatar_path,
        avatar_objects,
        armature,
        body_meshes,
    )
    normalize_official_avatar_canonical_v43(
        avatar_objects,
        armature,
        body_meshes,
        metadata,
    )
    return metadata


legacy.validate_unreal_avatar_reference = validate_unreal_avatar_reference_v43

normalize_official_avatar_before_weights_v40 = previous.normalize_official_avatar_before_weights_v40
validate_unreal_avatar_reference_v40 = previous.validate_unreal_avatar_reference_v40
prepare_garment_fresh_v40 = previous.prepare_garment_fresh_v40
export_glb_v40 = previous.export_glb_v40
validate_roundtrip_v40 = previous.validate_roundtrip_v40
normalize_shared_space_v39 = previous.normalize_shared_space_v39
validate_deformation_envelope_v39 = previous.validate_deformation_envelope_v39
evaluated_world_points = previous.evaluated_world_points
shape_signature = previous.shape_signature
validate_shape_metrics = previous.validate_shape_metrics
garment_signature = previous.garment_signature
validate_anchor_metrics = previous.validate_anchor_metrics
validate_signature = previous.validate_signature
reduce_object_polygons = previous.reduce_object_polygons


def production_main():
    return previous.main()


main = production_main


if __name__ == "__main__":
    main()
