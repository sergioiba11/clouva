"use client";

import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { AvatarModelViewer } from "@/components/avatar-engine/AvatarModelViewer";
import { useAvatarStore } from "@/lib/avatar-engine/avatar-store";

export function AvatarModel({ className = "" }: { className?: string }) {
  const config = useAvatarStore((state) => state.config);
  const [modelUrl, setModelUrl] = useState<string | null>(null);
  const [motionTest, setMotionTest] = useState(false);

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
    <>
      <AvatarModelViewer
        modelUrl={modelUrl}
        fallbackModelUrl={null}
        frontRotationY={0}
        config={config}
        alt="CLOUVA oficial"
        className={className}
        playAnimations={false}
        motionTest={motionTest}
      />

      <button
        type="button"
        aria-pressed={motionTest}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => setMotionTest((value) => !value)}
        className="absolute bottom-24 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/15 bg-black/55 px-4 py-2 text-xs font-medium uppercase tracking-[0.14em] text-white/80 shadow-lg backdrop-blur-md transition hover:bg-black/70 active:scale-95"
      >
        <Activity className="h-4 w-4" />
        {motionTest ? "Detener movimiento" : "Probar movimiento"}
      </button>
    </>
  );
}
