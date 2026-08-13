from __future__ import annotations

from pathlib import Path
import cv2
import numpy as np
from PIL import Image
from camera_rig import OrthoCamera
from raycast_scene import AnatomyRaycastScene

def _save_rgb(path: Path, value: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(value, 0, 255).astype(np.uint8), mode="RGB").save(path)

def render_view(scene: AnatomyRaycastScene, camera: OrthoCamera, output_dir: Path) -> dict:
    buffers = scene.render_camera(camera)
    valid = buffers["valid"]
    normals = buffers["primitive_normals"].astype(np.float32)
    normal_length = np.linalg.norm(normals, axis=-1, keepdims=True)
    normals = np.divide(normals, np.maximum(normal_length, 1e-8), where=normal_length > 0)
    background = np.array([7, 8, 14], dtype=np.float32)
    base = np.broadcast_to(background, (*valid.shape, 3)).copy()
    light = np.array([0.35, -0.55, 0.76], dtype=np.float32)
    light /= np.linalg.norm(light)
    shade = np.clip(0.38 + 0.62 * np.abs(np.sum(normals * light, axis=-1)), 0.0, 1.0)
    foreground = np.stack([120 + shade * 90, 145 + shade * 80, 195 + shade * 60], axis=-1)
    base[valid] = foreground[valid]
    depth = buffers["t_hit"].copy()
    usable = valid & np.isfinite(depth)
    depth_image = np.zeros((*valid.shape, 3), dtype=np.uint8)
    if usable.any():
        values = depth[usable]
        near, far = np.percentile(values, [2, 98])
        normalized = 1.0 - np.clip((depth - near) / max(float(far - near), 1e-8), 0.0, 1.0)
        gray = (normalized * 255).astype(np.uint8)
        depth_image[..., :] = gray[..., None]
        depth_image[~valid] = 0
    normal_image = ((normals * 0.5 + 0.5) * 255).astype(np.uint8)
    normal_image[~valid] = 0
    silhouette = valid.astype(np.uint8) * 255
    edge = cv2.morphologyEx(silhouette, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8))
    edge_rgb = np.stack([edge, edge, edge], axis=-1)
    silhouette_rgb = np.stack([silhouette, silhouette, silhouette], axis=-1)
    gray = cv2.cvtColor(base.astype(np.uint8), cv2.COLOR_RGB2GRAY)[..., None].repeat(3, axis=2)
    detector = np.full((*valid.shape, 3), 238, dtype=np.float32)
    detector_shade = np.clip(0.55 + 0.45 * np.abs(np.sum(normals * light, axis=-1)), 0.0, 1.0)
    detector_foreground = np.stack([
        178 + detector_shade * 62,
        118 + detector_shade * 68,
        96 + detector_shade * 60,
    ], axis=-1)
    detector[valid] = detector_foreground[valid]
    paths = {}
    for label, image in {
        "detector": detector,
        "neutral": base, "depth": depth_image, "normal": normal_image,
        "silhouette": silhouette_rgb, "edge": edge_rgb, "grayscale": gray, "inverted": 255 - base,
    }.items():
        path = output_dir / f"{camera.name}_{label}.png"
        _save_rgb(path, image)
        paths[label] = str(path)
    return {"camera": camera, "buffers": buffers, "paths": paths}
