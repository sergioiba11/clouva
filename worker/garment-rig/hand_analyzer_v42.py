"""Independent single-hand analyzer for CLOUVA Avatar Analyzer V4.2.

Geometry remains the primary 3D source. Visual landmarks label branches and may
supply a controlled visual+geometry fallback only when every projected point
passes regional ray-cast and anatomical chain validation.
"""
from __future__ import annotations

from itertools import combinations
from typing import Any, Dict

from mathutils import Vector

from anatomy_bvh import build_anatomy_bvh
from hand_analyzer import (
    _chains_cross,
    _derive_palm_and_metacarpals,
    _ensure_wrist,
    _group,
    _internal,
    _refine_to_topology,
    _triangulate_side,
)
from hand_topology_segmenter import FINGERS, apply_finger_region_labels, detect_hand_topology
from sparse_landmark_projector_v42 import project_sparse_landmarks

MODULE_VERSION = "clouva-hand-analyzer-v4.2"


def _chain_names(finger: str, suffix: str):
    return [
        f"{finger}_01_{suffix}",
        f"{finger}_02_{suffix}",
        f"{finger}_03_{suffix}",
        f"{finger}_tip_{suffix}",
    ]


def _local(point: Vector, origin: Vector, lateral: Vector, forward: Vector):
    delta = point - origin
    return delta.dot(lateral), delta.dot(forward)


def _visual_geometry_fallback(landmarks: Dict[str, dict], measurement: dict, anatomy_bvh, side: str):
    suffix = "l" if side == "left" else "r"
    origin = Vector(tuple(measurement.get("origin") or (0.0, 0.0, 0.0)))
    lateral = Vector(tuple(measurement.get("lateral") or ((1.0, 0.0, 0.0) if suffix == "l" else (-1.0, 0.0, 0.0))))
    forward = Vector(tuple(measurement.get("forward") or (0.0, 0.0, -1.0)))
    if lateral.length <= 1e-8:
        lateral = Vector((1.0 if suffix == "l" else -1.0, 0.0, 0.0))
    if forward.length <= 1e-8:
        forward = Vector((0.0, 0.0, -1.0))
    lateral.normalize(); forward.normalize()
    hand_scale = max(float(measurement.get("handScale") or 0.0), 1e-5)
    chains: dict[str, list[Vector]] = {}
    failures = []

    for finger in FINGERS:
        names = _chain_names(finger, suffix)
        items = [landmarks.get(name) or {} for name in names]
        if not all(item.get("accepted") and (item.get("internalJointPosition") or item.get("position")) for item in items):
            failures.append({"code": "VISUAL_FINGER_CHAIN_INCOMPLETE", "side": side, "finger": finger})
            continue
        points = [_internal(item) for item in items]
        lengths = [(second - first).length for first, second in zip(points, points[1:])]
        total = sum(lengths)
        if total < hand_scale * (0.10 if finger == "thumb" else 0.14) or total > hand_scale * 1.35:
            failures.append({"code": "VISUAL_FINGER_LENGTH_INVALID", "side": side, "finger": finger, "length": float(total), "handScale": hand_scale})
            continue
        surfaces = [anatomy_bvh.nearest(point, f"hand_{suffix}", hand_scale * 0.25) for point in points]
        if any(surface is None for surface in surfaces):
            failures.append({"code": "VISUAL_FINGER_REGION_INVALID", "side": side, "finger": finger})
            continue
        chains[finger] = points

    if len(chains) != 5:
        return {"accepted": False, "failures": failures, "validFingers": len(chains)}

    crossed = set()
    for first, second in combinations(chains, 2):
        if _chains_cross(chains[first], chains[second], origin, lateral, forward):
            crossed.update((first, second))
    if crossed:
        failures.append({"code": "FINGER_CHAINS_CROSS", "side": side, "fingers": sorted(crossed)})
        return {"accepted": False, "failures": failures, "validFingers": 5}

    bases = {finger: _local(points[0], origin, lateral, forward)[0] for finger, points in chains.items()}
    non_thumb = [bases[name] for name in ("index", "middle", "ring", "pinky")]
    monotonic = all(
        (non_thumb[index + 1] - non_thumb[index]) * (1.0 if suffix == "l" else -1.0) <= hand_scale * 0.05
        for index in range(len(non_thumb) - 1)
    )
    thumb_is_lateral = abs(bases["thumb"] - bases["index"]) >= hand_scale * 0.04
    if not monotonic or not thumb_is_lateral:
        failures.append({
            "code": "VISUAL_FINGER_ORDER_INVALID",
            "side": side,
            "localBaseCoordinates": bases,
            "thumbIsLateral": thumb_is_lateral,
            "nonThumbOrderValid": monotonic,
        })
        return {"accepted": False, "failures": failures, "validFingers": 5}

    for finger, points in chains.items():
        for name, point in zip(_chain_names(finger, suffix), points):
            item = landmarks[name]
            surface = anatomy_bvh.nearest(point, f"hand_{suffix}", hand_scale * 0.25)
            item.update({
                "accepted": True,
                "verified": True,
                "display": True,
                "state": "verified_visual_geometry",
                "validationState": "verified_visual_geometry",
                "verificationMethod": "verified_visual_geometry",
                "method": "sparse-raycast-visual-chain-with-palm-geometry-v4.2",
                "surfaceRegion": surface.get("primaryRegion") or surface.get("region") if surface else f"hand_{suffix}",
                "surfaceDisplayPosition": [float(value) for value in (surface["location"] if surface else point)],
                "geometryFallback": False,
                "rayHit": True,
                "depthResidual": 0.0,
                "rejectionReasons": [],
            })
    return {"accepted": True, "failures": [], "validFingers": 5, "localBaseCoordinates": bases}


def _topology_mode(topology, visual_fallback: dict[str, Any], hand_base_ready: bool):
    classification = topology.diagnostics.get("classification") or {}
    branch_count = len(topology.branches)
    existing_mode = str(classification.get("mode") or "unsupported_or_corrupt")
    if branch_count == 5:
        return "five_finger_geometry"
    if visual_fallback.get("accepted"):
        return "five_finger_visual_fallback"
    if existing_mode == "simplified_mitten" and hand_base_ready:
        return "simplified_mitten"
    if existing_mode == "unsupported_or_corrupt":
        return "topology_corrupt"
    return "hand_repair_required"


def analyze_hand_module_v42(
    detector_output: dict,
    manifest: dict,
    classifications: Dict[str, str],
    segmentation,
    meshes,
    anatomy_bvh,
    side: str,
    *,
    requested_landmarks: list[str] | None = None,
):
    if side not in {"left", "right"}:
        raise ValueError("side must be left or right")
    suffix = "l" if side == "left" else "r"
    side_manifest = {
        **manifest,
        "views": [item for item in manifest.get("views") or [] if item.get("region") == "hand" and item.get("side") == side],
    }
    side_view_names = {str(item.get("name") or "") for item in side_manifest["views"]}
    side_detector = {
        **detector_output,
        "views": [item for item in detector_output.get("views") or [] if str(item.get("name") or "") in side_view_names],
    }
    projected, projection_failures, projection_metrics = project_sparse_landmarks(
        side_detector,
        side_manifest,
        anatomy_bvh,
        requested_landmarks=requested_landmarks,
    )
    grouped = _group(projected)
    side_grouped = {name: values for name, values in grouped.items() if name.endswith(f"_{suffix}")}
    rough = _triangulate_side(side_grouped, segmentation, anatomy_bvh, side, rough=True)
    topology = detect_hand_topology(meshes, segmentation, side, rough)
    label_report = apply_finger_region_labels(meshes, segmentation, topology)
    final_bvh = build_anatomy_bvh(meshes, segmentation, classifications)
    final_landmarks = _triangulate_side(side_grouped, segmentation, final_bvh, side, rough=False)
    measurement = segmentation.hand_measurement(side)
    wrist_fallback = _ensure_wrist(final_landmarks, measurement, final_bvh, side)
    refined = _refine_to_topology(final_landmarks, topology, final_bvh, side, measurement)
    landmarks = refined["landmarks"]
    visual_fallback = {"accepted": False, "failures": [], "validFingers": 0}
    if int(refined.get("validFingers") or 0) < 5:
        visual_fallback = _visual_geometry_fallback(landmarks, measurement, final_bvh, side)
    palm_warnings = _derive_palm_and_metacarpals(landmarks, final_bvh, side)
    wrist = landmarks.get(f"wrist_{suffix}") or {}
    classification = topology.diagnostics.get("classification") or {}
    hand_base_ready = bool(wrist.get("accepted") and classification.get("handBaseSupported"))
    valid_fingers = 5 if visual_fallback.get("accepted") else int(refined.get("validFingers") or 0)
    hand_mode = _topology_mode(topology, visual_fallback, hand_base_ready)
    blocking = list(refined.get("blockingWarnings") or [])
    informative = list(refined.get("informativeWarnings") or [])
    if visual_fallback.get("accepted"):
        blocking = [item for item in blocking if str(item.get("code") or "") not in {
            "GEOMETRIC_FINGER_BRANCH_UNAVAILABLE", "FINGER_TOPOLOGY_INVALID", "FINGER_BRANCH_CONFIDENCE_LOW",
        }]
        informative.append({"code": "FIVE_FINGER_VISUAL_GEOMETRY_FALLBACK_USED", "side": side, "blocking": False})
    else:
        blocking.extend(visual_fallback.get("failures") or [])
    if wrist_fallback:
        informative.append({"code": "WRIST_GEOMETRY_FALLBACK_USED", "side": side, "blocking": False})
    if hand_mode != "simplified_mitten":
        blocking.extend(palm_warnings)

    branch_assignment = topology.diagnostics.get("branchAssignment") or {}
    medial = topology.diagnostics.get("medialGraph") or {}
    palm_vertex_count = len(segmentation.region_points(f"hand_{suffix}"))
    finger_separation_score = max(
        float(branch_assignment.get("mappingConfidence") or 0.0),
        float(classification.get("confidence") or 0.0),
    )
    if hand_mode in {"hand_repair_required", "topology_corrupt"}:
        blocking.append({
            "code": "HAND_REPAIR_REQUIRED",
            "side": side,
            "detectedBranchCount": len(topology.branches),
            "requiredBranchCount": 5,
            "palmVertexCount": palm_vertex_count,
            "fingerSeparationScore": finger_separation_score,
            "handTopologyMode": hand_mode,
            "blocking": True,
        })

    finger_rig_ready = bool(valid_fingers == 5 and hand_mode in {"five_finger_geometry", "five_finger_visual_fallback"})
    if hand_mode == "simplified_mitten" and hand_base_ready:
        status = "valid_base_only"
        blocking = [item for item in blocking if str(item.get("code") or "") not in {"PALM_GEOMETRY_INSUFFICIENT"}]
    elif finger_rig_ready and not blocking:
        status = "valid_with_warnings" if informative else "valid"
    else:
        status = "needs_review"

    warnings = [
        *({**item, "module": f"{side}_hand", "blocking": True} for item in projection_failures),
        *({**item, "module": f"{side}_hand", "blocking": True} for item in blocking),
        *({**item, "module": f"{side}_hand", "blocking": False} for item in informative),
    ]
    result = {
        "status": status,
        "side": side,
        "landmarks": landmarks,
        "validFingers": valid_fingers,
        "handTopologyMode": hand_mode,
        "handMode": hand_mode,
        "fingerRigMode": "full" if finger_rig_ready else "simplified" if hand_mode == "simplified_mitten" else "unsupported",
        "handBaseReady": hand_base_ready,
        "fingerRigReady": finger_rig_ready,
        "measurements": {**measurement, "fingerLengths": refined.get("fingerLengths") or {}},
        "topology": topology.as_report(),
        "topologyClassification": classification,
        "medialGraph": medial,
        "fingerRegionLabeling": label_report,
        "visualGeometryFallback": visual_fallback,
        "detectedBranchCount": len(topology.branches),
        "requiredBranchCount": 5,
        "palmVertexCount": palm_vertex_count,
        "fingerSeparationScore": finger_separation_score,
        "warnings": warnings,
        "blockingWarnings": blocking,
        "nonBlockingWarnings": informative,
        "projectedCandidates": projected,
        "projectionMetrics": projection_metrics,
        "method": "single-hand-geodesic-branches-plus-sparse-bvh-projection-v4.2",
        "manifest": {
            "version": MODULE_VERSION,
            "module": f"{side}_hand",
            "side": side,
            "status": status,
            "cameras": sorted(side_view_names),
            "landmarkFilter": sorted(requested_landmarks or []),
            "sparseProjection": True,
            **projection_metrics,
        },
    }
    return result, final_bvh


__all__ = ["analyze_hand_module_v42"]
