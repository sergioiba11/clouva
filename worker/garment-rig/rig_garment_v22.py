import importlib.util
import json
import os
import sys

from mathutils import Vector


PREVIOUS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rig_garment_v21.py")


def load_previous_pipeline():
    if not os.path.exists(PREVIOUS_PATH):
        raise RuntimeError(f"No se encontró el pipeline V21 en {PREVIOUS_PATH}")
    spec = importlib.util.spec_from_file_location("clouva_rig_v21", PREVIOUS_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("No se pudo crear el cargador del pipeline V21")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


previous = load_previous_pipeline()
legacy = previous.legacy
v9 = previous.v9
v20 = previous.previous


UPPER_VOLUME_REPAIR_MARGIN = 0.02
UPPER_VOLUME_REPAIR_MAX_SCALE = 1.25


def _axis_repair_factor(current_size, target_size, minimum_ratio):
    current = float(current_size)
    target = float(target_size)
    minimum = float(minimum_ratio)
    if current <= 1e-9 or target <= 1e-9:
        raise RuntimeError(
            f"No se puede reparar el volumen de la prenda: current={current}, target={target}"
        )
    ratio = current / target
    if ratio >= minimum:
        return 1.0
    desired_ratio = minimum + UPPER_VOLUME_REPAIR_MARGIN
    factor = desired_ratio / ratio
    if factor > UPPER_VOLUME_REPAIR_MAX_SCALE:
        raise RuntimeError(
            "La prenda requiere una expansión horizontal insegura: "
            f"ratio={ratio:.4f}, minimum={minimum:.4f}, factor={factor:.4f}"
        )
    return factor


def ensure_upper_volume_before_rig(garment, target_min, target_max, category):
    """Repair a slightly narrow AI garment before weight transfer and validation.

    V18 can clamp the horizontal correction when the generated hoodie starts much
    wider/taller than the official chibi torso. The later V27 volume contract then
    correctly rejects a width ratio below its safety floor. Instead of weakening the
    validator, expand only the deficient axes, keep the garment centered on the torso,
    and preserve its top alignment before skin weights are copied.
    """
    if category not in v9.UPPER_GARMENTS:
        return None

    target_size = target_max - target_min
    garment_min, garment_max = legacy.bbox_world(garment)
    garment_size = garment_max - garment_min
    minimums = v20.UPPER_GARMENT_MIN_TARGET_RATIOS.get(
        category,
        Vector((0.75, 0.60, 0.75)),
    )

    before_ratios = Vector((
        float(garment_size.x) / max(float(target_size.x), 1e-9),
        float(garment_size.y) / max(float(target_size.y), 1e-9),
        float(garment_size.z) / max(float(target_size.z), 1e-9),
    ))
    factors = Vector((
        _axis_repair_factor(garment_size.x, target_size.x, minimums.x),
        _axis_repair_factor(garment_size.y, target_size.y, minimums.y),
        _axis_repair_factor(garment_size.z, target_size.z, minimums.z),
    ))

    if max(abs(float(value) - 1.0) for value in factors) <= 1e-6:
        return {
            "repaired": False,
            "beforeRatios": tuple(float(value) for value in before_ratios),
            "afterRatios": tuple(float(value) for value in before_ratios),
            "factors": (1.0, 1.0, 1.0),
        }

    target_center = (target_min + target_max) * 0.5
    target_top = float(garment_max.z)
    v9.apply_object_scale(
        garment,
        sx=float(factors.x),
        sy=float(factors.y),
        sz=float(factors.z),
    )

    repaired_min, repaired_max = legacy.bbox_world(garment)
    repaired_center = (repaired_min + repaired_max) * 0.5
    garment.location += Vector((
        float(target_center.x - repaired_center.x),
        float(target_center.y - repaired_center.y),
        float(target_top - repaired_max.z),
    ))
    legacy.bpy.context.view_layer.update()

    final_min, final_max = legacy.bbox_world(garment)
    final_size = final_max - final_min
    after_ratios = Vector((
        float(final_size.x) / max(float(target_size.x), 1e-9),
        float(final_size.y) / max(float(target_size.y), 1e-9),
        float(final_size.z) / max(float(target_size.z), 1e-9),
    ))
    if any(float(after_ratios[index]) + 1e-5 < float(minimums[index]) for index in range(3)):
        raise RuntimeError(
            "La reparación de volumen no alcanzó el contrato mínimo: "
            f"before={tuple(round(float(v), 4) for v in before_ratios)}, "
            f"after={tuple(round(float(v), 4) for v in after_ratios)}, "
            f"minimum={tuple(round(float(v), 4) for v in minimums)}"
        )

    garment["clouvaUpperVolumeRepairVersion"] = 33
    garment["clouvaUpperVolumeRepairFactors"] = json.dumps(
        [float(factors.x), float(factors.y), float(factors.z)],
        separators=(",", ":"),
    )
    garment["clouvaUpperVolumeRatiosBefore"] = json.dumps(
        [float(before_ratios.x), float(before_ratios.y), float(before_ratios.z)],
        separators=(",", ":"),
    )
    garment["clouvaUpperVolumeRatiosAfter"] = json.dumps(
        [float(after_ratios.x), float(after_ratios.y), float(after_ratios.z)],
        separators=(",", ":"),
    )
    print(
        "[rig-v33] upper volume repaired before weights "
        f"category={category} "
        f"before={tuple(round(float(v), 4) for v in before_ratios)} "
        f"after={tuple(round(float(v), 4) for v in after_ratios)} "
        f"factors={tuple(round(float(v), 4) for v in factors)}",
        flush=True,
    )
    return {
        "repaired": True,
        "beforeRatios": tuple(float(value) for value in before_ratios),
        "afterRatios": tuple(float(value) for value in after_ratios),
        "factors": tuple(float(value) for value in factors),
    }


def main():
    avatar_path, garment_path, output_path, category, art_path, color, preview_settings = legacy.args()
    if category not in legacy.VALID_CATEGORIES:
        raise RuntimeError(f"Categoría inválida: {category}")

    legacy.validate_lower_geometry_and_weights = v9.validate_lower_geometry_and_weights_v9
    legacy.validate_upper_weights = v9.validate_upper_weights_v6

    legacy.clear_scene()
    avatar_objects = legacy.import_glb(avatar_path)
    armature = legacy.find_armature(avatar_objects)
    body_meshes = legacy.body_meshes_for_rig(avatar_objects, armature)
    official_metadata = legacy.validate_unreal_avatar_reference(
        avatar_path,
        avatar_objects,
        armature,
        body_meshes,
    )
    if category in v9.UPPER_GARMENTS:
        previous.validate_required_upper_landmarks(armature)

    body_min, body_max = legacy.combined_bbox(body_meshes)
    avatar_height = max(body_max.z - body_min.z, 1e-6)

    garment_objects = legacy.import_glb(garment_path)
    garment = legacy.prepare_garment(garment_objects, category)
    target_min, target_max = legacy.fit_to_body(garment, body_meshes, armature, category)

    safe_settings = v9.sanitize_preview_settings(category, preview_settings)
    legacy.apply_preview_adjustments(garment, safe_settings, avatar_height)
    if category in v9.LOWER_GARMENTS:
        v9.snap_lower_garment(garment, body_meshes, armature, category, safe_settings)
        target_min, target_max = legacy.body_region(body_meshes, armature, category)
    elif category in v9.UPPER_GARMENTS:
        v9.snap_upper_garment(garment, armature, category)
        target_min, target_max = legacy.body_region(body_meshes, armature, category)
        ensure_upper_volume_before_rig(garment, target_min, target_max, category)

    if category == "hat":
        legacy.assign_rigid_bone_weights(garment, armature, "head")
    elif category == "accessory":
        legacy.assign_rigid_bone_weights(garment, armature, "chest")
    else:
        legacy.copy_weights(body_meshes, garment, armature, category)
        if category in v9.UPPER_GARMENTS:
            v9.ensure_upper_arm_weights(garment, armature)

    legacy.apply_material(garment, art_path, color)
    legacy.attach_armature(garment, armature)
    legacy.validate(garment, armature, target_min, target_max, category)
    garment["clouvaRigVersion"] = 33
    garment["clouvaCanonicalSnap"] = category in v9.DEFORMABLE_CATEGORIES
    garment["clouvaCrossSectionNormalization"] = category in v9.LOWER_GARMENTS
    garment["clouvaOfficialUnrealReferenceValidated"] = bool(official_metadata)
    legacy.export_glb(output_path, garment, armature)
    v9.validate_roundtrip_v9(output_path)


if __name__ == "__main__":
    main()
