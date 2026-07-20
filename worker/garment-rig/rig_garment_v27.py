import importlib.util
import json
import math
import os
import sys

import numpy as np
from mathutils import Matrix, Vector


PREVIOUS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rig_garment_v26.py")


def load_previous_pipeline():
    if not os.path.exists(PREVIOUS_PATH):
        raise RuntimeError(f"No se encontró el pipeline V26 en {PREVIOUS_PATH}")
    spec = importlib.util.spec_from_file_location("clouva_rig_v26", PREVIOUS_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("No se pudo crear el cargador del pipeline V26")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


previous = load_previous_pipeline()
legacy = previous.legacy
v9 = previous.v9

SPACE_CONTRACT_VERSION = 39
MAX_GARMENT_TO_AVATAR_RATIO = 3.0
IDENTITY_EPSILON = 1e-5
SHAPE_DRIFT_LIMIT = 0.015
RIG_ERROR = "Rig incompatible: escala o bind pose incorrecta"
MAX_GARMENT_POLYGONS = previous.MAX_GARMENT_POLYGONS
ROUNDTRIP_SIGNATURE_VERSION = previous.ROUNDTRIP_SIGNATURE_VERSION
_original_prepare_garment = previous._original_prepare_garment

_original_export_glb = legacy.export_glb
_original_roundtrip_validator = v9.validate_roundtrip_v9


def _matrix_values(matrix):
    return [[round(float(matrix[row][column]), 8) for column in range(4)] for row in range(4)]


def _is_identity_matrix(matrix, epsilon=IDENTITY_EPSILON):
    identity = Matrix.Identity(4)
    return all(
        math.isfinite(float(matrix[row][column]))
        and abs(float(matrix[row][column] - identity[row][column])) <= epsilon
        for row in range(4)
        for column in range(4)
    )


def _object_transform_payload(obj):
    return {
        "name": obj.name,
        "location": [round(float(value), 8) for value in obj.location],
        "rotation": [round(float(value), 8) for value in obj.rotation_euler],
        "scale": [round(float(value), 8) for value in obj.scale],
        "matrixWorld": _matrix_values(obj.matrix_world),
    }


def _identity_object(obj):
    obj.parent = None
    obj.matrix_parent_inverse = Matrix.Identity(4)
    obj.matrix_world = Matrix.Identity(4)
    obj.location = (0.0, 0.0, 0.0)
    obj.rotation_mode = "XYZ"
    obj.rotation_euler = (0.0, 0.0, 0.0)
    obj.scale = (1.0, 1.0, 1.0)


def _points_metrics(before, after):
    if getattr(before, "shape", None) != getattr(after, "shape", None) or len(before) == 0:
        return float("inf"), float("inf")
    deltas = ((after - before) ** 2).sum(axis=1) ** 0.5
    before_min = before.min(axis=0)
    before_max = before.max(axis=0)
    reference = max(float((before_max - before_min).max()), 1e-8)
    return float(deltas.max()) / reference, float((deltas * deltas).mean() ** 0.5) / reference


def normalize_shared_space_v39(garment, armature):
    """Bake the FBX object-space conversion once and export one identity shared space.

    Unreal's FBX enters Blender with an armature object scale close to 100. Keeping that
    scale on the armature while the garment uses an inverse parent matrix produces two
    different bind spaces in GLB. The browser then sees giant bones and a garment that
    stretches like a ribbon. This function bakes the full world transforms into armature
    rest data and garment vertices, leaving both export nodes at exact identity.
    """
    if garment is None or armature is None or garment.type != "MESH" or armature.type != "ARMATURE":
        raise RuntimeError(RIG_ERROR)

    if legacy.bpy.context.object and legacy.bpy.context.object.mode != "OBJECT":
        legacy.bpy.ops.object.mode_set(mode="OBJECT")
    armature.data.pose_position = "REST"
    legacy.bpy.context.view_layer.update()

    before_points = previous.evaluated_world_points(garment).copy()
    before_garment = _object_transform_payload(garment)
    before_armature = _object_transform_payload(armature)
    garment_world = garment.matrix_world.copy()
    armature_world = armature.matrix_world.copy()

    if not all(math.isfinite(float(value)) for row in armature_world for value in row):
        raise RuntimeError(RIG_ERROR)
    if not all(math.isfinite(float(value)) for row in garment_world for value in row):
        raise RuntimeError(RIG_ERROR)

    # Preserve the visible garment in world space while removing the inverse-parent trick.
    garment.parent = None
    garment.matrix_world = garment_world
    legacy.bpy.context.view_layer.update()

    # Convert the official Unreal armature from FBX object space into the common scene
    # space. Bone hierarchy, names and weights remain untouched; only the object-level
    # centimeters/meters conversion is baked into the rest data exactly once.
    armature.data.transform(armature_world)
    _identity_object(armature)

    # Bake the garment object's world transform into its mesh coordinates. The mesh and
    # the official armature now have identity nodes and share the exact same coordinate
    # system before glTF inverse bind matrices are generated.
    garment.data.transform(garment_world)
    _identity_object(garment)

    armature_modifiers = [modifier for modifier in garment.modifiers if modifier.type == "ARMATURE"]
    for modifier in armature_modifiers[1:]:
        garment.modifiers.remove(modifier)
    if armature_modifiers:
        modifier = armature_modifiers[0]
    else:
        modifier = garment.modifiers.new(name="CLOUVA Armature", type="ARMATURE")
    modifier.object = armature
    if hasattr(modifier, "use_deform_preserve_volume"):
        modifier.use_deform_preserve_volume = False

    # Parent only for a clean exported hierarchy; no matrix inverse or additional scale.
    garment.parent = armature
    garment.parent_type = "OBJECT"
    garment.matrix_parent_inverse = Matrix.Identity(4)
    garment.location = (0.0, 0.0, 0.0)
    garment.rotation_mode = "XYZ"
    garment.rotation_euler = (0.0, 0.0, 0.0)
    garment.scale = (1.0, 1.0, 1.0)
    legacy.bpy.context.view_layer.update()

    if not _is_identity_matrix(armature.matrix_world) or not _is_identity_matrix(garment.matrix_world):
        raise RuntimeError(RIG_ERROR)
    if garment.find_armature() != armature:
        raise RuntimeError(RIG_ERROR)

    after_points = previous.evaluated_world_points(garment).copy()
    maximum_drift, rms_drift = _points_metrics(before_points, after_points)
    if not math.isfinite(maximum_drift) or maximum_drift > SHAPE_DRIFT_LIMIT:
        raise RuntimeError(RIG_ERROR)

    payload = {
        "version": SPACE_CONTRACT_VERSION,
        "before": {"armature": before_armature, "garment": before_garment},
        "after": {
            "armature": _object_transform_payload(armature),
            "garment": _object_transform_payload(garment),
        },
        "maximumVisibleDrift": maximum_drift,
        "rmsVisibleDrift": rms_drift,
    }
    garment["clouvaSharedSpaceVersion"] = SPACE_CONTRACT_VERSION
    garment["clouvaSharedSpace"] = json.dumps(payload, separators=(",", ":"))
    armature["clouvaSharedSpaceVersion"] = SPACE_CONTRACT_VERSION
    print(
        "[rig-v39] shared identity space applied "
        f"armatureBeforeScale={before_armature['scale']} garmentBeforeScale={before_garment['scale']} "
        f"maxDrift={maximum_drift:.6f} rmsDrift={rms_drift:.6f}",
        flush=True,
    )
    return payload


def _skeleton_world_bounds(armature):
    points = []
    for bone in armature.data.bones:
        points.append(armature.matrix_world @ bone.head_local)
        points.append(armature.matrix_world @ bone.tail_local)
    if not points:
        raise RuntimeError(RIG_ERROR)
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


def _validate_point_cloud(points, skeleton_min, skeleton_max, label):
    if len(points) < 8:
        raise RuntimeError(RIG_ERROR)
    if not np.isfinite(points).all():
        raise RuntimeError(RIG_ERROR)

    skeleton_size = skeleton_max - skeleton_min
    avatar_height = max(float(skeleton_size.z), float(skeleton_size.y), float(skeleton_size.x), 1e-8)
    center = np.array(tuple((skeleton_min + skeleton_max) * 0.5), dtype=np.float64)
    minimum = points.min(axis=0)
    maximum = points.max(axis=0)
    garment_extent = float((maximum - minimum).max())
    farthest = float((((points - center) ** 2).sum(axis=1) ** 0.5).max())

    if (
        not math.isfinite(garment_extent)
        or not math.isfinite(farthest)
        or garment_extent > avatar_height * MAX_GARMENT_TO_AVATAR_RATIO
        or farthest > avatar_height * MAX_GARMENT_TO_AVATAR_RATIO
    ):
        raise RuntimeError(RIG_ERROR)
    return {
        "label": label,
        "avatarHeight": avatar_height,
        "garmentExtent": garment_extent,
        "farthestVertex": farthest,
    }


def validate_deformation_envelope_v39(garment, armature):
    if not _is_identity_matrix(armature.matrix_world) or not _is_identity_matrix(garment.matrix_world):
        raise RuntimeError(RIG_ERROR)
    skeleton_min, skeleton_max = _skeleton_world_bounds(armature)
    rest_metrics = _validate_point_cloud(
        previous.evaluated_world_points(garment),
        skeleton_min,
        skeleton_max,
        "rest",
    )

    original_pose_position = armature.data.pose_position
    snapshots = {bone.name: bone.matrix_basis.copy() for bone in armature.pose.bones}
    posed = []
    try:
        armature.data.pose_position = "POSE"
        for canonical, angle in (
            ("left_upper_arm", 0.32),
            ("right_upper_arm", -0.32),
            ("left_up_leg", -0.22),
            ("right_up_leg", 0.22),
        ):
            pose_bone = legacy.resolve_bone(armature, canonical)
            if pose_bone is None:
                continue
            pose_bone.matrix_basis = pose_bone.matrix_basis @ Matrix.Rotation(angle, 4, "X")
            posed.append(pose_bone.name)
        legacy.bpy.context.view_layer.update()
        pose_metrics = _validate_point_cloud(
            previous.evaluated_world_points(garment),
            skeleton_min,
            skeleton_max,
            "pose-test",
        )
    finally:
        for bone in armature.pose.bones:
            snapshot = snapshots.get(bone.name)
            if snapshot is not None:
                bone.matrix_basis = snapshot
        armature.data.pose_position = original_pose_position
        legacy.bpy.context.view_layer.update()

    if len(posed) < 2:
        raise RuntimeError(RIG_ERROR)
    garment["clouvaDeformationEnvelopeVersion"] = SPACE_CONTRACT_VERSION
    garment["clouvaDeformationEnvelope"] = json.dumps(
        {"rest": rest_metrics, "pose": pose_metrics, "posedBones": posed},
        separators=(",", ":"),
    )
    print(
        "[rig-v39] deformation envelope passed "
        f"restExtent={rest_metrics['garmentExtent']:.6f} "
        f"poseExtent={pose_metrics['garmentExtent']:.6f} posedBones={posed}",
        flush=True,
    )
    return {"rest": rest_metrics, "pose": pose_metrics, "posedBones": posed}


def export_glb_v39(output_path, garment, armature):
    normalize_shared_space_v39(garment, armature)
    validate_deformation_envelope_v39(garment, armature)
    garment["clouvaRigVersion"] = SPACE_CONTRACT_VERSION
    garment["clouvaRigSpaceValidated"] = True
    _original_export_glb(output_path, garment, armature)


def validate_roundtrip_v39(output_path):
    _original_roundtrip_validator(output_path)
    armatures = [obj for obj in legacy.bpy.context.scene.objects if obj.type == "ARMATURE"]
    garments = [
        obj
        for obj in legacy.bpy.context.scene.objects
        if obj.type == "MESH" and obj.find_armature() is not None
    ]
    if len(armatures) != 1 or not garments:
        raise RuntimeError(RIG_ERROR)
    armature = armatures[0]
    garment = max(garments, key=lambda obj: len(obj.data.vertices))
    if int(garment.get("clouvaSharedSpaceVersion", 0)) != SPACE_CONTRACT_VERSION:
        raise RuntimeError(RIG_ERROR)
    if not bool(garment.get("clouvaRigSpaceValidated", False)):
        raise RuntimeError(RIG_ERROR)
    if not _is_identity_matrix(armature.matrix_world) or not _is_identity_matrix(garment.matrix_world):
        raise RuntimeError(RIG_ERROR)
    if garment.find_armature() != armature:
        raise RuntimeError(RIG_ERROR)

    skeleton_min, skeleton_max = _skeleton_world_bounds(armature)
    metrics = _validate_point_cloud(
        previous.evaluated_world_points(garment),
        skeleton_min,
        skeleton_max,
        "roundtrip",
    )
    print(
        "[rig-v39] GLB shared-space roundtrip passed "
        f"armatureScale={tuple(round(float(value), 6) for value in armature.scale)} "
        f"garmentScale={tuple(round(float(value), 6) for value in garment.scale)} "
        f"metrics={metrics}",
        flush=True,
    )
    return metrics


legacy.export_glb = export_glb_v39
v9.validate_roundtrip_v9 = validate_roundtrip_v39

# Re-export active contracts for Docker and downstream wrappers.
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
