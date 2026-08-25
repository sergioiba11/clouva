import importlib.util
import os
import sys

from mathutils import Vector


MODULE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rig_garment_v34.py")
sys.path.insert(0, os.path.dirname(MODULE_PATH))
spec = importlib.util.spec_from_file_location("clouva_rig_v46_test", MODULE_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError("No se pudo cargar V46")
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

assert module.SURFACE_FIT_VERSION == 46
assert module.ANATOMICAL_FIT_VERSION == 46
assert module.legacy.copy_weights.__name__ == "copy_weights_surface_v46"
assert module.legacy.validate.__name__ == "validate_surface_fit_v46"
assert callable(module.surface_cage_fit_v46)

displacements = [
    Vector((0.0, 0.0, 0.0)),
    Vector((3.0, 0.0, 0.0)),
    Vector((0.0, 0.0, 0.0)),
]
smoothed = module._smooth_displacements(displacements, [{1}, {0, 2}, {1}], 1, strength=0.5)
assert 1.4 < smoothed[0].x < 1.6
assert 1.4 < smoothed[1].x < 1.6
assert 1.4 < smoothed[2].x < 1.6

shirt = module._surface_settings("shirt", 2.0)
jacket = module._surface_settings("jacket", 2.0)
assert 0.0 < shirt[0] < shirt[1]
assert jacket[0] > shirt[0]
assert jacket[1] > shirt[1]

print("[clouva] V46 topology-preserving collision relaxation contracts OK")
