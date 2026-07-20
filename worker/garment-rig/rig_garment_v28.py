import importlib.util
import json
import math
import os
import sys

from mathutils import Matrix


PREVIOUS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rig_garment_v27.py")


def load_previous_pipeline():
    if not os.path.exists(PREVIOUS_PATH):
        raise RuntimeError(f"No se encontró el pipeline V39 en {PREVIOUS_PATH}")
    spec = importlib.util.spec_from_file_location("clouva_rig_v39", PREVIOUS_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("No se pudo crear el cargador del pipeline V39")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


previous = load_previous_pipeline()
legacy = previous.legacy
v9 = previous.v9

PREBIND_SPACE_VERSION = 40
SPACE_CONTRACT_VERSION = 40
IDENTITY_EPSILON = 1e-5
MAX_VISIBLE_DRIFT = 0.015
RIG_ERROR = "Rig incompatible: escala o bind pose incorrecta"
MAX_GARMENT_POLYGONS = previous.MAX_GARMENT_POLYGONS
ROUNDTRIP_SIGNATURE_VERSION = previous.ROUNDTRIP_SIGNATURE_VERSION
_original_prepare_garment = legacy.prepare_garment
_original_validate_unreal_avatar_reference = legacy.validate_unreal_avatar_reference


def _is_identity(matrix, epsilon=IDENTITY_EPSILON):
    expected = Matrix.Identity(4)
    return all(
        math.isfinite(float(matrix[row][column]))
        and abs(float(matrix[row][column] - expected[row][column])) <= epsilon
        for row in range(4)
        for column in range(4)
    )


def _identity_object(obj):
    obj.parent = None
    obj.matrix_parent_inverse = Matrix.Identity(4)
    obj.matrix_world = Matrix.Identity(4)
    obj.location = (0.0, 0.0, 0.0)
    obj.rotation_mode = "XYZ"
    obj.rotation_euler = (0.0, 0.0, 0.0)
    obj.scale = (1.0, 1.0, 1.0)


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


def _relative_point_drift(before, after):
    if getattr(before, "shape", None) != getattr(after, "shape", None) or len(before) == 0:
        return float("inf"), float("inf")
    deltas = ((after - before) ** 2).sum(axis=1) ** 0.5
    minimum = before.min(axis=0)
    maximum = before.max(axis=0)
    reference = max(float((maximum - minimum).max()), 1e-8)
    return float(deltas.max()) / reference, float((deltas * deltas).mean() ** 0.5) / reference


def normalize_official_avatar_before_weights_v40(avatar_objects, armature, body_meshes):
    """Bake Unreal's FBX root conversion before fitting or transferring any weights.

    V39 normalized the armature only at export time, after garment weights already existed.
    Blender could therefore generate skin matrices from one object space and later rewrite
    the rest bones into another. The GLB looked valid in Blender but Three.js received
    incompatible inverse bind matrices. V40 establishes the final identity space first,
    then fitting, weight transfer, parenting and export all happen in that same space.
    """
    if armature is None or armature.type != "ARMATURE":
        raise RuntimeError(RIG_ERROR)
    if int(armature.get("clouvaPrebindSpaceVersion", 0)) == PREBIND_SPACE_VERSION:
        return json.loads(str(armature.get("clouvaPrebindSpace", "{}")) or "{}")

    if legacy.bpy.context.object and legacy.bpy.context.object.mode != "OBJECT":
        legacy.bpy.ops.object.mode_set(mode="OBJECT")
    armature.data.pose_position = "REST"
    for pose_bone in armature.pose.bones:
        pose_bone.matrix_basis = Matrix.Identity(4)
    legacy.bpy.context.view_layer.update()

    skinned_meshes = [
        obj for obj in avatar_objects
        if getattr(obj, "type", None) == "MESH" and _mesh_armature(obj) == armature
    ]
    if not skinned_meshes:
        raise RuntimeError("El cuerpo oficial no contiene mallas vinculadas al armature")

    before_points = {
        obj.name: previous.evaluated_world_points(obj).copy()
        for obj in skinned_meshes
        if len(obj.data.vertices) > 0
    }
    armature_world = armature.matrix_world.copy()
    mesh_worlds = {obj.name: obj.matrix_world.copy() for obj in skinned_meshes}

    for obj in skinned_meshes:
        world = mesh_worlds[obj.name]
        obj.parent = None
        obj.matrix_parent_inverse = Matrix.Identity(4)
        obj.matrix_world = world
        if obj.data.users > 1:
            obj.data = obj.data.copy()

    # The official rest bones are converted from Unreal/FBX object space into final GLB
    # space before any garment vertex group is created.
    armature.data.transform(armature_world)
    _identity_object(armature)

    reports = []
    for obj in skinned_meshes:
        obj.data.transform(mesh_worlds[obj.name])
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
    if not _is_identity(armature.matrix_world):
        raise RuntimeError(RIG_ERROR)

    maximum_drift = 0.0
    rms_drift = 0.0
    for obj in skinned_meshes:
        if not _is_identity(obj.matrix_world) or _mesh_armature(obj) != armature:
            raise RuntimeError(RIG_ERROR)
        before = before_points.get(obj.name)
        if before is None:
            continue
        after = previous.evaluated_world_points(obj).copy()
        maximum, rms = _relative_point_drift(before, after)
        maximum_drift = max(maximum_drift, maximum)
        rms_drift = max(rms_drift, rms)
        reports.append({"mesh": obj.name, "maximumVisibleDrift": maximum, "rmsVisibleDrift": rms})

    if not math.isfinite(maximum_drift) or maximum_drift > MAX_VISIBLE_DRIFT:
        raise RuntimeError(RIG_ERROR)

    payload = {
        "version": PREBIND_SPACE_VERSION,
        "armature": armature.name,
        "meshes": reports,
        "maximumVisibleDrift": maximum_drift,
        "rmsVisibleDrift": rms_drift,
    }
    encoded = json.dumps(payload, separators=(",", ":"))
    armature["clouvaPrebindSpaceVersion"] = PREBIND_SPACE_VERSION
    armature["clouvaPrebindSpace"] = encoded
    for obj in skinned_meshes:
        obj["clouvaPrebindSpaceVersion"] = PREBIND_SPACE_VERSION
    print(
        "[rig-v40] official avatar normalized before weight transfer "
        f"meshes={len(skinned_meshes)} maxDrift={maximum_drift:.8f} rmsDrift={rms_drift:.8f}",
        flush=True,
    )
    return payload


def validate_unreal_avatar_reference_v40(avatar_path, avatar_objects, armature, body_meshes):
    metadata = _original_validate_unreal_avatar_reference(
        avatar_path,
        avatar_objects,
        armature,
        body_meshes,
    )
    report = normalize_official_avatar_before_weights_v40(avatar_objects, armature, body_meshes)
    armature["clouvaOfficialPrebindValidated"] = True
    armature["clouvaPrebindReport"] = json.dumps(report, separators=(",", ":"))
    return metadata


def prepare_garment_fresh_v40(objects, category):
    garment = _original_prepare_garment(objects, category)
    if garment.type != "MESH":
        raise RuntimeError(RIG_ERROR)
    garment.animation_data_clear()
    world = garment.matrix_world.copy()
    garment.parent = None
    garment.matrix_parent_inverse = Matrix.Identity(4)
    garment.matrix_world = world
    for modifier in list(garment.modifiers):
        if modifier.type == "ARMATURE":
            garment.modifiers.remove(modifier)
    if category in legacy.DEFORMABLE_CATEGORIES:
        garment.vertex_groups.clear()
    garment["clouvaFreshSourceVersion"] = PREBIND_SPACE_VERSION
    garment["clouvaSourceSkinningRemoved"] = True
    legacy.bpy.context.view_layer.update()
    return garment


def _validate_fresh_weights(garment, armature):
    bone_names = {bone.name for bone in armature.data.bones}
    group_names = {group.name for group in garment.vertex_groups}
    unknown = sorted(group_names - bone_names)
    if unknown:
        raise RuntimeError(RIG_ERROR)
    if not group_names:
        raise RuntimeError(RIG_ERROR)
    weighted = sum(1 for vertex in garment.data.vertices if vertex.groups)
    if weighted / max(len(garment.data.vertices), 1) < 0.995:
        raise RuntimeError(RIG_ERROR)
    modifiers = [modifier for modifier in garment.modifiers if modifier.type == "ARMATURE"]
    if len(modifiers) != 1 or modifiers[0].object != armature:
        raise RuntimeError(RIG_ERROR)
    return {"groups": len(group_names), "weighted": weighted, "vertices": len(garment.data.vertices)}


def export_glb_v40(output_path, garment, armature):
    if int(armature.get("clouvaPrebindSpaceVersion", 0)) != PREBIND_SPACE_VERSION:
        raise RuntimeError(RIG_ERROR)
    if not _is_identity(armature.matrix_world):
        raise RuntimeError(RIG_ERROR)

    armature.data.pose_position = "REST"
    for pose_bone in armature.pose.bones:
        pose_bone.matrix_basis = Matrix.Identity(4)
    legacy.bpy.context.view_layer.update()

    # Only the garment object transform remains to bake. The armature was already frozen
    # before weight transfer, so V39 no longer rewrites a bound skeleton after the fact.
    previous.normalize_shared_space_v39(garment, armature)
    weight_report = _validate_fresh_weights(garment, armature)
    envelope = previous.validate_deformation_envelope_v39(garment, armature)
    garment["clouvaRigVersion"] = PREBIND_SPACE_VERSION
    garment["clouvaRigSpaceValidated"] = True
    garment["clouvaPrebindSpaceVersion"] = PREBIND_SPACE_VERSION
    garment["clouvaFreshWeightTransferVersion"] = PREBIND_SPACE_VERSION
    garment["clouvaFreshWeightReport"] = json.dumps(weight_report, separators=(",", ":"))
    armature["clouvaPrebindSpaceVersion"] = PREBIND_SPACE_VERSION
    armature["clouvaDeformationEnvelopeVersion"] = PREBIND_SPACE_VERSION
    print(
        "[rig-v40] exporting one pre-bind identity space "
        f"weights={weight_report} posedBones={envelope['posedBones']}",
        flush=True,
    )
    previous._original_export_glb(output_path, garment, armature)


def validate_roundtrip_v40(output_path):
    previous.validate_roundtrip_v39(output_path)
    armatures = [obj for obj in legacy.bpy.context.scene.objects if obj.type == "ARMATURE"]
    garments = [
        obj for obj in legacy.bpy.context.scene.objects
        if obj.type == "MESH" and obj.find_armature() is not None
    ]
    if len(armatures) != 1 or not garments:
        raise RuntimeError(RIG_ERROR)
    armature = armatures[0]
    garment = max(garments, key=lambda obj: len(obj.data.vertices))
    if int(armature.get("clouvaPrebindSpaceVersion", 0)) != PREBIND_SPACE_VERSION:
        raise RuntimeError(RIG_ERROR)
    if int(garment.get("clouvaPrebindSpaceVersion", 0)) != PREBIND_SPACE_VERSION:
        raise RuntimeError(RIG_ERROR)
    if int(garment.get("clouvaFreshWeightTransferVersion", 0)) != PREBIND_SPACE_VERSION:
        raise RuntimeError(RIG_ERROR)
    if not _is_identity(armature.matrix_world) or not _is_identity(garment.matrix_world):
        raise RuntimeError(RIG_ERROR)
    report = _validate_fresh_weights(garment, armature)
    previous.validate_deformation_envelope_v39(garment, armature)
    print(
        "[rig-v40] GLB roundtrip retained pre-bind identity space "
        f"armature={armature.name} garment={garment.name} report={report}",
        flush=True,
    )
    return report


legacy.validate_unreal_avatar_reference = validate_unreal_avatar_reference_v40
legacy.prepare_garment = prepare_garment_fresh_v40
legacy.export_glb = export_glb_v40
v9.validate_roundtrip_v9 = validate_roundtrip_v40

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
