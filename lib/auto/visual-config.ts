export type VehicleScenePreset = "underground" | "ice" | "blackout";
export type VehicleWheelPreset = "bbs" | "enkei" | "momo" | "oz" | "rays" | "volk";
export type VehicleDecalPreset =
  | "none"
  | "bajoceroz"
  | "locodanisonido"
  | "elunito"
  | "nfs_audiobahn"
  | "nfs_scorpion"
  | "nfs_japanrobo"
  | "nfs_lightning45"
  | "nfs_wild59"
  | "custom";

export type VehicleTuningConfig = {
  bodyColor: string;
  rideHeight: number;
  wheelScale: number;
  wheelStyle: VehicleWheelPreset;
  windowTint: number;
  headlights: boolean;
  headlightStyle: number;
  neonEnabled: boolean;
  neonColor: string;
  neonIntensity: number;
  autoRotate: boolean;
  bodyKit: number;
  widebody: number;
  hoodStyle: number;
  hoodCarbon: boolean;
  spoilerStyle: number;
  spoilerCarbon: boolean;
  audioTrunkOpen: boolean;
  decalPreset: VehicleDecalPreset;
  customDecalMediaId: string | null;
  decalScale: number;
  decalOffsetY: number;
  decalOffsetZ: number;
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
  wheelStyle: "bbs",
  windowTint: 0.58,
  headlights: true,
  headlightStyle: 0,
  neonEnabled: true,
  neonColor: "#8b5cff",
  neonIntensity: 1.15,
  autoRotate: false,
  bodyKit: 0,
  widebody: 0,
  hoodStyle: 0,
  hoodCarbon: false,
  spoilerStyle: 0,
  spoilerCarbon: false,
  audioTrunkOpen: false,
  decalPreset: "bajoceroz",
  customDecalMediaId: null,
  decalScale: 1,
  decalOffsetY: 0,
  decalOffsetZ: 0,
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
    wheelScale: numberIn(data.wheelScale, DEFAULT_VEHICLE_TUNING.wheelScale, 0.82, 1.24),
    wheelStyle: data.wheelStyle === "bbs" || data.wheelStyle === "enkei" || data.wheelStyle === "momo" || data.wheelStyle === "oz" || data.wheelStyle === "rays" || data.wheelStyle === "volk"
      ? data.wheelStyle
      : DEFAULT_VEHICLE_TUNING.wheelStyle,
    windowTint: numberIn(data.windowTint, DEFAULT_VEHICLE_TUNING.windowTint, 0, 0.92),
    headlights: bool(data.headlights, DEFAULT_VEHICLE_TUNING.headlights),
    headlightStyle: Number(data.headlightStyle) === 5 ? 5 : 0,
    neonEnabled: bool(data.neonEnabled, DEFAULT_VEHICLE_TUNING.neonEnabled),
    neonColor: color(data.neonColor, DEFAULT_VEHICLE_TUNING.neonColor),
    neonIntensity: numberIn(data.neonIntensity, DEFAULT_VEHICLE_TUNING.neonIntensity, 0, 3),
    autoRotate: bool(data.autoRotate, DEFAULT_VEHICLE_TUNING.autoRotate),
    bodyKit: Math.round(numberIn(data.bodyKit, DEFAULT_VEHICLE_TUNING.bodyKit, 0, 1)),
    widebody: Math.round(numberIn(data.widebody, DEFAULT_VEHICLE_TUNING.widebody, 0, 3)),
    hoodStyle: Math.round(numberIn(data.hoodStyle, DEFAULT_VEHICLE_TUNING.hoodStyle, 0, 10)),
    hoodCarbon: bool(data.hoodCarbon, DEFAULT_VEHICLE_TUNING.hoodCarbon),
    spoilerStyle: Math.round(numberIn(data.spoilerStyle, DEFAULT_VEHICLE_TUNING.spoilerStyle, 0, 40)),
    spoilerCarbon: bool(data.spoilerCarbon, DEFAULT_VEHICLE_TUNING.spoilerCarbon),
    audioTrunkOpen: bool(data.audioTrunkOpen, DEFAULT_VEHICLE_TUNING.audioTrunkOpen),
    decalPreset:
      data.decalPreset === "none"
      || data.decalPreset === "bajoceroz"
      || data.decalPreset === "locodanisonido"
      || data.decalPreset === "elunito"
      || data.decalPreset === "nfs_audiobahn"
      || data.decalPreset === "nfs_scorpion"
      || data.decalPreset === "nfs_japanrobo"
      || data.decalPreset === "nfs_lightning45"
      || data.decalPreset === "nfs_wild59"
      || data.decalPreset === "custom"
        ? data.decalPreset
        : DEFAULT_VEHICLE_TUNING.decalPreset,
    customDecalMediaId: typeof data.customDecalMediaId === "string" && data.customDecalMediaId.trim() ? data.customDecalMediaId.trim().slice(0, 80) : null,
    decalScale: numberIn(data.decalScale, DEFAULT_VEHICLE_TUNING.decalScale, 0.45, 2.2),
    decalOffsetY: numberIn(data.decalOffsetY, DEFAULT_VEHICLE_TUNING.decalOffsetY, -0.45, 0.45),
    decalOffsetZ: numberIn(data.decalOffsetZ, DEFAULT_VEHICLE_TUNING.decalOffsetZ, -0.8, 0.8),
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
