import numpy as np
from measurement_quality import build_measurement_points, mesh_symmetry_score

class Scene:
    bounds_min = np.array([-0.56, -0.19, 0.0])
    bounds_max = np.array([0.56, 0.19, 1.8])

landmarks = [
    {"name":"left_shoulder","canonical_position":[-0.11,-0.01,1.30],"confidence":0.99},
    {"name":"right_shoulder","canonical_position":[0.008,0.13,1.32],"confidence":0.84},
    {"name":"left_hip","canonical_position":[-0.124,0.09,0.75],"confidence":0.99},
    {"name":"right_hip","canonical_position":[0.058,0.13,0.84],"confidence":0.99},
]
points, corrections = build_measurement_points(Scene(), landmarks)
assert mesh_symmetry_score(Scene()) > 0.99
assert len(corrections) == 2
assert points["left_shoulder"][0] < 0 < points["right_shoulder"][0]
assert abs(abs(points["left_shoulder"][0]) - abs(points["right_shoulder"][0])) < 1e-9
assert abs(points["left_hip"][2] - points["right_hip"][2]) < 1e-9
print("V0.8.1_SMOKE_OK")
