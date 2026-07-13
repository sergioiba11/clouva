"use client";

import { AvatarModelViewer } from "@/components/avatar-engine/AvatarModelViewer";
import { useActiveAvatarStore } from "@/lib/avatar-engine/active-avatar-store";
import { useAvatarStore } from "@/lib/avatar-engine/avatar-store";

export function AvatarModel({ className = "" }: { className?: string }) {
  const config = useAvatarStore((state) => state.config);
  const avatar = useActiveAvatarStore((state) => state.avatar);

  return (
    <AvatarModelViewer
      modelUrl={avatar.modelUrl}
      fallbackModelUrl={avatar.fallbackUrl}
      frontRotationY={avatar.frontRotationY}
      config={config}
      alt="Avatar activo CLOUVA"
      className={className}
    />
  );
}
