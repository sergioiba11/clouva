"use client";

import { useEffect, useState } from "react";
import { AvatarModelViewer } from "@/components/avatar-engine/AvatarModelViewer";
import { OFFICIAL_CLOUVA_MODEL_URL } from "@/lib/avatar-engine/active-avatar-store";
import { useAvatarStore } from "@/lib/avatar-engine/avatar-store";

export function AvatarModel({ className = "" }: { className?: string }) {
  const config = useAvatarStore((state) => state.config);
  const [modelUrl, setModelUrl] = useState(OFFICIAL_CLOUVA_MODEL_URL);

  useEffect(() => {
    let alive = true;
    void fetch("/api/avatar/official", { cache: "no-store" })
      .then((response) => response.json())
      .then((result) => {
        if (alive && result?.modelUrl) setModelUrl(result.modelUrl);
      })
      .catch((error) => console.warn("Could not refresh official CLOUVA model", error));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <AvatarModelViewer
      modelUrl={modelUrl}
      fallbackModelUrl={null}
      frontRotationY={0}
      config={config}
      alt="CLOUVA oficial"
      className={className}
      playAnimations={false}
    />
  );
}
