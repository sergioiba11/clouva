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
    <div className={`relative h-full min-h-[100dvh] w-full ${className}`}>
      <AvatarModelViewer
        modelUrl={modelUrl}
        fallbackModelUrl={null}
        frontRotationY={0}
        config={config}
        alt="CLOUVA oficial"
        playAnimations={false}
        motionTest={motionTest}
      />

      <div className="fixed bottom-20 left-1/2 z-[9999] flex -translate-x-1/2 flex-col items-center gap-2">
        <button
          type="button"
          aria-pressed={motionTest}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            setMotionTest((value) => !value);
          }}
          className={`flex min-w-[190px] items-center justify-center gap-2 rounded-full border px-5 py-3 text-xs font-semibold uppercase tracking-[0.12em] shadow-2xl backdrop-blur-md transition active:scale-95 ${
            motionTest
              ? "border-violet-300/60 bg-violet-600/80 text-white"
              : "border-white/25 bg-black/80 text-white"
          }`}
        >
          <Activity className={`h-4 w-4 ${motionTest ? "animate-pulse" : ""}`} />
          {motionTest ? "Detener movimiento" : "Probar movimiento"}
        </button>

        <span className="rounded-full border border-white/10 bg-black/65 px-3 py-1 text-[10px] uppercase tracking-[0.12em] text-white/65 backdrop-blur">
          {motionTest ? "Prueba del rig activa" : "Respiración activa"}
        </span>
      </div>
    </div>
  );
}
