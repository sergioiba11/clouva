"""Topology-first hand analysis for CLOUVA Avatar Analyzer V3."""
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
        item.setdefault("rejectionReasons", []).extend(
            reason for reason in reasons if reason not in item.get("rejectionReasons", [])
        )


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
            regions = (f"hand_{suffix}",)
            preferred = ("palm", "dorsum")
        else:
            finger = name.split("_")[0]
            finger_region = f"{finger}_{suffix}"
            regions = (finger_region,) if anatomy_bvh.has_region(finger_region) and not rough else (f"hand_{suffix}",)
            preferred = ("palm", "three_quarter_palm")
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


def _refine_to_topology(landmarks: Dict[str, dict], topology, anatomy_bvh, side: str):
    suffix = topology.suffix
    warnings = []
    valid = {}
    finger_lengths = {}
    for finger in FINGERS:
        names = _chain_names(finger, suffix)
        branch = topology.branch(finger)
        region = f"{finger}_{suffix}"
        metric = topology.metrics.get(finger) or {}
        if branch is None or not anatomy_bvh.has_region(region):
            _invalidate(landmarks, names, ["GEOMETRIC_FINGER_BRANCH_UNAVAILABLE"])
            valid[finger] = False
            warnings.append({"code": "GEOMETRIC_FINGER_BRANCH_UNAVAILABLE", "side": side, "finger": finger})
            continue

        observations = []
        for name in names:
            item = landmarks.get(name) or {}
            if item.get("accepted", False):
                point, distance, along = topology.nearest_on_branch(finger, _internal(item))
                if point is not None:
                    observations.append((name, item, point, distance, along))
        if len(observations) < 3:
            _invalidate(landmarks, names, ["INSUFFICIENT_VISUAL_GEOMETRY_AGREEMENT"])
            valid[finger] = False
            warnings.append({
                "code": "INSUFFICIENT_VISUAL_GEOMETRY_AGREEMENT", "side": side,
                "finger": finger, "acceptedVisualPoints": len(observations),
            })
            continue

        observation_lookup = {name: (item, point, distance, along) for name, item, point, distance, along in observations}
        prior_factors = {names[0]: 0.18, names[1]: 0.43, names[2]: 0.70, names[3]: 1.0}
        factors = []
        for name in names:
            if name in observation_lookup:
                _item, _point, _distance, along = observation_lookup[name]
                factor = along * 0.82 + prior_factors[name] * 0.18
            else:
                factor = prior_factors[name]
            if factors:
                factor = max(factor, factors[-1] + 0.07)
            factors.append(min(factor, 1.0))
        if factors[-1] < 0.88:
            factors[-1] = 1.0

        points = [topology.point_at(finger, factor) for factor in factors]
        if any(point is None for point in points):
            _invalidate(landmarks, names, ["FINGER_CENTERLINE_SAMPLING_FAILED"])
            valid[finger] = False
            continue
        segment_lengths = [(points[index + 1] - points[index]).length for index in range(3)]
        geodesic_length = max(float(metric.get("geodesicLength") or branch.geodesic_length), 1e-5)
        minimum_segment = geodesic_length * 0.055
        maximum_segment = geodesic_length * 0.52
        sizes_valid = all(minimum_segment <= length <= maximum_segment for length in segment_lengths)
        branch_confidence = float(metric.get("branchConfidence") or branch.confidence)
        visual_geometry_distances = [value[2] for value in observation_lookup.values()]
        agreement = max(0.0, min(1.0, 1.0 - sum(visual_geometry_distances) / max(len(visual_geometry_distances) * geodesic_length * 0.25, 1e-8)))
        chain_valid = sizes_valid and branch_confidence >= 0.48 and agreement >= 0.40

        for name, point, factor in zip(names, points, factors):
            item = landmarks.setdefault(name, {"name": name})
            surface = anatomy_bvh.nearest(point, region)
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
            item.setdefault("methods", []).extend([
                "geometry_first_finger_branch", "geodesic_centerline_projection",
                "finger_specific_region_bvh",
            ])
            item["method"] = "topology-first-finger-centerline-v3"
            item["accepted"] = chain_valid
            item["verified"] = chain_valid
            item["display"] = chain_valid
            final = (
                float(item.get("finalConfidence", item.get("confidence", 0.0))) * 0.45
                + branch_confidence * 0.30 + agreement * 0.25
            )
            item["finalConfidence"] = float(final if chain_valid else min(final, 0.39))
            item["confidence"] = item["finalConfidence"]
            if not chain_valid:
                item.setdefault("rejectionReasons", []).extend([
                    *( [] if sizes_valid else ["FINGER_SEGMENT_SCALE_INVALID"] ),
                    *( [] if branch_confidence >= 0.48 else ["FINGER_BRANCH_CONFIDENCE_LOW"] ),
                    *( [] if agreement >= 0.40 else ["VISUAL_GEOMETRY_AGREEMENT_LOW"] ),
                ])

        valid[finger] = chain_valid
        if chain_valid:
            finger_lengths[finger] = float(sum(segment_lengths))
        else:
            warnings.append({
                "code": "FINGER_TOPOLOGY_INVALID", "side": side, "finger": finger,
                "segmentLengths": segment_lengths, "branchConfidence": branch_confidence,
                "visualGeometryAgreement": agreement,
            })

    # Crossing test in the hand local plane.
    measurement = topology.metrics
    crossed = set()
    valid_chains = {
        finger: [_internal(landmarks[name]) for name in _chain_names(finger, suffix)]
        for finger in FINGERS if valid.get(finger, False)
    }
    def segments(points): return list(zip(points, points[1:]))
    def orient(a, b, c): return (b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x)
    def crosses(first, second):
        a,b=first; c,d=second
        return orient(a,b,c)*orient(a,b,d) < 0 and orient(c,d,a)*orient(c,d,b) < 0
    for first, second in combinations(valid_chains, 2):
        if any(crosses(a, b) for a in segments(valid_chains[first]) for b in segments(valid_chains[second])):
            crossed.update((first, second))
    for finger in crossed:
        _invalidate(landmarks, _chain_names(finger, suffix), ["FINGER_CHAINS_CROSS"])
        valid[finger] = False
    if crossed:
        warnings.append({"code": "FINGER_CHAINS_CROSS", "side": side, "fingers": sorted(crossed)})

    return {
        "landmarks": landmarks,
        "validFingers": sum(1 for value in valid.values() if value),
        "fingerLengths": finger_lengths,
        "warnings": warnings,
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
        "display": accepted, "confidence": base_confidence * 0.88 if accepted else min(base_confidence, 0.39),
        "finalConfidence": base_confidence * 0.88 if accepted else min(base_confidence, 0.39),
        "viewsConfirmed": min(int(landmarks[name].get("viewsConfirmed", 0)) for name in base_names),
        "methods": ["verified_mcp_centroid", "hand_region_bvh_surface_anchor"],
        "method": "anatomical-palm-center-v3", "rejectionReasons": [] if accepted else ["PALM_OUTSIDE_HAND_REGION"],
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
            "aliasOf": base_name, "confidence": min(float(landmarks[base_name].get("confidence", 0.0)), base_confidence) * 0.82,
            "viewsConfirmed": int(landmarks[base_name].get("viewsConfirmed", 0)),
            "methods": ["palm_to_mcp_internal_derivation"], "method": "derived-metacarpal-internal-v3",
            "rejectionReasons": [] if verified else ["SOURCE_CHAIN_NOT_VERIFIED"],
        }
    return []


def analyze_hands(detector_output: dict, manifest: dict, classifications: Dict[str, str],
                  segmentation, meshes, anatomy_bvh):
    hand_views = {**detector_output, "views": [item for item in detector_output.get("views", []) if item.get("region") == "hand"]}
    rough_projected, rough_failures = project_candidates(hand_views, manifest, classifications, anatomy_bvh)
    rough_grouped = _group(rough_projected)
    topologies = {}
    rough_landmarks = {}
    warnings = list(rough_failures)

    for side in ("left", "right"):
        suffix = "l" if side == "left" else "r"
        side_grouped = {name: values for name, values in rough_grouped.items() if name.endswith(f"_{suffix}")}
        rough = _triangulate_side(side_grouped, segmentation, anatomy_bvh, side, rough=True)
        rough_landmarks[side] = rough
        topology = detect_hand_topology(meshes, segmentation, side, rough)
        topologies[side] = topology
        apply_report = apply_finger_region_labels(meshes, segmentation, topology)
        warnings.extend(topology.diagnostics.get("branchAssignment", {}).get("warnings") or [])
        if apply_report.get("validFingerRegions", 0) < 5:
            warnings.append({"code": "FINGER_REGION_LABELING_INCOMPLETE", **apply_report})

    final_bvh = build_anatomy_bvh(meshes, segmentation, classifications)
    refresh_reports = [_refresh_hand_passes(manifest, final_bvh, side) for side in ("left", "right")]
    final_projected, final_failures = project_candidates(hand_views, manifest, classifications, final_bvh)
    warnings.extend(final_failures)
    final_grouped = _group(final_projected)
    result = {}

    for side in ("left", "right"):
        suffix = "l" if side == "left" else "r"
        side_grouped = {name: values for name, values in final_grouped.items() if name.endswith(f"_{suffix}")}
        landmarks = _triangulate_side(side_grouped, segmentation, final_bvh, side, rough=False)
        refined = _refine_to_topology(landmarks, topologies[side], final_bvh, side)
        landmarks = refined["landmarks"]
        side_warnings = list(refined.get("warnings") or [])
        side_warnings.extend(_derive_palm_and_metacarpals(landmarks, final_bvh, side))
        valid_fingers = int(refined.get("validFingers") or 0)
        rejected_names = sorted(name for name, item in landmarks.items() if isinstance(item, dict) and not item.get("accepted", False))
        status = "valid" if valid_fingers == 5 and not rejected_names and not side_warnings and topologies[side].diagnostics.get("status") == "valid" else "needs_review"
        if status != "valid":
            side_warnings.append({
                "code": f"{side.upper()}_HAND_REQUIRES_REVIEW", "validFingers": valid_fingers,
                "rejectedLandmarks": rejected_names,
                "topologyStatus": topologies[side].diagnostics.get("status"),
            })
        result[side] = {
            "status": status, "landmarks": landmarks, "validFingers": valid_fingers,
            "measurements": {**segmentation.hand_measurement(side), "fingerLengths": refined.get("fingerLengths") or {}},
            "topology": topologies[side].as_report(),
            "triangulatedLandmarks": sum(1 for item in landmarks.values() if item.get("internalJointPosition")),
            "acceptedLandmarks": sum(1 for item in landmarks.values() if item.get("accepted", False)),
            "visibleSurfaceLandmarks": sum(1 for item in landmarks.values() if item.get("display", False)),
            "rejectedLandmarks": rejected_names, "warnings": side_warnings,
            "projectedCandidates": [item for item in final_projected if item.get("side") == side],
            "method": "topology-first-geodesic-branches-plus-finger-region-bvh-v3",
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
