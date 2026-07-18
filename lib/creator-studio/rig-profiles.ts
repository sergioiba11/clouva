import type { ReferenceCategory } from "@/lib/creator-studio/reference-assets";

export type RigMode = "deformable" | "rigid";
export type RigPipeline = "garment" | "object";
export type RigAnchorKey = "head" | "neck" | "chest" | "leftHand" | "rightHand" | null;

export type RigProfile = {
  category: ReferenceCategory;
  label: string;
  mode: RigMode;
  pipeline: RigPipeline;
  workerCategory: "hoodie" | "shirt" | "jacket" | "pants" | "shoes" | "hat" | "accessory";
  summary: string;
  actionLabel: string;
  requiredBones: string[];
  validationPoses: string[];
  anchor: string;
  anchorKey: RigAnchorKey;
  sided: boolean;
  bodyRegions: string[];
};

const PROFILES: Record<ReferenceCategory, RigProfile> = {
  hoodie: {
    category: "hoodie",
    label: "Buzo / hoodie",
    mode: "deformable",
    pipeline: "garment",
    workerCategory: "hoodie",
    summary: "Ajusta el buzo al torso y transfiere pesos del pecho, hombros, brazos y antebrazos para que las mangas acompañen el movimiento.",
    actionLabel: "Vestir y riggear buzo",
    requiredBones: ["Spine", "Chest", "Shoulders", "Upper Arms", "Lower Arms"],
    validationPoses: ["T-Pose", "Idle", "Walk"],
    anchor: "Torso + ambos brazos",
    anchorKey: null,
    sided: false,
    bodyRegions: ["torso", "hombro izquierdo", "hombro derecho", "manga izquierda", "manga derecha"],
  },
  remera: {
    category: "remera",
    label: "Remera",
    mode: "deformable",
    pipeline: "garment",
    workerCategory: "shirt",
    summary: "Transfiere pesos del torso y hombros para que la tela siga el pecho y la parte superior de los brazos.",
    actionLabel: "Vestir y riggear remera",
    requiredBones: ["Spine", "Chest", "Shoulders", "Upper Arms"],
    validationPoses: ["T-Pose", "Idle", "Walk"],
    anchor: "Torso + hombros",
    anchorKey: null,
    sided: false,
    bodyRegions: ["torso", "hombros", "mangas"],
  },
  campera: {
    category: "campera",
    label: "Campera",
    mode: "deformable",
    pipeline: "garment",
    workerCategory: "jacket",
    summary: "Ajusta la campera completa y copia pesos del torso, hombros, brazos y antebrazos.",
    actionLabel: "Vestir y riggear campera",
    requiredBones: ["Spine", "Chest", "Shoulders", "Upper Arms", "Lower Arms"],
    validationPoses: ["T-Pose", "Idle", "Walk"],
    anchor: "Torso + ambos brazos",
    anchorKey: null,
    sided: false,
    bodyRegions: ["torso", "hombros", "mangas"],
  },
  baggy: {
    category: "baggy",
    label: "Pantalón baggy",
    mode: "deformable",
    pipeline: "garment",
    workerCategory: "pants",
    summary: "Transfiere pesos de cadera, muslos, rodillas y piernas para que ambas perneras se deformen con el avatar.",
    actionLabel: "Vestir y riggear pantalón",
    requiredBones: ["Hips", "Upper Legs", "Lower Legs"],
    validationPoses: ["T-Pose", "Idle", "Walk"],
    anchor: "Cadera + ambas piernas",
    anchorKey: null,
    sided: false,
    bodyRegions: ["cintura", "muslo izquierdo", "muslo derecho", "piernas"],
  },
  zapatillas: {
    category: "zapatillas",
    label: "Zapatillas",
    mode: "deformable",
    pipeline: "garment",
    workerCategory: "shoes",
    summary: "Copia pesos de pies y dedos para mantener cada zapatilla alineada al caminar.",
    actionLabel: "Calzar y riggear zapatillas",
    requiredBones: ["Feet", "Toes"],
    validationPoses: ["Idle", "Walk"],
    anchor: "Ambos pies",
    anchorKey: null,
    sided: false,
    bodyRegions: ["pie izquierdo", "pie derecho", "dedos"],
  },
  gorra: {
    category: "gorra",
    label: "Gorra",
    mode: "rigid",
    pipeline: "object",
    workerCategory: "hat",
    summary: "Crea un rig rígido y lo conecta a Head para que siga la cabeza sin deformarse.",
    actionLabel: "Anclar gorra a la cabeza",
    requiredBones: ["Head"],
    validationPoses: ["Idle", "Walk"],
    anchor: "Cabeza",
    anchorKey: "head",
    sided: false,
    bodyRegions: ["cabeza"],
  },
  cadena: {
    category: "cadena",
    label: "Cadena",
    mode: "rigid",
    pipeline: "object",
    workerCategory: "accessory",
    summary: "Conecta la cadena a cuello/pecho para que acompañe el torso.",
    actionLabel: "Anclar cadena al cuello",
    requiredBones: ["Neck", "Chest"],
    validationPoses: ["Idle", "Walk"],
    anchor: "Cuello",
    anchorKey: "neck",
    sided: false,
    bodyRegions: ["cuello", "pecho"],
  },
  lentes: {
    category: "lentes",
    label: "Lentes",
    mode: "rigid",
    pipeline: "object",
    workerCategory: "accessory",
    summary: "Conecta los lentes a Head para seguir cada giro de la cabeza.",
    actionLabel: "Anclar lentes a la cabeza",
    requiredBones: ["Head"],
    validationPoses: ["Idle", "Walk"],
    anchor: "Cabeza / ojos",
    anchorKey: "head",
    sided: false,
    bodyRegions: ["cabeza", "ojos"],
  },
  mochila: {
    category: "mochila",
    label: "Mochila",
    mode: "rigid",
    pipeline: "object",
    workerCategory: "accessory",
    summary: "Conecta la mochila al pecho superior para acompañar la espalda.",
    actionLabel: "Anclar mochila a la espalda",
    requiredBones: ["Chest", "Spine"],
    validationPoses: ["Idle", "Walk"],
    anchor: "Espalda",
    anchorKey: "chest",
    sided: false,
    bodyRegions: ["espalda", "pecho superior"],
  },
  aros: {
    category: "aros",
    label: "Aros",
    mode: "rigid",
    pipeline: "object",
    workerCategory: "accessory",
    summary: "Conecta los aros a la cabeza para acompañar sus movimientos.",
    actionLabel: "Anclar aros a la cabeza",
    requiredBones: ["Head"],
    validationPoses: ["Idle", "Walk"],
    anchor: "Cabeza / orejas",
    anchorKey: "head",
    sided: false,
    bodyRegions: ["orejas", "cabeza"],
  },
  guantes: {
    category: "guantes",
    label: "Guantes",
    mode: "rigid",
    pipeline: "object",
    workerCategory: "accessory",
    summary: "Conecta el objeto a la mano seleccionada. Para dedos articulados se requerirá una plantilla específica por mano.",
    actionLabel: "Anclar guante a la mano",
    requiredBones: ["Hand"],
    validationPoses: ["Idle", "Walk"],
    anchor: "Mano",
    anchorKey: "rightHand",
    sided: true,
    bodyRegions: ["mano izquierda", "mano derecha"],
  },
  pulseras: {
    category: "pulseras",
    label: "Pulsera",
    mode: "rigid",
    pipeline: "object",
    workerCategory: "accessory",
    summary: "Conecta la pulsera a la mano seleccionada para acompañar la muñeca.",
    actionLabel: "Anclar pulsera a la muñeca",
    requiredBones: ["Hand", "Lower Arm"],
    validationPoses: ["Idle", "Walk"],
    anchor: "Muñeca",
    anchorKey: "rightHand",
    sided: true,
    bodyRegions: ["muñeca izquierda", "muñeca derecha"],
  },
  anillos: {
    category: "anillos",
    label: "Anillo",
    mode: "rigid",
    pipeline: "object",
    workerCategory: "accessory",
    summary: "Conecta el anillo a la mano seleccionada. La versión actual sigue la mano completa.",
    actionLabel: "Anclar anillo a la mano",
    requiredBones: ["Hand"],
    validationPoses: ["Idle", "Walk"],
    anchor: "Mano / dedos",
    anchorKey: "rightHand",
    sided: true,
    bodyRegions: ["mano izquierda", "mano derecha"],
  },
};

export function resolveRigProfile(category: string): RigProfile {
  return PROFILES[category as ReferenceCategory] ?? PROFILES.hoodie;
}

export function isDeformableCategory(category: string): boolean {
  return resolveRigProfile(category).mode === "deformable";
}

export function isRigidCategory(category: string): boolean {
  return resolveRigProfile(category).mode === "rigid";
}

export const RIG_PROFILES = PROFILES;
