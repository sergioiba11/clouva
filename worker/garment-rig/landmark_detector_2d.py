"""MediaPipe Tasks auxiliary process for CLOUVA technical renders.

V3.2 evaluates neutral, edge, contrast, grayscale and silhouette variants.
MediaPipe supplies only 2D candidates; Blender still validates every candidate
against the anatomical BVH before it can become an accepted landmark.
"""
from __future__ import annotations

import json
import math
import os
import sys
from pathlib import Path
from typing import Dict, Iterable, List

import mediapipe as mp
import numpy as np
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

try:
    import cv2
except Exception:  # MediaPipe still works without optional preprocessing.
    cv2 = None

FACE_MODEL = Path(os.environ.get("CLOUVA_FACE_LANDMARKER_MODEL", "/app/models/face_landmarker.task"))
HAND_MODEL = Path(os.environ.get("CLOUVA_HAND_LANDMARKER_MODEL", "/app/models/hand_landmarker.task"))

FACE_MAP: Dict[str, List[int]] = {
    "eye_l_center": [468], "eye_l_inner": [362], "eye_l_outer": [263],
    "eye_l_upper": [386, 385, 384], "eye_l_lower": [374, 380, 381],
    "eye_r_center": [473], "eye_r_inner": [133], "eye_r_outer": [33],
    "eye_r_upper": [159, 158, 157], "eye_r_lower": [145, 144, 163],
    "nose_bridge_top": [168], "nose_bridge_mid": [6], "nose_tip": [1],
    "nose_base": [2], "nostril_l": [327], "nostril_r": [98],
    "nose_wing_l": [358], "nose_wing_r": [129],
    "mouth_center": [13, 14], "mouth_corner_l": [291], "mouth_corner_r": [61],
    "upper_lip_center": [13], "upper_lip_l": [270, 269], "upper_lip_r": [40, 39],
    "lower_lip_center": [14], "lower_lip_l": [321, 375], "lower_lip_r": [91, 146],
    "mouth_opening_upper": [13], "mouth_opening_lower": [14],
    "chin": [152], "jaw_l": [454], "jaw_r": [234],
    "cheek_l": [425], "cheek_r": [205], "forehead_center": [10],
    "temple_l": [356], "temple_r": [127], "brow_l_inner": [336],
    "brow_l_outer": [300], "brow_r_inner": [107], "brow_r_outer": [70],
}

HAND_MAP = {
    "wrist": 0,
    "thumb_01": 1, "thumb_02": 2, "thumb_03": 3, "thumb_tip": 4,
    "index_01": 5, "index_02": 6, "index_03": 7, "index_tip": 8,
    "middle_01": 9, "middle_02": 10, "middle_03": 11, "middle_tip": 12,
    "ring_01": 13, "ring_02": 14, "ring_03": 15, "ring_tip": 16,
    "pinky_01": 17, "pinky_02": 18, "pinky_03": 19, "pinky_tip": 20,
}


def _average(landmarks, indices: Iterable[int]):
    selected = [landmarks[index] for index in indices if index < len(landmarks)]
    if not selected:
        return None
    count = float(len(selected))
    return {
        "x": sum(float(item.x) for item in selected) / count,
        "y": sum(float(item.y) for item in selected) / count,
        "z": sum(float(item.z) for item in selected) / count,
    }


def _face_detector():
    if not FACE_MODEL.is_file():
        raise FileNotFoundError(f"Face Landmarker model missing: {FACE_MODEL}")
    options = vision.FaceLandmarkerOptions(
        base_options=python.BaseOptions(model_asset_path=str(FACE_MODEL)),
        running_mode=vision.RunningMode.IMAGE,
        num_faces=1,
        min_face_detection_confidence=0.20,
        min_face_presence_confidence=0.20,
        min_tracking_confidence=0.20,
        output_face_blendshapes=False,
        output_facial_transformation_matrixes=False,
    )
    return vision.FaceLandmarker.create_from_options(options)


def _hand_detector():
    if not HAND_MODEL.is_file():
        raise FileNotFoundError(f"Hand Landmarker model missing: {HAND_MODEL}")
    options = vision.HandLandmarkerOptions(
        base_options=python.BaseOptions(model_asset_path=str(HAND_MODEL)),
        running_mode=vision.RunningMode.IMAGE,
        num_hands=1,
        min_hand_detection_confidence=0.12,
        min_hand_presence_confidence=0.12,
        min_tracking_confidence=0.12,
    )
    return vision.HandLandmarker.create_from_options(options)


def _distance(first: dict, second: dict):
    return math.hypot(float(first["x"]) - float(second["x"]), float(first["y"]) - float(second["y"]))


def _agreement_confidence(rgb: dict | None, edge: dict | None, base: float):
    if rgb is not None and edge is not None:
        distance = _distance(rgb, edge)
        agreement = max(0.0, min(1.0, 1.0 - distance / 0.065))
        confidence = max(0.42, min(0.97, base * 0.50 + agreement * 0.50))
        point = {
            "x": (float(rgb["x"]) + float(edge["x"])) * 0.5,
            "y": (float(rgb["y"]) + float(edge["y"])) * 0.5,
            "z": (float(rgb.get("z", 0.0)) + float(edge.get("z", 0.0))) * 0.5,
        }
        return point, confidence, agreement, ["rgb", "edge"]
    point = rgb or edge
    if point is None:
        return None, 0.0, 0.0, []
    return point, max(0.38, min(0.72, base * 0.72)), 0.35, ["rgb" if rgb else "edge"]


def _append_variant(images: list, variant):
    if variant is None:
        return
    contiguous = np.ascontiguousarray(variant, dtype=np.uint8)
    images.append(mp.Image(image_format=mp.ImageFormat.SRGB, data=contiguous))


def _mediapipe_images(path: str | None):
    if not path or not Path(path).is_file():
        return []
    images = [mp.Image.create_from_file(path)]
    if cv2 is None:
        return images
    source = cv2.imread(path, cv2.IMREAD_COLOR)
    if source is None or source.size == 0:
        return images
    try:
        lab = cv2.cvtColor(source, cv2.COLOR_BGR2LAB)
        lightness, channel_a, channel_b = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(8, 8))
        enhanced = cv2.cvtColor(cv2.merge((clahe.apply(lightness), channel_a, channel_b)), cv2.COLOR_LAB2RGB)
        _append_variant(images, enhanced)
    except Exception:
        pass
    try:
        rgb = cv2.cvtColor(source, cv2.COLOR_BGR2RGB)
        blurred = cv2.GaussianBlur(rgb, (0, 0), 1.15)
        sharpened = cv2.addWeighted(rgb, 1.75, blurred, -0.75, 0)
        _append_variant(images, sharpened)
    except Exception:
        pass
    try:
        gray = cv2.cvtColor(source, cv2.COLOR_BGR2GRAY)
        gray = cv2.equalizeHist(gray)
        gray_rgb = cv2.cvtColor(gray, cv2.COLOR_GRAY2RGB)
        _append_variant(images, gray_rgb)
        _append_variant(images, 255 - gray_rgb)
    except Exception:
        pass
    return images


def _robust_fuse(points: list[dict]):
    if not points:
        return None
    xs = sorted(float(item["x"]) for item in points)
    ys = sorted(float(item["y"]) for item in points)
    median_x = xs[len(xs) // 2]
    median_y = ys[len(ys) // 2]
    inliers = [
        item for item in points
        if math.hypot(float(item["x"]) - median_x, float(item["y"]) - median_y) <= 0.075
    ] or points
    return {
        "x": sum(float(item["x"]) for item in inliers) / len(inliers),
        "y": sum(float(item["y"]) for item in inliers) / len(inliers),
        "z": sum(float(item.get("z", 0.0)) for item in inliers) / len(inliers),
        "variantCount": len(points),
        "variantInliers": len(inliers),
        "variantAgreement": min(1.0, len(inliers) / max(len(points), 1)),
    }


def _face_points(detector, path: str | None):
    detected = []
    for image in _mediapipe_images(path):
        result = detector.detect(image)
        if not result.face_landmarks:
            continue
        landmarks = result.face_landmarks[0]
        detected.append({name: _average(landmarks, indices) for name, indices in FACE_MAP.items()})
    return {
        name: fused
        for name in FACE_MAP
        if (fused := _robust_fuse([item[name] for item in detected if item.get(name)])) is not None
    }


def _hand_points(detector, path: str | None):
    detected = []
    handedness = []
    for image in _mediapipe_images(path):
        result = detector.detect(image)
        if not result.hand_landmarks:
            continue
        detector_handedness = None
        handedness_score = 0.55
        if result.handedness and result.handedness[0]:
            category = result.handedness[0][0]
            detector_handedness = category.category_name
            handedness_score = float(category.score or handedness_score)
            handedness.append((detector_handedness, handedness_score))
        landmarks = result.hand_landmarks[0]
        detected.append({
            base_name: {
                "x": float(landmarks[index].x),
                "y": float(landmarks[index].y),
                "z": float(landmarks[index].z),
            }
            for base_name, index in HAND_MAP.items() if index < len(landmarks)
        })
    if not detected:
        return {}, None, 0.0
    fused = {
        name: point
        for name in HAND_MAP
        if (point := _robust_fuse([item[name] for item in detected if item.get(name)])) is not None
    }
    detector_handedness = None
    handedness_score = 0.55
    if handedness:
        totals = {}
        for label, score in handedness:
            totals[label] = totals.get(label, 0.0) + float(score)
        detector_handedness = max(totals, key=totals.get)
        handedness_score = min(1.0, totals[detector_handedness] / max(len(handedness), 1))
    return fused, detector_handedness, handedness_score


def _detect_face(detector, view: dict):
    rgb = _face_points(detector, view.get("path"))
    edge = _face_points(detector, view.get("edgePath"))
    if not rgb and not edge:
        silhouette = _face_points(detector, view.get("silhouettePath"))
        rgb = silhouette
    if not rgb and not edge:
        return [], {"code": "FACE_NOT_DETECTED", "view": view["name"]}
    candidates = []
    for name in FACE_MAP:
        point, confidence, agreement, variants = _agreement_confidence(rgb.get(name), edge.get(name), 0.78)
        if point is None:
            continue
        candidates.append({
            "name": name,
            "x": point["x"], "y": point["y"], "detectorDepth": point["z"],
            "detectorConfidence": confidence,
            "viewQualityConfidence": agreement,
            "visualConfidence": confidence,
            "view": view["name"], "region": "face",
            "indices": FACE_MAP[name], "renderVariants": variants,
            "variantConsensus": {
                "rgb": {
                    "attemptsWithDetection": int((rgb.get(name) or {}).get("variantCount") or 0),
                    "inliers": int((rgb.get(name) or {}).get("variantInliers") or 0),
                },
                "edge": {
                    "attemptsWithDetection": int((edge.get(name) or {}).get("variantCount") or 0),
                    "inliers": int((edge.get(name) or {}).get("variantInliers") or 0),
                },
            },
        })
    return candidates, None


def _detect_hand(detector, view: dict):
    rgb, rgb_handedness, rgb_score = _hand_points(detector, view.get("path"))
    edge, edge_handedness, edge_score = _hand_points(detector, view.get("edgePath"))
    silhouette, silhouette_handedness, silhouette_score = _hand_points(detector, view.get("silhouettePath"))
    if not rgb and not edge and silhouette:
        rgb, rgb_handedness, rgb_score = silhouette, silhouette_handedness, silhouette_score
    if not rgb and not edge:
        return [], {"code": "HAND_NOT_DETECTED", "view": view["name"], "side": view.get("side")}
    detector_handedness = rgb_handedness or edge_handedness or silhouette_handedness
    handedness_score = max(rgb_score, edge_score, silhouette_score, 0.45)
    suffix = "l" if view.get("side") == "left" else "r"
    candidates = []
    for base_name, index in HAND_MAP.items():
        first = rgb.get(base_name) or silhouette.get(base_name)
        second = edge.get(base_name)
        point, confidence, agreement, variants = _agreement_confidence(first, second, handedness_score)
        if point is None:
            continue
        if first is silhouette.get(base_name) and "rgb" in variants:
            variants = ["silhouette" if value == "rgb" else value for value in variants]
        candidates.append({
            "name": f"{base_name}_{suffix}",
            "x": point["x"], "y": point["y"], "detectorDepth": point["z"],
            "detectorConfidence": confidence,
            "viewQualityConfidence": agreement,
            "visualConfidence": confidence,
            "view": view["name"], "region": "hand", "side": view.get("side"),
            "detectorHandedness": detector_handedness,
            "handednessConfidence": handedness_score,
            "index": index, "canonicalIndex": index, "renderVariants": variants,
            "variantConsensus": {
                "rgbOrSilhouette": {
                    "attemptsWithDetection": int((first or {}).get("variantCount") or 0),
                    "inliers": int((first or {}).get("variantInliers") or 0),
                },
                "edge": {
                    "attemptsWithDetection": int((second or {}).get("variantCount") or 0),
                    "inliers": int((second or {}).get("variantInliers") or 0),
                },
            },
        })
    return candidates, None


def _collapse_errors(errors: List[dict]):
    grouped: Dict[tuple, dict] = {}
    for raw in errors:
        code = str(raw.get("code") or "DETECTOR_WARNING")
        side = raw.get("side")
        key = (code, side, raw.get("message"))
        view = raw.get("view")
        if key not in grouped:
            grouped[key] = {
                **{name: value for name, value in raw.items() if name != "view"},
                "occurrences": 0,
                "views": [],
            }
        item = grouped[key]
        item["occurrences"] += 1
        if view and view not in item["views"]:
            item["views"].append(view)
    return list(grouped.values())


def _prune_redundant_errors(output: dict):
    successful_face_views = sum(
        1 for view in output.get("views", [])
        if view.get("region") == "face" and len(view.get("candidates") or []) >= 8
    )
    successful_hand_views = {
        side: sum(
            1 for view in output.get("views", [])
            if view.get("region") == "hand"
            and view.get("side") == side
            and len(view.get("candidates") or []) >= 12
        )
        for side in ("left", "right")
    }
    filtered = []
    for error in output.get("errors", []):
        code = error.get("code")
        if code == "FACE_NOT_DETECTED" and successful_face_views >= 2:
            continue
        if code == "HAND_NOT_DETECTED" and successful_hand_views.get(error.get("side"), 0) >= 2:
            continue
        filtered.append(error)
    output["errors"] = filtered
    output["detectionCoverage"] = {
        "faceViews": successful_face_views,
        "leftHandViews": successful_hand_views["left"],
        "rightHandViews": successful_hand_views["right"],
    }
    return output


def run(request_path: Path, output_path: Path):
    request = json.loads(request_path.read_text(encoding="utf-8"))
    views = request.get("views") or []
    output = {
        "version": "clouva-mediapipe-tasks-v3.2-stylized-silhouette-retry",
        "faceModel": str(FACE_MODEL), "handModel": str(HAND_MODEL),
        "handLandmarkCount": len(HAND_MAP), "views": [], "errors": [],
    }
    face_detector = _face_detector()
    hand_detector = _hand_detector()
    try:
        for view in views:
            try:
                if view.get("region") == "face":
                    candidates, error = _detect_face(face_detector, view)
                elif view.get("region") == "hand":
                    candidates, error = _detect_hand(hand_detector, view)
                else:
                    candidates, error = [], {"code": "UNKNOWN_REGION", "view": view.get("name")}
                output["views"].append({
                    "name": view.get("name"), "region": view.get("region"),
                    "side": view.get("side"), "candidates": candidates,
                })
                if error:
                    output["errors"].append(error)
            except Exception as exc:
                output["errors"].append({
                    "code": "DETECTOR_VIEW_FAILED", "view": view.get("name"), "message": str(exc),
                })
    finally:
        face_detector.close()
        hand_detector.close()
    output = _prune_redundant_errors(output)
    output["errors"] = _collapse_errors(output["errors"])
    output_path.write_text(json.dumps(output, indent=2), encoding="utf-8")
    return output


def main():
    if len(sys.argv) != 3:
        raise SystemExit("Usage: landmark_detector_2d.py request.json output.json")
    run(Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve())


if __name__ == "__main__":
    main()
