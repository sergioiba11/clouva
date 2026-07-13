"use client";

import { useState } from "react";

const MODEL_SRC = "/models/clouva-avatar.glb";

export function AvatarModel() {
  const [fallback, setFallback] = useState(false);

  if (fallback) {
    return (
      <div className="clouva-avatar-fallback" aria-label="Placeholder 3D de avatar CLOUVA">
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
      touch-action="pan-y"
      interaction-prompt="none"
      camera-orbit="0deg 82deg 2.25m"
      min-camera-orbit="auto 58deg 1.55m"
      max-camera-orbit="auto 98deg 3.4m"
      field-of-view="28deg"
      min-field-of-view="20deg"
      max-field-of-view="42deg"
      auto-rotate
      auto-rotate-delay="1400"
      rotation-per-second="10deg"
      shadow-intensity="0.75"
      shadow-softness="0.92"
      exposure="0.82"
      environment-image="neutral"
      ar={false}
      onError={() => setFallback(true)}
      className="h-full w-full"
      style={{ background: "transparent", minHeight: "100%" }}
    />
  );
}
