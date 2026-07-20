import importlib.util
import json
import math
import os
import sys
from pathlib import Path

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

CANONICAL_RIG_VERSION = 43
RIG_ERROR = previous.RIG_ERROR
PREBIND_SPACE_VERSION = previous.PREBIND_SPACE_VERSION
SPACE_CONTRACT_VERSION = previous.SPACE_CONTRACT_VERSION
MAX_GARMENT_POLYGONS = previous.MAX_GARMENT_POLYGONS
ROUNDTRIP_SIGNATURE_VERSION = previous.ROUNDTRIP_SIGNATURE_VERSION
ANATOMICAL_FIT_VERSION = previous.ANATOMICAL_FIT_VERSION
IDENTITY_EPSILON = 1e-5
REST_BIND_EPSILON = 1e-5

_previous_validate_avatar = legacy.validate_unreal_avatar_reference
_previous_export_glb = legacy.export_glb
_LAST_DIAGNOSTICS = {}


def _matrix_values(matrix):
    return [[float(matrix[row][column]) for column in range(4)] for row in range(4)]


def _vector_values(value):
    return [float(component) for component in value]


def _is_identity(matrix, epsilon=IDENTITY_EPSILON):
    expected = Matrix.Identity(4)
    return all(
        math.isfinite(float(matrix[row][column]))
        and abs(float(matrix[row][column] - expected[row][column])) <= epsilon
        for row in range(4)
        for column in range(4)
    )


def _unit_report():
    settings = legacy.bpy.context.scene.unit_settings
    scale_length = float(settings.scale_length or 1.0)
    return {
        "system": str(settings.system or "NONE"),
        "lengthUnit": str(settings.length_unit or "ADAPTIVE"),
        "scaleLength": scale_length,
        "detection": "scene-unit-metadata-plus-evaluated-bounding-box",
        "fixedScaleOverrideUsed": False,
    }


def _evaluated_bbox(meshes):
    points = []
    for mesh in meshes:
        evaluated = previous.evaluated_world_points(mesh)
        for point in evaluated:
            points.append(Vector((float(point[0]), float(point[1]), float(point[2]))))
    if not points:
        raise RuntimeError("No se pudo medir el cuerpo oficial evaluado en Rest Position")
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


def _pose_rest_difference(armature):
    armature.data.pose_position = "REST"
    for pose_bone in armature.pose.bones:
        pose_bone.matrix_basis = Matrix.Identity(4)
    legacy.bpy.context.view_layer.update()

    deltas = []
    mismatched = []
    for data_bone in armature.data.bones:
        pose_bone = armature.pose.bones.get(data_bone.name)
        if pose_bone is None:
            mismatched.append(data_bone.name)
            continue
        for row in range(4):
            for column in range(4):
                delta = abs(float(pose_bone.matrix[row][column] - data_bone.matrix_local[row][column]))
                deltas.append(delta)
        if max(deltas[-16:] or [0.0]) > REST_BIND_EPSILON:
            mismatched.append(data_bone.name)

    maximum = max(deltas or [0.0])
    rms = math.sqrt(sum(value * value for value in deltas) / max(len(deltas), 1))
    return {
        "maximumElementDelta": maximum,
        "rmsElementDelta": rms,
        "mismatchedBones": mismatched,
        "matchesRestPose": maximum <= REST_BIND_EPSILON and not mismatched,
    }


def _mesh_armature(mesh):
    try:
        found = mesh.find_armature()
        if found is not None:
            return found
    except Exception:
        pass
    for modifier in mesh.modifiers:
        if modifier.type == "ARMATURE" and modifier.object is not None:
            return modifier.object
    return None


def _canonical_snapshot(stage, armature, body_meshes, enforce):
    if armature is None or armature.type != "ARMATURE":
        raise RuntimeError(RIG_ERROR)

    armature.data.pose_position = "REST"
    for pose_bone in armature.pose.bones:
        pose_bone.matrix_basis = Matrix.Identity(4)
    legacy.bpy.context.view_layer.update()

    minimum, maximum = _evaluated_bbox(body_meshes)
    height = float(maximum.z - minimum.z)
    units = _unit_report()
    rest_bind = _pose_rest_difference(armature)

    mesh_reports = []
    all_same_armature = True
    all_identity_world = True
    all_unit_scale = True
    for mesh in body_meshes:
        resolved_armature = _mesh_armature(mesh)
        same_armature = resolved_armature is armature
        identity_world = _is_identity(mesh.matrix_world)
        unit_scale = all(abs(float(component) - 1.0) <= IDENTITY_EPSILON for component in mesh.scale)
        all_same_armature = all_same_armature and same_armature
        all_identity_world = all_identity_world and identity_world
        all_unit_scale = all_unit_scale and unit_scale
        mesh_reports.append({
            "name": mesh.name,
            "vertices": len(mesh.data.vertices),
            "localScale": _vector_values(mesh.scale),
            "matrixWorld": _matrix_values(mesh.matrix_world),
            "armature": resolved_armature.name if resolved_armature else None,
            "sameOriginalArmature": same_armature,
            "worldMatrixIdentity": identity_world,
        })

    armature_identity = _is_identity(armature.matrix_world)
    armature_unit_scale = all(abs(float(component) - 1.0) <= IDENTITY_EPSILON for component in armature.scale)
    canonical = (
        armature_identity
        and armature_unit_scale
        and all_identity_world
        and all_unit_scale
        and all_same_armature
        and rest_bind["matchesRestPose"]
    )

    report = {
        "version": CANONICAL_RIG_VERSION,
        "stage": stage,
        "canonical": canonical,
        "units": units,
        "height": {
            "blenderUnits": height,
            "metersFromSceneUnits": height * units["scaleLength"],
            "bboxMin": _vector_values(minimum),
            "bboxMax": _vector_values(maximum),
        },
        "armature": {
            "name": armature.name,
            "bones": len(armature.data.bones),
            "localScale": _vector_values(armature.scale),
            "matrixWorld": _matrix_values(armature.matrix_world),
            "worldMatrixIdentity": armature_identity,
            "posePosition": armature.data.pose_position,
        },
        "bindPoseVsRestPose": rest_bind,
        "meshes": mesh_reports,
        "sameOriginalArmature": all_same_armature,
        "skinScaleAppliedAfterBinding": False,
    }

    if enforce and not canonical:
        print(
            f"[rig-v43-diagnostics] rejected={json.dumps(report, separators=(',', ':'))}",
            flush=True,
        )
        raise RuntimeError(RIG_ERROR)
    return report


def validate_unreal_avatar_reference_v43(avatar_path, avatar_objects, armature, body_meshes):
    global _LAST_DIAGNOSTICS
    pre = _canonical_snapshot("imported-before-canonicalization", armature, body_meshes, enforce=False)
    metadata = _previous_validate_avatar(avatar_path, avatar_objects, armature, body_meshes)
    post = _canonical_snapshot("canonical-before-mold", armature, body_meshes, enforce=True)

    report = {
        "version": CANONICAL_RIG_VERSION,
        "source": str(avatar_path),
        "pre": pre,
        "post": post,
    }
    _LAST_DIAGNOSTICS = report
    encoded = json.dumps(report, separators=(",", ":"))
    armature["clouvaCanonicalRigVersion"] = CANONICAL_RIG_VERSION
    armature["clouvaCanonicalRigDiagnostics"] = encoded
    for mesh in body_meshes:
        mesh["clouvaCanonicalRigVersion"] = CANONICAL_RIG_VERSION
    print(f"[rig-v43-diagnostics] {encoded}", flush=True)
    return metadata


def export_glb_v43(output_path, garment, armature):
    global _LAST_DIAGNOSTICS
    body_meshes = [
        obj for obj in legacy.bpy.context.scene.objects
        if obj.type == "MESH" and _mesh_armature(obj) is armature and obj is not garment
    ]
    if not body_meshes:
        body_meshes = [garment]

    before_export = _canonical_snapshot("before-export", armature, body_meshes, enforce=True)
    if _mesh_armature(garment) is not armature:
        raise RuntimeError(RIG_ERROR)
    if not all(abs(float(component) - 1.0) <= IDENTITY_EPSILON for component in garment.scale):
        raise RuntimeError(RIG_ERROR)

    _previous_export_glb(output_path, garment, armature)
    after_export = _canonical_snapshot("after-export", armature, body_meshes, enforce=True)

    report = dict(_LAST_DIAGNOSTICS or {})
    report.update({
        "version": CANONICAL_RIG_VERSION,
        "beforeExport": before_export,
        "afterExport": after_export,
        "garment": {
            "name": garment.name,
            "localScale": _vector_values(garment.scale),
            "matrixWorld": _matrix_values(garment.matrix_world),
            "armature": _mesh_armature(garment).name if _mesh_armature(garment) else None,
            "sameOriginalArmature": _mesh_armature(garment) is armature,
        },
    })
    sidecar = Path(output_path).with_suffix(".diagnostics.json")
    sidecar.write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
    armature["clouvaCanonicalRigDiagnostics"] = json.dumps(report, separators=(",", ":"))
    print(
        f"[rig-v43-diagnostics] export={json.dumps(report, separators=(',', ':'))}",
        flush=True,
    )


legacy.validate_unreal_avatar_reference = validate_unreal_avatar_reference_v43
legacy.export_glb = export_glb_v43

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
