from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Iterable

import numpy as np

from result_contract import SurfaceLandmark


FACE_REQUIRED_SEMANTICS = {
    "left_eye_outer",
    "right_eye_outer",
    "nose_tip",
    "mouth_left",
    "mouth_right",
    "chin",
}

# MediaPipe contour points immediately around the chin. Stylized avatars often
# project these a few millimetres below the conservative head envelope even
# though they are still on the real facial surface.
LOWER_CHIN_CONTOUR_INDICES = {148, 149, 150, 152, 175, 176, 377, 378, 400}


@dataclass(frozen=True)
class FaceEnvelope:
    center_x: float
    center_y: float
    center_z: float
    radius_x: float
    radius_z: float
    min_x: float
    max_x: float
    min_z: float
    max_z: float
    front_surface_y: float
    back_surface_y: float
    front_cutoff_y: float
    height: float

    def to_dict(self) -> dict:
        return asdict(self)


def _body_position(items: Iterable[SurfaceLandmark], name: str) -> np.ndarray | None:
    for item in items:
        if item.group == "body" and item.name == name:
            return np.asarray(item.canonical_position, dtype=np.float64)
    return None


def build_face_envelope(scene, body_landmarks: list[SurfaceLandmark]) -> FaceEnvelope:
    """Build a conservative front-of-head volume from the real GLB geometry.

    CLOUVA canonical space is Z-up and the avatar faces -Y. The visible facial
    surface is therefore the low-Y side. The lower limit intentionally leaves a
    very small chin allowance while still excluding the neck.
    """
    bounds_min = np.asarray(scene.bounds_min, dtype=np.float64)
    bounds_max = np.asarray(scene.bounds_max, dtype=np.float64)
    size = np.maximum(bounds_max - bounds_min, 1e-6)
    total_height = float(size[2])

    shoulder_points = [
        point for point in (
            _body_position(body_landmarks, "left_shoulder"),
            _body_position(body_landmarks, "right_shoulder"),
        ) if point is not None
    ]
    shoulder_z = float(np.mean([point[2] for point in shoulder_points])) if shoulder_points else float(bounds_min[2] + total_height * 0.72)

    min_z = max(
        shoulder_z + total_height * 0.040,
        float(bounds_max[2] - total_height * 0.238),
    )
    max_z = float(bounds_max[2] + total_height * 0.008)

    vertices = np.asarray(scene.vertices, dtype=np.float64)
    head_vertices = vertices[(vertices[:, 2] >= min_z) & (vertices[:, 2] <= max_z)]
    if len(head_vertices) < 64:
        head_vertices = vertices[vertices[:, 2] >= bounds_min[2] + total_height * 0.75]
    if len(head_vertices) < 16:
        head_vertices = vertices

    low = np.percentile(head_vertices, 1.0, axis=0)
    high = np.percentile(head_vertices, 99.0, axis=0)
    center_x = float((low[0] + high[0]) * 0.5)
    center_y = float((low[1] + high[1]) * 0.5)
    center_z = float((min_z + max_z) * 0.5)
    radius_x = max(float((high[0] - low[0]) * 0.55), total_height * 0.06)
    radius_z = max(float((max_z - min_z) * 0.55), total_height * 0.08)

    front_y = float(low[1])
    back_y = float(high[1])
    depth = max(back_y - front_y, total_height * 0.04)
    front_cutoff = float(front_y + depth * 0.62)

    return FaceEnvelope(
        center_x=center_x,
        center_y=center_y,
        center_z=center_z,
        radius_x=radius_x,
        radius_z=radius_z,
        min_x=float(low[0] - radius_x * 0.08),
        max_x=float(high[0] + radius_x * 0.08),
        min_z=float(min_z),
        max_z=float(max_z),
        front_surface_y=front_y,
        back_surface_y=back_y,
        front_cutoff_y=front_cutoff,
        height=total_height,
    )


def _semantic_zone_reason(item: SurfaceLandmark, envelope: FaceEnvelope) -> str | None:
    """Validate stable semantic anchors with ranges tuned for stylized faces."""
    z = float(item.canonical_position[2])
    relative_z = (z - envelope.min_z) / max(envelope.max_z - envelope.min_z, 1e-6)
    name = item.name

    if "eye" in name or "brow" in name or "iris" in name:
        if not 0.30 <= relative_z <= 0.90:
            return "FACE_FEATURE_ZONE_MISMATCH"
    elif name in {"nose_tip", "nose_bridge"}:
        if not 0.15 <= relative_z <= 0.80:
            return "FACE_FEATURE_ZONE_MISMATCH"
    elif name in {"mouth_left", "mouth_right", "upper_lip", "lower_lip"}:
        if not 0.06 <= relative_z <= 0.58:
            return "FACE_FEATURE_ZONE_MISMATCH"
    elif name == "chin":
        if not -0.06 <= relative_z <= 0.38:
            return "FACE_FEATURE_ZONE_MISMATCH"
    elif name == "forehead":
        if not 0.52 <= relative_z <= 1.02:
            return "FACE_FEATURE_ZONE_MISMATCH"
    return None


def _is_lower_chin_surface(item: SurfaceLandmark, envelope: FaceEnvelope) -> bool:
    x, y, z = map(float, item.canonical_position)
    index = item.detector_index
    if index is None and item.name.startswith("face_"):
        try:
            index = int(item.name.split("_", 1)[1])
        except (TypeError, ValueError):
            index = None
    height = float(getattr(envelope, "height", max(envelope.max_z - envelope.min_z, 1.0)))
    lower_allowance = height * 0.012
    central = abs(x - envelope.center_x) <= envelope.radius_x * 0.60
    front = y <= envelope.front_cutoff_y
    near_chin = envelope.min_z - lower_allowance <= z < envelope.min_z
    return bool(index in LOWER_CHIN_CONTOUR_INDICES and central and front and near_chin)


def validate_face_landmarks(
    face_landmarks: list[SurfaceLandmark],
    envelope: FaceEnvelope,
    raw_landmark_count: int,
) -> tuple[list[SurfaceLandmark], list[SurfaceLandmark], dict]:
    accepted: list[SurfaceLandmark] = []
    rejected: list[SurfaceLandmark] = []
    rejection_counts = {
        "outside_head": 0,
        "on_neck": 0,
        "behind_head": 0,
        "feature_zone": 0,
    }

    for item in face_landmarks:
        position = np.asarray(item.canonical_position, dtype=np.float64)
        x, y, z = map(float, position)
        reason: str | None = None

        if z < envelope.min_z and not (item.name == "chin" or _is_lower_chin_surface(item, envelope)):
            reason = "FACE_PROJECTION_ON_NECK"
            rejection_counts["on_neck"] += 1
        elif z > envelope.max_z or x < envelope.min_x or x > envelope.max_x:
            reason = "FACE_PROJECTION_OUTSIDE_HEAD"
            rejection_counts["outside_head"] += 1
        elif y > envelope.front_cutoff_y:
            reason = "FACE_PROJECTION_BEHIND_HEAD"
            rejection_counts["behind_head"] += 1
        else:
            ellipse = ((x - envelope.center_x) / envelope.radius_x) ** 2 + ((z - envelope.center_z) / envelope.radius_z) ** 2
            # The jaw/chin contour is naturally a little outside the ellipsoid.
            ellipse_limit = 1.72 if (item.name == "chin" or _is_lower_chin_surface(item, envelope)) else 1.50
            if ellipse > ellipse_limit:
                reason = "FACE_PROJECTION_OUTSIDE_HEAD"
                rejection_counts["outside_head"] += 1
            else:
                reason = _semantic_zone_reason(item, envelope)
                if reason:
                    rejection_counts["feature_zone"] += 1

        item.validation = {
            "face_envelope_valid": reason is None,
            "front_cutoff_y": envelope.front_cutoff_y,
            "projected_y": y,
            "surface_locked": True,
        }
        if reason is None:
            item.state = "face_region_valid"
            item.rejection_reason = None
            item.warnings = [warning for warning in item.warnings if not warning.startswith("FACE_")]
            accepted.append(item)
        else:
            item.state = "face_region_rejected"
            item.rejection_reason = reason
            if reason not in item.warnings:
                item.warnings.append(reason)
            rejected.append(item)

    semantic_names = {item.name for item in accepted}
    required_verified = len(FACE_REQUIRED_SEMANTICS & semantic_names)
    critical_rejected = sorted(
        item.name for item in rejected if item.name in FACE_REQUIRED_SEMANTICS
    )
    projected_count = len(face_landmarks)
    validated_count = len(accepted)
    ratio = validated_count / max(projected_count, 1)
    # A dense face can tolerate a very small number of non-semantic rejects,
    # but every required semantic anchor must be valid.
    ready = (
        required_verified == len(FACE_REQUIRED_SEMANTICS)
        and not critical_rejected
        and validated_count >= 180
        and ratio >= 0.55
    )

    metrics = {
        "raw_face_landmarks": int(raw_landmark_count),
        "projected_face_landmarks": int(projected_count),
        "validated_face_landmarks": int(validated_count),
        "rejected_face_landmarks": int(len(rejected)),
        "validated_ratio": float(ratio),
        "required_semantic_verified": int(required_verified),
        "required_semantic_total": int(len(FACE_REQUIRED_SEMANTICS)),
        "critical_semantic_rejected": critical_rejected,
        "rejection_by_region": int(rejection_counts["outside_head"] + rejection_counts["on_neck"]),
        "rejection_by_distance": int(rejection_counts["feature_zone"]),
        "rejection_behind_head": int(rejection_counts["behind_head"]),
        "rejection_details": rejection_counts,
        "face_landmarks_ready": bool(ready),
    }
    return accepted, rejected, metrics
