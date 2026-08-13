from __future__ import annotations

from typing import Any
import math
import numpy as np

from body_measurements import (
    build_slice_components,
    slice_mesh_at_z,
    _section_record,
    SliceComponent,
)


def _point_map(landmarks: list[dict]) -> dict[str, np.ndarray]:
    result: dict[str, np.ndarray] = {}
    for item in landmarks:
        name = item.get("name")
        value = item.get("canonical_position")
        if name and isinstance(value, list) and len(value) == 3:
            result[name] = np.asarray(value, dtype=np.float64)
    return result


def _confidence_map(landmarks: list[dict]) -> dict[str, float]:
    return {
        str(item.get("name")): float(item.get("confidence", 0.5))
        for item in landmarks if item.get("name")
    }


def mesh_symmetry_score(ray_scene) -> float:
    center_x = float((ray_scene.bounds_min[0] + ray_scene.bounds_max[0]) * 0.5)
    left = abs(float(ray_scene.bounds_min[0] - center_x))
    right = abs(float(ray_scene.bounds_max[0] - center_x))
    denom = max(left, right, 1e-9)
    return float(np.clip(1.0 - abs(left - right) / denom, 0.0, 1.0))


def build_measurement_points(ray_scene, landmarks: list[dict]) -> tuple[dict[str, np.ndarray], list[dict]]:
    points = _point_map(landmarks)
    confidences = _confidence_map(landmarks)
    center_x = float((ray_scene.bounds_min[0] + ray_scene.bounds_max[0]) * 0.5)
    height = float(ray_scene.bounds_max[2] - ray_scene.bounds_min[2])
    corrections: list[dict] = []

    for base in ("shoulder", "elbow", "wrist", "hip", "knee", "ankle", "heel", "foot_index"):
        left_name, right_name = f"left_{base}", f"right_{base}"
        left, right = points.get(left_name), points.get(right_name)
        if left is None or right is None:
            continue
        left_radius = abs(float(left[0] - center_x))
        right_radius = abs(float(right[0] - center_x))
        max_radius = max(left_radius, right_radius, 1e-9)
        sign_invalid = left[0] >= center_x or right[0] <= center_x
        radial_mismatch = abs(left_radius - right_radius) > height * 0.018
        vertical_mismatch = abs(float(left[2] - right[2])) > height * 0.022
        depth_mismatch = abs(float(left[1] - right[1])) > height * 0.032
        near_center = min(left_radius, right_radius) < max_radius * 0.62
        if not (sign_invalid or radial_mismatch or vertical_mismatch or depth_mismatch or near_center):
            continue

        # Use the farther, higher-confidence side for radius; average Y/Z to remove detector skew.
        left_weight = max(confidences.get(left_name, 0.5), 0.05)
        right_weight = max(confidences.get(right_name, 0.5), 0.05)
        if near_center or radial_mismatch:
            radius = max(left_radius, right_radius)
        else:
            radius = (left_radius * left_weight + right_radius * right_weight) / (left_weight + right_weight)
        y = (float(left[1]) * left_weight + float(right[1]) * right_weight) / (left_weight + right_weight)
        z = (float(left[2]) * left_weight + float(right[2]) * right_weight) / (left_weight + right_weight)
        original_left, original_right = left.copy(), right.copy()
        points[left_name] = np.array([center_x - radius, y, z], dtype=np.float64)
        points[right_name] = np.array([center_x + radius, y, z], dtype=np.float64)
        corrections.append({
            "pair": base,
            "reason": [
                name for name, active in (
                    ("sign", sign_invalid), ("radius", radial_mismatch),
                    ("height", vertical_mismatch), ("depth", depth_mismatch),
                    ("near_center", near_center),
                ) if active
            ],
            "original_left": original_left.astype(float).tolist(),
            "original_right": original_right.astype(float).tolist(),
            "corrected_left": points[left_name].astype(float).tolist(),
            "corrected_right": points[right_name].astype(float).tolist(),
        })
    return points, corrections


def _chain(points: dict[str, np.ndarray], names: list[str]) -> float | None:
    values = [points.get(name) for name in names]
    if any(value is None for value in values):
        return None
    return float(sum(np.linalg.norm(values[i + 1] - values[i]) for i in range(len(values) - 1)))


def _set_measurement(values: dict[str, dict], name: str, value_geometry: float | None, scale: float, method: str, confidence: float, **extra) -> None:
    if value_geometry is None or not np.isfinite(value_geometry):
        values[name] = {"status": "unavailable", "method": method, "confidence": 0.0, **extra}
        return
    value_m = float(value_geometry * scale)
    values[name] = {
        "status": "valid",
        "value_m": value_m,
        "value_cm": value_m * 100.0,
        "method": method,
        "confidence": float(np.clip(confidence, 0.0, 1.0)),
        **extra,
    }


def _pair_average_when_symmetric(values: dict[str, dict], left_key: str, right_key: str, symmetry: float, threshold: float = 0.08) -> None:
    left, right = values.get(left_key, {}), values.get(right_key, {})
    if left.get("value_m") is None or right.get("value_m") is None:
        return
    lv, rv = float(left["value_m"]), float(right["value_m"])
    relative = abs(lv - rv) / max((lv + rv) * 0.5, 1e-9)
    if symmetry >= 0.97 and relative > threshold:
        mean = (lv + rv) * 0.5
        for item in (left, right):
            item["raw_value_m"] = item["value_m"]
            item["raw_value_cm"] = item["value_cm"]
            item["value_m"] = mean
            item["value_cm"] = mean * 100.0
            item["method"] = f"{item.get('method', 'pair')}_symmetry_average"
            item["confidence"] = min(float(item.get("confidence", 0.8)), 0.82)
            item["symmetry_corrected"] = True


def _foot_geometry_span(ray_scene, side: str, ankle: np.ndarray | None) -> float | None:
    if ankle is None:
        return None
    vertices = np.asarray(ray_scene.vertices, dtype=np.float64)
    height = float(ray_scene.bounds_max[2] - ray_scene.bounds_min[2])
    center_x = float((ray_scene.bounds_min[0] + ray_scene.bounds_max[0]) * 0.5)
    z_max = min(float(ray_scene.bounds_min[2] + height * 0.105), float(ankle[2] + height * 0.035))
    side_mask = vertices[:, 0] < center_x if side == "left" else vertices[:, 0] > center_x
    x_window = np.abs(vertices[:, 0] - float(ankle[0])) <= height * 0.105
    mask = side_mask & x_window & (vertices[:, 2] <= z_max)
    cloud = vertices[mask]
    if len(cloud) < 30:
        return None
    xy = cloud[:, :2]
    xy = xy - np.median(xy, axis=0)
    covariance = np.cov(xy.T)
    eigenvalues, eigenvectors = np.linalg.eigh(covariance)
    axis = eigenvectors[:, int(np.argmax(eigenvalues))]
    projected = xy @ axis
    low, high = np.quantile(projected, [0.015, 0.985])
    span = float(high - low)
    if span < height * 0.025 or span > height * 0.18:
        return None
    return span


def _strict_limb_component(ray_scene, z: float, target: np.ndarray):
    height = float(ray_scene.bounds_max[2] - ray_scene.bounds_min[2])
    center_x = float((ray_scene.bounds_min[0] + ray_scene.bounds_max[0]) * 0.5)
    components = build_slice_components(slice_mesh_at_z(
        ray_scene.vertices.astype(np.float64), ray_scene.faces.astype(np.int64), float(z)
    ))
    expected_side = -1 if target[0] < center_x else 1
    candidates = []
    for component in components:
        side = -1 if component.centroid[0] < center_x else 1
        if side != expected_side:
            continue
        if abs(float(component.centroid[0] - target[0])) > height * 0.075:
            continue
        if component.width > height * 0.15 or component.depth > height * 0.15:
            continue
        if component.perimeter > height * 0.42:
            continue
        distance = float(np.linalg.norm(component.centroid[:2] - target[:2]))
        candidates.append((distance, component))
    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0])
    return candidates[0][1]


def _plane_basis(axis: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray] | None:
    """Build a stable orthonormal basis whose local Z axis follows the limb."""
    normal = np.asarray(axis, dtype=np.float64)
    length = float(np.linalg.norm(normal))
    if length <= 1e-9:
        return None
    normal = normal / length
    reference = np.array([0.0, 0.0, 1.0], dtype=np.float64)
    if abs(float(np.dot(normal, reference))) > 0.88:
        reference = np.array([0.0, 1.0, 0.0], dtype=np.float64)
    u = np.cross(normal, reference)
    u_norm = float(np.linalg.norm(u))
    if u_norm <= 1e-9:
        return None
    u = u / u_norm
    v = np.cross(normal, u)
    v = v / max(float(np.linalg.norm(v)), 1e-9)
    return u, v, normal


def _oblique_limb_component(
    ray_scene,
    start: np.ndarray,
    end: np.ndarray,
    fraction: float,
    *,
    max_perimeter_ratio: float = 0.30,
    max_dimension_ratio: float = 0.12,
) -> tuple[SliceComponent | None, dict[str, Any]]:
    """Slice perpendicular to a limb axis instead of horizontally.

    A horizontal Z slice can join an upper arm to the chest. Transforming the
    mesh into a local limb frame makes the requested plane Z=0 and isolates the
    arm cross-section even when the source mesh is one connected surface.
    """
    start = np.asarray(start, dtype=np.float64)
    end = np.asarray(end, dtype=np.float64)
    axis = end - start
    basis = _plane_basis(axis)
    if basis is None:
        return None, {"status": "invalid_axis"}
    u, v, normal = basis
    origin = start * (1.0 - float(fraction)) + end * float(fraction)
    vertices = np.asarray(ray_scene.vertices, dtype=np.float64)
    shifted = vertices - origin
    local_vertices = np.column_stack((shifted @ u, shifted @ v, shifted @ normal))
    segments = slice_mesh_at_z(local_vertices, np.asarray(ray_scene.faces, dtype=np.int64), 0.0)
    components = build_slice_components(segments)
    height = float(ray_scene.bounds_max[2] - ray_scene.bounds_min[2])
    candidates: list[tuple[float, SliceComponent]] = []
    rejected: list[dict[str, Any]] = []
    for component in components:
        center_distance = float(np.linalg.norm(component.centroid[:2]))
        max_dimension = max(float(component.width), float(component.depth))
        min_dimension = min(float(component.width), float(component.depth))
        perimeter_ratio = float(component.perimeter / max(height, 1e-9))
        dimension_ratio = float(max_dimension / max(height, 1e-9))
        center_ratio = float(center_distance / max(height, 1e-9))
        aspect = max_dimension / max(min_dimension, height * 1e-6)
        reasons = []
        if center_ratio > 0.065:
            reasons.append("far_from_limb_axis")
        if perimeter_ratio > max_perimeter_ratio:
            reasons.append("torso_sized_perimeter")
        if dimension_ratio > max_dimension_ratio:
            reasons.append("torso_sized_dimension")
        if perimeter_ratio < 0.025:
            reasons.append("degenerate_perimeter")
        if aspect > 3.2:
            reasons.append("degenerate_aspect")
        if reasons:
            rejected.append({
                "reasons": reasons,
                "center_ratio": center_ratio,
                "perimeter_ratio": perimeter_ratio,
                "dimension_ratio": dimension_ratio,
                "closed": bool(component.closed),
            })
            continue
        # Prefer a loop centered on the limb axis. Closed loops receive a bonus,
        # but open high-poly slices remain usable as an explicit estimate.
        score = center_distance
        if not component.closed:
            score += height * 0.018
        score += abs(component.width - component.depth) * 0.08
        candidates.append((score, component))
    if not candidates:
        return None, {
            "status": "no_isolated_component",
            "origin": origin.astype(float).tolist(),
            "normal": normal.astype(float).tolist(),
            "candidate_count": len(components),
            "rejected": rejected[:12],
        }
    candidates.sort(key=lambda item: item[0])
    component = candidates[0][1]
    local_centroid = component.centroid.copy()
    canonical_centroid = origin + u * local_centroid[0] + v * local_centroid[1] + normal * local_centroid[2]
    component = SliceComponent(
        segment_indices=component.segment_indices,
        points=component.points,
        perimeter=component.perimeter,
        centroid=canonical_centroid,
        bounds_min=component.bounds_min,
        bounds_max=component.bounds_max,
        closed=component.closed,
    )
    return component, {
        "status": "isolated",
        "origin": origin.astype(float).tolist(),
        "normal": normal.astype(float).tolist(),
        "axis_length": float(np.linalg.norm(axis)),
        "candidate_count": len(components),
        "selected_closed": bool(component.closed),
    }



def _unique_xy(points: np.ndarray, tolerance: float) -> np.ndarray:
    """Deduplicate 2D slice endpoints with an adaptive geometric tolerance."""
    if len(points) == 0:
        return points.reshape(0, 2)
    tolerance = max(float(tolerance), 1e-9)
    buckets: dict[tuple[int, int], list[np.ndarray]] = {}
    for point in np.asarray(points, dtype=np.float64):
        key = tuple(np.round(point[:2] / tolerance).astype(np.int64).tolist())
        buckets.setdefault(key, []).append(point[:2])
    return np.asarray([np.mean(values, axis=0) for values in buckets.values()], dtype=np.float64)


def _largest_missing_arc(occupied: np.ndarray) -> int:
    """Return the largest circular run of empty angular bins."""
    occupied = np.asarray(occupied, dtype=bool)
    if occupied.size == 0 or not occupied.any():
        return int(occupied.size)
    doubled = np.concatenate([~occupied, ~occupied])
    best = current = 0
    for value in doubled:
        if value:
            current += 1
            best = max(best, current)
        else:
            current = 0
    return min(best, int(occupied.size))


def _circular_interpolate(values: np.ndarray) -> np.ndarray | None:
    """Fill missing angular bins by linear interpolation on a circular domain."""
    values = np.asarray(values, dtype=np.float64)
    valid = np.isfinite(values)
    count = len(values)
    if count < 8 or valid.sum() < max(8, int(count * 0.55)):
        return None
    x = np.arange(count, dtype=np.float64)
    valid_x = x[valid]
    valid_y = values[valid]
    extended_x = np.concatenate([valid_x - count, valid_x, valid_x + count])
    extended_y = np.concatenate([valid_y, valid_y, valid_y])
    return np.interp(x, extended_x, extended_y)


def _polar_core_record_from_points(
    points_xy: np.ndarray,
    *,
    target_xy: np.ndarray,
    z: float,
    scale: float,
    geometry_height: float,
    label: str,
    source_component_count: int,
    width_reference: float | None = None,
) -> dict[str, Any] | None:
    """Build a closed, star-shaped torso contour from dense plane intersections.

    This is not a blind convex hull. It keeps one radial sample per angle around
    the torso center, rejects large angular holes, and records that source
    topology required reconstruction. It is intended for neck/chest/waist/hip,
    which are approximately star-shaped around the body center.
    """
    points_xy = _unique_xy(np.asarray(points_xy, dtype=np.float64), geometry_height * 0.00035)
    if len(points_xy) < 36:
        return None
    target_xy = np.asarray(target_xy, dtype=np.float64)[:2]
    # A robust center starts from the expected torso axis and is nudged toward
    # the median of the actual section points, never far enough to drift to an arm.
    median = np.median(points_xy, axis=0)
    max_shift = geometry_height * 0.035
    shift = median - target_xy
    shift_norm = float(np.linalg.norm(shift))
    if shift_norm > max_shift:
        shift = shift / max(shift_norm, 1e-9) * max_shift
    center = target_xy + shift

    rel = points_xy - center
    radii = np.linalg.norm(rel, axis=1)
    valid_radius = (radii > geometry_height * 0.012) & (radii < geometry_height * 0.28)
    rel, radii = rel[valid_radius], radii[valid_radius]
    if len(radii) < 36:
        return None
    angles = (np.arctan2(rel[:, 1], rel[:, 0]) + 2.0 * math.pi) % (2.0 * math.pi)
    bin_count = 180
    bin_index = np.floor(angles / (2.0 * math.pi) * bin_count).astype(int) % bin_count
    radial_bins = np.full(bin_count, np.nan, dtype=np.float64)
    for index in range(bin_count):
        values = radii[bin_index == index]
        if len(values):
            # Median avoids a stray point from a nearby arm or accessory.
            radial_bins[index] = float(np.median(values))
    occupied = np.isfinite(radial_bins)
    coverage = float(occupied.mean())
    largest_gap_bins = _largest_missing_arc(occupied)
    largest_gap_degrees = largest_gap_bins * 360.0 / bin_count
    if coverage < 0.68 or largest_gap_degrees > 42.0:
        return None
    interpolated = _circular_interpolate(radial_bins)
    if interpolated is None:
        return None

    # Circular smoothing suppresses triangle-scale noise without changing body form.
    padded = np.concatenate([interpolated[-2:], interpolated, interpolated[:2]])
    smoothed = np.asarray([
        np.median(padded[i:i + 5]) for i in range(bin_count)
    ], dtype=np.float64)
    median_radius = float(np.median(smoothed))
    if median_radius <= geometry_height * 0.018:
        return None
    # Large adjacent jumps mean the section is not a trustworthy single torso loop.
    relative_jumps = np.abs(np.roll(smoothed, -1) - smoothed) / max(median_radius, 1e-9)
    max_jump = float(np.quantile(relative_jumps, 0.98))
    if max_jump > 0.32:
        return None

    theta = (np.arange(bin_count, dtype=np.float64) + 0.5) * (2.0 * math.pi / bin_count)
    polygon = center + np.column_stack([np.cos(theta), np.sin(theta)]) * smoothed[:, None]
    perimeter = float(np.linalg.norm(np.roll(polygon, -1, axis=0) - polygon, axis=1).sum())
    width = float(polygon[:, 0].max() - polygon[:, 0].min())
    depth = float(polygon[:, 1].max() - polygon[:, 1].min())
    if perimeter <= 0 or width <= 0 or depth <= 0:
        return None
    # Plausibility gates by section type, relative to calibrated height.
    limits = {
        "neck": (0.12, 0.34, 0.045, 0.18),
        "chest": (0.28, 0.75, 0.10, 0.32),
        "waist": (0.24, 0.68, 0.09, 0.30),
        "hip": (0.28, 0.78, 0.11, 0.34),
    }
    p_min, p_max, d_min, d_max = limits[label]
    if not (geometry_height * p_min <= perimeter <= geometry_height * p_max):
        return None
    if not (geometry_height * d_min <= max(width, depth) <= geometry_height * d_max):
        return None

    # v0.8.5: a chest slice can contain three disconnected components
    # (torso + both upper arms). A mathematically closed contour is not enough:
    # its width and perimeter must also be compatible with the shoulder span.
    if label == "chest" and width_reference is not None and np.isfinite(width_reference):
        reference = max(float(width_reference), geometry_height * 0.08)
        if width > reference * 1.18:
            return None
        if perimeter > reference * 3.45:
            return None

    confidence = float(np.clip(0.78 + coverage * 0.12 - largest_gap_degrees / 360.0 * 0.20 - max_jump * 0.08, 0.72, 0.90))
    return {
        "status": "valid",
        "z": float(z),
        "circumference_cm": perimeter * scale * 100.0,
        "width_cm": width * scale * 100.0,
        "depth_cm": depth * scale * 100.0,
        "closed": True,
        "source_topology_closed": False,
        "computationally_closed": True,
        "centroid": [float(center[0]), float(center[1]), float(z)],
        "method": "polar_torso_contour_reconstruction",
        "confidence": confidence,
        "reconstruction": {
            "angular_bins": bin_count,
            "angular_coverage": coverage,
            "largest_missing_arc_degrees": largest_gap_degrees,
            "radial_jump_q98": max_jump,
            "source_component_count": int(source_component_count),
        },
    }


def _reconstruct_core_section(
    ray_scene,
    *,
    label: str,
    z: float,
    target_xy: np.ndarray,
    scale: float,
    width_reference: float | None = None,
) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    """Try adaptive welding, then a validated polar closure for a torso slice."""
    vertices = np.asarray(ray_scene.vertices, dtype=np.float64)
    faces = np.asarray(ray_scene.faces, dtype=np.int64)
    height = float(ray_scene.bounds_max[2] - ray_scene.bounds_min[2])
    segments = slice_mesh_at_z(vertices, faces, float(z))
    diagnostics: dict[str, Any] = {
        "label": label,
        "z": float(z),
        "raw_segment_count": len(segments),
        "attempts": [],
    }
    if not segments:
        diagnostics["status"] = "no_segments"
        return None, diagnostics

    # First, retry graph welding with tolerances tied to avatar height.
    selected = None
    selected_components = []
    for tolerance in (height * 0.00020, height * 0.00045, height * 0.00085, height * 0.00150):
        components = build_slice_components(segments, tolerance=max(tolerance, 2e-4))
        candidate = None
        scored = []
        for component in components:
            distance = float(np.linalg.norm(component.centroid[:2] - target_xy[:2]))
            # Torso must remain near center and have a non-trivial perimeter.
            if distance > height * 0.075 or component.perimeter < height * 0.10:
                continue
            if label == "chest":
                # The torso is the component that crosses the body axis. Upper
                # arms sit on either side and must never be merged into chest.
                axis_margin = height * 0.004
                crosses_axis = (
                    float(component.bounds_min[0]) <= float(target_xy[0]) + axis_margin
                    and float(component.bounds_max[0]) >= float(target_xy[0]) - axis_margin
                )
                if not crosses_axis:
                    continue
                if width_reference is not None and np.isfinite(width_reference):
                    if float(component.width) > float(width_reference) * 1.25:
                        continue
            score = distance - min(component.perimeter, height) * 0.012
            scored.append((score, component))
        if scored:
            scored.sort(key=lambda item: item[0])
            candidate = scored[0][1]
        diagnostics["attempts"].append({
            "tolerance": float(tolerance),
            "component_count": len(components),
            "selected_closed": bool(candidate.closed) if candidate else False,
        })
        if candidate is not None:
            selected = candidate
            selected_components = components
            if candidate.closed:
                record = _section_record(candidate, float(z), scale, "adaptive_welded_horizontal_mesh_intersection")
                record["source_topology_closed"] = True
                record["computationally_closed"] = True
                record["reconstruction"] = {
                    "method": "adaptive_endpoint_welding",
                    "tolerance": float(tolerance),
                    "source_component_count": len(components),
                }
                diagnostics["status"] = "closed_by_adaptive_welding"
                return record, diagnostics

    if selected is None:
        diagnostics["status"] = "no_center_component"
        return None, diagnostics

    # v0.8.5 chest isolation: reconstruct the central torso component first.
    # On an A-pose slice, the two arms are commonly separate components close
    # enough to the center that the older merge logic included them.
    if label == "chest":
        torso_points_xy = np.asarray(
            [point.point[:2] for point in selected.points], dtype=np.float64
        )
        torso_record = _polar_core_record_from_points(
            torso_points_xy,
            target_xy=np.asarray(target_xy, dtype=np.float64),
            z=float(z),
            scale=scale,
            geometry_height=height,
            label=label,
            source_component_count=1,
            width_reference=width_reference,
        )
        diagnostics["torso_isolation"] = {
            "strategy": "central_axis_component_only",
            "source_component_count": len(selected_components),
            "excluded_component_count": max(0, len(selected_components) - 1),
            "selected_width": float(selected.width),
            "selected_depth": float(selected.depth),
            "width_reference": float(width_reference) if width_reference is not None else None,
        }
        if torso_record is not None:
            torso_record["method"] = "central_torso_polar_contour_reconstruction"
            torso_record["reconstruction"]["excluded_lateral_components"] = max(0, len(selected_components) - 1)
            torso_record["reconstruction"]["torso_isolated"] = True
            diagnostics["status"] = "closed_by_central_torso_reconstruction"
            return torso_record, diagnostics

    # Merge plausible fragments around the torso axis for neck, waist and hip.
    # Chest deliberately does not merge lateral components after the isolated
    # attempt, because those components are usually the upper arms.
    relevant_components = [
        component for component in selected_components
        if float(np.linalg.norm(component.centroid[:2] - target_xy[:2])) <= height * 0.13
        and component.perimeter >= height * 0.008
        and max(component.width, component.depth) <= height * 0.36
    ]
    if label == "chest":
        relevant_components = [selected]
    elif not relevant_components:
        relevant_components = [selected]
    points_xy = np.asarray([
        point.point[:2]
        for component in relevant_components
        for point in component.points
    ], dtype=np.float64)
    record = _polar_core_record_from_points(
        points_xy,
        target_xy=np.asarray(target_xy, dtype=np.float64),
        z=float(z),
        scale=scale,
        geometry_height=height,
        label=label,
        source_component_count=len(relevant_components),
        width_reference=width_reference,
    )
    if record is not None:
        diagnostics["status"] = "closed_by_polar_reconstruction"
        return record, diagnostics

    if label == "neck":
        # Neck seams are often one nearly complete open loop. Prefer a minimal
        # endpoint bridge, then use a neck-specific ellipse-guided closure.
        bridge_tolerance = height * 0.00150
        bridged = _neck_endpoint_bridge_record(
            segments, selected, z=float(z), scale=scale, geometry_height=height,
            tolerance=max(bridge_tolerance, 2e-4),
            source_component_count=len(relevant_components),
        )
        if bridged is not None:
            diagnostics["status"] = "closed_by_neck_endpoint_bridge"
            diagnostics["neck_fallback"] = bridged.get("reconstruction", {})
            return bridged, diagnostics
        guided = _neck_ellipse_guided_record_from_points(
            points_xy,
            target_xy=np.asarray(target_xy, dtype=np.float64),
            z=float(z),
            scale=scale,
            geometry_height=height,
            source_component_count=len(relevant_components),
        )
        if guided is not None:
            diagnostics["status"] = "closed_by_neck_ellipse_guided_reconstruction"
            diagnostics["neck_fallback"] = guided.get("reconstruction", {})
            return guided, diagnostics

    diagnostics["status"] = "reconstruction_rejected"
    return None, diagnostics


def _component_open_endpoints(
    segments,
    component: SliceComponent,
    *,
    tolerance: float,
) -> list[np.ndarray]:
    """Return the two degree-1 endpoints of one open slice component."""
    tolerance = max(float(tolerance), 1e-9)
    buckets: dict[tuple[int, int], list[np.ndarray]] = {}
    degrees: dict[tuple[int, int], int] = {}
    for index in component.segment_indices:
        segment = segments[index]
        for endpoint in (segment.a.point, segment.b.point):
            key = tuple(np.round(np.asarray(endpoint[:2]) / tolerance).astype(np.int64).tolist())
            buckets.setdefault(key, []).append(np.asarray(endpoint, dtype=np.float64))
            degrees[key] = degrees.get(key, 0) + 1
    endpoints = [
        np.mean(buckets[key], axis=0)
        for key, degree in degrees.items()
        if degree == 1
    ]
    return endpoints


def _neck_endpoint_bridge_record(
    segments,
    component: SliceComponent,
    *,
    z: float,
    scale: float,
    geometry_height: float,
    tolerance: float,
    source_component_count: int,
) -> dict[str, Any] | None:
    """Close a single small seam in an otherwise complete neck loop.

    A geometry-only GLB can contain a UV/topology seam that leaves the horizontal
    neck section open. We accept a bridge only when there are exactly two open
    endpoints, the gap is small relative to both the neck size and perimeter, and
    the resulting circumference stays anatomically plausible.
    """
    endpoints = _component_open_endpoints(segments, component, tolerance=tolerance)
    if len(endpoints) != 2:
        return None
    gap = float(np.linalg.norm(endpoints[0][:2] - endpoints[1][:2]))
    min_dimension = max(min(float(component.width), float(component.depth)), geometry_height * 1e-6)
    max_gap = min(geometry_height * 0.018, min_dimension * 0.26)
    bridge_ratio = gap / max(float(component.perimeter), geometry_height * 1e-6)
    if gap <= 0.0 or gap > max_gap or bridge_ratio > 0.09:
        return None
    perimeter = float(component.perimeter + gap)
    width = float(component.width)
    depth = float(component.depth)
    if not (geometry_height * 0.12 <= perimeter <= geometry_height * 0.34):
        return None
    if not (geometry_height * 0.045 <= max(width, depth) <= geometry_height * 0.18):
        return None
    aspect = max(width, depth) / max(min(width, depth), geometry_height * 1e-6)
    if aspect > 2.15:
        return None
    confidence = float(np.clip(0.86 - bridge_ratio * 0.9, 0.76, 0.86))
    return {
        "status": "valid",
        "z": float(z),
        "circumference_cm": perimeter * scale * 100.0,
        "width_cm": width * scale * 100.0,
        "depth_cm": depth * scale * 100.0,
        "closed": True,
        "source_topology_closed": False,
        "computationally_closed": True,
        "centroid": component.centroid.astype(float).tolist(),
        "method": "neck_endpoint_bridge_reconstruction",
        "confidence": confidence,
        "reconstruction": {
            "method": "validated_endpoint_bridge",
            "gap_m": gap,
            "gap_cm_calibrated": gap * scale * 100.0,
            "bridge_ratio": bridge_ratio,
            "source_component_count": int(source_component_count),
            "endpoint_count": 2,
        },
    }


def _neck_ellipse_guided_record_from_points(
    points_xy: np.ndarray,
    *,
    target_xy: np.ndarray,
    z: float,
    scale: float,
    geometry_height: float,
    source_component_count: int,
) -> dict[str, Any] | None:
    """Reconstruct a neck loop from observed radii plus an ellipse prior.

    This fallback is neck-only. It preserves every trustworthy observed angular
    sample and fills only missing angles with an ellipse fitted to robust extents.
    It is intentionally stricter than a generic convex hull and records that the
    closure is computational rather than source-topology exact.
    """
    points_xy = _unique_xy(np.asarray(points_xy, dtype=np.float64), geometry_height * 0.00030)
    if len(points_xy) < 24:
        return None
    target_xy = np.asarray(target_xy, dtype=np.float64)[:2]
    q_low = np.quantile(points_xy, 0.02, axis=0)
    q_high = np.quantile(points_xy, 0.98, axis=0)
    robust_width, robust_depth = (q_high - q_low).astype(float)
    if robust_width <= 0 or robust_depth <= 0:
        return None
    if not (geometry_height * 0.04 <= max(robust_width, robust_depth) <= geometry_height * 0.18):
        return None
    aspect = max(robust_width, robust_depth) / max(min(robust_width, robust_depth), geometry_height * 1e-6)
    if aspect > 2.20:
        return None
    extent_center = (q_low + q_high) * 0.5
    shift = extent_center - target_xy
    max_shift = geometry_height * 0.025
    shift_norm = float(np.linalg.norm(shift))
    if shift_norm > max_shift:
        shift = shift / max(shift_norm, 1e-9) * max_shift
    center = target_xy + shift

    rel = points_xy - center
    radii = np.linalg.norm(rel, axis=1)
    valid = (radii > geometry_height * 0.015) & (radii < geometry_height * 0.13)
    rel, radii = rel[valid], radii[valid]
    if len(radii) < 24:
        return None
    angles = (np.arctan2(rel[:, 1], rel[:, 0]) + 2.0 * math.pi) % (2.0 * math.pi)
    bin_count = 144
    bin_index = np.floor(angles / (2.0 * math.pi) * bin_count).astype(int) % bin_count
    observed = np.full(bin_count, np.nan, dtype=np.float64)
    for index in range(bin_count):
        values = radii[bin_index == index]
        if len(values):
            observed[index] = float(np.median(values))
    occupied = np.isfinite(observed)
    coverage = float(occupied.mean())
    largest_gap_bins = _largest_missing_arc(occupied)
    largest_gap_degrees = largest_gap_bins * 360.0 / bin_count
    if coverage < 0.34 or largest_gap_degrees > 150.0:
        return None

    theta = (np.arange(bin_count, dtype=np.float64) + 0.5) * (2.0 * math.pi / bin_count)
    a = robust_width * 0.5
    b = robust_depth * 0.5
    ellipse_radius = (a * b) / np.sqrt((b * np.cos(theta)) ** 2 + (a * np.sin(theta)) ** 2 + 1e-12)
    radial = ellipse_radius.copy()
    observed_clamped = np.clip(observed[occupied], ellipse_radius[occupied] * 0.58, ellipse_radius[occupied] * 1.42)
    radial[occupied] = observed_clamped
    padded = np.concatenate([radial[-2:], radial, radial[:2]])
    radial = np.asarray([np.median(padded[i:i + 5]) for i in range(bin_count)], dtype=np.float64)
    median_radius = float(np.median(radial))
    jumps = np.abs(np.roll(radial, -1) - radial) / max(median_radius, 1e-9)
    max_jump = float(np.quantile(jumps, 0.98))
    if max_jump > 0.36:
        return None

    polygon = center + np.column_stack([np.cos(theta), np.sin(theta)]) * radial[:, None]
    perimeter = float(np.linalg.norm(np.roll(polygon, -1, axis=0) - polygon, axis=1).sum())
    width = float(polygon[:, 0].max() - polygon[:, 0].min())
    depth = float(polygon[:, 1].max() - polygon[:, 1].min())
    if not (geometry_height * 0.12 <= perimeter <= geometry_height * 0.34):
        return None
    if not (geometry_height * 0.045 <= max(width, depth) <= geometry_height * 0.18):
        return None
    confidence = float(np.clip(0.74 + coverage * 0.13 - largest_gap_degrees / 360.0 * 0.07 - max_jump * 0.04, 0.72, 0.84))
    return {
        "status": "valid",
        "z": float(z),
        "circumference_cm": perimeter * scale * 100.0,
        "width_cm": width * scale * 100.0,
        "depth_cm": depth * scale * 100.0,
        "closed": True,
        "source_topology_closed": False,
        "computationally_closed": True,
        "centroid": [float(center[0]), float(center[1]), float(z)],
        "method": "neck_ellipse_guided_polar_reconstruction",
        "confidence": confidence,
        "reconstruction": {
            "method": "observed_radii_plus_ellipse_prior",
            "angular_bins": bin_count,
            "angular_coverage": coverage,
            "largest_missing_arc_degrees": largest_gap_degrees,
            "radial_jump_q98": max_jump,
            "source_component_count": int(source_component_count),
            "observed_bins": int(occupied.sum()),
            "filled_bins": int((~occupied).sum()),
        },
    }

def _relative_difference(a: float, b: float) -> float:
    return abs(a - b) / max((abs(a) + abs(b)) * 0.5, 1e-9)



def _section_metric_m(section: dict[str, Any], field: str) -> float | None:
    """Read a centimetre section field as metres, returning None when unavailable."""
    value = section.get(field)
    if value is None:
        return None
    value = float(value) / 100.0
    return value if np.isfinite(value) and value > 0 else None


def _validate_isolated_chest_against_core(
    chest: dict[str, Any],
    waist: dict[str, Any],
    hip: dict[str, Any],
    geometry_height: float,
) -> tuple[bool, dict[str, Any]]:
    """Validate a reconstructed chest using the torso itself, not shoulder landmarks.

    MediaPipe shoulder points are joint/visual anchors and commonly sit inside the
    outer torso silhouette. Comparing the chest width against that pair creates a
    false arm-contamination error. v0.8.6 instead requires an isolated central
    component and checks its width, depth and perimeter against height, waist and hip.
    """
    diagnostics: dict[str, Any] = {"rule": "isolated_torso_core_ratios_v086", "failures": []}
    if chest.get("status") != "valid":
        diagnostics["failures"].append("chest_status_not_valid")
    if chest.get("closed") is not True or chest.get("computationally_closed") is not True:
        diagnostics["failures"].append("chest_not_computationally_closed")
    if float(chest.get("confidence", 0.0)) < 0.72:
        diagnostics["failures"].append("chest_confidence_low")

    reconstruction = chest.get("reconstruction", {}) or {}
    method = str(chest.get("method", ""))
    torso_isolated = bool(
        reconstruction.get("torso_isolated")
        or method == "central_torso_polar_contour_reconstruction"
    )
    diagnostics["torso_isolated"] = torso_isolated
    diagnostics["excluded_lateral_components"] = int(reconstruction.get("excluded_lateral_components", 0) or 0)
    if not torso_isolated:
        diagnostics["failures"].append("central_torso_not_isolated")

    chest_width = _section_metric_m(chest, "width_cm")
    chest_depth = _section_metric_m(chest, "depth_cm")
    chest_perimeter = _section_metric_m(chest, "circumference_cm")
    diagnostics.update({
        "chest_width_m": chest_width,
        "chest_depth_m": chest_depth,
        "chest_perimeter_m": chest_perimeter,
    })
    if None in (chest_width, chest_depth, chest_perimeter):
        diagnostics["failures"].append("chest_dimensions_missing")
        return False, diagnostics

    height = max(float(geometry_height), 1e-9)
    normalized = {
        "width_to_height": chest_width / height,
        "depth_to_height": chest_depth / height,
        "perimeter_to_height": chest_perimeter / height,
        "width_to_depth": chest_width / max(chest_depth, 1e-9),
    }
    diagnostics["normalized"] = normalized
    broad_limits = {
        "width_to_height": (0.10, 0.28),
        "depth_to_height": (0.07, 0.24),
        "perimeter_to_height": (0.30, 0.70),
        "width_to_depth": (0.70, 1.90),
    }
    for key, (low, high) in broad_limits.items():
        if not (low <= normalized[key] <= high):
            diagnostics["failures"].append(f"{key}_out_of_range")

    def compare(section: dict[str, Any], label: str, limits: dict[str, tuple[float, float]]) -> None:
        other_width = _section_metric_m(section, "width_cm")
        other_depth = _section_metric_m(section, "depth_cm")
        other_perimeter = _section_metric_m(section, "circumference_cm")
        if None in (other_width, other_depth, other_perimeter):
            diagnostics[f"{label}_comparison"] = {"available": False}
            return
        ratios = {
            "width": chest_width / max(other_width, 1e-9),
            "depth": chest_depth / max(other_depth, 1e-9),
            "perimeter": chest_perimeter / max(other_perimeter, 1e-9),
        }
        diagnostics[f"{label}_comparison"] = {"available": True, **ratios}
        for key, (low, high) in limits.items():
            if not (low <= ratios[key] <= high):
                diagnostics["failures"].append(f"chest_to_{label}_{key}_out_of_range")

    compare(waist, "waist", {
        "width": (0.85, 1.55),
        "depth": (0.75, 1.45),
        "perimeter": (0.88, 1.55),
    })
    compare(hip, "hip", {
        "width": (0.62, 1.25),
        "depth": (0.70, 1.55),
        "perimeter": (0.68, 1.30),
    })
    return len(diagnostics["failures"]) == 0, diagnostics


def apply_measurement_quality_v086(ray_scene, landmarks: list[dict], measurements: dict[str, Any], height_cm: float) -> dict[str, Any]:
    values = measurements.setdefault("values", {})
    sections = measurements.setdefault("sections", {})
    scale = float(measurements.get("scale", {}).get("geometry_to_meters", 1.0))
    geometry_height = float(ray_scene.bounds_max[2] - ray_scene.bounds_min[2])
    height_m = float(height_cm) / 100.0
    symmetry = mesh_symmetry_score(ray_scene)
    points, corrections = build_measurement_points(ray_scene, landmarks)

    # Recompute paired chains from symmetry-cleaned points.
    for side in ("left", "right"):
        _set_measurement(values, f"{side}_arm_length", _chain(points, [f"{side}_shoulder", f"{side}_elbow", f"{side}_wrist"]), scale, "symmetry_validated_joint_chain", 0.84)
        _set_measurement(values, f"{side}_forearm_length", _chain(points, [f"{side}_elbow", f"{side}_wrist"]), scale, "symmetry_validated_joint_chain", 0.86)
        _set_measurement(values, f"{side}_leg_length", _chain(points, [f"{side}_hip", f"{side}_knee", f"{side}_ankle"]), scale, "symmetry_validated_joint_chain", 0.82)
        foot_span = _foot_geometry_span(ray_scene, side, points.get(f"{side}_ankle"))
        _set_measurement(values, f"{side}_foot_length", foot_span, scale, "foot_region_pca_extent", 0.82)

    for left_key, right_key, threshold in (
        ("left_arm_length", "right_arm_length", 0.07),
        ("left_forearm_length", "right_forearm_length", 0.07),
        ("left_leg_length", "right_leg_length", 0.07),
        ("left_foot_length", "right_foot_length", 0.10),
    ):
        _pair_average_when_symmetric(values, left_key, right_key, symmetry, threshold)

    # Shoulder width is derived from the corrected shoulder pair only. Using an
    # unvalidated chest slice here creates a circular error when arms pollute it.
    left_shoulder, right_shoulder = points.get("left_shoulder"), points.get("right_shoulder")
    direct_shoulder = float(np.linalg.norm(left_shoulder - right_shoulder)) if left_shoulder is not None and right_shoulder is not None else None
    shoulder_geometry = direct_shoulder
    _set_measurement(values, "shoulder_width", shoulder_geometry, scale, "symmetry_validated_shoulder_pair", 0.82)

    # Slice each limb perpendicular to its own axis. This avoids the v0.8.1
    # failure where a horizontal bicep plane joined the right arm to the torso.
    limb_specs = {
        "left_bicep": ("left_shoulder", "left_elbow", 0.64, 0.25, 0.105),
        "right_bicep": ("right_shoulder", "right_elbow", 0.64, 0.25, 0.105),
        "left_forearm": ("left_elbow", "left_wrist", 0.52, 0.24, 0.095),
        "right_forearm": ("right_elbow", "right_wrist", 0.52, 0.24, 0.095),
        "left_thigh": ("left_hip", "left_knee", 0.55, 0.34, 0.14),
        "right_thigh": ("right_hip", "right_knee", 0.55, 0.34, 0.14),
        "left_calf": ("left_knee", "left_ankle", 0.52, 0.30, 0.125),
        "right_calf": ("right_knee", "right_ankle", 0.52, 0.30, 0.125),
    }
    limb_diagnostics: dict[str, dict[str, Any]] = {}
    for label, (start_name, end_name, fraction, max_perimeter, max_dimension) in limb_specs.items():
        start, end = points.get(start_name), points.get(end_name)
        if start is None or end is None:
            sections[label] = {"status": "unavailable", "confidence": 0.0, "method": "limb_axis_perpendicular_mesh_intersection"}
            values[f"{label}_circumference"] = {"status": "unavailable", "confidence": 0.0, "method": "limb_axis_perpendicular_mesh_intersection"}
            limb_diagnostics[label] = {"status": "landmarks_unavailable"}
            continue
        component, diagnostic = _oblique_limb_component(
            ray_scene,
            start,
            end,
            fraction,
            max_perimeter_ratio=max_perimeter,
            max_dimension_ratio=max_dimension,
        )
        target = start * (1.0 - fraction) + end * fraction
        section = _section_record(component, float(target[2]), scale, "limb_axis_perpendicular_mesh_intersection")
        section["plane_origin"] = target.astype(float).tolist()
        section["plane_normal"] = (end - start).astype(float).tolist()
        section["isolation"] = diagnostic
        sections[label] = section
        limb_diagnostics[label] = diagnostic
        if section.get("circumference_cm") is not None:
            values[f"{label}_circumference"] = {
                "status": section["status"],
                "value_cm": section["circumference_cm"],
                "value_m": section["circumference_cm"] / 100.0,
                "method": section["method"],
                "confidence": section["confidence"],
                "plane_locked": True,
            }
        else:
            values[f"{label}_circumference"] = {
                "status": "unavailable",
                "method": "limb_axis_perpendicular_mesh_intersection",
                "confidence": 0.0,
            }

    critical: list[dict] = []
    notices: list[dict] = []

    ranges = {
        "shoulder_width": (0.12, 0.30),
        "left_arm_length": (0.20, 0.52), "right_arm_length": (0.20, 0.52),
        "left_leg_length": (0.24, 0.58), "right_leg_length": (0.24, 0.58),
        "left_foot_length": (0.025, 0.18), "right_foot_length": (0.025, 0.18),
        "left_hand_length": (0.045, 0.20), "right_hand_length": (0.045, 0.20),
    }
    for name, (minimum, maximum) in ranges.items():
        item = values.get(name, {})
        value = item.get("value_m")
        if value is None:
            critical.append({"code": "MEASUREMENT_UNAVAILABLE", "measurement": name})
            continue
        ratio = float(value) / max(height_m, 1e-9)
        if ratio < minimum or ratio > maximum:
            item["status"] = "invalid_range"
            item["confidence"] = min(float(item.get("confidence", 0.5)), 0.25)
            critical.append({"code": "MEASUREMENT_RANGE_INVALID", "measurement": name, "ratio_to_height": ratio})

    circumference_ranges = {
        "left_bicep_circumference": (0.075, 0.30), "right_bicep_circumference": (0.075, 0.30),
        "left_forearm_circumference": (0.055, 0.23), "right_forearm_circumference": (0.055, 0.23),
        "left_thigh_circumference": (0.12, 0.42), "right_thigh_circumference": (0.12, 0.42),
        "left_calf_circumference": (0.075, 0.30), "right_calf_circumference": (0.075, 0.30),
    }
    for name, (minimum, maximum) in circumference_ranges.items():
        item = values.get(name, {})
        value = item.get("value_m")
        if value is None:
            critical.append({"code": "LIMB_CIRCUMFERENCE_UNAVAILABLE", "measurement": name})
            continue
        ratio = float(value) / max(height_m, 1e-9)
        if ratio < minimum or ratio > maximum:
            item["status"] = "invalid_range"
            item["confidence"] = min(float(item.get("confidence", 0.5)), 0.20)
            critical.append({"code": "LIMB_CIRCUMFERENCE_RANGE_INVALID", "measurement": name, "ratio_to_height": ratio})

    pair_checks = (
        ("left_arm_length", "right_arm_length", 0.08),
        ("left_forearm_length", "right_forearm_length", 0.08),
        ("left_leg_length", "right_leg_length", 0.08),
        ("left_foot_length", "right_foot_length", 0.12),
        ("left_hand_length", "right_hand_length", 0.14),
        ("left_palm_width", "right_palm_width", 0.16),
        ("left_bicep_circumference", "right_bicep_circumference", 0.22),
        ("left_forearm_circumference", "right_forearm_circumference", 0.22),
        ("left_thigh_circumference", "right_thigh_circumference", 0.22),
        ("left_calf_circumference", "right_calf_circumference", 0.22),
    )
    pair_results = []
    for left_key, right_key, limit in pair_checks:
        left_item, right_item = values.get(left_key, {}), values.get(right_key, {})
        lv, rv = left_item.get("value_m"), right_item.get("value_m")
        if lv is None or rv is None:
            pair_results.append({"pair": [left_key, right_key], "status": "unavailable"})
            continue
        relative = _relative_difference(float(lv), float(rv))
        valid = relative <= limit
        pair_results.append({"pair": [left_key, right_key], "relative_difference": relative, "limit": limit, "valid": valid})
        if not valid:
            critical.append({"code": "MEASUREMENT_PAIR_ASYMMETRY", "pair": [left_key, right_key], "relative_difference": relative})

    core_names = ("neck", "chest", "waist", "hip")
    core_targets = {
        "neck": (float(measurements.get("levels", {}).get("neck_z", 0.0)), np.asarray(sections.get("neck", {}).get("centroid", [0.0, 0.0, 0.0])[:2], dtype=np.float64)),
        "chest": (float(measurements.get("levels", {}).get("chest_z", 0.0)), np.asarray(sections.get("chest", {}).get("centroid", [0.0, 0.0, 0.0])[:2], dtype=np.float64)),
        "waist": (float(measurements.get("levels", {}).get("waist_z", 0.0)), np.asarray(sections.get("waist", {}).get("centroid", [0.0, 0.0, 0.0])[:2], dtype=np.float64)),
        "hip": (float(measurements.get("levels", {}).get("hip_z", 0.0)), np.asarray(sections.get("hip", {}).get("centroid", [0.0, 0.0, 0.0])[:2], dtype=np.float64)),
    }
    body_center_xy = np.array([
        float((ray_scene.bounds_min[0] + ray_scene.bounds_max[0]) * 0.5),
        float((ray_scene.bounds_min[1] + ray_scene.bounds_max[1]) * 0.5),
    ], dtype=np.float64)
    core_diagnostics: dict[str, dict[str, Any]] = {}
    for core_name in core_names:
        current = sections.get(core_name, {})
        if current.get("status") == "valid" and current.get("closed") is True:
            current.setdefault("source_topology_closed", True)
            current.setdefault("computationally_closed", True)
            core_diagnostics[core_name] = {"status": "already_closed"}
            continue
        z, target = core_targets[core_name]
        if not np.isfinite(target).all() or np.linalg.norm(target - body_center_xy) > geometry_height * 0.08:
            target = body_center_xy.copy()
        reconstructed, diagnostic = _reconstruct_core_section(
            ray_scene,
            label=core_name,
            z=z,
            target_xy=target,
            scale=scale,
            width_reference=None,  # v0.8.6: never validate chest against inner shoulder landmarks
        )
        core_diagnostics[core_name] = diagnostic
        if reconstructed is not None:
            sections[core_name] = reconstructed
            values[f"{core_name}_circumference"] = {
                "status": "valid",
                "value_cm": reconstructed["circumference_cm"],
                "value_m": reconstructed["circumference_cm"] / 100.0,
                "method": reconstructed["method"],
                "confidence": reconstructed["confidence"],
                "computationally_closed": True,
                "source_topology_closed": reconstructed.get("source_topology_closed", False),
            }

    # v0.8.6 final chest gate: validate the isolated torso contour against
    # height, waist and hip. Visual shoulder landmarks are joint anchors and
    # are not the external shoulder silhouette, so they are not a valid width cap.
    chest_section = sections.get("chest", {})
    chest_valid, chest_validation = _validate_isolated_chest_against_core(
        chest_section,
        sections.get("waist", {}),
        sections.get("hip", {}),
        geometry_height,
    )
    core_diagnostics.setdefault("chest", {})["v086_validation"] = chest_validation
    if not chest_valid:
        chest_section["status"] = "invalid_torso_ratio_validation"
        chest_section["closed"] = False
        chest_section["confidence"] = min(float(chest_section.get("confidence", 0.5)), 0.20)
        values["chest_circumference"] = {
            "status": "invalid_torso_ratio_validation",
            "method": chest_section.get("method", "unknown"),
            "confidence": chest_section["confidence"],
        }
        critical.append({
            "code": "CHEST_CONTOUR_TORSO_RATIO_INVALID",
            "diagnostics": chest_validation,
        })
    else:
        notices.append({
            "code": "CHEST_CONTOUR_CENTRAL_TORSO_VALIDATED",
            "method": chest_section.get("method"),
            "diagnostics": chest_validation,
        })

    core_available = all(sections.get(name, {}).get("status") in {"valid", "estimated_open_section"} for name in core_names)
    core_exact = all(
        sections.get(name, {}).get("status") == "valid"
        and sections.get(name, {}).get("closed") is True
        and sections.get(name, {}).get("computationally_closed") is True
        and float(sections.get(name, {}).get("confidence", 0.0)) >= 0.72
        for name in core_names
    )
    if core_available and not core_exact:
        notices.append({
            "code": "CORE_CONTOURS_NOT_CLOSED",
            "sections": [name for name in core_names if not sections.get(name, {}).get("closed")],
        })
    elif core_exact and any(not sections.get(name, {}).get("source_topology_closed", False) for name in core_names):
        notices.append({
            "code": "CORE_CONTOURS_COMPUTATIONALLY_CLOSED",
            "sections": [name for name in core_names if not sections.get(name, {}).get("source_topology_closed", False)],
        })

    measurements_ready = len(critical) == 0
    measurements["version"] = "clouva-body-measurements-v1.6-torso-ratio-validation"
    measurements["quality"] = {
        "mesh_symmetry_score": symmetry,
        "measurement_landmark_corrections": corrections,
        "pair_validation": pair_results,
        "limb_section_diagnostics": limb_diagnostics,
        "core_contour_diagnostics": core_diagnostics,
        "critical_errors": critical,
        "notices": notices,
    }
    measurements["readiness"] = {
        "measurements_ready": measurements_ready,
        "circumferences_ready": core_exact,
        "circumferences_estimated_ready": core_available,
        "scale_calibrated": True,
    }
    measurements["warnings"] = [*critical, *notices]
    return measurements


# Compatibility aliases for older callers and tests.
apply_measurement_quality_v085 = apply_measurement_quality_v086
apply_measurement_quality_v084 = apply_measurement_quality_v086
apply_measurement_quality_v083 = apply_measurement_quality_v086
