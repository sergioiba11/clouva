"""Topology-first hand segmentation for Avatar Analyzer V3."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable, List

from mathutils import Vector

from anatomy_segmenter import VertexSample
from finger_branch_detector import assign_finger_branches
from hand_modes import classify_hand_mode
from hand_medial_graph import HandBranch, detect_medial_branches
from mesh_geodesics import build_region_graph

FINGERS = ("thumb", "index", "middle", "ring", "pinky")


def _segment_distance(point: Vector, start: Vector, end: Vector):
    axis = end - start
    denominator = max(axis.length_squared, 1e-12)
    factor = max(0.0, min(1.0, (point - start).dot(axis) / denominator))
    closest = start + axis * factor
    return (point - closest).length, closest, factor


def _polyline_nearest(point: Vector, points: List[Vector]):
    if len(points) < 2:
        return float("inf"), None, 0.0
    best = None
    cumulative = 0.0
    total = sum((second - first).length for first, second in zip(points, points[1:]))
    for first, second in zip(points, points[1:]):
        distance, closest, factor = _segment_distance(point, first, second)
        segment_length = (second - first).length
        along = (cumulative + segment_length * factor) / max(total, 1e-8)
        candidate = (distance, closest, along)
        if best is None or distance < best[0]:
            best = candidate
        cumulative += segment_length
    return best


def _branch_metrics(branch: HandBranch, hand_points: List[Vector], hand_scale: float):
    assigned = []
    for point in hand_points:
        distance, _closest, along = _polyline_nearest(point, branch.centerline)
        if distance <= hand_scale * 0.18 and along >= 0.08:
            assigned.append((point, distance, along))
    if not assigned:
        return {
            "fingerLength": branch.geodesic_length,
            "fingerMeanRadius": 0.0,
            "fingerBaseRadius": 0.0,
            "fingerTipRadius": 0.0,
            "geodesicLength": branch.geodesic_length,
            "branchConfidence": branch.confidence,
            "vertexCount": 0,
        }
    radii = [distance for _point, distance, _along in assigned]
    base = [distance for _point, distance, along in assigned if along <= 0.30]
    tip = [distance for _point, distance, along in assigned if along >= 0.72]
    return {
        "fingerLength": float(branch.direct_length),
        "fingerMeanRadius": float(sum(radii) / len(radii)),
        "fingerBaseRadius": float(sum(base) / len(base)) if base else float(sum(radii) / len(radii)),
        "fingerTipRadius": float(sum(tip) / len(tip)) if tip else float(min(radii)),
        "geodesicLength": float(branch.geodesic_length),
        "branchConfidence": float(branch.confidence),
        "vertexCount": len(assigned),
    }


@dataclass
class HandTopology:
    side: str
    suffix: str
    branches: Dict[str, HandBranch]
    metrics: Dict[str, dict]
    diagnostics: dict

    def branch(self, finger: str):
        return self.branches.get(finger)

    @property
    def hand_mode(self):
        return str((self.diagnostics.get("classification") or {}).get("mode") or "unsupported_or_corrupt")

    def nearest_on_branch(self, finger: str, point: Vector):
        branch = self.branch(finger)
        if branch is None:
            return None, float("inf"), 0.0
        distance, closest, along = _polyline_nearest(point, branch.centerline)
        return closest, float(distance), float(along)

    def point_at(self, finger: str, factor: float):
        branch = self.branch(finger)
        if branch is None or not branch.centerline:
            return None
        factor = max(0.0, min(1.0, factor))
        index = factor * (len(branch.centerline) - 1)
        lower = int(index)
        upper = min(len(branch.centerline) - 1, lower + 1)
        return branch.centerline[lower].lerp(branch.centerline[upper], index - lower)

    def as_report(self):
        classification = self.diagnostics.get("classification") or {}
        return {
            "side": self.side,
            "handMode": classification.get("mode"),
            "fingerRigMode": classification.get("fingerRigMode"),
            "handBaseReady": bool(classification.get("handBaseSupported")),
            "fullFingerRigReady": bool(
                classification.get("fullFingerRigSupported") and len(self.branches) == 5
            ),
            "branches": {finger: branch.as_dict() for finger, branch in self.branches.items()},
            "metrics": self.metrics,
            "diagnostics": self.diagnostics,
        }


def detect_hand_topology(meshes: Iterable, segmentation, side: str,
                         visual_landmarks: Dict[str, dict]):
    meshes = list(meshes)
    suffix = "l" if side == "left" else "r"
    region = f"hand_{suffix}"
    measurement = segmentation.hand_measurement(side)
    hand_scale = max(float(measurement.get("handScale") or 0.0), 1e-5)
    wrist = Vector(tuple(measurement.get("origin") or (0.0, 0.0, 0.0)))
    graph = build_region_graph(meshes, segmentation, region)
    branches, medial_diagnostics = detect_medial_branches(graph, wrist, hand_scale, 5)
    visual_tip_count = sum(
        1
        for finger in FINGERS
        if bool((visual_landmarks.get(f"{finger}_tip_{suffix}") or {}).get("accepted"))
        or int((visual_landmarks.get(f"{finger}_tip_{suffix}") or {}).get("viewsConfirmed") or 0) > 0
    )
    classification = classify_hand_mode({
        "vertex_count": len(graph.points),
        "connected_components": len(graph.connected_components()),
        "geodesic_branches": len(branches),
        "visual_fingertips": visual_tip_count,
        "silhouette_valleys": int(measurement.get("silhouetteValleys") or 0),
        "corrupt_geometry": not bool(graph.points),
    })
    mapping, mapping_diagnostics = assign_finger_branches(
        branches, visual_landmarks, measurement, side,
    )
    hand_points = segmentation.region_points(region)
    metrics = {
        finger: _branch_metrics(branch, hand_points, hand_scale)
        for finger, branch in mapping.items()
    }
    status = "valid" if (
        classification["fullFingerRigSupported"]
        and medial_diagnostics.get("status") == "valid"
        and mapping_diagnostics.get("status") == "valid"
        and len(mapping) == 5
    ) else "valid_base_only" if classification["mode"] == "simplified_mitten" else "needs_review"
    diagnostics = {
        "version": "clouva-hand-topology-v4.1",
        "status": status,
        "classification": classification,
        "medialGraph": medial_diagnostics,
        "branchAssignment": mapping_diagnostics,
        "geometryFirst": True,
        "mediaPipeRole": "branch-labeling-and-joint-prior",
    }
    return HandTopology(side, suffix, mapping, metrics, diagnostics)


def apply_finger_region_labels(meshes: Iterable, segmentation, topology: HandTopology):
    suffix = topology.suffix
    hand_region = f"hand_{suffix}"
    measurement = segmentation.hand_measurement(topology.side)
    hand_scale = max(float(measurement.get("handScale") or 0.0), 1e-5)
    relabeled = {finger: 0 for finger in FINGERS}
    retained_palm = 0

    # Remove stale per-finger samples when re-running the same job.
    for finger in FINGERS:
        segmentation.samples.pop(f"{finger}_{suffix}", None)

    for obj in meshes:
        labels = segmentation.labels.get(obj.name) or []
        if not labels:
            continue
        normal_matrix = obj.matrix_world.to_3x3()
        for vertex in obj.data.vertices:
            if vertex.index >= len(labels) or labels[vertex.index] != hand_region:
                continue
            point = obj.matrix_world @ vertex.co
            candidates = []
            for finger, branch in topology.branches.items():
                distance, _closest, along = _polyline_nearest(point, branch.centerline)
                if along >= 0.12:
                    candidates.append((distance, finger, along))
            if not candidates:
                retained_palm += 1
                continue
            candidates.sort(key=lambda item: item[0])
            distance, finger, along = candidates[0]
            metric = topology.metrics.get(finger) or {}
            radius = max(
                float(metric.get("fingerBaseRadius") or 0.0) * (1.0 - along)
                + float(metric.get("fingerTipRadius") or 0.0) * along,
                hand_scale * 0.045,
            )
            if distance > max(radius * 2.1, hand_scale * 0.16):
                retained_palm += 1
                continue
            region = f"{finger}_{suffix}"
            labels[vertex.index] = region
            normal = normal_matrix @ vertex.normal
            if normal.length > 1e-8:
                normal.normalize()
            segmentation.samples.setdefault(region, []).append(
                VertexSample(obj.name, int(vertex.index), point, normal, region),
            )
            relabeled[finger] += 1

    # Keep hand samples synchronized with the mutated labels.
    segmentation.samples[hand_region] = [
        sample for sample in segmentation.samples.get(hand_region, [])
        if segmentation.labels.get(sample.object_name, [])[sample.vertex_index] == hand_region
    ]
    report = {
        "version": "clouva-finger-region-labeling-v3",
        "side": topology.side,
        "relabeledVertices": relabeled,
        "retainedPalmVertices": retained_palm,
        "validFingerRegions": sum(1 for count in relabeled.values() if count >= 4),
    }
    topology.diagnostics["regionLabeling"] = report
    return report
