import type { AvatarItem } from "./types";

export type LoadedAvatarPart = {
  item: AvatarItem;
  skeletonId: string;
  skinnedMeshNames: string[];
  modelUrl: string;
};

export async function loadAvatarPart(item: AvatarItem, baseSkeletonId: string): Promise<LoadedAvatarPart> {
  if (item.compatibleSkeleton !== baseSkeletonId) {
    throw new Error(`Avatar part ${item.id} requires skeleton ${item.compatibleSkeleton}, expected ${baseSkeletonId}`);
  }

  return {
    item,
    skeletonId: baseSkeletonId,
    skinnedMeshNames: [`${item.id}:SkinnedMesh`],
    modelUrl: item.modelUrl,
  };
}
