"use client";

import { AvatarModelViewer } from "@/components/avatar-engine/AvatarModelViewer";
import { defaultAvatarConfig } from "@/lib/avatar-engine/catalog";
import { getRenderableAvatarUrl } from "@/lib/avatar-engine/catalog";

export const AVATAR_MODEL_URL = getRenderableAvatarUrl();

export function AvatarModel({ className = "" }: { className?: string }) {
  return <AvatarModelViewer modelUrl={AVATAR_MODEL_URL} config={defaultAvatarConfig} alt="Avatar activo CLOUVA" className={className} />;
}
