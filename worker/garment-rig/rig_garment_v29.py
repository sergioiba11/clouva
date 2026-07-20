import importlib.util
import os
import sys


PREVIOUS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rig_garment_v28.py")


def load_previous_pipeline():
    if not os.path.exists(PREVIOUS_PATH):
        raise RuntimeError(f"No se encontró el pipeline V40 en {PREVIOUS_PATH}")
    spec = importlib.util.spec_from_file_location("clouva_rig_v40", PREVIOUS_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("No se pudo crear el cargador del pipeline V40")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


previous = load_previous_pipeline()
legacy = previous.legacy
v9 = previous.v9

PREBIND_SPACE_VERSION = previous.PREBIND_SPACE_VERSION
SPACE_CONTRACT_VERSION = previous.SPACE_CONTRACT_VERSION
RIG_ERROR = previous.RIG_ERROR
MAX_GARMENT_POLYGONS = previous.MAX_GARMENT_POLYGONS
ROUNDTRIP_SIGNATURE_VERSION = previous.ROUNDTRIP_SIGNATURE_VERSION

# V40 public contracts.
normalize_official_avatar_before_weights_v40 = previous.normalize_official_avatar_before_weights_v40
validate_unreal_avatar_reference_v40 = previous.validate_unreal_avatar_reference_v40
prepare_garment_fresh_v40 = previous.prepare_garment_fresh_v40
export_glb_v40 = previous.export_glb_v40
validate_roundtrip_v40 = previous.validate_roundtrip_v40
_relative_point_drift = previous._relative_point_drift
_original_prepare_garment = previous._original_prepare_garment

# Keep the V39 smoke test and downstream wrappers working while V40 becomes active.
normalize_shared_space_v39 = previous.previous.normalize_shared_space_v39
validate_deformation_envelope_v39 = previous.previous.validate_deformation_envelope_v39
_points_metrics = previous.previous._points_metrics
_matrix_values = previous.previous._matrix_values

# V33 lives seven wrappers below this entrypoint. The former Docker smoke check
# reaches V23 after six links, so expose the retained repair contract there too.
_v23 = previous.previous.previous.previous.previous.previous
_v22 = _v23.previous
if not hasattr(_v23, "ensure_upper_volume_before_rig"):
    _v23.ensure_upper_volume_before_rig = _v22.ensure_upper_volume_before_rig
ensure_upper_volume_before_rig = _v22.ensure_upper_volume_before_rig

# Re-export existing diagnostics and memory guards.
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
