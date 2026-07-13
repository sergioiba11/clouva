"use client";

import { useEffect, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  AmbientLight,
  AnimationMixer,
  Box3,
  Clock,
  DirectionalLight,
  HemisphereLight,
  MathUtils,
  Object3D,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { applyAvatarConfig } from "@/lib/avatar-engine/apply-avatar-config";
import { getAvatarItem } from "@/lib/avatar-engine/catalog";
import {
  analyzeObject,
  applyMaterialColors,
  applyMorphValues,
  loadAvatarPart,
  normalizeAvatarObject,
  setHairColor,
  setSkinTone,
  validateAvatarItemCompatibility,
} from "@/lib/avatar-engine/load-avatar-part";
import type { AvatarConfig, BaseAvatarModel, LoadedAvatarPart } from "@/lib/avatar-engine/types";

type ModelState = "idle" | "loading" | "ready" | "error";
type Props = { modelUrl: string | null; config?: AvatarConfig; alt?: string; className?: string };
const debug = process.env.NEXT_PUBLIC_AVATAR_DEBUG === "true";

function Fallback({ className }: { className: string }) {
  return (
    <div
      className={`avatar-render-fallback ${className}`}
      data-avatar-source="fallback"
      aria-label="Preview temporal humanoide CLOUVA"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", minHeight: "100dvh" }}
    >
      <span className="avatar-render-silhouette" aria-hidden="true" />
    </div>
  );
}

function frameObject(camera: PerspectiveCamera, object: Object3D, aspect: number) {
  object.updateMatrixWorld(true);
  const box = new Box3().setFromObject(object);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const verticalFov = MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(aspect, 0.1));
  const distanceForHeight = size.y / (2 * Math.tan(verticalFov / 2));
  const distanceForWidth = size.x / (2 * Math.tan(horizontalFov / 2));
  const distance = Math.max(distanceForHeight, distanceForWidth, size.z * 2, 2) * 1.18;

  camera.near = Math.max(distance / 100, 0.01);
  camera.far = Math.max(distance * 20, 100);
  camera.position.set(center.x, center.y + size.y * 0.02, center.z + distance);
  camera.lookAt(center.x, center.y + size.y * 0.02, center.z);
  camera.updateProjectionMatrix();
}

export function AvatarModelViewer({ modelUrl, config, className = "" }: Props) {
  const mount = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ModelState>(modelUrl ? "loading" : "idle");
  const [base, setBase] = useState<BaseAvatarModel | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!modelUrl || !config || !mount.current) return;

    let disposed = false;
    const scene = new Scene();
    const camera = new PerspectiveCamera(32, 1, 0.01, 100);
    const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    const clock = new Clock();
    let mixer: AnimationMixer | null = null;
    let raf = 0;
    let bodyObject: Object3D | null = null;
    const loadedParts: Record<string, LoadedAvatarPart> = {};

    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 768 ? 1 : 1.5));
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    mount.current.appendChild(renderer.domElement);

    scene.add(new HemisphereLight(0xffffff, 0x221133, 2.2));
    scene.add(new AmbientLight(0xffffff, 1.1));
    const key = new DirectionalLight(0xffffff, 3.2);
    key.position.set(3, 5, 4);
    scene.add(key);
    const fill = new DirectionalLight(0x8b5cf6, 1.4);
    fill.position.set(-3, 2, 2);
    scene.add(fill);

    const resize = () => {
      const rect = mount.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.max(rect.width, 1);
      const height = Math.max(rect.height, 1);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      if (bodyObject) frameObject(camera, bodyObject, camera.aspect);
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount.current);
    window.addEventListener("resize", resize);
    resize();

    const animate = () => {
      if (!document.hidden) {
        mixer?.update(clock.getDelta());
        renderer.render(scene, camera);
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    (async () => {
      setState("loading");
      setErrorMessage(null);

      const item = getAvatarItem(config.bodyId);
      if (!item) throw new Error(`No hay body GLB ready para ${config.bodyId}`);

      const body = await loadAvatarPart(item, null);
      if (disposed) return;

      normalizeAvatarObject(body.object);
      bodyObject = body.object;
      scene.add(body.object);

      const analysis = analyzeObject(body.object);
      frameObject(camera, body.object, camera.aspect);

      mixer = new AnimationMixer(body.object);
      const model: BaseAvatarModel = {
        object: body.object,
        skeletonId: body.skeletonId,
        boneNames: analysis.boneNames,
        materialNames: analysis.materialNames,
        morphNames: analysis.morphNames,
        animations: body.animations,
        height: analysis.size.y,
        center: { x: analysis.center.x, y: analysis.center.y, z: analysis.center.z },
      };

      setBase(model);
      applyMaterialColors(body.object, config.materialColors);
      setSkinTone(body.object, config.skinTone);
      setHairColor(body.object, config.hairColor);
      applyMorphValues(body.object, config.morphValues);

      const clip =
        body.animations.find((candidate: any) =>
          String(candidate.name).toLowerCase().includes(String(config.activeAnimation ?? "idle").toLowerCase()),
        ) ?? body.animations[0];
      if (clip) mixer.clipAction(clip).reset().fadeIn(0.25).play();

      await applyAvatarConfig(config, model);

      for (const id of [config.faceId, config.hairId, config.topId, config.bottomId, config.shoesId, ...config.accessoryIds].filter(Boolean) as string[]) {
        const partItem = getAvatarItem(id);
        if (!partItem || !validateAvatarItemCompatibility(partItem, model).compatible) continue;
        const part = await loadAvatarPart(partItem, model);
        loadedParts[id] = part;
        scene.add(part.object);
        applyMaterialColors(part.object, config.materialColors);
        setHairColor(part.object, config.hairColor);
        applyMorphValues(part.object, config.morphValues);
      }

      resize();
      setState("ready");
    })().catch((error) => {
      const message = error instanceof Error ? error.message : "Error desconocido cargando el avatar";
      console.error("Avatar model failed to load", error);
      setErrorMessage(message);
      setState("error");
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      window.removeEventListener("resize", resize);
      Object.values(loadedParts).forEach((part) => part.dispose());
      renderer.dispose();
      mount.current?.replaceChildren();
    };
  }, [modelUrl, config]);

  if (!modelUrl || !config) return <Fallback className={className} />;

  return (
    <div
      className={`avatar-render-shell ${className}`}
      data-state={state}
      data-avatar-source="glb"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", minHeight: "100dvh" }}
    >
      {state === "loading" ? <div className="avatar-loader">Cargando avatar…</div> : null}
      {state === "error" ? (
        <div className="avatar-loader" style={{ maxWidth: "90vw", textAlign: "center" }}>
          No se pudo cargar el avatar: {errorMessage}
        </div>
      ) : null}
      <div
        ref={mount}
        className="avatar-model-viewer"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", minHeight: "100dvh" }}
      />
      {debug && base ? (
        <pre className="avatar-debug-panel">
          {JSON.stringify(
            {
              source: "glb",
              baseUrl: modelUrl,
              skeletonId: base.skeletonId,
              bones: base.boneNames,
              clips: base.animations.map((candidate: any) => candidate.name),
              morphs: base.morphNames,
              materials: base.materialNames,
              config,
            },
            null,
            2,
          )}
        </pre>
      ) : null}
    </div>
  );
}
