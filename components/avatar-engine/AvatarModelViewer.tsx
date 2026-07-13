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
      <div className={`avatar-render-fallback ${className}`} aria-label="Silueta temporal del avatar CLOUVA">
        <span className="avatar-render-silhouette" />
        <p>{modelUrl ? "No pudimos cargar el modelo. Probá otra URL." : "Configurá NEXT_PUBLIC_AVATAR_BASE_URL para ver el humanoide 3D."}</p>
      </div>
    );
  }

  return (
    <div className={`avatar-render-shell ${className}`} data-state={state}>
      {state === "loading" ? <div className="avatar-loader">Cargando avatar…</div> : null}
      <model-viewer
        key={key}
        src={modelUrl}
        alt={alt}
        camera-controls
        disable-pan
        interaction-prompt="none"
        touch-action="pan-y"
        camera-orbit="0deg 78deg auto"
        min-camera-orbit="-180deg 58deg auto"
        max-camera-orbit="180deg 98deg auto"
        min-field-of-view="18deg"
        max-field-of-view="34deg"
        field-of-view="24deg"
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
