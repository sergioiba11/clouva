from __future__ import annotations

import hashlib
import json
import shutil
import traceback
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from camera_rig import body_cameras, crop_camera
from canonical_space import build_canonical_transform
from finger_topology import summarize_fingers
from face_validation import build_face_envelope, validate_face_landmarks
from ear_anchors import build_earlobe_anchors
from body_measurements import calculate_body_measurements
from measurement_quality import apply_measurement_quality_v086
from garment_anchors import build_garment_anchors

LEGACY_V07_VERSION = "clouva-anatomy-lab-v0.7-lobe-pins-clean-face"
from glb_loader import load_glb
from landmark_projector import project_candidates
from mediapipe_detectors import MediaPipeDetectors
from multiview_fusion import fuse_landmarks
from raycast_scene import AnatomyRaycastScene
from technical_renderer import render_view

BASE = Path(__file__).resolve().parent.parent
OUTPUT = BASE / "output"
MODELS = Path(__file__).resolve().parent / "models"

def _write(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")

def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


BODY_LR_PAIRS = [
    ("left_eye_inner", "right_eye_inner"),
    ("left_eye", "right_eye"),
    ("left_eye_outer", "right_eye_outer"),
    ("left_ear", "right_ear"),
    ("mouth_left", "mouth_right"),
    ("left_shoulder", "right_shoulder"),
    ("left_elbow", "right_elbow"),
    ("left_wrist", "right_wrist"),
    ("left_pinky", "right_pinky"),
    ("left_index", "right_index"),
    ("left_thumb", "right_thumb"),
    ("left_hip", "right_hip"),
    ("left_knee", "right_knee"),
    ("left_ankle", "right_ankle"),
    ("left_heel", "right_heel"),
    ("left_foot_index", "right_foot_index"),
]


# MediaPipe Pose face points are useful for camera framing only.  The real face
# map comes from Face Landmarker.  Keeping crossed pose-eye points in the final
# anatomy map produced duplicated and misleading markers.
POSE_FACE_DIAGNOSTIC_NAMES = {
    "nose", "left_eye_inner", "left_eye", "left_eye_outer",
    "right_eye_inner", "right_eye", "right_eye_outer",
    "left_ear", "right_ear", "mouth_left", "mouth_right",
}


def _canonical_to_source(position: np.ndarray, canonical) -> list[float]:
    point = np.ones(4, dtype=np.float64)
    point[:3] = np.asarray(position, dtype=np.float64)
    source = canonical.canonical_to_source @ point
    return source[:3].astype(float).tolist()


def _normalize_pose_left_right(projected: list, center_x: float) -> list:
    """Normaliza pares izquierda/derecha después de proyectar cada vista.

    Los detectores visuales pueden invertir handedness en vistas traseras o
    diagonales. CLOUVA usa X canónico: izquierda < centro y derecha > centro.
    """
    by_name = {item.name: item for item in projected if item.group == "body"}
    for left_name, right_name in BODY_LR_PAIRS:
        left = by_name.get(left_name)
        right = by_name.get(right_name)
        if left is None or right is None:
            continue
        lx = float(left.canonical_position[0])
        rx = float(right.canonical_position[0])
        if lx > rx:
            left.name, right.name = right.name, left.name
    # Marca observaciones claramente cruzadas para que no dominen la fusión.
    for item in projected:
        if item.group != "body":
            continue
        x = float(item.canonical_position[0])
        if item.name.startswith("left_") and x > center_x:
            item.confidence *= 0.35
            item.warnings.append("LEFT_RIGHT_CROSSOVER")
        elif item.name.startswith("right_") and x < center_x:
            item.confidence *= 0.35
            item.warnings.append("LEFT_RIGHT_CROSSOVER")
    return projected


def _repair_fused_left_right(items: list, center_x: float) -> list:
    """Repair final left/right naming after multiview fusion.

    Pose is useful for body framing but its face-side labels are unstable on
    stylized heads. Paired landmarks are ordered by canonical X and impossible
    single-side observations are marked diagnostic rather than trusted.
    """
    by_name = {item.name: item for item in items if item.group == "body"}
    for left_name, right_name in BODY_LR_PAIRS:
        left = by_name.get(left_name)
        right = by_name.get(right_name)
        if left is None or right is None:
            continue
        if float(left.canonical_position[0]) > float(right.canonical_position[0]):
            left.name, right.name = right.name, left.name
            by_name[left_name], by_name[right_name] = right, left

    for item in items:
        if item.group != "body":
            continue
        x = float(item.canonical_position[0])
        crossed = (item.name.startswith("left_") and x > center_x) or (
            item.name.startswith("right_") and x < center_x
        )
        if crossed:
            if "LEFT_RIGHT_CROSSOVER" not in item.warnings:
                item.warnings.append("LEFT_RIGHT_CROSSOVER")
            item.confidence = min(float(item.confidence), 0.35)
        else:
            item.warnings = [warning for warning in item.warnings if warning != "LEFT_RIGHT_CROSSOVER"]
    return sorted(items, key=lambda item: (item.group, item.side or "", item.name))


def _estimate_hand_focus(ray_scene, fused_body: list, side: str) -> tuple[np.ndarray, float]:
    """Encuentra la mano usando la geometría exterior, no solo el wrist de Pose."""
    bounds_min = ray_scene.bounds_min.astype(np.float64)
    bounds_max = ray_scene.bounds_max.astype(np.float64)
    size = bounds_max - bounds_min
    center_x = float((bounds_min[0] + bounds_max[0]) * 0.5)
    names = [f"{side}_wrist", f"{side}_index", f"{side}_pinky", f"{side}_thumb"]
    pose_points = [np.asarray(item.canonical_position, dtype=np.float64)
                   for item in fused_body if item.name in names]
    z_hint = float(np.median([point[2] for point in pose_points])) if pose_points else float(bounds_min[2] + size[2] * 0.47)

    vertices = ray_scene.vertices.astype(np.float64)
    side_mask = vertices[:, 0] <= bounds_min[0] + size[0] * 0.30 if side == "left"         else vertices[:, 0] >= bounds_max[0] - size[0] * 0.30
    z_half = max(float(size[2] * 0.13), 0.14)
    band_mask = np.abs(vertices[:, 2] - z_hint) <= z_half
    candidates = vertices[side_mask & band_mask]

    if len(candidates) >= 20:
        low = np.percentile(candidates, 2, axis=0)
        high = np.percentile(candidates, 98, axis=0)
        center = (low + high) * 0.5
        extent = high - low
        focus_size = max(float(np.max(extent) * 1.55), float(size[0] * 0.18), 0.18)
    else:
        x = bounds_min[0] + size[0] * 0.06 if side == "left" else bounds_max[0] - size[0] * 0.06
        center = np.array([x, (bounds_min[1] + bounds_max[1]) * 0.5, z_hint], dtype=np.float64)
        focus_size = max(float(size[0] * 0.24), 0.20)

    # Evita que un wrist mal detectado lleve la cámara hacia el torso.
    if side == "left":
        center[0] = min(center[0], center_x - size[0] * 0.22)
    else:
        center[0] = max(center[0], center_x + size[0] * 0.22)
    return center, focus_size


def _derive_internal_joints(
    landmarks: list[dict],
    canonical,
    face_envelope=None,
    body_center: tuple[float, float] | None = None,
) -> list[dict]:
    by_name = {item["name"]: item for item in landmarks if item.get("group") == "body"}
    definitions = {
        "neck": ["left_shoulder", "right_shoulder"],
        "chest": ["left_shoulder", "right_shoulder", "left_hip", "right_hip"],
        "pelvis": ["left_hip", "right_hip"],
        "left_shoulder": ["left_shoulder"],
        "right_shoulder": ["right_shoulder"],
        "left_elbow": ["left_elbow"],
        "right_elbow": ["right_elbow"],
        "left_wrist": ["left_wrist"],
        "right_wrist": ["right_wrist"],
        "left_hip": ["left_hip"],
        "right_hip": ["right_hip"],
        "left_knee": ["left_knee"],
        "right_knee": ["right_knee"],
        "left_ankle": ["left_ankle"],
        "right_ankle": ["right_ankle"],
    }
    center_x = float(body_center[0]) if body_center else 0.0
    center_y = float(body_center[1]) if body_center else 0.0
    joints = []

    if face_envelope is not None:
        head_position = np.array([
            float(face_envelope.center_x),
            float(face_envelope.center_y),
            float(face_envelope.center_z),
        ], dtype=float)
        joints.append({
            "name": "head",
            "landmark_type": "internal_joint",
            "canonical_position": head_position.tolist(),
            "source_position": _canonical_to_source(head_position, canonical),
            "confidence": 0.95,
            "method": "geometry_head_envelope_center",
            "source_landmarks": ["face_envelope"],
        })

    for name, sources in definitions.items():
        points = [by_name[source]["canonical_position"] for source in sources if source in by_name]
        if not points:
            continue
        position = np.mean(points, axis=0)
        if name == "chest" and all(source in by_name for source in sources):
            shoulder = np.mean([by_name["left_shoulder"]["canonical_position"], by_name["right_shoulder"]["canonical_position"]], axis=0)
            hip = np.mean([by_name["left_hip"]["canonical_position"], by_name["right_hip"]["canonical_position"]], axis=0)
            position = shoulder * 0.62 + hip * 0.38
        if name in {"neck", "chest", "pelvis"}:
            position = np.asarray(position, dtype=float)
            position[0] = center_x
            if body_center is not None:
                position[1] = center_y
        canonical_position = np.asarray(position, dtype=float)
        joints.append({
            "name": name,
            "landmark_type": "internal_joint",
            "canonical_position": canonical_position.tolist(),
            "source_position": _canonical_to_source(canonical_position, canonical),
            "confidence": float(np.mean([by_name[source]["confidence"] for source in sources if source in by_name])),
            "method": "centerline_geometry_estimate" if name in {"neck", "chest", "pelvis"} else "surface_landmark_center_estimate",
            "source_landmarks": [source for source in sources if source in by_name],
        })
    return joints

@dataclass
class RunState:
    run_id: str
    status: str = "queued"
    phase: str = "queued"
    progress: int = 0
    message: str = "En cola"
    error: str | None = None
    result: dict | None = None
    events: list[dict] = field(default_factory=list)
    cancel_requested: bool = False

    def publish(self, phase: str, progress: int, message: str) -> None:
        self.status = "running" if progress < 100 else "completed"
        self.phase = phase
        self.progress = progress
        self.message = message
        self.events.append({"phase": phase, "progress": progress, "message": message})

class Analyzer:
    def __init__(self, state: RunState, source: Path, height_cm: float = 180.0):
        self.state = state
        self.source = source
        self.run_dir = OUTPUT / state.run_id
        self.render_dir = self.run_dir / "renders"
        self.height_cm = float(height_cm)

    def check_cancel(self):
        if self.state.cancel_requested:
            raise RuntimeError("JOB_CANCELLED")

    def run(self) -> dict:
        self.run_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(self.source, self.run_dir / "source.glb")
        self.state.publish("loading_glb", 5, "Cargando GLB")
        loaded = load_glb(self.source)
        source_info = {**loaded.metadata, "sha256": _sha256(self.source), "filename": self.source.name}
        _write(self.run_dir / "source_info.json", source_info)
        self.check_cancel()

        self.state.publish("normalizing", 12, "Normalizando avatar")
        canonical = build_canonical_transform(loaded)
        _write(self.run_dir / "canonical_space.json", canonical.to_dict())
        ray_scene = AnatomyRaycastScene(loaded, canonical)
        self.check_cancel()

        self.state.publish("rendering_body", 22, "Generando vistas del cuerpo")
        cameras = body_cameras(ray_scene.bounds_min, ray_scene.bounds_max, resolution=512)
        rendered = {camera.name: render_view(ray_scene, camera, self.render_dir) for camera in cameras}
        self.check_cancel()

        detectors = MediaPipeDetectors(MODELS)
        observations = []
        warnings = []
        try:
            self.state.publish("detecting_body", 36, "Analizando cuerpo")
            center_x = float((ray_scene.bounds_min[0] + ray_scene.bounds_max[0]) * 0.5)
            for name in ("front", "back", "front_left", "front_right"):
                view = rendered[name]
                candidates = detectors.detect_pose(view["paths"]["detector"])
                if not candidates:
                    candidates = detectors.detect_pose(view["paths"]["neutral"])
                if not candidates:
                    candidates = detectors.detect_pose(view["paths"]["grayscale"])
                projected = project_candidates(candidates, name, view["camera"], view["buffers"], ray_scene, canonical, radius=5)
                observations.extend(_normalize_pose_left_right(projected, center_x))
            fused_body = _repair_fused_left_right(fuse_landmarks(observations), center_x)

            head_points = [item for item in fused_body if item.name in {"nose", "left_eye", "right_eye", "left_ear", "right_ear"}]
            if head_points:
                center = np.mean([item.canonical_position for item in head_points], axis=0)
            else:
                center = np.array([
                    (ray_scene.bounds_min[0] + ray_scene.bounds_max[0]) / 2,
                    (ray_scene.bounds_min[1] + ray_scene.bounds_max[1]) / 2,
                    ray_scene.bounds_min[2] + (ray_scene.bounds_max[2] - ray_scene.bounds_min[2]) * 0.88,
                ])
            full_size = ray_scene.bounds_max - ray_scene.bounds_min
            # canonical front is -Y: the camera must sit on the -Y side and
            # cast rays toward +Y. In the legacy body rig those are the views
            # named back/back_left/back_right. v8 used the opposite side,
            # which projected the face mesh onto the rear skull and neck.
            face_camera_bases = {
                "face_front": "back",
                "face_left_45": "back_left",
                "face_right_45": "back_right",
            }
            self.state.publish("detecting_face", 51, "Analizando cara desde el frente real")
            face_observations = []
            raw_face_landmark_count = 0
            face_detected_views = 0
            for face_name, base_name in face_camera_bases.items():
                face_camera = crop_camera(
                    rendered[base_name]["camera"], face_name, center,
                    max(full_size[0] * 0.34, 0.13), max(full_size[2] * 0.27, 0.16), 640
                )
                face_view = render_view(ray_scene, face_camera, self.render_dir)
                face_candidates = []
                for variant in ("detector", "neutral", "grayscale", "inverted"):
                    face_candidates = detectors.detect_face(face_view["paths"][variant])
                    if face_candidates:
                        break
                raw_face_landmark_count = max(raw_face_landmark_count, len(face_candidates))
                if not face_candidates:
                    continue
                face_detected_views += 1
                face_observations.extend(project_candidates(
                    face_candidates, face_name, face_camera, face_view["buffers"], ray_scene, canonical, radius=6
                ))
            if face_detected_views == 0:
                warnings.append({"code": "FACE_NOT_DETECTED", "views_attempted": list(face_camera_bases)})

            self.state.publish("detecting_hands", 64, "Analizando manos y dedos desde varios ángulos")
            hand_observations = []
            hand_view_bases = {
                "left": ("front", "back", "left", "front_left"),
                "right": ("front", "back", "right", "front_right"),
            }
            for side in ("left", "right"):
                center_hand, focus_size = _estimate_hand_focus(ray_scene, fused_body, side)
                detected_views = 0
                projected_views = 0
                for base_name in hand_view_bases[side]:
                    base = rendered[base_name]["camera"]
                    hand_camera = crop_camera(
                        base,
                        f"{side}_hand_{base_name}",
                        center_hand,
                        focus_size,
                        focus_size,
                        768,
                    )
                    hand_view = render_view(ray_scene, hand_camera, self.render_dir)
                    candidates = []
                    for variant in ("detector", "neutral", "grayscale", "inverted"):
                        candidates = detectors.detect_hands(hand_view["paths"][variant])
                        if candidates:
                            break
                    if not candidates:
                        continue
                    detected_views += 1
                    # El recorte contiene una sola mano: no descartarla por una
                    # etiqueta de handedness invertida por la cámara o el render.
                    for item in candidates:
                        item["detector_side"] = item.get("side")
                        item["side"] = side
                    projected = project_candidates(
                        candidates,
                        hand_camera.name,
                        hand_camera,
                        hand_view["buffers"],
                        ray_scene,
                        canonical,
                        radius=10,
                    )
                    if projected:
                        projected_views += 1
                        hand_observations.extend(projected)
                if detected_views == 0:
                    warnings.append({
                        "code": "HAND_NOT_DETECTED",
                        "side": side,
                        "views_attempted": list(hand_view_bases[side]),
                        "focus_center": center_hand.astype(float).tolist(),
                        "focus_size": float(focus_size),
                    })
                elif projected_views == 0:
                    warnings.append({
                        "code": "HAND_DETECTED_BUT_NOT_PROJECTED",
                        "side": side,
                        "detected_views": detected_views,
                    })

            self.state.publish("fusing_views", 76, "Combinando vistas y validando cara")
            fused_hands = fuse_landmarks(hand_observations)
            pose_face_diagnostics = [item for item in fused_body if item.name in POSE_FACE_DIAGNOSTIC_NAMES]
            production_body = [item for item in fused_body if item.name not in POSE_FACE_DIAGNOSTIC_NAMES]
            fused_body_hands = sorted(
                [*production_body, *fused_hands],
                key=lambda item: (item.group, item.side or "", item.name),
            )
            fused_face = fuse_landmarks(face_observations)
            face_envelope = build_face_envelope(ray_scene, fused_body)
            valid_face, rejected_face, face_metrics = validate_face_landmarks(
                fused_face, face_envelope, raw_face_landmark_count
            )
            if rejected_face:
                warnings.append({
                    "code": "FACE_LANDMARKS_REJECTED",
                    "count": len(rejected_face),
                    "details": face_metrics["rejection_details"],
                })
            earlobe_anchors, anchor_warnings = build_earlobe_anchors(
                ray_scene, fused_body, canonical, face_envelope
            )
            warnings.extend(anchor_warnings)
            all_fused = sorted(
                [*fused_body_hands, *valid_face],
                key=lambda item: (item.group, item.side or "", item.name),
            )
            landmarks = [item.to_dict() for item in all_fused]
            rejected_face_landmarks = [item.to_dict() for item in rejected_face]
            finger_summary = summarize_fingers(landmarks)
            body_center = (
                float((ray_scene.bounds_min[0] + ray_scene.bounds_max[0]) * 0.5),
                float((ray_scene.bounds_min[1] + ray_scene.bounds_max[1]) * 0.5),
            )
            internal_joints = _derive_internal_joints(
                landmarks, canonical, face_envelope=face_envelope, body_center=body_center
            )
            self.state.publish("extracting_measurements", 84, "Calculando medidas y contornos reales")
            body_measurements = calculate_body_measurements(
                ray_scene, landmarks, internal_joints, face_envelope, self.height_cm
            )
            body_measurements = apply_measurement_quality_v086(
                ray_scene, landmarks, body_measurements, self.height_cm
            )
            for measurement_warning in body_measurements.get("warnings", []):
                warnings.append({"code": "MEASUREMENT_QUALITY", "detail": measurement_warning})
            self.state.publish("building_garment_anchors", 91, "Creando puntos de confección")
            garment_anchors, garment_warnings = build_garment_anchors(
                ray_scene, canonical, landmarks, body_measurements
            )
            warnings.extend(garment_warnings)
            self.state.publish("building_result", 95, "Guardando perfil anatómico para moldes")

            result = {
                "version": "clouva-anatomy-lab-v0.8.6-torso-ratio-chest-validation",
                "run_id": self.state.run_id,
                "source": source_info,
                "canonical_space": canonical.to_dict(),
                "landmarks": landmarks,
                "rejected_face_landmarks": rejected_face_landmarks,
                "accessory_anchors": {
                    "earrings": earlobe_anchors,
                },
                "face_validation": {
                    "envelope": face_envelope.to_dict(),
                    "metrics": face_metrics,
                },
                "internal_joints": internal_joints,
                "body_measurements": body_measurements,
                "garment_anchors": garment_anchors,
                "finger_topology": finger_summary,
                "warnings": warnings,
                "diagnostics": {
                    "pose_face_landmarks": [item.to_dict() for item in pose_face_diagnostics],
                },
                "quality": {
                    "left_right_crossovers": [
                        item["name"] for item in landmarks
                        if "LEFT_RIGHT_CROSSOVER" in item.get("warnings", [])
                    ],
                    "pose_face_crossovers_removed_from_production": [
                        item.name for item in pose_face_diagnostics
                        if "LEFT_RIGHT_CROSSOVER" in item.warnings
                    ],
                    "centerline_locked": True,
                    "earlobes_geometry_derived": True,
                    "earlobe_pins_triangle_interior": all(
                        item.get("validation", {}).get("triangle_interior") is True for item in earlobe_anchors
                    ),
                    "earlobe_vertical_lock": all(
                        item.get("validation", {}).get("vertical_lock") is True for item in earlobe_anchors
                    ),
                    "earlobe_pair_height_valid": all(
                        item.get("validation", {}).get("pair_height_valid") is True for item in earlobe_anchors
                    ),
                    "face_critical_rejections": face_metrics.get("critical_semantic_rejected", []),
                    "measurements_calibrated": body_measurements.get("readiness", {}).get("scale_calibrated", False),
                    "garment_anchor_warnings": len(garment_warnings),
                },
                "metrics": {
                    "surface_landmark_count": len(landmarks),
                    "body_landmark_count": sum(item["group"] == "body" for item in landmarks),
                    "face_landmark_count": sum(item["group"] == "face" for item in landmarks),
                    "face_landmark_rejected_count": len(rejected_face_landmarks),
                    "hand_landmark_count": sum(item["group"] == "hand" for item in landmarks),
                    "earring_anchor_count": len(earlobe_anchors),
                    "measurement_count": sum(
                        item.get("status") in {"valid", "estimated_open_section"}
                        for item in body_measurements.get("values", {}).values()
                    ),
                    "garment_anchor_count": len(garment_anchors),
                },
                "renders": sorted(
                    str(path.relative_to(self.run_dir)).replace("\\", "/") for path in self.render_dir.glob("*.png")
                ),
                "readiness": {
                    "body_ready": any(item["group"] == "body" for item in landmarks),
                    "face_landmarks_ready": bool(
                        face_metrics["face_landmarks_ready"]
                        and not any(
                            "LEFT_RIGHT_CROSSOVER" in item.get("warnings", [])
                            for item in landmarks
                            if item.get("group") == "face"
                        )
                    ),
                    "left_hand_ready": any(item["group"] == "hand" and item.get("side") == "left" for item in landmarks),
                    "right_hand_ready": any(item["group"] == "hand" and item.get("side") == "right" for item in landmarks),
                    "earring_anchors_ready": len(earlobe_anchors) == 2 and all(
                        item.get("state") == "surface_anchor_ready"
                        and item.get("validation", {}).get("pair_valid") is True
                        and item.get("validation", {}).get("triangle_interior") is True
                        for item in earlobe_anchors
                    ),
                    "measurements_ready": body_measurements.get("readiness", {}).get("measurements_ready", False),
                    "circumferences_ready": body_measurements.get("readiness", {}).get("circumferences_ready", False),
                    "garment_anchors_ready": len(garment_anchors) >= 18 and not any(
                        warning.get("code") == "GARMENT_REQUIRED_ANCHORS_MISSING"
                        for warning in garment_warnings
                    ),
                    "circumferences_estimated_ready": body_measurements.get("readiness", {}).get("circumferences_estimated_ready", False),
                    "garment_mold_draft_ready": bool(
                        body_measurements.get("readiness", {}).get("measurements_ready", False)
                        and body_measurements.get("readiness", {}).get("circumferences_estimated_ready", False)
                        and len(garment_anchors) >= 18
                    ),
                    "garment_mold_input_ready": bool(
                        body_measurements.get("readiness", {}).get("measurements_ready", False)
                        and body_measurements.get("readiness", {}).get("circumferences_ready", False)
                        and len(garment_anchors) >= 18
                    ),
                },
            }
            _write(self.run_dir / "surface_landmarks.json", landmarks)
            _write(self.run_dir / "rejected_face_landmarks.json", rejected_face_landmarks)
            _write(self.run_dir / "face_validation.json", result["face_validation"])
            _write(self.run_dir / "accessory_anchors.json", result["accessory_anchors"])
            _write(self.run_dir / "internal_joints.json", internal_joints)
            _write(self.run_dir / "body_measurements.json", body_measurements)
            _write(self.run_dir / "garment_anchors.json", garment_anchors)
            shutil.copy2(self.source, self.run_dir / "diagnostic_anatomy.glb")
            _write(self.run_dir / "warnings.json", warnings)
            _write(self.run_dir / "anatomy_result.json", result)
            self.state.publish("completed", 100, "Análisis completado")
            self.state.result = result
            return result
        finally:
            detectors.close()

def execute(state: RunState, source: Path, height_cm: float = 180.0) -> None:
    try:
        state.result = Analyzer(state, source, height_cm=height_cm).run()
    except Exception as exc:
        state.status = "cancelled" if str(exc) == "JOB_CANCELLED" else "failed"
        state.phase = state.status
        state.error = str(exc)
        state.message = "Análisis cancelado" if state.status == "cancelled" else "El análisis falló"
        state.events.append({"phase": state.phase, "progress": state.progress, "message": state.message, "error": state.error})
        run_dir = OUTPUT / state.run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        (run_dir / "error.txt").write_text(traceback.format_exc(), encoding="utf-8")
