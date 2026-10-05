export type VehicleScenePreset = "underground" | "ice" | "blackout";

export type VehicleTuningConfig = {
  bodyColor: string;
  rideHeight: number;
  wheelScale: number;
  windowTint: number;
  headlights: boolean;
  neonEnabled: boolean;
  neonColor: string;
  neonIntensity: number;
  autoRotate: boolean;
};

export type VehicleShowConfig = {
  scene: VehicleScenePreset;
  reactivity: number;
  bassBounce: number;
  midGlow: number;
  trebleFlash: number;
  cameraPulse: number;
  autoRotateSpeed: number;
};

export const DEFAULT_VEHICLE_TUNING: VehicleTuningConfig = {
  bodyColor: "#6d4aff",
  rideHeight: -0.08,
  wheelScale: 1,
  windowTint: 0.58,
  headlights: true,
  neonEnabled: true,
  neonColor: "#8b5cff",
  neonIntensity: 1.15,
  autoRotate: false,
};

export const DEFAULT_VEHICLE_SHOW: VehicleShowConfig = {
  scene: "underground",
  reactivity: 1,
  bassBounce: 0.9,
  midGlow: 0.8,
  trebleFlash: 0.65,
  cameraPulse: 0.55,
  autoRotateSpeed: 0.75,
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberIn(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function bool(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function color(value: unknown, fallback: string) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : fallback;
}

export function normalizeVehicleTuning(value: unknown): VehicleTuningConfig {
  const data = asRecord(value);
  return {
    bodyColor: color(data.bodyColor, DEFAULT_VEHICLE_TUNING.bodyColor),
    rideHeight: numberIn(data.rideHeight, DEFAULT_VEHICLE_TUNING.rideHeight, -0.3, 0.35),
    wheelScale: numberIn(data.wheelScale, DEFAULT_VEHICLE_TUNING.wheelScale, 0.78, 1.35),
    windowTint: numberIn(data.windowTint, DEFAULT_VEHICLE_TUNING.windowTint, 0, 0.92),
    headlights: bool(data.headlights, DEFAULT_VEHICLE_TUNING.headlights),
    neonEnabled: bool(data.neonEnabled, DEFAULT_VEHICLE_TUNING.neonEnabled),
    neonColor: color(data.neonColor, DEFAULT_VEHICLE_TUNING.neonColor),
    neonIntensity: numberIn(data.neonIntensity, DEFAULT_VEHICLE_TUNING.neonIntensity, 0, 3),
    autoRotate: bool(data.autoRotate, DEFAULT_VEHICLE_TUNING.autoRotate),
  };
}

export function normalizeVehicleShow(value: unknown): VehicleShowConfig {
  const data = asRecord(value);
  const scene = data.scene === "ice" || data.scene === "blackout" || data.scene === "underground"
    ? data.scene
    : DEFAULT_VEHICLE_SHOW.scene;
  return {
    scene,
    reactivity: numberIn(data.reactivity, DEFAULT_VEHICLE_SHOW.reactivity, 0, 2),
    bassBounce: numberIn(data.bassBounce, DEFAULT_VEHICLE_SHOW.bassBounce, 0, 2),
    midGlow: numberIn(data.midGlow, DEFAULT_VEHICLE_SHOW.midGlow, 0, 2),
    trebleFlash: numberIn(data.trebleFlash, DEFAULT_VEHICLE_SHOW.trebleFlash, 0, 2),
    cameraPulse: numberIn(data.cameraPulse, DEFAULT_VEHICLE_SHOW.cameraPulse, 0, 2),
    autoRotateSpeed: numberIn(data.autoRotateSpeed, DEFAULT_VEHICLE_SHOW.autoRotateSpeed, 0, 3),
  };
}
