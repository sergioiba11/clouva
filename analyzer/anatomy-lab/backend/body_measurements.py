from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

import numpy as np


@dataclass
class SlicePoint:
    point: np.ndarray
    face_index: int
    barycentric: np.ndarray


@dataclass
class SliceSegment:
    a: SlicePoint
    b: SlicePoint


@dataclass
class SliceComponent:
    segment_indices: list[int]
    points: list[SlicePoint]
    perimeter: float
    centroid: np.ndarray
    bounds_min: np.ndarray
    bounds_max: np.ndarray
    closed: bool

    @property
    def width(self) -> float:
        return float(self.bounds_max[0] - self.bounds_min[0])

    @property
    def depth(self) -> float:
        return float(self.bounds_max[1] - self.bounds_min[1])


def _edge_intersection(a: np.ndarray, b: np.ndarray, da: float, db: float, ia: int, ib: int) -> tuple[np.ndarray, np.ndarray] | None:
    eps = 1e-10
    if abs(da) <= eps and abs(db) <= eps:
        return None
    if da * db > 0:
        return None
    denominator = da - db
    if abs(denominator) <= eps:
        return None
    t = da / denominator
    if t < -1e-8 or t > 1.00000001:
        return None
    t = float(np.clip(t, 0.0, 1.0))
    point = a + (b - a) * t
    bary = np.zeros(3, dtype=np.float64)
    bary[ia] = 1.0 - t
    bary[ib] = t
    return point, bary


def slice_mesh_at_z(vertices: np.ndarray, faces: np.ndarray, z: float) -> list[SliceSegment]:
    triangles = vertices[faces]
    z_values = triangles[:, :, 2]
    candidate_mask = (z_values.min(axis=1) <= z) & (z_values.max(axis=1) >= z)
    candidate_ids = np.nonzero(candidate_mask)[0]
    segments: list[SliceSegment] = []
    for face_index in candidate_ids.tolist():
        tri = triangles[face_index]
        d = tri[:, 2] - z
        hits: list[tuple[np.ndarray, np.ndarray]] = []
        for ia, ib in ((0, 1), (1, 2), (2, 0)):
            hit = _edge_intersection(tri[ia], tri[ib], float(d[ia]), float(d[ib]), ia, ib)
            if hit is None:
                continue
            if not any(np.linalg.norm(hit[0] - existing[0]) < 1e-7 for existing in hits):
                hits.append(hit)
        if len(hits) < 2:
            continue
        if len(hits) > 2:
            # Degenerate vertex-on-plane case: keep the farthest pair.
            best = None
            best_distance = -1.0
            for i in range(len(hits)):
                for j in range(i + 1, len(hits)):
                    distance = float(np.linalg.norm(hits[i][0] - hits[j][0]))
                    if distance > best_distance:
                        best = (hits[i], hits[j])
                        best_distance = distance
            assert best is not None
            hits = [best[0], best[1]]
        if np.linalg.norm(hits[0][0] - hits[1][0]) < 1e-8:
            continue
        segments.append(SliceSegment(
            SlicePoint(hits[0][0], face_index, hits[0][1]),
            SlicePoint(hits[1][0], face_index, hits[1][1]),
        ))
    return segments


def _quantized_key(point: np.ndarray, tolerance: float) -> tuple[int, int]:
    return tuple(np.round(point[:2] / tolerance).astype(np.int64).tolist())


def build_slice_components(segments: list[SliceSegment], tolerance: float = 2e-4) -> list[SliceComponent]:
    if not segments:
        return []
    parent = list(range(len(segments)))

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    buckets: dict[tuple[int, int], list[int]] = {}
    for index, segment in enumerate(segments):
        for endpoint in (segment.a, segment.b):
            buckets.setdefault(_quantized_key(endpoint.point, tolerance), []).append(index)
    for values in buckets.values():
        first = values[0]
        for other in values[1:]:
            union(first, other)

    groups: dict[int, list[int]] = {}
    for index in range(len(segments)):
        groups.setdefault(find(index), []).append(index)

    components: list[SliceComponent] = []
    for indices in groups.values():
        points: list[SlicePoint] = []
        perimeter = 0.0
        degrees: dict[tuple[int, int], int] = {}
        for index in indices:
            segment = segments[index]
            points.extend([segment.a, segment.b])
            perimeter += float(np.linalg.norm(segment.b.point - segment.a.point))
            for endpoint in (segment.a, segment.b):
                key = _quantized_key(endpoint.point, tolerance)
                degrees[key] = degrees.get(key, 0) + 1
        array = np.asarray([item.point for item in points], dtype=np.float64)
        components.append(SliceComponent(
            segment_indices=indices,
            points=points,
            perimeter=perimeter,
            centroid=np.mean(array, axis=0),
            bounds_min=np.min(array, axis=0),
            bounds_max=np.max(array, axis=0),
            closed=bool(degrees) and all(value == 2 for value in degrees.values()),
        ))
    return sorted(components, key=lambda item: item.perimeter, reverse=True)


def choose_component(components: list[SliceComponent], target_xy: np.ndarray, max_distance: float | None = None) -> SliceComponent | None:
    if not components:
        return None
    target_xy = np.asarray(target_xy, dtype=np.float64)[:2]
    scored = []
    for component in components:
        distance = float(np.linalg.norm(component.centroid[:2] - target_xy))
        if max_distance is not None and distance > max_distance:
            continue
        # Prefer the expected center, but avoid choosing tiny accidental loops.
        score = distance - min(component.perimeter, 2.0) * 0.015
        scored.append((score, component))
    if not scored:
        return None
    scored.sort(key=lambda item: item[0])
    return scored[0][1]


def section_at(ray_scene, z: float, target_xy: Iterable[float], max_distance: float | None = None) -> SliceComponent | None:
    segments = slice_mesh_at_z(ray_scene.vertices.astype(np.float64), ray_scene.faces.astype(np.int64), float(z))
    components = build_slice_components(segments)
    return choose_component(components, np.asarray(list(target_xy), dtype=np.float64), max_distance=max_distance)


def _point(landmarks: dict[str, dict], name: str) -> np.ndarray | None:
    item = landmarks.get(name)
    if not item:
        return None
    value = item.get("canonical_position")
    if not isinstance(value, list) or len(value) != 3:
        return None
    return np.asarray(value, dtype=np.float64)


def _distance_chain(landmarks: dict[str, dict], names: list[str]) -> float | None:
    points = [_point(landmarks, name) for name in names]
    if any(point is None for point in points):
        return None
    return float(sum(np.linalg.norm(points[index + 1] - points[index]) for index in range(len(points) - 1)))


def _measurement(value_m: float | None, scale: float, method: str, confidence: float, **extra) -> dict[str, Any]:
    if value_m is None or not np.isfinite(value_m):
        return {"status": "unavailable", "method": method, "confidence": 0.0, **extra}
    calibrated_m = float(value_m * scale)
    return {
        "status": "valid",
        "value_m": calibrated_m,
        "value_cm": calibrated_m * 100.0,
        "method": method,
        "confidence": float(np.clip(confidence, 0.0, 1.0)),
        **extra,
    }


def _section_record(component: SliceComponent | None, z: float, scale: float, method: str) -> dict[str, Any]:
    if component is None:
        return {"status": "unavailable", "z": float(z), "method": method, "confidence": 0.0}
    confidence = 0.94 if component.closed else 0.68
    return {
        "status": "valid" if component.closed else "estimated_open_section",
        "z": float(z),
        "circumference_cm": float(component.perimeter * scale * 100.0),
        "width_cm": float(component.width * scale * 100.0),
        "depth_cm": float(component.depth * scale * 100.0),
        "closed": component.closed,
        "centroid": component.centroid.astype(float).tolist(),
        "method": method,
        "confidence": confidence,
    }


def calculate_body_measurements(ray_scene, landmarks: list[dict], internal_joints: list[dict], face_envelope, height_cm: float) -> dict[str, Any]:
    by_name = {item.get("name"): item for item in landmarks if item.get("name")}
    joints = {item.get("name"): item for item in internal_joints if item.get("name")}
    geometry_height = float(ray_scene.bounds_max[2] - ray_scene.bounds_min[2])
    calibrated_height_m = float(height_cm) / 100.0
    scale = calibrated_height_m / geometry_height if geometry_height > 1e-9 else 1.0
    center_xy = np.array([
        float((ray_scene.bounds_min[0] + ray_scene.bounds_max[0]) * 0.5),
        float((ray_scene.bounds_min[1] + ray_scene.bounds_max[1]) * 0.5),
    ])

    left_shoulder, right_shoulder = _point(by_name, "left_shoulder"), _point(by_name, "right_shoulder")
    left_hip, right_hip = _point(by_name, "left_hip"), _point(by_name, "right_hip")
    shoulder_z = float(np.mean([point[2] for point in (left_shoulder, right_shoulder) if point is not None])) if any(point is not None for point in (left_shoulder, right_shoulder)) else float(ray_scene.bounds_min[2] + geometry_height * 0.72)
    pelvis_z = float(np.mean([point[2] for point in (left_hip, right_hip) if point is not None])) if any(point is not None for point in (left_hip, right_hip)) else float(ray_scene.bounds_min[2] + geometry_height * 0.45)
    torso_span = max(shoulder_z - pelvis_z, geometry_height * 0.18)

    chest_z = pelvis_z + torso_span * 0.68
    neck_z = min(shoulder_z + geometry_height * 0.035, float(face_envelope.min_z + geometry_height * 0.015))
    hip_z = pelvis_z

    waist_candidates = []
    for z in np.linspace(pelvis_z + torso_span * 0.26, pelvis_z + torso_span * 0.50, 9):
        component = section_at(ray_scene, float(z), center_xy, max_distance=geometry_height * 0.12)
        if component and component.perimeter > geometry_height * 0.25:
            waist_candidates.append((component.perimeter, float(z), component))
    if waist_candidates:
        _, waist_z, waist_component = min(waist_candidates, key=lambda item: item[0])
    else:
        waist_z = pelvis_z + torso_span * 0.40
        waist_component = section_at(ray_scene, waist_z, center_xy, max_distance=geometry_height * 0.12)

    chest_component = section_at(ray_scene, chest_z, center_xy, max_distance=geometry_height * 0.14)
    neck_component = section_at(ray_scene, neck_z, center_xy, max_distance=geometry_height * 0.12)
    hip_component = section_at(ray_scene, hip_z, center_xy, max_distance=geometry_height * 0.16)
    head_component = section_at(ray_scene, float(face_envelope.center_z), [face_envelope.center_x, face_envelope.center_y], max_distance=geometry_height * 0.12)

    sections: dict[str, dict] = {
        "neck": _section_record(neck_component, neck_z, scale, "horizontal_mesh_intersection"),
        "chest": _section_record(chest_component, chest_z, scale, "horizontal_mesh_intersection"),
        "waist": _section_record(waist_component, waist_z, scale, "narrowest_torso_mesh_intersection"),
        "hip": _section_record(hip_component, hip_z, scale, "horizontal_mesh_intersection"),
        "head": _section_record(head_component, float(face_envelope.center_z), scale, "horizontal_mesh_intersection"),
    }

    limb_specs = {
        "left_bicep": ("left_shoulder", "left_elbow", 0.52),
        "right_bicep": ("right_shoulder", "right_elbow", 0.52),
        "left_forearm": ("left_elbow", "left_wrist", 0.52),
        "right_forearm": ("right_elbow", "right_wrist", 0.52),
        "left_thigh": ("left_hip", "left_knee", 0.48),
        "right_thigh": ("right_hip", "right_knee", 0.48),
        "left_calf": ("left_knee", "left_ankle", 0.55),
        "right_calf": ("right_knee", "right_ankle", 0.55),
    }
    for label, (start_name, end_name, fraction) in limb_specs.items():
        start, end = _point(by_name, start_name), _point(by_name, end_name)
        if start is None or end is None:
            sections[label] = {"status": "unavailable", "confidence": 0.0}
            continue
        target = start * (1.0 - fraction) + end * fraction
        component = section_at(ray_scene, float(target[2]), target[:2], max_distance=geometry_height * 0.10)
        sections[label] = _section_record(component, float(target[2]), scale, "limb_horizontal_mesh_intersection")

    values: dict[str, dict] = {
        "height": _measurement(geometry_height, scale, "calibrated_geometry_bounds", 0.99),
        "shoulder_width": _measurement(float(np.linalg.norm(left_shoulder - right_shoulder)) if left_shoulder is not None and right_shoulder is not None else None, scale, "surface_landmark_distance", 0.86),
        "left_arm_length": _measurement(_distance_chain(by_name, ["left_shoulder", "left_elbow", "left_wrist"]), scale, "joint_chain", 0.90),
        "right_arm_length": _measurement(_distance_chain(by_name, ["right_shoulder", "right_elbow", "right_wrist"]), scale, "joint_chain", 0.90),
        "left_forearm_length": _measurement(_distance_chain(by_name, ["left_elbow", "left_wrist"]), scale, "joint_chain", 0.91),
        "right_forearm_length": _measurement(_distance_chain(by_name, ["right_elbow", "right_wrist"]), scale, "joint_chain", 0.91),
        "left_leg_length": _measurement(_distance_chain(by_name, ["left_hip", "left_knee", "left_ankle"]), scale, "joint_chain", 0.87),
        "right_leg_length": _measurement(_distance_chain(by_name, ["right_hip", "right_knee", "right_ankle"]), scale, "joint_chain", 0.87),
        "left_foot_length": _measurement(_distance_chain(by_name, ["left_heel", "left_foot_index"]), scale, "surface_landmark_distance", 0.83),
        "right_foot_length": _measurement(_distance_chain(by_name, ["right_heel", "right_foot_index"]), scale, "surface_landmark_distance", 0.83),
    }

    # Hand Landmarker names use group=hand and side. Build side-specific lookup.
    hand_lookup = {(item.get("side"), item.get("name")): item for item in landmarks if item.get("group") == "hand"}
    for side in ("left", "right"):
        wrist = hand_lookup.get((side, "wrist"))
        middle_tip = hand_lookup.get((side, "middle_tip"))
        index_mcp = hand_lookup.get((side, "index_mcp"))
        pinky_mcp = hand_lookup.get((side, "pinky_mcp"))
        hand_length = None
        palm_width = None
        if wrist and middle_tip:
            hand_length = float(np.linalg.norm(np.asarray(wrist["canonical_position"]) - np.asarray(middle_tip["canonical_position"])))
        if index_mcp and pinky_mcp:
            palm_width = float(np.linalg.norm(np.asarray(index_mcp["canonical_position"]) - np.asarray(pinky_mcp["canonical_position"])))
        values[f"{side}_hand_length"] = _measurement(hand_length, scale, "hand_landmark_distance", 0.88)
        values[f"{side}_palm_width"] = _measurement(palm_width, scale, "hand_landmark_distance", 0.86)

    # Promote useful section values as measurements while keeping section metadata.
    for name, section in sections.items():
        if section.get("status") in {"valid", "estimated_open_section"}:
            values[f"{name}_circumference"] = {
                "status": section["status"],
                "value_cm": section["circumference_cm"],
                "value_m": section["circumference_cm"] / 100.0,
                "method": section["method"],
                "confidence": section["confidence"],
            }

    valid_values = [item for item in values.values() if item.get("status") in {"valid", "estimated_open_section"}]
    core_sections = [sections.get(name, {}) for name in ("neck", "chest", "waist", "hip")]
    circumference_ready = all(item.get("status") in {"valid", "estimated_open_section"} for item in core_sections)
    return {
        "version": "clouva-body-measurements-v1",
        "scale": {
            "height_cm": float(height_cm),
            "geometry_height": geometry_height,
            "geometry_to_meters": scale,
            "source": "local_height_input",
            "status": "calibrated_from_height_input",
        },
        "levels": {
            "neck_z": neck_z,
            "chest_z": chest_z,
            "waist_z": waist_z,
            "hip_z": hip_z,
        },
        "values": values,
        "sections": sections,
        "readiness": {
            "measurements_ready": len(valid_values) >= 10,
            "circumferences_ready": circumference_ready,
            "scale_calibrated": True,
        },
        "warnings": [] if circumference_ready else ["CORE_CIRCUMFERENCE_SECTION_INCOMPLETE"],
    }
