"use client";

import { Suspense } from "react";
import { useActiveAvatarStore } from "@/lib/avatar-engine/active-avatar-store";
import type { AvatarConfig } from "@/lib/avatar-engine/types";
import { AvatarModelViewer } from "./AvatarModelViewer";

export function AvatarCanvas({ config }: { config: AvatarConfig }) {
  const avatar = useActiveAvatarStore((state) => state.avatar);

  return (
    <section
      className="avatar-canvas"
      aria-label="Vista 3D del avatar CLOUVA"
      style={{ position: "absolute", inset: 0, zIndex: 1, width: "100%", height: "100%", minHeight: "100dvh", overflow: "hidden" }}
    >
      <div className="avatar-canvas-lights" />
      <Suspense fallback={<div className="avatar-loader">Cargando avatar…</div>}>
        <AvatarModelViewer
          modelUrl={avatar.modelUrl}
          fallbackModelUrl={avatar.fallbackUrl}
          frontRotationY={avatar.frontRotationY}
          config={config}
          className="avatar-engine-viewer"
          alt="Personaje humanoide CLOUVA configurado"
        />
      </Suspense>
      <div className="avatar-canvas-note">Arrastrá para girar · Pinch/scroll para zoom limitado</div>
    </section>
  );
}
