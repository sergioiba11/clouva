import importlib.util
import os
import sys

import numpy as np


MODULE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rig_garment_v30.py")
spec = importlib.util.spec_from_file_location("clouva_rig_v41_test", MODULE_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError("No se pudo cargar V41")
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

assert module.ANATOMICAL_FIT_VERSION == 41
assert module.legacy.copy_weights.__name__ == "copy_weights_anatomical_v41"
assert callable(module.refine_upper_fit_v41)
assert callable(module.validate_upper_fit_v41)

point, distance, progress = module._nearest_on_polyline(
    np.asarray((0.5, 0.4, 0.0), dtype=np.float64),
    [
        np.asarray((0.0, 0.0, 0.0), dtype=np.float64),
        np.asarray((1.0, 0.0, 0.0), dtype=np.float64),
        np.asarray((2.0, 0.0, 0.0), dtype=np.float64),
    ],
)
assert np.allclose(point, np.asarray((0.5, 0.0, 0.0)), atol=1e-7)
assert abs(distance - 0.4) < 1e-7
assert 0.24 < progress < 0.26

cloud = []
for z in np.linspace(0.0, 2.0, 9):
    for x in np.linspace(-0.4, 0.4, 9):
        for y in (-0.2, 0.2):
            cloud.append((x, y, z))
cloud = np.asarray(cloud, dtype=np.float64)
profile = module._robust_profile(
    cloud,
    1.0,
    0.3,
    0.0,
    0.8,
    {"center_x": 99.0, "center_y": 99.0, "half_x": 99.0, "half_y": 99.0},
)
assert abs(profile["center_x"]) < 1e-7
assert abs(profile["center_y"]) < 1e-7
assert 0.30 < profile["half_x"] < 0.45
assert 0.18 < profile["half_y"] < 0.22

profiles = [
    {
        "z": 0.0,
        "center_x": 0.0,
        "center_y": 0.0,
        "half_x": 0.2,
        "half_y": 0.1,
        "source_center_x": 1.0,
        "source_center_y": 1.0,
        "source_half_x": 0.5,
        "source_half_y": 0.4,
    },
    {
        "z": 2.0,
        "center_x": 0.2,
        "center_y": 0.4,
        "half_x": 0.4,
        "half_y": 0.3,
        "source_center_x": 2.0,
        "source_center_y": 3.0,
        "source_half_x": 0.9,
        "source_half_y": 0.8,
    },
]
mid = module._interpolate_profile(profiles, 1.0)
assert abs(mid["center_x"] - 0.1) < 1e-7
assert abs(mid["center_y"] - 0.2) < 1e-7
assert abs(mid["half_x"] - 0.3) < 1e-7
assert abs(mid["source_half_y"] - 0.6) < 1e-7

print("[clouva] V41 anatomical fitting helpers OK")
