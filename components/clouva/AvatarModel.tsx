"use client";

import { AvatarModelViewer } from "@/components/avatar-engine/AvatarModelViewer";
import { getRenderableAvatarUrl } from "@/lib/avatar-engine/catalog";

export const AVATAR_MODEL_URL = getRenderableAvatarUrl();

export function AvatarModel({ className = "" }: { className?: string }) {
  return <AvatarModelViewer modelUrl={AVATAR_MODEL_URL} alt="Avatar activo CLOUVA" className={className} />;
}
