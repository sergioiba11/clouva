"use client";

import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { AvatarModelViewer } from "@/components/avatar-engine/AvatarModelViewer";
import { OFFICIAL_CLOUVA_MODEL_URL } from "@/lib/avatar-engine/active-avatar-store";

const HOME_AVATAR_CACHE_KEY = "clouva.home.officialAvatarUrl.v1";

function getInitialModelUrl() {
  if (typeof window === "undefined") return OFFICIAL_CLOUVA_MODEL_URL;

  try {
    const cachedUrl = window.localStorage.getItem(HOME_AVATAR_CACHE_KEY)?.trim();
    if (cachedUrl && (cachedUrl.startsWith("https://") || cachedUrl.startsWith("http://") || cachedUrl.startsWith("/"))) {
      return cachedUrl;
    }
  } catch {
    // localStorage can be unavailable in private/restricted browser contexts.
  }

  return OFFICIAL_CLOUVA_MODEL_URL;
}

export function AvatarModel({ className = "" }: { className?: string }) {
  // Start with the last real CLOUVA GLB (or the official GLB on first visit), so the
  // shared viewer never enters its procedural fallback while /api/avatar/clouva refreshes.
  const [modelUrl, setModelUrl] = useState<string>(getInitialModelUrl);
  const [motionTest, setMotionTest] = useState(false);

  useEffect(() => {
    let alive = true;

    void fetch("/api/avatar/clouva", { cache: "no-store" })
      .then((response) => response.json())
      .then((result) => {
        const nextModelUrl = typeof result?.modelUrl === "string" ? result.modelUrl.trim() : "";
        if (!alive || !nextModelUrl) return;

        setModelUrl((current) => current === nextModelUrl ? current : nextModelUrl);
        try {
          window.localStorage.setItem(HOME_AVATAR_CACHE_KEY, nextModelUrl);
        } catch {
          // The real avatar still renders even when the browser blocks storage.
        }
      })
      .catch((error) => console.warn("Could not refresh the admin CLOUVA avatar", error));

    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className={`relative h-full min-h-[100dvh] w-full ${className}`}>
      <AvatarModelViewer
        modelUrl={modelUrl}
        fallbackModelUrl={OFFICIAL_CLOUVA_MODEL_URL}
        frontRotationY={0}
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
