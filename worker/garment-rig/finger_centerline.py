"""Finger-specific geometry refinement for CLOUVA Avatar Analyzer V2."""
from __future__ import annotations

from itertools import combinations
from typing import Dict, Iterable, List, Tuple

from mathutils import Vector

FINGERS = ("thumb", "index", "middle", "ring", "pinky")


def _vec(value: Vector):
    return [float(value.x), float(value.y), float(value.z)]


def _internal(item: dict) -> Vector:
    value = item.get("internalJointPosition") or item.get("position")
    return Vector(tuple(float(component) for component in value))


def _segment_distance(point: Vector, start: Vector, end: Vector):
    axis = end - start
    denominator = max(axis.length_squared, 1e-12)
    t = max(0.0, min(1.0, (point - start).dot(axis) / denominator))
    closest = start + axis * t
    return (point - closest).length, closest


def _polyline_distance(point: Vector, points: List[Vector]):
    if len(points) < 2:
        return float("inf")
    return min(_segment_distance(point, first, second)[0] for first, second in zip(points, points[1:]))


def _chain_names(finger: str, suffix: str):
    return [
        f"{finger}_01_{suffix}",
        f"{finger}_02_{suffix}",
        f"{finger}_03_{suffix}",
        f"{finger}_tip_{suffix}",
    ]


def _line_segments(points: List[Vector]):
    return list(zip(points, points[1:]))


def _orientation_2d(a, b, c):
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _segments_cross_2d(first, second, epsilon=1e-8):
    a, b = first
    c, d = second
    o1 = _orientation_2d(a, b, c)
    o2 = _orientation_2d(a, b, d)
    o3 = _orientation_2d(c, d, a)
    o4 = _orientation_2d(c, d, b)
    return o1 * o2 < -epsilon and o3 * o4 < -epsilon


def _hand_frame(landmarks: Dict[str, dict], suffix: str):
    wrist = _internal(landmarks[f"wrist_{suffix}"])
    middle = _internal(landmarks[f"middle_01_{suffix}"])
    index = _internal(landmarks[f"index_01_{suffix}"])
    pinky = _internal(landmarks[f"pinky_01_{suffix}"])
    forward = middle - wrist
    lateral = index - pinky
    if forward.length <= 1e-8 or lateral.length <= 1e-8:
        return None
    forward.normalize()
    lateral -= forward * lateral.dot(forward)
    if lateral.length <= 1e-8:
        return None
    lateral.normalize()
    normal = forward.cross(lateral)
    if normal.length <= 1e-8:
        return None
    normal.normalize()
    lateral = normal.cross(forward).normalized()
    return wrist, forward, lateral, normal


def _assign_finger_clouds(hand_points: Iterable[Vector], landmarks: Dict[str, dict],
                          suffix: str, hand_scale: float):
    polylines = {}
    wrist = _internal(landmarks[f"wrist_{suffix}"])
    for finger in FINGERS:
        names = _chain_names(finger, suffix)
        if all(name in landmarks and landmarks[name].get("accepted", False) for name in names):
            polylines[finger] = [wrist, *[_internal(landmarks[name]) for name in names]]
    clouds = {finger: [] for finger in polylines}
    maximum_distance = hand_scale * 0.20
    for point in hand_points:
        ranked = sorted(
            ((_polyline_distance(point, polyline), finger) for finger, polyline in polylines.items()),
            key=lambda item: item[0],
        )
        if ranked and ranked[0][0] <= maximum_distance:
            clouds[ranked[0][1]].append(point)
    return clouds


def _cross_section_center(candidate: Vector, previous: Vector, following: Vector,
                          cloud: List[Vector], hand_scale: float):
    axis = following - previous
    if axis.length <= 1e-8:
        return candidate
    axis.normalize()
    radius = hand_scale * 0.115
    slab = hand_scale * 0.075
    selected = [
        point for point in cloud
        if abs((point - candidate).dot(axis)) <= slab
        and ((point - candidate) - axis * (point - candidate).dot(axis)).length <= radius
    ]
    if len(selected) < 4:
        return candidate
    center = sum(selected, Vector((0.0, 0.0, 0.0))) / len(selected)
    # Retain the longitudinal coordinate from triangulation while using the
    # cross-section centroid for the internal axis.
    return center + axis * (candidate - center).dot(axis)


def _nearest_surface(point: Vector, cloud: List[Vector]):
    if not cloud:
        return None, float("inf")
    surface = min(cloud, key=lambda value: (value - point).length_squared)
    return surface, (surface - point).length


def _invalidate(landmarks: Dict[str, dict], names: List[str], reasons: List[str]):
    for name in names:
        item = landmarks.get(name)
        if not item:
            continue
        item["accepted"] = False
        item["verified"] = False
        item["display"] = False
        item["confidence"] = min(float(item.get("confidence", 0.0)), 0.39)
        item.setdefault("rejectionReasons", []).extend(reason for reason in reasons if reason not in item.get("rejectionReasons", []))


def refine_hand_landmarks(landmarks: Dict[str, dict], segmentation, side: str):
    suffix = "l" if side == "left" else "r"
    measurement = segmentation.hand_measurement(side)
    hand_scale = max(float(measurement.get("handScale") or 0.0), 1e-5)
    warnings: List[dict] = []
    required_frame = [
        f"wrist_{suffix}", f"middle_01_{suffix}", f"index_01_{suffix}", f"pinky_01_{suffix}",
    ]
    if not all(name in landmarks and landmarks[name].get("accepted", False) for name in required_frame):
        return {
            "status": "needs_review",
            "validFingers": 0,
            "landmarks": landmarks,
            "measurements": measurement,
            "warnings": [{"code": "HAND_LOCAL_FRAME_UNAVAILABLE", "side": side}],
        }
    frame = _hand_frame(landmarks, suffix)
    if frame is None:
        return {
            "status": "needs_review",
            "validFingers": 0,
            "landmarks": landmarks,
            "measurements": measurement,
            "warnings": [{"code": "HAND_LOCAL_FRAME_DEGENERATE", "side": side}],
        }
    wrist, forward, lateral, normal = frame
    hand_points = segmentation.region_points(f"hand_{suffix}")
    clouds = _assign_finger_clouds(hand_points, landmarks, suffix, hand_scale)
    valid = {}
    finger_lengths = {}

    for finger in FINGERS:
        names = _chain_names(finger, suffix)
        if not all(name in landmarks and landmarks[name].get("accepted", False) for name in names):
            _invalidate(landmarks, names, ["TRIANGULATED_CHAIN_INCOMPLETE"])
            valid[finger] = False
            continue
        cloud = clouds.get(finger, [])
        raw = [_internal(landmarks[name]) for name in names]
        refined = []
        extended = [wrist, *raw]
        for index, candidate in enumerate(raw, start=1):
            previous = extended[max(0, index - 1)]
            following = extended[min(len(extended) - 1, index + 1)]
            refined.append(_cross_section_center(candidate, previous, following, cloud, hand_scale))

        distances = [(point - wrist).dot(forward) for point in refined]
        segment_lengths = [(refined[index + 1] - refined[index]).length for index in range(3)]
        minimum_segment = hand_scale * 0.045
        maximum_segment = hand_scale * 0.46
        progressing = all(distances[index + 1] > distances[index] + hand_scale * 0.012 for index in range(3))
        sizes_valid = all(minimum_segment <= length <= maximum_segment for length in segment_lengths)
        continuity = True
        directions = []
        for first, second in zip(refined, refined[1:]):
            direction = second - first
            if direction.length > 1e-8:
                direction.normalize()
            directions.append(direction)
        for first, second in zip(directions, directions[1:]):
            if first.length > 1e-8 and second.length > 1e-8 and first.dot(second) < 0.05:
                continuity = False

        surface_distances = []
        for name, point in zip(names, refined):
            surface, surface_distance = _nearest_surface(point, cloud)
            surface_distances.append(surface_distance)
            item = landmarks[name]
            item["internalJointPosition"] = _vec(point)
            item["position"] = _vec(point)
            item["region"] = f"{finger}_{suffix}"
            item["surfaceRegion"] = f"{finger}_{suffix}"
            item["landmarkType"] = "internal_joint"
            item["topologyConfidence"] = 0.90
            item.setdefault("methods", []).extend(["finger_cloud_assignment", "cross_section_medial_refinement"])
            if surface is not None:
                item["surfaceDisplayPosition"] = _vec(surface)
                item["displayPosition"] = _vec(surface)

        inside_cloud = bool(cloud) and all(distance <= hand_scale * 0.22 for distance in surface_distances)
        chain_valid = progressing and sizes_valid and continuity and inside_cloud
        if not chain_valid:
            reasons = [
                *( [] if progressing else ["FINGER_NOT_PROGRESSING_FROM_WRIST"] ),
                *( [] if sizes_valid else ["FINGER_SEGMENT_SCALE_INVALID"] ),
                *( [] if continuity else ["FINGER_DIRECTION_DISCONTINUITY"] ),
                *( [] if inside_cloud else ["FINGER_CENTERLINE_OUTSIDE_GEOMETRY"] ),
            ]
            _invalidate(landmarks, names, reasons)
            warnings.append({
                "code": "FINGER_TOPOLOGY_INVALID",
                "side": side,
                "finger": finger,
                "reasons": reasons,
                "segmentLengths": segment_lengths,
                "surfaceDistances": surface_distances,
            })
            valid[finger] = False
        else:
            for name in names:
                landmarks[name]["accepted"] = True
                landmarks[name]["verified"] = True
                landmarks[name]["display"] = True
                landmarks[name]["confidence"] = max(float(landmarks[name].get("confidence", 0.0)), 0.72)
            valid[finger] = True
            finger_lengths[finger] = float(sum(segment_lengths))

    # Validate lateral order of the four forward fingers in the local hand frame.
    ordered_names = [f"{finger}_01_{suffix}" for finger in ("index", "middle", "ring", "pinky")]
    if all(name in landmarks and landmarks[name].get("accepted", False) for name in ordered_names):
        lateral_values = [(_internal(landmarks[name]) - wrist).dot(lateral) for name in ordered_names]
        if not all(lateral_values[index] > lateral_values[index + 1] for index in range(3)):
            for finger in ("index", "middle", "ring", "pinky"):
                _invalidate(landmarks, _chain_names(finger, suffix), ["FINGER_LATERAL_ORDER_INVALID"])
                valid[finger] = False
            warnings.append({"code": "FINGER_LATERAL_ORDER_INVALID", "side": side, "values": lateral_values})

    # Detect crossings in a local palm plane.
    projected_chains = {}
    for finger in FINGERS:
        names = _chain_names(finger, suffix)
        if not valid.get(finger, False):
            continue
        points = [wrist, *[_internal(landmarks[name]) for name in names]]
        projected_chains[finger] = [((point - wrist).dot(lateral), (point - wrist).dot(forward)) for point in points]
    crossed = set()
    for first, second in combinations(projected_chains, 2):
        first_segments = _line_segments(projected_chains[first])[1:]
        second_segments = _line_segments(projected_chains[second])[1:]
        if any(_segments_cross_2d(a, b) for a in first_segments for b in second_segments):
            crossed.update((first, second))
    if crossed:
        for finger in crossed:
            _invalidate(landmarks, _chain_names(finger, suffix), ["FINGER_CHAINS_CROSS"])
            valid[finger] = False
        warnings.append({"code": "FINGER_CHAINS_CROSS", "side": side, "fingers": sorted(crossed)})

    valid_fingers = sum(1 for value in valid.values() if value)
    measurement = {
        **measurement,
        "fingerLengths": finger_lengths,
        "localFrame": {
            "origin": _vec(wrist),
            "forward": _vec(forward),
            "lateral": _vec(lateral),
            "normal": _vec(normal),
        },
    }
    return {
        "status": "valid" if valid_fingers == 5 and not warnings else "needs_review",
        "validFingers": valid_fingers,
        "landmarks": landmarks,
        "measurements": measurement,
        "fingerRegionVertexCounts": {finger: len(clouds.get(finger, [])) for finger in FINGERS},
        "warnings": warnings,
    }
