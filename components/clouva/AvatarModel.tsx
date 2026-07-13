"use client";

import { useState } from "react";

const MODEL_SRC = "/models/clouva-avatar.glb";

export function AvatarModel() {
  const [fallback, setFallback] = useState(false);

  if (fallback) {
    return (
      <div className="clouva-avatar-fallback" aria-label="Personaje 3D CLOUVA">
        <div className="clouva-avatar-halo" />
        <div className="clouva-avatar-head" />
        <div className="clouva-avatar-torso" />
        <div className="clouva-avatar-leg clouva-avatar-leg-left" />
        <div className="clouva-avatar-leg clouva-avatar-leg-right" />
      </div>
    );
  }

  return (
    <model-viewer
      src={MODEL_SRC}
      alt="Personaje 3D CLOUVA"
      camera-controls
      touch-action="none"
      interaction-prompt="none"
      camera-orbit="0deg 80deg 1.72m"
      min-camera-orbit="auto 58deg 1.28m"
      max-camera-orbit="auto 96deg 2.65m"
      field-of-view="20deg"
      min-field-of-view="16deg"
      max-field-of-view="32deg"
      auto-rotate
      auto-rotate-delay="0"
      rotation-per-second="2.2deg"
      shadow-intensity="0.58"
      shadow-softness="0.96"
      exposure="0.72"
      environment-image="neutral"
      ar={false}
      onError={() => setFallback(true)}
      className="clouva-model-viewer h-full w-full"
      style={{ background: "transparent", minHeight: "100%" }}
    />
  );
}
