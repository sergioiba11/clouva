from __future__ import annotations

from dataclasses import dataclass
import numpy as np
from glb_loader import LoadedScene

@dataclass
class CanonicalTransform:
    source_to_canonical: np.ndarray
    canonical_to_source: np.ndarray
    detected_up_axis: str
    detected_front_axis: str
    mirrored: bool
    pose: str
    confidence: float

    def to_dict(self) -> dict:
        return {
            "source_to_canonical_matrix": self.source_to_canonical.tolist(),
            "canonical_to_source_matrix": self.canonical_to_source.tolist(),
            "detected_up_axis": self.detected_up_axis,
            "detected_front_axis": self.detected_front_axis,
            "mirrored": self.mirrored,
            "pose": self.pose,
            "confidence": self.confidence,
        }

def _axis_rotation(up_index: int) -> np.ndarray:
    if up_index == 2:
        return np.eye(3)
    if up_index == 1:
        return np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], dtype=np.float64)
    return np.array([[0, 1, 0], [0, 0, 1], [1, 0, 0]], dtype=np.float64)

def build_canonical_transform(scene: LoadedScene) -> CanonicalTransform:
    size = scene.bounds_max - scene.bounds_min
    up_index = int(np.argmax(size))
    rotation = _axis_rotation(up_index)
    all_source = np.concatenate([item.vertices_source for item in scene.primitives], axis=0)
    rotated = (rotation @ all_source.T).T
    minimum = rotated.min(axis=0)
    maximum = rotated.max(axis=0)
    center_xy = (minimum[:2] + maximum[:2]) * 0.5
    translation = np.array([-center_xy[0], -center_xy[1], -minimum[2]], dtype=np.float64)
    matrix = np.eye(4, dtype=np.float64)
    matrix[:3, :3] = rotation
    matrix[:3, 3] = translation
    inverse = np.linalg.inv(matrix)
    axis_names = ["X", "Y", "Z"]
    return CanonicalTransform(
        source_to_canonical=matrix,
        canonical_to_source=inverse,
        detected_up_axis=f"+{axis_names[up_index]}",
        detected_front_axis="-Y",
        mirrored=False,
        pose="A_POSE_ESTIMATED",
        confidence=0.65 if up_index != 2 else 0.82,
    )

def transform_points(points: np.ndarray, matrix: np.ndarray) -> np.ndarray:
    homogeneous = np.concatenate([points, np.ones((len(points), 1), dtype=np.float64)], axis=1)
    transformed = (matrix @ homogeneous.T).T
    return transformed[:, :3]
