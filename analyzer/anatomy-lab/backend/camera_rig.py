from __future__ import annotations

from dataclasses import dataclass
import numpy as np

@dataclass
class OrthoCamera:
    name: str
    origin: np.ndarray
    direction: np.ndarray
    right: np.ndarray
    up: np.ndarray
    width: float
    height: float
    resolution: int

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "origin": self.origin.tolist(),
            "direction": self.direction.tolist(),
            "right": self.right.tolist(),
            "up": self.up.tolist(),
            "width": self.width,
            "height": self.height,
            "resolution": self.resolution,
        }

    def rays(self) -> np.ndarray:
        columns = (np.arange(self.resolution, dtype=np.float32) + 0.5) / self.resolution - 0.5
        rows = 0.5 - (np.arange(self.resolution, dtype=np.float32) + 0.5) / self.resolution
        grid_x, grid_y = np.meshgrid(columns * self.width, rows * self.height)
        origins = self.origin[None, None, :] + grid_x[..., None] * self.right[None, None, :] + grid_y[..., None] * self.up[None, None, :]
        directions = np.broadcast_to(self.direction[None, None, :], origins.shape)
        return np.concatenate([origins, directions], axis=-1).astype(np.float32)

def _normalize(value: np.ndarray) -> np.ndarray:
    norm = float(np.linalg.norm(value))
    if norm <= 1e-9:
        raise ValueError("CAMERA_RIG_FAILED")
    return value / norm

def make_camera(name: str, target: np.ndarray, direction_to_target: np.ndarray, size: np.ndarray, resolution: int = 512, framing: float = 1.15) -> OrthoCamera:
    direction = _normalize(direction_to_target)
    world_up = np.array([0.0, 0.0, 1.0])
    right = np.cross(direction, world_up)
    if np.linalg.norm(right) < 1e-6:
        right = np.array([1.0, 0.0, 0.0])
    right = _normalize(right)
    up = _normalize(np.cross(right, direction))
    width = max(float(size[0]), float(size[1]), float(size[2]) * 0.55) * framing
    height = max(float(size[2]), width) * framing
    distance = max(width, height) * 1.8
    origin = target - direction * distance
    return OrthoCamera(name, origin, direction, right, up, width, height, resolution)

def body_cameras(bounds_min: np.ndarray, bounds_max: np.ndarray, resolution: int = 512) -> list[OrthoCamera]:
    size = bounds_max - bounds_min
    target = (bounds_min + bounds_max) * 0.5
    directions = {
        "front": np.array([0.0, -1.0, 0.0]),
        "back": np.array([0.0, 1.0, 0.0]),
        "left": np.array([1.0, 0.0, 0.0]),
        "right": np.array([-1.0, 0.0, 0.0]),
        "front_left": np.array([0.7071, -0.7071, 0.0]),
        "front_right": np.array([-0.7071, -0.7071, 0.0]),
        "back_left": np.array([0.7071, 0.7071, 0.0]),
        "back_right": np.array([-0.7071, 0.7071, 0.0]),
    }
    return [make_camera(name, target, value, size, resolution=resolution) for name, value in directions.items()]

def crop_camera(base: OrthoCamera, name: str, center: np.ndarray, width: float, height: float, resolution: int = 512) -> OrthoCamera:
    distance = max(width, height) * 2.0
    origin = center - base.direction * distance
    return OrthoCamera(name, origin, base.direction.copy(), base.right.copy(), base.up.copy(), width, height, resolution)
