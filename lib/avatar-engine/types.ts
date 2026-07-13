export type AvatarCategory = "body" | "hair" | "top" | "bottom" | "shoes" | "accessory" | "color" | "animation";

export interface AvatarItem {
  id: string;
  name: string;
  category: AvatarCategory;
  modelUrl: string;
  thumbnailUrl: string;
  free: boolean;
  compatibleSkeleton: string;
  colors?: string[];
}

export interface AvatarConfig {
  bodyId: string;
  hairId: string | null;
  topId: string | null;
  bottomId: string | null;
  shoesId: string | null;
  accessoryIds: string[];
  skinTone: string;
  hairColor: string;
  materialColors: Record<string, string>;
  morphValues: Record<string, number>;
}

export type AvatarSkeletonId = "clouva-humanoid-v1";
export const CLOUVA_SKELETON_ID: AvatarSkeletonId = "clouva-humanoid-v1";
