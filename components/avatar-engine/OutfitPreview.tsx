"use client";

import { useEffect, useRef, useState } from "react";
import { ACESFilmicToneMapping, AmbientLight, Box3, DirectionalLight, HemisphereLight, Object3D, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { frameAvatar, normalizeAvatarObject, inferAvatarBodyPartBox, fitGarmentToBodyPart, type GarmentFitOptions, type WearableCategory } from "@/lib/avatar-engine/frame-avatar";

const CATEGORY_FIT: Record<WearableCategory, GarmentFitOptions> = {
  hoodie: { paddingScale: 0.98, widthPadding: 1.07, depthPadding: 1.08, verticalOffset: -0.025, forwardOffset: 0.008, minAxisRatio: 0.76, maxAxisRatio: 1.20 },
  shirt: { paddingScale: 0.96, widthPadding: 1.03, depthPadding: 1.05, verticalOffset: -0.018, forwardOffset: 0.006, minAxisRatio: 0.78, maxAxisRatio: 1.18 },
  jacket: { paddingScale: 1, widthPadding: 1.10, depthPadding: 1.12, verticalOffset: -0.025, forwardOffset: 0.01, minAxisRatio: 0.75, maxAxisRatio: 1.22 },
  pants: { paddingScale: 1, widthPadding: 1.06, depthPadding: 1.08, verticalOffset: 0, forwardOffset: 0.004, minAxisRatio: 0.78, maxAxisRatio: 1.20 },
  shorts: { paddingScale: 1, widthPadding: 1.06, depthPadding: 1.08, verticalOffset: 0, forwardOffset: 0.004, minAxisRatio: 0.78, maxAxisRatio: 1.20 },
  shoes: { paddingScale: 1, widthPadding: 1.04, depthPadding: 1.08, verticalOffset: 0, forwardOffset: 0.008, minAxisRatio: 0.72, maxAxisRatio: 1.25 },
  accessory: { paddingScale: 1, widthPadding: 1, depthPadding: 1, verticalOffset: 0, forwardOffset: 0, minAxisRatio: 0.75, maxAxisRatio: 1.25 },
};

export type OutfitLayer = { id: string; url: string; visible: boolean; category?: string; preFitted?: boolean };
type Props = { avatarUrl: string | null; layers: OutfitLayer[]; className?: string };

function categoryOf(value?: string): WearableCategory | null {
  return value && value in CATEGORY_FIT ? value as WearableCategory : null;
}

function invalidFit(object: Object3D, target: Box3) {
  object.updateMatrixWorld(true);
  const box = new Box3().setFromObject(object);
  const size = box.getSize(new Vector3());
  const targetSize = target.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const targetCenter = target.getCenter(new Vector3());
  return !Number.isFinite(size.x + size.y + size.z)
    || size.x > targetSize.x * 1.55
    || size.y > targetSize.y * 1.32
    || size.z > targetSize.z * 1.55
    || size.y < targetSize.y * 0.58
    || center.distanceTo(targetCenter) > targetSize.y * 0.55;
}

function resetRootTransform(object: Object3D) {
  object.position.set(0, 0, 0);
  object.rotation.set(0, 0, 0);
  object.scale.set(1, 1, 1);
  object.updateMatrixWorld(true);
}

function copyNormalizedAvatarTransform(garment: Object3D, avatar: Object3D) {
  garment.position.copy(avatar.position);
  garment.quaternion.copy(avatar.quaternion);
  garment.scale.copy(avatar.scale);
  garment.updateMatrixWorld(true);
}

export function OutfitPreview({ avatarUrl, layers, className = "" }: Props) {
  const mount = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const loadedRef = useRef<Record<string, Object3D>>({});

  useEffect(() => {
    if (!mount.current || !avatarUrl) return;
    let disposed = false;
    let raf = 0;
    let mainModel: Object3D | null = null;
    const scene = new Scene();
    const camera = new PerspectiveCamera(31, 1, 0.02, 100);
    const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 768 ? 1 : 1.5));
    Object.assign(renderer.domElement.style, { width: "100%", height: "100%", display: "block", touchAction: "none" });
    mount.current.appendChild(renderer.domElement);

    scene.add(new HemisphereLight(0xffffff, 0x160b25, 2.25));
    scene.add(new AmbientLight(0xffffff, 0.95));
    const key = new DirectionalLight(0xffffff, 3.1);
    key.position.set(3, 5, 4);
    scene.add(key);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;

    const resize = () => {
      const rect = mount.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.max(rect.width, 1);
      const height = Math.max(rect.height, 1);
      renderer.setSize(width, height, false);
      if (mainModel) {
        const framed = frameAvatar(camera, mainModel, width / height, 1.3);
        controls.target.copy(framed.center);
        controls.update();
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount.current);
    const loader = new GLTFLoader();

    (async () => {
      try {
        const avatarObj = (await loader.loadAsync(avatarUrl)).scene;
        normalizeAvatarObject(avatarObj, { targetHeight: 2.05 });
        scene.add(avatarObj);
        mainModel = avatarObj;
        loadedRef.current.__avatar = avatarObj;

        for (const layer of layers) {
          if (disposed) return;
          const obj = (await loader.loadAsync(layer.url)).scene;
          const category = categoryOf(layer.category);
          if (category) {
            const target = inferAvatarBodyPartBox(avatarObj, category);

            if (layer.preFitted) copyNormalizedAvatarTransform(obj, avatarObj);

            if (!layer.preFitted || invalidFit(obj, target)) {
              resetRootTransform(obj);
              fitGarmentToBodyPart(obj, target, CATEGORY_FIT[category]);

              if (invalidFit(obj, target)) {
                resetRootTransform(obj);
                fitGarmentToBodyPart(obj, target, {
                  ...CATEGORY_FIT[category],
                  widthPadding: (CATEGORY_FIT[category].widthPadding ?? 1) * 0.94,
                  depthPadding: (CATEGORY_FIT[category].depthPadding ?? 1) * 0.94,
                });
              }
            }

            scene.add(obj);
            avatarObj.attach(obj);

            // Nunca ocultamos una pieza que el usuario equipó. La validación sirve
            // para elegir el mejor ajuste, no para convertirla en invisible.
            if (invalidFit(obj, target)) {
              console.warn("CLOUVA wearable fit outside expected bounds", {
                layerId: layer.id,
                category,
                preFitted: layer.preFitted,
              });
            }
          } else {
            normalizeAvatarObject(obj, { targetHeight: 0.65 });
            avatarObj.add(obj);
          }

          obj.visible = layer.visible;
          loadedRef.current[layer.id] = obj;
        }
        if (!disposed) {
          setStatus("ready");
          requestAnimationFrame(resize);
        }
      } catch (error) {
        console.error("Outfit preview failed", error);
        if (!disposed) setStatus("error");
      }
    })();

    const animate = () => {
      if (!document.hidden) { controls.update(); renderer.render(scene, camera); }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      mount.current?.replaceChildren();
      loadedRef.current = {};
    };
  }, [avatarUrl, layers.map((layer) => `${layer.url}:${layer.category ?? ""}:${layer.preFitted ? 1 : 0}`).join(",")]);

  useEffect(() => {
    for (const layer of layers) {
      const obj = loadedRef.current[layer.id];
      if (obj) obj.visible = layer.visible;
    }
  }, [layers.map((layer) => `${layer.id}:${layer.visible}`).join(",")]);

  return <div className={`relative h-full w-full ${className}`}>
    {status === "loading" ? <div className="absolute inset-0 grid place-items-center text-sm text-white/40">Cargando…</div> : null}
    {status === "error" ? <div className="absolute inset-0 grid place-items-center text-sm text-rose-400">No se pudo cargar la vista previa</div> : null}
    <div ref={mount} className="h-full w-full" />
  </div>;
}
