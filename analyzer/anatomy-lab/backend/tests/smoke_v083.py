from __future__ import annotations
import math
import os
import sys
import numpy as np

BACKEND = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, BACKEND)
from measurement_quality import _polar_core_record_from_points


def arc_points(radius_x: float, radius_y: float, missing_start: float | None = None, missing_end: float | None = None):
    theta = np.linspace(0.0, 2.0 * math.pi, 720, endpoint=False)
    if missing_start is not None and missing_end is not None:
        keep = ~((theta >= missing_start) & (theta <= missing_end))
        theta = theta[keep]
    return np.column_stack([radius_x * np.cos(theta), radius_y * np.sin(theta)])

# Small mesh-seam gap should be computationally closed.
points = arc_points(0.145, 0.105, math.radians(80), math.radians(96))
record = _polar_core_record_from_points(
    points,
    target_xy=np.array([0.0, 0.0]),
    z=1.0,
    scale=1.0,
    geometry_height=1.8,
    label="chest",
    source_component_count=1,
)
assert record is not None
assert record["closed"] is True
assert record["computationally_closed"] is True
assert 70.0 < record["circumference_cm"] < 90.0

# A major missing body region must never be called final.
points_bad = arc_points(0.145, 0.105, math.radians(30), math.radians(125))
record_bad = _polar_core_record_from_points(
    points_bad,
    target_xy=np.array([0.0, 0.0]),
    z=1.0,
    scale=1.0,
    geometry_height=1.8,
    label="chest",
    source_component_count=1,
)
assert record_bad is None

# An arm-like outlier must not inflate the median radial contour.
base = arc_points(0.14, 0.10, math.radians(210), math.radians(222))
outliers = np.array([[0.48, 0.0], [0.50, 0.01], [0.49, -0.01]])
record_outlier = _polar_core_record_from_points(
    np.vstack([base, outliers]),
    target_xy=np.array([0.0, 0.0]),
    z=1.0,
    scale=1.0,
    geometry_height=1.8,
    label="chest",
    source_component_count=3,
)
assert record_outlier is not None
assert record_outlier["circumference_cm"] < 90.0
print("V083_SMOKE_OK")
