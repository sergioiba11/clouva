export const CLOUVA_RIG_ID = "clouva_base_v1" as const;

export const BODY_MASKS = [
  "head",
  "neck",
  "torso",
  "upper_arm_left",
  "upper_arm_right",
  "lower_arm_left",
  "lower_arm_right",
  "hand_left",
  "hand_right",
  "pelvis",
  "upper_leg_left",
  "upper_leg_right",
  "lower_leg_left",
  "lower_leg_right",
  "foot_left",
  "foot_right",
] as const;

export const WEARABLE_SLOTS = [
  "hair",
  "headwear",
  "face",
  "eyes",
  "ears",
  "neck",
  "upper_body_inner",
  "upper_body_outer",
  "hands",
  "waist",
  "lower_body",
  "feet",
  "back",
  "wrist_left",
  "wrist_right",
  "finger",
  "full_body",
  "tattoo",
] as const;

export const WEARABLE_CATEGORIES = [
  "shirt",
  "hoodie",
  "jacket",
  "top",
  "pants",
  "baggy",
  "shorts",
  "socks",
  "shoes",
  "cap",
  "flat_cap",
  "neckwear",
  "gloves",
  "belt",
  "laces",
  "glasses",
  "earrings",
  "plugs",
  "chain",
  "rings",
  "bracelet",
  "scarf",
  "bag",
  "waist_bag",
  "nails",
  "tattoo",
  "contact_lenses",
] as const;

export type BodyMask = (typeof BODY_MASKS)[number];
export type WearableSlot = (typeof WEARABLE_SLOTS)[number];
export type WearableCategoryV1 = (typeof WEARABLE_CATEGORIES)[number];

export type ClouvaWearableMetadata = {
  avatarRig: typeof CLOUVA_RIG_ID;
  category: WearableCategoryV1;
  slot: WearableSlot;
  genderCompatibility: "universal";
  bodyMasks: BodyMask[];
  compatibleAnimations: boolean;
  version: 1;
  preFitted: boolean;
  hasSkinWeights: boolean;
  scale: 1;
};

export type WearableValidationResult = {
  ok: boolean;
  errors: string[];
};

export function validateWearableMetadata(value: unknown): WearableValidationResult {
  const errors: string[] = [];
  const data = value as Partial<ClouvaWearableMetadata> | null;

  if (!data || typeof data !== "object") return { ok: false, errors: ["Metadatos ausentes"] };
  if (data.avatarRig !== CLOUVA_RIG_ID) errors.push("La prenda no usa el rig oficial clouva_base_v1");
  if (!WEARABLE_CATEGORIES.includes(data.category as WearableCategoryV1)) errors.push("Categoría de prenda inválida");
  if (!WEARABLE_SLOTS.includes(data.slot as WearableSlot)) errors.push("Slot de prenda inválido");
  if (!Array.isArray(data.bodyMasks) || data.bodyMasks.some((mask) => !BODY_MASKS.includes(mask as BodyMask))) {
    errors.push("Body masks inválidas");
  }
  if (data.preFitted !== true) errors.push("La prenda debe estar ajustada sobre el avatar oficial");
  if (data.hasSkinWeights !== true) errors.push("La prenda no contiene skin weights compatibles");
  if (data.scale !== 1) errors.push("La prenda debe exportarse con escala 1");
  if (data.version !== 1) errors.push("Versión de contrato no compatible");

  return { ok: errors.length === 0, errors };
}
