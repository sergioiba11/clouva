import importlib.util
import os
import sys
import tempfile


PREVIOUS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rig_garment_v15.py")


def load_previous_pipeline():
    if not os.path.exists(PREVIOUS_PATH):
        raise RuntimeError(f"No se encontró el pipeline V15 en {PREVIOUS_PATH}")
    spec = importlib.util.spec_from_file_location("clouva_rig_v15", PREVIOUS_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("No se pudo crear el cargador del pipeline V15")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


previous = load_previous_pipeline()
legacy = previous.legacy
v9 = previous.v9
_generic_roundtrip_validator = previous.v12.validate_roundtrip_v12
_lower_roundtrip_validator = previous.validate_roundtrip_v15
_export_v15 = legacy.export_glb


def export_glb_v16(output_path, garment, armature):
    garment["clouvaCategoryAwareRoundtrip"] = True
    garment["clouvaRoundtripContractVersion"] = 16
    _export_v15(output_path, garment, armature)


legacy.export_glb = export_glb_v16


def validate_roundtrip_v16(output_path):
    """Apply the body-contract validator only to lower-body garments.

    V15 introduced a strict body contract for pants/shorts, but its roundtrip
    validator required that contract for every category. Hoodies, shirts,
    jackets, shoes and rigid accessories never receive those lower-body
    properties, so otherwise-valid rigged GLBs were rejected after export.
    """
    if not os.path.exists(output_path) or os.path.getsize(output_path) < 1024:
        raise RuntimeError("El GLB exportado está vacío")

    with tempfile.TemporaryDirectory(prefix="clouva-validate-v16-"):
        legacy.clear_scene()
        imported = legacy.import_glb(output_path)
        armatures = [obj for obj in imported if obj.type == "ARMATURE"]
        skinned = [obj for obj in imported if obj.type == "MESH" and obj.find_armature()]
        if len(armatures) != 1 or not skinned:
            raise RuntimeError("El GLB exportado no contiene un único rig vestible")

        garment = max(skinned, key=lambda obj: len(obj.data.vertices))
        category = str(garment.get("clouvaCategory", "")).strip().lower()
        body_contract_version = int(garment.get("clouvaBodyContractVersion", 0))
        print(
            "[rig-v16] selecting roundtrip validator "
            f"category={category or 'unknown'} bodyContract={body_contract_version}",
            flush=True,
        )

    if category in legacy.LOWER_GARMENTS:
        return _lower_roundtrip_validator(output_path)

    # Upper garments and all other categories use the generic V12 spatial,
    # armature and skinning roundtrip contract. They must not be forced to
    # carry pants-only body metadata.
    return _generic_roundtrip_validator(output_path)


v9.validate_roundtrip_v9 = validate_roundtrip_v16


if __name__ == "__main__":
    v9.main()
