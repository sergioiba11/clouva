"use client";

import { AvatarModelViewer } from "@/components/avatar-engine/AvatarModelViewer";
import { useAvatarStore } from "@/lib/avatar-engine/avatar-store";

const DEFAULT_BODY_URL = "/models/base-body-quaternius.glb";

export function AvatarModel({ className = "" }: { className?: string }) {
  const config = useAvatarStore((state) => state.config);

  return <AvatarModelViewer modelUrl={DEFAULT_BODY_URL} config={config} alt="Avatar activo CLOUVA" className={className} />;
}
