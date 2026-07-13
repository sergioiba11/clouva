"use client";

import { useEffect } from "react";
import { AvatarModelViewer } from "@/components/avatar-engine/AvatarModelViewer";
import { getRenderableAvatarUrl } from "@/lib/avatar-engine/catalog";
import { useAvatarStore } from "@/lib/avatar-engine/avatar-store";

export function AvatarModel({ className = "" }: { className?: string }) {
  const config = useAvatarStore((state) => state.config);
  const catalogReady = useAvatarStore((state) => state.catalogReady);
  const hydrate = useAvatarStore((state) => state.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const modelUrl = catalogReady ? getRenderableAvatarUrl(config) : null;

  return <AvatarModelViewer modelUrl={modelUrl} config={config} alt="Avatar activo CLOUVA" className={className} />;
}
