from __future__ import annotations

import numpy as np

from canonical_space import CanonicalTransform


MIN_LATERAL_ALIGNMENT = 0.52
LOWER_LOBE_MIN_FRACTION = 0.25
LOWER_LOBE_TARGET_FRACTION = 0.28
LOWER_LOBE_MAX_FRACTION = 0.35
MIN_INTERIOR_WEIGHT = 0.10
# Compatibilidad con pruebas v0.7; el algoritmo v0.7.2 calcula pesos reales por triángulo.
INTERIOR_BARYCENTRIC = np.array([1.0 / 3.0, 1.0 / 3.0, 1.0 / 3.0], dtype=np.float64)


def _canonical_to_source(position: np.ndarray, transform: CanonicalTransform) -> list[float]:
    point = np.ones(4, dtype=np.float64)
    point[:3] = np.asarray(position, dtype=np.float64)
    source = transform.canonical_to_source @ point
    return source[:3].astype(float).tolist()


def _normal_to_source(normal: np.ndarray, transform: CanonicalTransform) -> list[float]:
    matrix = np.asarray(transform.canonical_to_source[:3, :3], dtype=np.float64)
    value = matrix @ np.asarray(normal, dtype=np.float64)
    length = float(np.linalg.norm(value))
    if length > 1e-9:
        value /= length
    return value.astype(float).tolist()


def _envelope_values(scene, envelope) -> dict:
    arrays = [
        np.asarray(record.vertices_canonical, dtype=np.float64)
        for record in scene.records.values()
    ]
    if arrays:
        vertices = np.concatenate(arrays, axis=0)
    else:
        cx = float(getattr(envelope, "center_x", 0.0))
        cy = float(getattr(envelope, "center_y", 0.0))
        cz = float(getattr(envelope, "center_z", 0.0))
        rx = float(getattr(envelope, "radius_x", 0.1))
        min_z = float(getattr(envelope, "min_z", cz - 0.1))
        max_z = float(getattr(envelope, "max_z", cz + 0.1))
        front_y = float(getattr(envelope, "front_surface_y", cy - 0.1))
        back_y = float(getattr(envelope, "back_surface_y", cy + 0.1))
        vertices = np.array(
            [[cx - rx, front_y, min_z], [cx + rx, back_y, max_z]],
            dtype=np.float64,
        )

    center_x = float(getattr(envelope, "center_x", (vertices[:, 0].min() + vertices[:, 0].max()) * 0.5))
    center_y = float(getattr(envelope, "center_y", (vertices[:, 1].min() + vertices[:, 1].max()) * 0.5))
    center_z = float(getattr(envelope, "center_z", (vertices[:, 2].min() + vertices[:, 2].max()) * 0.5))
    height = float(getattr(envelope, "height", max(np.ptp(vertices[:, 2]), 1.0)))
    radius_x = float(getattr(envelope, "radius_x", max(np.max(np.abs(vertices[:, 0] - center_x)), height * 0.06)))
    min_z = float(getattr(envelope, "min_z", vertices[:, 2].min()))
    max_z = float(getattr(envelope, "max_z", vertices[:, 2].max()))
    front_y = float(getattr(envelope, "front_surface_y", vertices[:, 1].min()))
    back_y = float(getattr(envelope, "back_surface_y", vertices[:, 1].max()))
    head_span = max(max_z - min_z, height * 0.12)
    target_z = min_z + head_span * LOWER_LOBE_TARGET_FRACTION
    max_vertical_error = max(height * 0.0085, head_span * 0.045, 0.012)
    max_pair_height_delta = max(height * 0.0065, head_span * 0.035, 0.010)
    return {
        "center_x": center_x,
        "center_y": center_y,
        "center_z": center_z,
        "height": height,
        "radius_x": radius_x,
        "min_z": min_z,
        "max_z": max_z,
        "front_y": front_y,
        "back_y": back_y,
        "head_span": head_span,
        "target_z": target_z,
        "max_vertical_error": max_vertical_error,
        "max_pair_height_delta": max_pair_height_delta,
    }


def _closest_interior_barycentric(triangle: np.ndarray, target: np.ndarray) -> np.ndarray:
    """Project target to a triangle and keep the attachment safely inside it."""
    a, b, c = np.asarray(triangle, dtype=np.float64)
    v0 = b - a
    v1 = c - a
    v2 = np.asarray(target, dtype=np.float64) - a
    d00 = float(np.dot(v0, v0))
    d01 = float(np.dot(v0, v1))
    d11 = float(np.dot(v1, v1))
    d20 = float(np.dot(v2, v0))
    d21 = float(np.dot(v2, v1))
    denom = d00 * d11 - d01 * d01
    if abs(denom) < 1e-12:
        return np.array([1 / 3, 1 / 3, 1 / 3], dtype=np.float64)
    v = (d11 * d20 - d01 * d21) / denom
    w = (d00 * d21 - d01 * d20) / denom
    u = 1.0 - v - w
    bary = np.array([u, v, w], dtype=np.float64)
    positive = np.maximum(bary, 0.0)
    total = float(np.sum(positive))
    if total <= 1e-12:
        positive = np.array([1 / 3, 1 / 3, 1 / 3], dtype=np.float64)
    else:
        positive /= total
    # Affine map into the interior simplex: every weight stays >= MIN_INTERIOR_WEIGHT.
    remaining = 1.0 - 3.0 * MIN_INTERIOR_WEIGHT
    bary = MIN_INTERIOR_WEIGHT + remaining * positive
    return bary


def _candidate_geometry(record, values: dict, side: str) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Return only lateral triangles inside the hard lower-lobe band."""
    sign = -1.0 if side == "left" else 1.0
    triangles = np.asarray(record.vertices_canonical[record.faces], dtype=np.float64)
    centroids = triangles.mean(axis=1)
    edges_a = triangles[:, 1] - triangles[:, 0]
    edges_b = triangles[:, 2] - triangles[:, 0]
    normals = np.cross(edges_a, edges_b)
    lengths = np.linalg.norm(normals, axis=1)
    safe = lengths > 1e-12
    normals[safe] /= lengths[safe, None]

    head_center = np.array([values["center_x"], values["center_y"], values["center_z"]], dtype=np.float64)
    outward = centroids - head_center[None, :]
    flip = np.einsum("ij,ij->i", normals, outward) < 0
    normals[flip] *= -1.0

    depth = max(values["back_y"] - values["front_y"], values["height"] * 0.04)
    x_side = (centroids[:, 0] - values["center_x"]) * sign
    lateral_alignment = normals[:, 0] * sign
    z_low = values["min_z"] + values["head_span"] * LOWER_LOBE_MIN_FRACTION
    z_high = values["min_z"] + values["head_span"] * LOWER_LOBE_MAX_FRACTION

    mask = (
        safe
        & (x_side >= values["radius_x"] * 0.72)
        & (x_side <= values["radius_x"] * 1.14)
        & (centroids[:, 2] >= z_low)
        & (centroids[:, 2] <= z_high)
        & (np.abs(centroids[:, 2] - values["target_z"]) <= values["max_vertical_error"])
        & (centroids[:, 1] >= values["front_y"] + depth * 0.28)
        & (centroids[:, 1] <= values["front_y"] + depth * 0.82)
        & (lateral_alignment >= MIN_LATERAL_ALIGNMENT)
        & (np.abs(normals[:, 2]) <= 0.72)
    )
    return triangles, centroids, normals, mask


def _find_lobe_surface(scene, envelope, side: str) -> dict:
    values = _envelope_values(scene, envelope)
    sign = -1.0 if side == "left" else 1.0
    depth = max(values["back_y"] - values["front_y"], values["height"] * 0.04)
    target = np.array(
        [
            values["center_x"] + sign * values["radius_x"] * 0.95,
            values["front_y"] + depth * 0.60,
            values["target_z"],
        ],
        dtype=np.float64,
    )

    best: dict | None = None
    for geometry_id, record in scene.records.items():
        triangles, centroids, normals, mask = _candidate_geometry(record, values, side)
        indices = np.flatnonzero(mask)
        if len(indices) == 0:
            continue

        candidate_centroids = centroids[indices]
        candidate_normals = normals[indices]
        lateral = candidate_normals[:, 0] * sign
        coarse_score = (
            np.abs(candidate_centroids[:, 2] - target[2]) / max(values["max_vertical_error"], 1e-6) * 6.0
            + np.abs(candidate_centroids[:, 0] - target[0]) / max(values["radius_x"], 1e-6) * 0.8
            + np.abs(candidate_centroids[:, 1] - target[1]) / max(depth, 1e-6) * 0.7
            + (1.0 - lateral) * 2.2
            + np.abs(candidate_normals[:, 2]) * 0.45
        )
        shortlist_count = min(96, len(indices))
        shortlist = np.argpartition(coarse_score, shortlist_count - 1)[:shortlist_count]
        for local in shortlist:
            triangle_id = int(indices[int(local)])
            triangle = triangles[triangle_id]
            normal = normals[triangle_id]
            barycentric = _closest_interior_barycentric(triangle, target)
            point = barycentric @ triangle
            vertical_error = abs(float(point[2] - target[2]))
            lower_fraction = float((point[2] - values["min_z"]) / max(values["head_span"], 1e-9))
            lateral_alignment = float(normal[0] * sign)
            score = (
                vertical_error / max(values["max_vertical_error"], 1e-6) * 8.0
                + abs(float(point[0] - target[0])) / max(values["radius_x"], 1e-6) * 0.8
                + abs(float(point[1] - target[1])) / max(depth, 1e-6) * 0.7
                + (1.0 - lateral_alignment) * 2.2
                + abs(float(normal[2])) * 0.45
            )
            details = scene.triangle_details(int(geometry_id), triangle_id)
            candidate = {
                "score": float(score),
                "geometry_id": int(geometry_id),
                "mesh_id": details["mesh_id"],
                "primitive_id": int(details["primitive_id"]),
                "triangle_id": triangle_id,
                "source_vertex_indices": details["source_vertex_indices"],
                "barycentric": barycentric.astype(float).tolist(),
                "canonical_position": point.astype(float).tolist(),
                "surface_normal": normal.astype(float).tolist(),
                "target": target.astype(float).tolist(),
                "candidate_count": int(len(indices)),
                "lateral_alignment": lateral_alignment,
                "vertical_error_m": vertical_error,
                "lower_zone_fraction": lower_fraction,
                "max_vertical_error_m": float(values["max_vertical_error"]),
            }
            if best is None or candidate["score"] < best["score"]:
                best = candidate

    if best is None:
        raise RuntimeError(f"EARLOBE_LOWER_ZONE_NOT_FOUND:{side}")
    return best


def _validate_pair(scene, anchors: list[dict], envelope) -> list[dict]:
    warnings: list[dict] = []
    if len(anchors) != 2:
        return [{"code": "EARLOBE_PAIR_INCOMPLETE", "count": len(anchors)}]
    by_side = {item["side"]: item for item in anchors}
    if set(by_side) != {"left", "right"}:
        return [{"code": "EARLOBE_PAIR_INVALID_SIDES"}]

    values = _envelope_values(scene, envelope)
    left = np.asarray(by_side["left"]["canonical_position"], dtype=np.float64)
    right = np.asarray(by_side["right"]["canonical_position"], dtype=np.float64)
    height = float(values["height"])
    center_x = float(values["center_x"])
    left_radius = abs(float(left[0] - center_x))
    right_radius = abs(float(right[0] - center_x))
    pair_height_delta = abs(float(left[2] - right[2]))

    if not (left[0] < center_x < right[0]):
        warnings.append({"code": "EARLOBE_LEFT_RIGHT_INVALID"})
    if pair_height_delta > values["max_pair_height_delta"]:
        warnings.append({
            "code": "EARLOBE_HEIGHT_ASYMMETRY",
            "difference": pair_height_delta,
            "maximum": float(values["max_pair_height_delta"]),
        })
    if abs(left_radius - right_radius) > height * 0.020:
        warnings.append({"code": "EARLOBE_WIDTH_ASYMMETRY", "difference": float(abs(left_radius - right_radius))})
    if abs(left[1] - right[1]) > height * 0.022:
        warnings.append({"code": "EARLOBE_DEPTH_ASYMMETRY", "difference": float(abs(left[1] - right[1]))})

    for side, anchor in by_side.items():
        point = np.asarray(anchor["canonical_position"], dtype=np.float64)
        validation = anchor.setdefault("validation", {})
        vertical_error = abs(float(point[2] - values["target_z"]))
        lower_fraction = float((point[2] - values["min_z"]) / max(values["head_span"], 1e-9))
        vertical_lock = (
            LOWER_LOBE_MIN_FRACTION <= lower_fraction <= LOWER_LOBE_MAX_FRACTION
            and vertical_error <= values["max_vertical_error"]
        )
        validation.update({
            "target_z": float(values["target_z"]),
            "vertical_error_m": vertical_error,
            "maximum_vertical_error_m": float(values["max_vertical_error"]),
            "lower_zone_fraction": lower_fraction,
            "lower_zone_min_fraction": LOWER_LOBE_MIN_FRACTION,
            "lower_zone_max_fraction": LOWER_LOBE_MAX_FRACTION,
            "vertical_lock": bool(vertical_lock),
            "pair_height_delta_m": pair_height_delta,
            "maximum_pair_height_delta_m": float(values["max_pair_height_delta"]),
            "pair_height_valid": bool(pair_height_delta <= values["max_pair_height_delta"]),
        })
        if not vertical_lock:
            warnings.append({
                "code": "EARLOBE_VERTICAL_LOCK_FAILED",
                "side": side,
                "z": float(point[2]),
                "target_z": float(values["target_z"]),
                "vertical_error_m": vertical_error,
                "lower_zone_fraction": lower_fraction,
            })
        alignment = float(validation.get("lateral_alignment", 0.0))
        if alignment < MIN_LATERAL_ALIGNMENT:
            warnings.append({"code": "EARLOBE_NORMAL_NOT_LATERAL", "side": side, "alignment": alignment})
        bary = np.asarray(anchor.get("barycentric", []), dtype=np.float64)
        if bary.shape != (3,) or np.min(bary) < MIN_INTERIOR_WEIGHT - 1e-6 or abs(float(np.sum(bary)) - 1.0) > 1e-4:
            warnings.append({"code": "EARLOBE_BARYCENTRIC_UNSTABLE", "side": side})
    return warnings


def build_earlobe_anchors(scene, body_landmarks, transform: CanonicalTransform, face_envelope) -> tuple[list[dict], list[dict]]:
    """Build two tiny pins from the strict lower-central lobe zone."""
    anchors: list[dict] = []
    warnings: list[dict] = []

    for side in ("left", "right"):
        sign = -1.0 if side == "left" else 1.0
        try:
            hit = _find_lobe_surface(scene, face_envelope, side)
        except RuntimeError as error:
            warnings.append({"code": "EARLOBE_ANCHOR_NOT_FOUND", "side": side, "detail": str(error)})
            continue

        normal = np.asarray(hit["surface_normal"], dtype=np.float64)
        hang = np.array([sign * 0.10, 0.0, -1.0], dtype=np.float64)
        hang /= max(float(np.linalg.norm(hang)), 1e-9)
        canonical_position = np.asarray(hit["canonical_position"], dtype=np.float64)
        anchors.append({
            "name": f"{side}_earlobe_anchor",
            "group": "anchor",
            "category": "earring_pin",
            "side": side,
            "state": "surface_anchor_candidate",
            "confidence": float(max(0.55, min(0.98, 1.0 - hit["score"] * 0.08))),
            "geometry_id": hit["geometry_id"],
            "mesh_id": hit["mesh_id"],
            "primitive_id": hit["primitive_id"],
            "triangle_id": hit["triangle_id"],
            "source_vertex_indices": hit["source_vertex_indices"],
            "barycentric": hit["barycentric"],
            "canonical_position": hit["canonical_position"],
            "source_position": _canonical_to_source(canonical_position, transform),
            "surface_normal": hit["surface_normal"],
            "source_surface_normal": _normal_to_source(normal, transform),
            "attachment_direction": hang.astype(float).tolist(),
            "source_attachment_direction": _normal_to_source(hang, transform),
            "offset_meters_normalized": 0.0,
            "source_landmark": "geometry_lower_central_ear_triangle",
            "target_position": hit["target"],
            "validation": {
                "surface_locked": True,
                "triangle_interior": True,
                "pair_valid": False,
                "lateral_alignment": hit["lateral_alignment"],
                "candidate_count": hit["candidate_count"],
                "vertical_error_m": hit["vertical_error_m"],
                "maximum_vertical_error_m": hit["max_vertical_error_m"],
                "lower_zone_fraction": hit["lower_zone_fraction"],
                "vertical_lock": False,
                "pair_height_valid": False,
            },
            "warnings": [],
        })

    pair_warnings = _validate_pair(scene, anchors, face_envelope)
    if pair_warnings:
        warnings.extend(pair_warnings)
        for anchor in anchors:
            anchor["state"] = "surface_anchor_review"
            anchor["validation"]["pair_valid"] = False
            anchor["warnings"].extend(item["code"] for item in pair_warnings)
    else:
        for anchor in anchors:
            anchor["state"] = "surface_anchor_ready"
            anchor["validation"]["pair_valid"] = True
    return anchors, warnings
