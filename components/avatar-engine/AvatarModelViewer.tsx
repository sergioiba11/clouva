"use client";

import { useEffect, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { buildProceduralClouvaAvatar } from "@/lib/avatar-engine/procedural-clouva";
import type { AvatarConfig } from "@/lib/avatar-engine/types";

type ModelState = "idle" | "loading" | "ready" | "error";
type Props = { modelUrl: string | null; config?: AvatarConfig; alt?: string; className?: string };

export function AvatarModelViewer({ config, className = "" }: Props) {
  const mount = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ModelState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!config || !mount.current) return;

    let disposed = false;
    const scene = new Scene();
    const camera = new PerspectiveCamera(32, 1, 0.05, 100);
    const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    let raf = 0;

    try {
      renderer.outputColorSpace = SRGBColorSpace;
      renderer.toneMapping = ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.2;
      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 768 ? 1 : 1.5));
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      renderer.domElement.style.display = "block";
      renderer.domElement.style.touchAction = "none";
      mount.current.appendChild(renderer.domElement);

      scene.add(new HemisphereLight(0xffffff, 0x1b1029, 2.4));
      scene.add(new AmbientLight(0xffffff, 1.15));
      const key = new DirectionalLight(0xffffff, 3.3);
      key.position.set(3, 5, 4);
      scene.add(key);
      const rim = new DirectionalLight(0x8b5cf6, 1.8);
      rim.position.set(-3, 2, -2);
      scene.add(rim);

      const avatar = buildProceduralClouvaAvatar(config);
      scene.add(avatar);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.enablePan = false;
      controls.enableRotate = true;
      controls.enableZoom = true;
      controls.rotateSpeed = 0.72;
      controls.zoomSpeed = 0.85;
      controls.minDistance = 3.1;
      controls.maxDistance = 6.2;
      controls.minPolarAngle = Math.PI * 0.28;
      controls.maxPolarAngle = Math.PI * 0.72;
      controls.target.set(0, 1.05, 0);
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.45;

      let resumeTimer: ReturnType<typeof setTimeout> | null = null;
      controls.addEventListener("start", () => {
        controls.autoRotate = false;
        if (resumeTimer) clearTimeout(resumeTimer);
      });
      controls.addEventListener("end", () => {
        resumeTimer = setTimeout(() => {
          controls.autoRotate = true;
        }, 2200);
      });

      const resize = () => {
        const rect = mount.current?.getBoundingClientRect();
        if (!rect) return;
        const width = Math.max(rect.width, 1);
        const height = Math.max(rect.height, 1);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.position.set(0, 1.12, camera.aspect < 0.8 ? 4.4 : 3.6);
        camera.lookAt(0, 1.05, 0);
        camera.updateProjectionMatrix();
        controls.target.set(0, 1.05, 0);
        controls.update();
      };

      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(mount.current);
      window.addEventListener("resize", resize);
      resize();
      setState("ready");

      const animate = () => {
        if (!document.hidden) {
          controls.update();
          renderer.render(scene, camera);
        }
        raf = requestAnimationFrame(animate);
      };
      raf = requestAnimationFrame(animate);

      return () => {
        disposed = true;
        cancelAnimationFrame(raf);
        if (resumeTimer) clearTimeout(resumeTimer);
        resizeObserver.disconnect();
        window.removeEventListener("resize", resize);
        controls.dispose();
        renderer.dispose();
        mount.current?.replaceChildren();
      };
    } catch (error) {
      if (!disposed) {
        setErrorMessage(error instanceof Error ? error.message : "Error creando el avatar");
        setState("error");
      }
    }
  }, [config]);

  if (!config) return null;

  return (
    <div
      className={`avatar-render-shell ${className}`}
      data-state={state}
      data-avatar-source="procedural"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", minHeight: "100dvh" }}
    >
      {state === "loading" ? <div className="avatar-loader">Construyendo CLOUVA…</div> : null}
      {state === "error" ? <div className="avatar-loader">No se pudo crear el avatar: {errorMessage}</div> : null}
      <div
        ref={mount}
        className="avatar-model-viewer"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", minHeight: "100dvh", touchAction: "none" }}
      />
    </div>
  );
}
