"use client";

import { AvatarModelViewer } from "@/components/avatar-engine/AvatarModelViewer";
import { useAvatarStore } from "@/lib/avatar-engine/avatar-store";

export function AvatarModel({ className = "" }: { className?: string }) {
  const config = useAvatarStore((state) => state.config);

  return <AvatarModelViewer modelUrl={null} config={config} alt="Avatar activo CLOUVA" className={className} />;
}
