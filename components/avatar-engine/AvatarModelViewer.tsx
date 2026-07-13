"use client";

import { useEffect, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  AmbientLight,
  AnimationMixer,
  Clock,
  DirectionalLight,
  HemisphereLight,
  Object3D,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { frameAvatar, normalizeAvatarObject } from "@/lib/avatar-engine/frame-avatar";
import { buildProceduralClouvaAvatar } from "@/lib/avatar-engine/procedural-clouva";
import type { AvatarConfig } from "@/lib/avatar-engine/types";

type ModelState = "loading" | "ready" | "fallback" | "error";
type Props = {
  modelUrl: string | null;
  fallbackModelUrl?: string | null;
  modelData?: ArrayBuffer | null;
  frontRotationY?: number;
  config?: AvatarConfig;
  alt?: string;
  className?: string;
  playAnimations?: boolean;
};

export function AvatarModelViewer({
  modelUrl,
  fallbackModelUrl = null,
  modelData,
  frontRotationY = 0,
  config,
  className = "",
  playAnimations = true,
}: Props) {
  const mount = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ModelState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!mount.current) return;

    let disposed = false;
    let raf = 0;
    let currentModel: Object3D | null = null;
    let mixer: AnimationMixer | null = null;
    let resumeTimer: ReturnType<typeof setTimeout> | null = null;
    const clock = new Clock();

    const scene = new Scene();
    const camera = new PerspectiveCamera(31, 1, 0.02, 100);
    const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });

    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 768 ? 1 : 1.5));
    Object.assign(renderer.domElement.style, { width: "100%", height: "100%", display: "block", touchAction: "none" });
    mount.current.appendChild(renderer.domElement);

    scene.add(new HemisphereLight(0xffffff, 0x160b25, 2.25));
    scene.add(new AmbientLight(0xffffff, 0.95));
    const key = new DirectionalLight(0xffffff, 3.1);
    key.position.set(3, 5, 4);
    scene.add(key);
    const rim = new DirectionalLight(0x8b5cf6, 2.1);
    rim.position.set(-3, 2.5, -3);
    scene.add(rim);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.enablePan = false;
    controls.enableRotate = true;
    controls.enableZoom = true;
    controls.rotateSpeed = 0.72;
    controls.zoomSpeed = 0.82;
    controls.minPolarAngle = Math.PI * 0.2;
    controls.maxPolarAngle = Math.PI * 0.78;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;

    controls.addEventListener("start", () => {
      controls.autoRotate = false;
      if (resumeTimer) clearTimeout(resumeTimer);
    });
    controls.addEventListener("end", () => {
      resumeTimer = setTimeout(() => {
        controls.autoRotate = true;
      }, 2600);
    });

    const resize = () => {
      const rect = mount.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.max(rect.width, 1);
      const height = Math.max(rect.height, 1);
      renderer.setSize(width, height, false);

      if (currentModel) {
        const framed = frameAvatar(camera, currentModel, width / height, 1.28);
        controls.target.copy(framed.center);
        controls.minDistance = Math.max(framed.distance * 0.72, 1.1);
        controls.maxDistance = framed.distance * 1.75;
        controls.update();
      } else {
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      }
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount.current);
    window.addEventListener("resize", resize);

    const loader = new GLTFLoader();
    let loaderReady: Promise<void> = Promise.resolve();
    if (MeshoptDecoder && typeof (MeshoptDecoder as any).ready?.then === "function") {
      loaderReady = (MeshoptDecoder as any).ready.then(() => {
        loader.setMeshoptDecoder(MeshoptDecoder);
      });
    } else {
      loader.setMeshoptDecoder(MeshoptDecoder);
    }

    const attachModel = (object: Object3D, animations: any[], isFallback: boolean) => {
      if (disposed) return;
      normalizeAvatarObject(object, { targetHeight: 2.05, frontRotationY });
      object.traverse((child: any) => {
        if (child.isMesh || child.isSkinnedMesh) {
          child.visible = true;
          child.frustumCulled = false;
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      currentModel = object;
      scene.add(object);

      if (playAnimations && animations.length) {
        mixer = new AnimationMixer(object);
        const idle = animations.find((clip) => String(clip.name).toLowerCase() === "idle")
          ?? animations.find((clip) => String(clip.name).toLowerCase().includes("idle"));
        if (idle) mixer.clipAction(idle).reset().play();
      }

      setState(isFallback ? "fallback" : "ready");
      setErrorMessage(null);
      requestAnimationFrame(resize);
    };

    const loadUrl = async (url: string, isFallback: boolean) => {
      await loaderReady;
      const gltf = await loader.loadAsync(url);
      attachModel(gltf.scene, gltf.animations, isFallback);
    };

    const useTechnicalFallback = () => {
      if (!config) {
        setState("error");
        return;
      }
      const fallback = buildProceduralClouvaAvatar(config);
      attachModel(fallback, [], true);
    };

    const load = async () => {
      setState("loading");
      setErrorMessage(null);
      try {
        if (modelData) {
          await loaderReady;
          const gltf = await loader.parseAsync(modelData.slice(0), "");
          attachModel(gltf.scene, gltf.animations, false);
          return;
        }
        if (modelUrl) {
          await loadUrl(modelUrl, false);
          return;
        }
        throw new Error("No active avatar URL");
      } catch (primaryError) {
        console.warn("Primary avatar failed", primaryError);
        if (fallbackModelUrl && fallbackModelUrl !== modelUrl) {
          try {
            await loadUrl(fallbackModelUrl, true);
            return;
          } catch (fallbackError) {
            console.error("Temporary rig failed", fallbackError);
            setErrorMessage(fallbackError instanceof Error ? fallbackError.message : String(fallbackError));
          }
        } else {
          setErrorMessage(primaryError instanceof Error ? primaryError.message : String(primaryError));
        }
        useTechnicalFallback();
      }
    };

    void load();

    const animate = () => {
      if (!document.hidden) {
        mixer?.update(clock.getDelta());
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
      mixer?.stopAllAction();
      controls.dispose();
      renderer.dispose();
      mount.current?.replaceChildren();
    };
  }, [modelUrl, fallbackModelUrl, modelData, frontRotationY, playAnimations]);

  return (
    <div
      className={`avatar-render-shell ${className}`}
      data-state={state}
      data-avatar-source={state === "ready" ? "glb" : "fallback"}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", minHeight: "100dvh" }}
    >
      {state === "loading" ? <div className="avatar-loader">Cargando CLOUVA…</div> : null}
      {state === "error" ? (
        <div className="avatar-loader" style={{ maxWidth: "88vw", textAlign: "center", zIndex: 30 }}>
          Error de avatar: {errorMessage}
        </div>
      ) : null}
      <div
        ref={mount}
        className="avatar-model-viewer"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", minHeight: "100dvh", touchAction: "none" }}
      />
    </div>
  );
}
