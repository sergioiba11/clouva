"use client";

import { useEffect, useState } from "react";
import { AvatarModelViewer } from "@/components/avatar-engine/AvatarModelViewer";
import { useAvatarStore } from "@/lib/avatar-engine/avatar-store";

export function AvatarModel({ className = "" }: { className?: string }) {
  const config = useAvatarStore((state) => state.config);
  const [modelUrl, setModelUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void fetch("/api/avatar/clouva", { cache: "no-store" })
      .then((response) => response.json())
      .then((result) => {
        if (alive && result?.modelUrl) setModelUrl(result.modelUrl);
      })
      .catch((error) => console.warn("Could not load the admin CLOUVA avatar", error));
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
