"use client";

import { AvatarModelViewer } from "@/components/avatar-engine/AvatarModelViewer";
import { OFFICIAL_CLOUVA_MODEL_URL } from "@/lib/avatar-engine/active-avatar-store";
import { useAvatarStore } from "@/lib/avatar-engine/avatar-store";

export function AvatarModel({ className = "" }: { className?: string }) {
  const config = useAvatarStore((state) => state.config);

  return (
    <AvatarModelViewer
      modelUrl={OFFICIAL_CLOUVA_MODEL_URL}
      fallbackModelUrl={null}
      frontRotationY={0}
      config={config}
      alt="CLOUVA oficial"
      className={className}
      playAnimations={false}
    />
  );
}
