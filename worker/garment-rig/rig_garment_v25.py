import importlib.util
import os
import sys


PREVIOUS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rig_garment_v24.py")


def load_previous_pipeline():
    if not os.path.exists(PREVIOUS_PATH):
        raise RuntimeError(f"No se encontró el pipeline V24 en {PREVIOUS_PATH}")
    spec = importlib.util.spec_from_file_location("clouva_rig_v24", PREVIOUS_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("No se pudo crear el cargador del pipeline V24")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


previous = load_previous_pipeline()
legacy = previous.legacy
v9 = previous.v9

# Re-export the active V36 contracts so Docker and downstream wrappers can inspect
# the exact pipeline that production executes.
evaluated_world_points = previous.evaluated_world_points
shape_signature = previous.shape_signature
validate_shape_metrics = previous.validate_shape_metrics
garment_signature = previous.garment_signature
validate_anchor_metrics = previous.validate_anchor_metrics
validate_signature = previous.validate_signature
ROUNDTRIP_SIGNATURE_VERSION = previous.ROUNDTRIP_SIGNATURE_VERSION


def production_main():
    """Run the real fitting main that lives in V22.

    V23 and V24 are validation wrappers and intentionally do not define a main()
    function. V24 previously called previous.main(), which is V23 and therefore raised
    AttributeError before production could finish. Resolve the chain explicitly to the
    V22 fitting entrypoint while keeping every V35/V36 monkey patch active.
    """
    fitting_pipeline = previous.previous.previous
    main_function = getattr(fitting_pipeline, "main", None)
    if not callable(main_function):
        raise RuntimeError("El pipeline de fitting V22 no expone un entrypoint ejecutable")
    return main_function()


main = production_main


if __name__ == "__main__":
    main()
