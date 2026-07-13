"use client";

import { useEffect, useMemo, useState } from "react";

type ModelState = "idle" | "loading" | "ready" | "error";

type ModelViewerElement = HTMLElement & {
  updateFraming?: () => Promise<void> | void;
  cameraTarget?: string;
  cameraOrbit?: string;
  fieldOfView?: string;
};

type Props = {
  modelUrl: string | null;
  alt?: string;
  className?: string;
};

export function AvatarModelViewer({ modelUrl, alt = "Avatar 3D CLOUVA", className = "" }: Props) {
  const [state, setState] = useState<ModelState>(modelUrl ? "loading" : "idle");
  const key = useMemo(() => modelUrl ?? "avatar-silhouette", [modelUrl]);

  useEffect(() => {
    setState(modelUrl ? "loading" : "idle");
  }, [modelUrl]);

  if (!modelUrl || state === "error") {
    return (
      <div className={`avatar-render-fallback ${className}`} data-avatar-source="fallback" aria-label="Preview temporal humanoide CLOUVA">
        <span className="avatar-render-silhouette" aria-hidden="true">
          <i className="avatar-fallback-glow" />
          <i className="avatar-fallback-hair" />
          <i className="avatar-fallback-head" />
          <i className="avatar-fallback-neck" />
          <i className="avatar-fallback-hood" />
          <i className="avatar-fallback-torso" />
          <i className="avatar-fallback-arm avatar-fallback-arm-left" />
          <i className="avatar-fallback-arm avatar-fallback-arm-right" />
          <i className="avatar-fallback-hand avatar-fallback-hand-left" />
          <i className="avatar-fallback-hand avatar-fallback-hand-right" />
          <i className="avatar-fallback-leg avatar-fallback-leg-left" />
          <i className="avatar-fallback-leg avatar-fallback-leg-right" />
          <i className="avatar-fallback-shoe avatar-fallback-shoe-left" />
          <i className="avatar-fallback-shoe avatar-fallback-shoe-right" />
        </span>
        <span className="sr-only" data-avatar-source-state="fallback">Avatar fallback de desarrollo activo</span>
      </div>
    );
  }

  return (
    <div className={`avatar-render-shell ${className}`} data-state={state} data-avatar-source="glb">
      {state === "loading" ? <div className="avatar-loader">Cargando avatar…</div> : null}
      <model-viewer
        key={key}
        src={modelUrl}
        alt={alt}
        camera-controls
        disable-pan
        interaction-prompt="none"
        touch-action="none"
        auto-rotate
        auto-rotate-delay="3200"
        rotation-per-second="8deg"
        camera-target="0m 1.35m 0m"
        camera-orbit="0deg 78deg 3.15m"
        min-camera-orbit="-180deg 58deg 2.35m"
        max-camera-orbit="180deg 92deg 4.15m"
        min-field-of-view="18deg"
        max-field-of-view="32deg"
        field-of-view="23deg"
        shadow-intensity="0.72"
        shadow-softness="0.95"
        exposure="1.05"
        environment-image="neutral"
        ar={false}
        onLoad={(event) => {
          const viewer = event.currentTarget as ModelViewerElement;
          void viewer.updateFraming?.();
          setState("ready");
        }}
        onError={(error) => {
          if (process.env.NODE_ENV === "development") console.error("Avatar model failed to load", error);
          setState("error");
        }}
        className="avatar-model-viewer"
      />
    </div>
  );
}
