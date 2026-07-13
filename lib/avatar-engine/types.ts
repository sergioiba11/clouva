import type { AnimationClip, Group, Object3D } from "three";

export type AvatarCategory = "body" | "face" | "hair" | "top" | "bottom" | "shoes" | "accessory" | "color" | "animation";
export type AvatarSlot = "body" | "face" | "hair" | "top" | "bottom" | "shoes" | "accessories";

export interface AvatarItem {
  id: string;
  name: string;
  category: AvatarCategory;
  modelUrl: string | null;
  thumbnailUrl?: string | null;
  previewImage?: string | null;
  free: boolean;
  compatibleSkeleton: string;
  skeletonId?: string;
  status?: "ready" | "draft" | "disabled";
  colors?: string[];
  tags?: string[];
  materialNames?: string[];
  supportedMorphs?: string[];
  supportedAnimations?: string[];
  version?: string;
  metadata?: Record<string, unknown>;
}

export interface AvatarConfig {
  bodyId: string;
  faceId?: string | null;
  hairId: string | null;
  topId: string | null;
  bottomId: string | null;
  shoesId: string | null;
  accessoryIds: string[];
  skinTone: string;
  hairColor: string;
  materialColors: Record<string, string>;
  morphValues: Record<string, number>;
  activeAnimation?: "idle" | "saludo" | "pose" | "emote" | string | null;
}

export type AvatarSkeletonId = "clouva-humanoid-v1";
export const CLOUVA_SKELETON_ID: AvatarSkeletonId = "clouva-humanoid-v1";

export type AvatarCompatibilityStatus = { compatible: boolean; reasons: string[]; warnings: string[] };
export type AvatarLoadingState = "idle" | "loading" | "ready" | "error";

export type LoadedAvatarPart = {
  item: AvatarItem;
  object: Group;
  animations: AnimationClip[];
  skeletonId: string;
  boneNames: string[];
  meshNames: string[];
  skinnedMeshNames: string[];
  materialNames: string[];
  morphNames: string[];
  modelUrl: string;
  dispose: () => void;
};

export type AvatarSlotsState = {
  equippedItemIds: { body: string | null; face: string | null; hair: string | null; top: string | null; bottom: string | null; shoes: string | null; accessories: string[] };
  loadedObjects: Partial<Record<AvatarSlot, Object3D | Object3D[]>>;
  loadingStates: Record<AvatarSlot, AvatarLoadingState>;
  errors: Partial<Record<AvatarSlot, string | null>>;
  compatibilityStatus: Partial<Record<AvatarSlot, AvatarCompatibilityStatus>>;
};

export type BaseAvatarModel = {
  object: Group;
  skeletonId: string;
  boneNames: string[];
  materialNames: string[];
  morphNames: string[];
  animations: AnimationClip[];
  height: number;
  center: { x: number; y: number; z: number };
};
