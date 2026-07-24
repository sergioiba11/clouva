"""Canonical orientation for temporary CLOUVA analysis and rig copies.

The source GLB on disk is never modified. Mesh data is duplicated inside the
fresh Blender scene, transformed to a Z-up / -Y-front canonical space and the
matrices required to map back to the source coordinate system are retained.
"""
from __future__ import annotations

import gc
import math
import os

from mathutils import Matrix, Vector

AXIS_NAMES = ("X", "Y", "Z")
MAX_ORIENTATION_POINTS = max(
    20_000,
    int(os.environ.get("CLOUVA_AVATAR_ANALYZER_ORIENTATION_POINTS", "100000")),
)


def _vec(value: Vector):
    return [float(value.x), float(value.y), float(value.z)]


def _matrix(value: Matrix):
    return [[float(value[row][column]) for column in range(4)] for row in range(4)]


def _points(meshes):
    meshes = list(meshes)
    total = sum(len(obj.data.vertices) for obj in meshes)
    stride = max(1, math.ceil(total / MAX_ORIENTATION_POINTS))
    points = [
        obj.matrix_world @ vertex.co
        for obj in meshes
        for index, vertex in enumerate(obj.data.vertices)
        if index % stride == 0
    ]
    points.extend(
        obj.matrix_world @ Vector(corner)
        for obj in meshes
        for corner in obj.bound_box
    )
    return points


def _bounds(points):
    minimum = Vector(tuple(min(point[index] for point in points) for index in range(3)))
    maximum = Vector(tuple(max(point[index] for point in points) for index in range(3)))
    return minimum, maximum, maximum - minimum


def _axis(index: int, sign: float = 1.0):
    values = [0.0, 0.0, 0.0]
    values[index] = float(sign)
    return Vector(values)


def _terminal_footprint(points, axis_index: int, high: bool):
    values = [float(point[axis_index]) for point in points]
    low_value = min(values)
    high_value = max(values)
    span = max(high_value - low_value, 1e-8)
    threshold = high_value - span * 0.10 if high else low_value + span * 0.10
    selected = [point for point in points if (point[axis_index] >= threshold if high else point[axis_index] <= threshold)]
    other = [index for index in range(3) if index != axis_index]
    if not selected:
        return float("inf"), 0
    first = max(float(point[other[0]]) for point in selected) - min(float(point[other[0]]) for point in selected)
    second = max(float(point[other[1]]) for point in selected) - min(float(point[other[1]]) for point in selected)
    return max(first * second, 1e-8), len(selected)


def _rotation_between(source: Vector, target: Vector):
    source = source.normalized()
    target = target.normalized()
    if (source - target).length <= 1e-7:
        return Matrix.Identity(4)
    if (source + target).length <= 1e-7:
        helper = Vector((1.0, 0.0, 0.0)) if abs(source.x) < 0.8 else Vector((0.0, 1.0, 0.0))
        axis = source.cross(helper).normalized()
        return Matrix.Rotation(3.141592653589793, 4, axis)
    return source.rotation_difference(target).to_matrix().to_4x4()


def _rotated(points, transform: Matrix):
    return [transform @ point for point in points]


def _horizontal_alignment(points):
    minimum, maximum, size = _bounds(points)
    if float(size.x) >= float(size.y):
        width_axis = "X"
        width_transform = Matrix.Identity(4)
    else:
        width_axis = "Y"
        width_transform = Matrix.Rotation(-1.5707963267948966, 4, "Z")
    aligned = _rotated(points, width_transform)
    minimum, maximum, size = _bounds(aligned)
    base = float(minimum.z)
    height = max(float(size.z), 1e-8)
    lower = [point for point in aligned if float(point.z) <= base + height * 0.20]
    sample = lower or aligned
    center_y = sorted(float(point.y) for point in sample)[len(sample) // 2]
    positive = max((float(point.y) - center_y for point in sample), default=0.0)
    negative = max((center_y - float(point.y) for point in sample), default=0.0)
    front_was_positive = positive > negative
    front_transform = Matrix.Rotation(3.141592653589793, 4, "Z") if front_was_positive else Matrix.Identity(4)
    asymmetry = abs(positive - negative) / max(positive, negative, height * 0.01)
    return front_transform @ width_transform, {
        "sourceWidthAxis": width_axis,
        "frontEvidence": {
            "positiveExtent": positive,
            "negativeExtent": negative,
            "selectedFront": "+Y" if front_was_positive else "-Y",
            "asymmetry": asymmetry,
        },
    }


def canonicalize_temporary_copy(meshes):
    meshes = list(meshes)
    points = _points(meshes)
    if not points:
        raise RuntimeError("Canonical orientation requires mesh geometry")

    source_matrices = {obj.name: _matrix(obj.matrix_world) for obj in meshes}
    source_minimum, source_maximum, source_size = _bounds(points)
    extents = [float(source_size[index]) for index in range(3)]
    ordered = sorted(range(3), key=lambda index: extents[index], reverse=True)
    up_index = ordered[0]
    largest = max(extents[up_index], 1e-8)
    second = max(extents[ordered[1]], 1e-8)
    elongation = largest / second

    low_footprint, low_count = _terminal_footprint(points, up_index, high=False)
    high_footprint, high_count = _terminal_footprint(points, up_index, high=True)
    up_sign = 1.0 if high_footprint <= low_footprint else -1.0
    source_up = _axis(up_index, up_sign)
    up_transform = _rotation_between(source_up, Vector((0.0, 0.0, 1.0)))
    up_aligned = _rotated(points, up_transform)
    horizontal_transform, horizontal_report = _horizontal_alignment(up_aligned)

    negative_determinants = [obj.name for obj in meshes if float(obj.matrix_world.to_3x3().determinant()) < 0.0]
    mirrored = bool(negative_determinants)
    mirror_transform = Matrix.Diagonal((-1.0, 1.0, 1.0, 1.0)) if mirrored else Matrix.Identity(4)
    canonical = horizontal_transform @ mirror_transform @ up_transform
    inverse = canonical.inverted_safe()

    del up_aligned
    del points
    gc.collect()

    for obj in meshes:
        # The scene was imported fresh for this operation, so single-user mesh
        # data is already isolated from the immutable GLB on disk. Duplicate only
        # genuinely shared datablocks to avoid doubling peak memory.
        if obj.data.users > 1:
            obj.data = obj.data.copy()
        transform = canonical @ obj.matrix_world
        obj.data.transform(transform, shape_keys=True)
        obj.matrix_world = Matrix.Identity(4)
        if float(transform.to_3x3().determinant()) < 0.0 and hasattr(obj.data, "flip_normals"):
            obj.data.flip_normals()
        obj.data.update()

    canonical_points = _points(meshes)
    canonical_minimum, canonical_maximum, canonical_size = _bounds(canonical_points)
    del canonical_points
    gc.collect()
    up_confidence = max(0.0, min(1.0, (elongation - 1.0) / 0.85))
    front_confidence = max(0.0, min(1.0, float(horizontal_report["frontEvidence"]["asymmetry"]) * 2.4))
    orientation_confidence = up_confidence * 0.72 + front_confidence * 0.28
    requires_review = orientation_confidence < 0.62

    report = {
        "method": "temporary-bounds-footprint-front-asymmetry-v3.2",
        "canonicalApplied": True,
        "sourceMatrixWorld": source_matrices,
        "canonicalMatrix": _matrix(canonical),
        "inverseCanonicalMatrix": _matrix(inverse),
        "detectedUpAxis": f"{'+' if up_sign > 0 else '-'}{AXIS_NAMES[up_index]}",
        "detectedFrontAxis": horizontal_report["frontEvidence"]["selectedFront"],
        "canonicalUpAxis": "+Z",
        "canonicalFrontAxis": "-Y",
        "mirrored": mirrored,
        "negativeDeterminantObjects": negative_determinants,
        "anatomicalLeftDirection": "+X",
        "anatomicalRightDirection": "-X",
        "orientationConfidence": orientation_confidence,
        "requiresOrientationReview": requires_review,
        "sourceBounds": {
            "minimum": _vec(source_minimum), "maximum": _vec(source_maximum), "size": _vec(source_size),
        },
        "canonicalBounds": {
            "minimum": _vec(canonical_minimum), "maximum": _vec(canonical_maximum), "size": _vec(canonical_size),
        },
        "upEvidence": {
            "axisExtents": dict(zip(AXIS_NAMES, extents)),
            "elongation": elongation,
            "lowTerminalFootprint": low_footprint,
            "highTerminalFootprint": high_footprint,
            "lowTerminalVertices": low_count,
            "highTerminalVertices": high_count,
        },
        **horizontal_report,
    }
    return report


def add_original_positions(landmarks: dict, inverse_matrix_values):
    inverse = Matrix(tuple(tuple(float(value) for value in row) for row in inverse_matrix_values))
    for record in landmarks.values():
        if not isinstance(record, dict):
            continue
        for field in ("position", "internalJointPosition", "surfaceDisplayPosition", "displayPosition"):
            value = record.get(field)
            if isinstance(value, list) and len(value) == 3:
                original = inverse @ Vector(tuple(float(component) for component in value))
                record[f"original{field[0].upper()}{field[1:]}"] = _vec(original)
    return landmarks
