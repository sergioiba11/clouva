import importlib.util
import os
import sys


PREVIOUS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rig_garment_v20_base.py")


def load_previous_pipeline():
    if not os.path.exists(PREVIOUS_PATH):
        raise RuntimeError(f"No se encontró el pipeline V20 en {PREVIOUS_PATH}")
    spec = importlib.util.spec_from_file_location("clouva_rig_v20", PREVIOUS_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("No se pudo crear el cargador del pipeline V20")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


previous = load_previous_pipeline()
legacy = previous.legacy
v9 = previous.v9


def validate_required_upper_landmarks(armature):
    required = {
        "hips": legacy.resolve_bone(armature, "hips"),
        "left_upper_arm": legacy.resolve_bone(armature, "left_upper_arm"),
        "right_upper_arm": legacy.resolve_bone(armature, "right_upper_arm"),
    }
    missing = [name for name, bone in required.items() if bone is None]
    if missing:
        available = [bone.name for bone in armature.data.bones]
        raise RuntimeError(
            "Official Unreal avatar is missing resolved upper-garment landmarks: "
            f"missing={missing}, available={available[:32]}"
        )
    if required["left_upper_arm"].name == required["right_upper_arm"].name:
        raise RuntimeError("Official Unreal avatar resolved both arms to the same bone")


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

    # Unreal exports the only root (Hips) as the FBX armature model node. Blender
    # imports all children but may omit Hips from pose.bones. The metadata shipped
    # next to AvatarReference.fbx lets us restore that verified root before any
    # torso/arm landmarks are measured.
    official_metadata = legacy.validate_unreal_avatar_reference(
        avatar_path,
        avatar_objects,
        armature,
        body_meshes,
    )
    if category in v9.UPPER_GARMENTS:
        validate_required_upper_landmarks(armature)

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
    garment["clouvaRigVersion"] = 32
    garment["clouvaCanonicalSnap"] = category in v9.DEFORMABLE_CATEGORIES
    garment["clouvaCrossSectionNormalization"] = category in v9.LOWER_GARMENTS
    garment["clouvaOfficialUnrealReferenceValidated"] = bool(official_metadata)
    legacy.export_glb(output_path, garment, armature)
    v9.validate_roundtrip_v9(output_path)


if __name__ == "__main__":
    main()
