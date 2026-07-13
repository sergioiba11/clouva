"use client";

import { useState } from "react";

const TEMPORARY_REMOTE_AVATAR_URL = "https://modelviewer.dev/shared-assets/models/Astronaut.glb";

export const AVATAR_MODEL_URL = process.env.NEXT_PUBLIC_AVATAR_MODEL_URL || process.env.NEXT_PUBLIC_SUPABASE_AVATAR_MODEL_URL || "/models/clouva-avatar.glb";

export function AvatarModel({ className = "" }: { className?: string }) {
  const [modelUrl, setModelUrl] = useState(AVATAR_MODEL_URL);
  const [visualFallback, setVisualFallback] = useState(false);

  if (visualFallback) {
    return (
      <div className={`clouva-avatar-fallback ${className}`} aria-label="Personaje CLOUVA streetwear original">
        <span className="clouva-avatar-hair" />
        <span className="clouva-avatar-head" />
        <span className="clouva-avatar-hoodie"><i>☘</i></span>
        <span className="clouva-avatar-chain" />
        <span className="clouva-avatar-leg clouva-avatar-leg-left" />
        <span className="clouva-avatar-leg clouva-avatar-leg-right" />
        <span className="clouva-avatar-shoe clouva-avatar-shoe-left" />
        <span className="clouva-avatar-shoe clouva-avatar-shoe-right" />
      </div>
    );
  }

  return (
    <model-viewer
      key={modelUrl}
      src={modelUrl}
      alt="Personaje 3D CLOUVA con streetwear oscuro, cadenas y trébol"
      camera-controls
      touch-action="pan-y"
      interaction-prompt="none"
      camera-orbit="0deg 82deg 2.15m"
      min-camera-orbit="-180deg 60deg 1.55m"
      max-camera-orbit="180deg 96deg 2.85m"
      field-of-view="24deg"
      min-field-of-view="18deg"
      max-field-of-view="34deg"
      auto-rotate
      auto-rotate-delay="2400"
      rotation-per-second="1.6deg"
      shadow-intensity="0.68"
      shadow-softness="0.95"
      exposure="0.82"
      environment-image="neutral"
      ar={false}
      onError={() => {
        if (modelUrl !== TEMPORARY_REMOTE_AVATAR_URL) {
          setModelUrl(TEMPORARY_REMOTE_AVATAR_URL);
          return;
        }
        setVisualFallback(true);
      }}
      className={`clouva-model-viewer ${className}`}
      style={{ background: "transparent", width: "100%", height: "100%", minHeight: "100%" }}
    />
  );
}
