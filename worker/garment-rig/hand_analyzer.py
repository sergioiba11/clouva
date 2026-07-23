"""Topology-first hand analysis for CLOUVA Avatar Analyzer V3.2.

MediaPipe is used as visual evidence, but a stylized hand is not declared absent
when Blender can isolate five real geodesic branches in the hand mesh. Geometry
fallbacks remain confidence-gated and never invent branches that do not exist.
"""
from __future__ import annotations

from collections import defaultdict
from itertools import combinations
from typing import Dict, List

import bpy
from mathutils import Vector

from anatomy_bvh import build_anatomy_bvh
from hand_topology_segmenter import FINGERS, apply_finger_region_labels, detect_hand_topology
from landmark_projector_3d import project_candidates
from ray_triangulator import triangulate_landmark
from technical_passes import generate_technical_passes


def _vec(value: Vector):
    return [float(value.x), float(value.y), float(value.z)]


def _internal(item: dict):
    value = item.get("internalJointPosition") or item.get("position")
    return Vector(tuple(float(component) for component in value))


def _group(projected: List[dict]):
    grouped = defaultdict(list)
    for candidate in projected:
        name = str(candidate.get("name") or "")
        if name:
            grouped[name].append(candidate)
    return grouped


def _chain_names(finger: str, suffix: str):
    return [
        f"{finger}_01_{suffix}", f"{finger}_02_{suffix}",
        f"{finger}_03_{suffix}", f"{finger}_tip_{suffix}",
    ]


def _invalidate(landmarks: Dict[str, dict], names: List[str], reasons: List[str]):
    for name in names:
        item = landmarks.get(name)
        if not item:
            continue
        item["accepted"] = False
        item["verified"] = False
        item["display"] = False
        item["confidence"] = min(float(item.get("confidence", 0.0)), 0.39)
        item["finalConfidence"] = min(float(item.get("finalConfidence", item.get("confidence", 0.0))), 0.39)
        existing = item.setdefault("rejectionReasons", [])
        for reason in reasons:
            if reason not in existing:
                existing.append(reason)


def _expected_names(suffix: str):
    return [
        f"wrist_{suffix}",
        *[
            f"{finger}_{joint}_{suffix}"
            for finger in FINGERS for joint in ("01", "02", "03", "tip")
        ],
    ]


def _triangulate_side(grouped, segmentation, anatomy_bvh, side: str, rough: bool = False):
    suffix = "l" if side == "left" else "r"
    measurement = segmentation.hand_measurement(side)
    hand_scale = max(float(measurement.get("handScale") or 0.0), 1e-5)
    landmarks = {}
    for name in _expected_names(suffix):
        if name.startswith("wrist_"):
            regions = (f"forearm_{suffix}", f"hand_{suffix}")
            preferred = ("palm", "dorsum", "medial")
        else:
            finger = name.split("_")[0]
            finger_region = f"{finger}_{suffix}"
            regions = (finger_region,) if anatomy_bvh.has_region(finger_region) and not rough else (f"hand_{suffix}",)
            preferred = ("palm", "three_quarter_palm", "dorsum")
        landmarks[name] = triangulate_landmark(
            name, grouped.get(name, []), segmentation, regions, hand_scale,
            minimum_views=2, preferred_view_tokens=preferred,
            anatomy_bvh=anatomy_bvh,
        )
    return landmarks


def _refresh_hand_passes(manifest: dict, anatomy_bvh, side: str):
    suffix = "l" if side == "left" else "r"
    allowed = [f"hand_{suffix}"] + [
        f"{finger}_{suffix}" for finger in FINGERS if anatomy_bvh.has_region(f"{finger}_{suffix}")
    ]
    refreshed = 0
    for view in manifest.get("views", []):
        if view.get("region") != "hand" or view.get("side") != side:
            continue
        camera = bpy.data.objects.get(view.get("cameraObject"))
        if camera is None:
            continue
        previous = view.get("technicalPasses") or {}
        resolution = int((previous.get("resolution") or [192])[0])
        view["allowedRegions"] = allowed
        view["technicalPasses"] = generate_technical_passes(
            __import__("pathlib").Path(view["path"]).parent,
            view["name"], camera, anatomy_bvh, allowed, resolution,
        )
        view["geometryPass"] = "finger-region-bvh-v3"
        refreshed += 1
    return {"side": side, "allowedRegions": allowed, "viewsRefreshed": refreshed}


def _ensure_wrist(landmarks: Dict[str, dict], measurement: dict, anatomy_bvh, side: str):
    suffix = "l" if side == "left" else "r"
    name = f"wrist_{suffix}"
    current = landmarks.get(name) or {"name": name}
    if current.get("accepted", False):
        return False
    origin_value = measurement.get("origin")
    if not measurement.get("valid") or not origin_value:
        landmarks[name] = current
        return False
    origin = Vector(tuple(float(value) for value in origin_value))
    hand_scale = max(float(measurement.get("handScale") or 0.0), 1e-5)
    surface = anatomy_bvh.nearest(origin, (f"forearm_{suffix}", f"hand_{suffix}"))
    if surface is None or float(surface["distance"]) > hand_scale * 0.42:
        landmarks[name] = current
        return False
    confidence = max(0.58, min(0.86, 0.72 + min(0.14, int(measurement.get("vertexCount") or 0) / 1200.0)))
    current.update({
        "name": name,
        "position": _vec(origin),
        "internalJointPosition": _vec(origin),
        "surfaceDisplayPosition": _vec(surface["location"]),
        "displayPosition": _vec(surface["location"]),
        "region": f"hand_{suffix}",
        "surfaceRegion": surface.get("region", f"hand_{suffix}"),
        "landmarkType": "internal_joint",
        "accepted": True,
        "verified": True,
        "display": True,
        "confidence": confidence,
        "finalConfidence": confidence,
        "viewsConfirmed": int(current.get("viewsConfirmed") or 0),
        "methods": ["measured_hand_origin", "forearm_hand_boundary_bvh"],
        "method": "geometry-measured-wrist-boundary-v3.2",
        "rejectionReasons": [],
        "geometryFallback": True,
    })
    landmarks[name] = current
    return True


def _usable_observation(item: dict):
    if not item or not (item.get("internalJointPosition") or item.get("position")):
        return False
    reasons = set(item.get("rejectionReasons") or [])
    hard_failures = {
        "LANDMARK_REGION_BVH_MISS", "LANDMARK_TECHNICAL_PASS_MISMATCH",
        "TECHNICAL_EVIDENCE_GATE_FAILED", "RAY_TRIANGULATION_FAILED",
    }
    if reasons.intersection(hard_failures):
        return False
    confidence = float(item.get("finalConfidence", item.get("confidence", 0.0)))
    views = int(item.get("viewsConfirmed") or 0)
    return bool(item.get("accepted", False) or (views >= 2 and confidence >= 0.30))


def _factor_sequence(names: List[str], observations: dict):
    canonical = [0.18, 0.43, 0.70, 0.96]
    bands = [(0.10, 0.30), (0.31, 0.56), (0.57, 0.82), (0.88, 1.0)]
    factors = []
    for index, name in enumerate(names):
        if name in observations:
            _item, _point, _distance, along = observations[name]
            factor = float(along) * 0.58 + canonical[index] * 0.42
        else:
            factor = canonical[index]
        lower, upper = bands[index]
        factor = max(lower, min(upper, factor))
        if factors:
            factor = max(factor, factors[-1] + 0.10)
        factors.append(min(factor, upper))
    return factors


def _local_xy(point: Vector, origin: Vector, lateral: Vector, forward: Vector):
    delta = point - origin
    return delta.dot(lateral), delta.dot(forward)


def _chains_cross(first: List[Vector], second: List[Vector], origin: Vector,
                  lateral: Vector, forward: Vector):
    def orient(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

    first_2d = [_local_xy(point, origin, lateral, forward) for point in first]
    second_2d = [_local_xy(point, origin, lateral, forward) for point in second]
    for a, b in zip(first_2d, first_2d[1:]):
        for c, d in zip(second_2d, second_2d[1:]):
            if orient(a, b, c) * orient(a, b, d) < 0 and orient(c, d, a) * orient(c, d, b) < 0:
                return True
    return False


def _refine_to_topology(landmarks: Dict[str, dict], topology, anatomy_bvh,
                        side: str, measurement: dict):
    suffix = topology.suffix
    blocking = []
    informative = []
    valid = {}
    finger_lengths = {}
    mapping = topology.diagnostics.get("branchAssignment") or {}
    medial = topology.diagnostics.get("medialGraph") or {}
    mapping_confidence = float(mapping.get("mappingConfidence") or 0.0)
    medial_valid = medial.get("status") == "valid"
    hand_scale = max(float(measurement.get("handScale") or 0.0), 1e-5)

    for finger in FINGERS:
        names = _chain_names(finger, suffix)
        branch = topology.branch(finger)
        region = f"{finger}_{suffix}"
        metric = topology.metrics.get(finger) or {}
        if branch is None or not anatomy_bvh.has_region(region):
            _invalidate(landmarks, names, ["GEOMETRIC_FINGER_BRANCH_UNAVAILABLE"])
            valid[finger] = False
            blocking.append({"code": "GEOMETRIC_FINGER_BRANCH_UNAVAILABLE", "side": side, "finger": finger})
            continue

        observations = []
        for name in names:
            item = landmarks.get(name) or {}
            if _usable_observation(item):
                point, distance, along = topology.nearest_on_branch(finger, _internal(item))
                if point is not None:
                    observations.append((name, item, point, distance, along))
        observation_lookup = {name: (item, point, distance, along) for name, item, point, distance, along in observations}
        factors = _factor_sequence(names, observation_lookup)
        points = [topology.point_at(finger, factor) for factor in factors]
        if any(point is None for point in points):
            _invalidate(landmarks, names, ["FINGER_CENTERLINE_SAMPLING_FAILED"])
            valid[finger] = False
            blocking.append({"code": "FINGER_CENTERLINE_SAMPLING_FAILED", "side": side, "finger": finger})
            continue

        segment_lengths = [(points[index + 1] - points[index]).length for index in range(3)]
        geodesic_length = max(float(metric.get("geodesicLength") or branch.geodesic_length), 1e-5)
        length_ratio = geodesic_length / hand_scale
        minimum_segment = geodesic_length * 0.045
        maximum_segment = geodesic_length * 0.46
        sizes_valid = all(minimum_segment <= length <= maximum_segment for length in segment_lengths)
        branch_confidence = float(metric.get("branchConfidence") or branch.confidence)
        vertex_count = int(metric.get("vertexCount") or 0)
        visual_distances = [value[2] for value in observation_lookup.values()]
        if visual_distances:
            agreement = max(
                0.0,
                min(1.0, 1.0 - sum(visual_distances) / max(len(visual_distances) * geodesic_length * 0.42, 1e-8)),
            )
        else:
            agreement = 0.55
        minimum_ratio = 0.11 if finger == "thumb" else 0.16
        geometry_strong = bool(
            medial_valid
            and branch_confidence >= 0.52
            and vertex_count >= 4
            and minimum_ratio <= length_ratio <= 1.20
        )
        semantic_evidence = mapping_confidence >= 0.45 or len(observations) >= 2
        visual_gate = len(observations) < 2 or agreement >= 0.24
        chain_valid = bool(sizes_valid and geometry_strong and semantic_evidence and visual_gate)
        geometry_only = chain_valid and len(observations) < 2
        surfaces = [anatomy_bvh.nearest(point, region) for point in points]
        if any(surface is None for surface in surfaces):
            chain_valid = False

        for name, point, factor, surface in zip(names, points, factors, surfaces):
            item = landmarks.setdefault(name, {"name": name})
            item["position"] = _vec(point)
            item["internalJointPosition"] = _vec(point)
            item["surfaceDisplayPosition"] = _vec(surface["location"] if surface else point)
            item["displayPosition"] = list(item["surfaceDisplayPosition"])
            item["region"] = region
            item["surfaceRegion"] = region if surface else "unknown"
            item["landmarkType"] = "internal_joint"
            item["geodesicFactor"] = float(factor)
            item["geodesicConfidence"] = float(branch_confidence)
            item["topologyConfidence"] = float(agreement)
            item["fingerMetrics"] = metric
            item["geometryFallback"] = geometry_only
            methods = item.setdefault("methods", [])
            for method in (
                "geometry_first_finger_branch", "geodesic_centerline_projection",
                "finger_specific_region_bvh",
                "visual_geometry_fusion" if observations else "geometry_only_branch_recovery",
            ):
                if method not in methods:
                    methods.append(method)
            item["method"] = "topology-visual-fused-finger-centerline-v3.2" if observations else "topology-only-finger-centerline-v3.2"
            item["accepted"] = chain_valid
            item["verified"] = chain_valid
            item["display"] = chain_valid
            detector_confidence = float(item.get("finalConfidence", item.get("confidence", 0.0)))
            evidence_confidence = agreement if observations else 0.55
            final = detector_confidence * 0.22 + branch_confidence * 0.40 + mapping_confidence * 0.18 + evidence_confidence * 0.20
            item["finalConfidence"] = float(max(0.45, final) if chain_valid else min(final, 0.39))
            item["confidence"] = item["finalConfidence"]
            item["rejectionReasons"] = []
            if not chain_valid:
                reasons = item["rejectionReasons"]
                if not sizes_valid:
                    reasons.append("FINGER_SEGMENT_SCALE_INVALID")
                if not geometry_strong:
                    reasons.append("FINGER_BRANCH_CONFIDENCE_LOW")
                if not semantic_evidence:
                    reasons.append("FINGER_BRANCH_LABEL_UNCERTAIN")
                if not visual_gate:
                    reasons.append("VISUAL_GEOMETRY_AGREEMENT_LOW")
                if surface is None:
                    reasons.append("FINGER_REGION_BVH_UNAVAILABLE")

        valid[finger] = chain_valid
        if chain_valid:
            finger_lengths[finger] = float(sum(segment_lengths))
            if geometry_only:
                informative.append({
                    "code": "FINGER_GEOMETRY_FALLBACK_USED", "side": side, "finger": finger,
                    "branchConfidence": branch_confidence, "mappingConfidence": mapping_confidence,
                })
        else:
            blocking.append({
                "code": "FINGER_TOPOLOGY_INVALID", "side": side, "finger": finger,
                "segmentLengths": segment_lengths, "branchConfidence": branch_confidence,
                "visualGeometryAgreement": agreement, "visualPointCount": len(observations),
                "mappingConfidence": mapping_confidence, "lengthRatio": length_ratio,
            })

    origin = Vector(tuple(measurement.get("origin") or (0.0, 0.0, 0.0)))
    lateral = Vector(tuple(measurement.get("lateral") or (1.0, 0.0, 0.0)))
    forward = Vector(tuple(measurement.get("forward") or (0.0, 0.0, -1.0)))
    if lateral.length <= 1e-8:
        lateral = Vector((1.0, 0.0, 0.0))
    if forward.length <= 1e-8:
        forward = Vector((0.0, 0.0, -1.0))
    lateral.normalize(); forward.normalize()
    valid_chains = {
        finger: [_internal(landmarks[name]) for name in _chain_names(finger, suffix)]
        for finger in FINGERS if valid.get(finger, False)
    }
    crossed = set()
    for first, second in combinations(valid_chains, 2):
        if _chains_cross(valid_chains[first], valid_chains[second], origin, lateral, forward):
            crossed.update((first, second))
    for finger in crossed:
        _invalidate(landmarks, _chain_names(finger, suffix), ["FINGER_CHAINS_CROSS"])
        valid[finger] = False
        finger_lengths.pop(finger, None)
    if crossed:
        blocking.append({"code": "FINGER_CHAINS_CROSS", "side": side, "fingers": sorted(crossed)})

    return {
        "landmarks": landmarks,
        "validFingers": sum(1 for value in valid.values() if value),
        "fingerLengths": finger_lengths,
        "blockingWarnings": blocking,
        "informativeWarnings": informative,
    }


def _derive_palm_and_metacarpals(landmarks: Dict[str, dict], anatomy_bvh, side: str):
    suffix = "l" if side == "left" else "r"
    wrist_name = f"wrist_{suffix}"
    base_names = [f"{finger}_01_{suffix}" for finger in ("index", "middle", "ring", "pinky")]
    if not all(name in landmarks and landmarks[name].get("accepted", False) for name in [wrist_name, *base_names]):
        return [{"code": "PALM_GEOMETRY_INSUFFICIENT", "side": side}]
    wrist = _internal(landmarks[wrist_name])
    bases = [_internal(landmarks[name]) for name in base_names]
    palm = (wrist + sum(bases, Vector((0.0, 0.0, 0.0)))) / 5.0
    surface = anatomy_bvh.nearest(palm, f"hand_{suffix}")
    accepted = surface is not None
    base_confidence = min(float(landmarks[name].get("confidence", 0.0)) for name in [wrist_name, *base_names])
    palm_name = f"palm_{suffix}"
    landmarks[palm_name] = {
        "name": palm_name, "position": _vec(palm), "internalJointPosition": _vec(palm),
        "surfaceDisplayPosition": _vec(surface["location"] if surface else palm),
        "displayPosition": _vec(surface["location"] if surface else palm),
        "region": f"hand_{suffix}", "surfaceRegion": f"hand_{suffix}",
        "landmarkType": "internal_joint", "accepted": accepted, "verified": accepted,
        "display": accepted, "confidence": base_confidence * 0.90 if accepted else min(base_confidence, 0.39),
        "finalConfidence": base_confidence * 0.90 if accepted else min(base_confidence, 0.39),
        "viewsConfirmed": min(int(landmarks[name].get("viewsConfirmed", 0)) for name in base_names),
        "methods": ["verified_mcp_centroid", "hand_region_bvh_surface_anchor"],
        "method": "anatomical-palm-center-v3.2", "rejectionReasons": [] if accepted else ["PALM_OUTSIDE_HAND_REGION"],
    }
    for finger in FINGERS:
        base_name = f"{finger}_01_{suffix}"
        if base_name not in landmarks:
            continue
        base = _internal(landmarks[base_name])
        name = f"{finger}_metacarpal_{suffix}"
        verified = bool(landmarks[base_name].get("accepted", False) and accepted)
        point = palm.lerp(base, 0.62)
        landmarks[name] = {
            "name": name, "position": _vec(point), "internalJointPosition": _vec(point),
            "region": f"hand_{suffix}", "landmarkType": "derived_internal",
            "accepted": verified, "verified": verified, "display": False, "derived": True,
            "aliasOf": base_name, "confidence": min(float(landmarks[base_name].get("confidence", 0.0)), base_confidence) * 0.84,
            "viewsConfirmed": int(landmarks[base_name].get("viewsConfirmed", 0)),
            "methods": ["palm_to_mcp_internal_derivation"], "method": "derived-metacarpal-internal-v3.2",
            "rejectionReasons": [] if verified else ["SOURCE_CHAIN_NOT_VERIFIED"],
        }
    return []


def analyze_hands(detector_output: dict, manifest: dict, classifications: Dict[str, str],
                  segmentation, meshes, anatomy_bvh):
    hand_views = {**detector_output, "views": [item for item in detector_output.get("views", []) if item.get("region") == "hand"]}
    rough_projected, rough_failures = project_candidates(hand_views, manifest, classifications, anatomy_bvh)
    rough_grouped = _group(rough_projected)
    topologies = {}
    warnings = list(rough_failures)

    for side in ("left", "right"):
        suffix = "l" if side == "left" else "r"
        side_grouped = {name: values for name, values in rough_grouped.items() if name.endswith(f"_{suffix}")}
        rough = _triangulate_side(side_grouped, segmentation, anatomy_bvh, side, rough=True)
        topology = detect_hand_topology(meshes, segmentation, side, rough)
        topologies[side] = topology
        apply_report = apply_finger_region_labels(meshes, segmentation, topology)
        warnings.extend(topology.diagnostics.get("branchAssignment", {}).get("warnings") or [])
        if apply_report.get("validFingerRegions", 0) < 5:
            warnings.append({"code": "FINGER_REGION_LABELING_INCOMPLETE", "side": side, **apply_report})

    final_bvh = build_anatomy_bvh(meshes, segmentation, classifications)
    refresh_reports = [_refresh_hand_passes(manifest, final_bvh, side) for side in ("left", "right")]
    final_projected, final_failures = project_candidates(hand_views, manifest, classifications, final_bvh)
    warnings.extend(final_failures)
    final_grouped = _group(final_projected)
    result = {}

    for side in ("left", "right"):
        suffix = "l" if side == "left" else "r"
        measurement = segmentation.hand_measurement(side)
        side_grouped = {name: values for name, values in final_grouped.items() if name.endswith(f"_{suffix}")}
        landmarks = _triangulate_side(side_grouped, segmentation, final_bvh, side, rough=False)
        wrist_fallback = _ensure_wrist(landmarks, measurement, final_bvh, side)
        refined = _refine_to_topology(landmarks, topologies[side], final_bvh, side, measurement)
        landmarks = refined["landmarks"]
        blocking = list(refined.get("blockingWarnings") or [])
        informative = list(refined.get("informativeWarnings") or [])
        classification = topologies[side].diagnostics.get("classification") or {}
        hand_mode = str(classification.get("mode") or "unsupported_or_corrupt")
        if wrist_fallback:
            informative.append({"code": "WRIST_GEOMETRY_FALLBACK_USED", "side": side})
        palm_warnings = _derive_palm_and_metacarpals(landmarks, final_bvh, side)
        if hand_mode != "simplified_mitten":
            blocking.extend(palm_warnings)
        valid_fingers = int(refined.get("validFingers") or 0)
        rejected_names = sorted(
            name for name, item in landmarks.items()
            if isinstance(item, dict) and not item.get("accepted", False)
        )
        hand_base_ready = bool(
            (landmarks.get(f"wrist_{suffix}") or {}).get("accepted")
            and classification.get("handBaseSupported")
        )
        finger_rig_ready = bool(
            classification.get("fullFingerRigSupported")
            and valid_fingers == 5
            and not rejected_names
        )
        if hand_mode == "simplified_mitten" and hand_base_ready:
            informative.extend({**item, "blocking": False} for item in blocking)
            blocking = []
            informative.append({
                "code": "HAND_FINGER_RIG_UNSUPPORTED",
                "side": side,
                "handMode": hand_mode,
                "message": "La base de la mano es válida; la topología tipo mitón no expone dedos reales.",
                "blocking": False,
            })
            status = "valid_base_only"
        elif finger_rig_ready and not blocking:
            status = "valid_with_warnings" if informative or topologies[side].diagnostics.get("status") != "valid" else "valid"
        else:
            status = "needs_review"
            blocking.append({
                "code": f"{side.upper()}_HAND_REQUIRES_REVIEW", "side": side,
                "validFingers": valid_fingers, "rejectedLandmarks": rejected_names,
                "topologyStatus": topologies[side].diagnostics.get("status"),
            })
        side_warnings = [*blocking, *informative]
        result[side] = {
            "status": status, "landmarks": landmarks, "validFingers": valid_fingers,
            "handMode": hand_mode,
            "fingerRigMode": classification.get("fingerRigMode") or "unsupported",
            "handBaseReady": hand_base_ready,
            "fingerRigReady": finger_rig_ready,
            "measurements": {**measurement, "fingerLengths": refined.get("fingerLengths") or {}},
            "topology": topologies[side].as_report(),
            "triangulatedLandmarks": sum(1 for item in landmarks.values() if item.get("internalJointPosition")),
            "acceptedLandmarks": sum(1 for item in landmarks.values() if item.get("accepted", False)),
            "visibleSurfaceLandmarks": sum(1 for item in landmarks.values() if item.get("display", False)),
            "rejectedLandmarks": rejected_names, "warnings": side_warnings,
            "blockingWarnings": blocking, "nonBlockingWarnings": informative,
            "projectedCandidates": [item for item in final_projected if item.get("side") == side],
            "method": "topology-first-geodesic-branches-plus-finger-region-bvh-v3.2",
        }
        warnings.extend(side_warnings)

    return {
        "left": result.get("left", {"status": "needs_review", "landmarks": {}, "warnings": []}),
        "right": result.get("right", {"status": "needs_review", "landmarks": {}, "warnings": []}),
        "warnings": warnings,
        "roughProjectedCandidates": rough_projected,
        "projectedCandidates": final_projected,
        "technicalPassRefresh": refresh_reports,
        "fingerRegionBvh": final_bvh.report(),
        "_anatomy_bvh": final_bvh,
    }
