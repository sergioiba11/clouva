"use client";

import { useEffect, useRef, useState } from "react";
import { ACESFilmicToneMapping, AmbientLight, Box3, DirectionalLight, HemisphereLight, Object3D, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { frameAvatar, normalizeAvatarObject, findAvatarBodyPart, inferAvatarBodyPartBox, fitGarmentToBodyPart, type GarmentFitOptions, type WearableCategory } from "@/lib/avatar-engine/frame-avatar";

const CATEGORY_BODY_MESHES: Record<WearableCategory, string[]> = {
  hoodie: ["Casual_Body"], shirt: ["Casual_Body"], jacket: ["Casual_Body"],
  pants: ["Casual_Legs"], shorts: ["Casual_Legs"], shoes: ["Casual_Feet"], accessory: ["Casual_Body"],
};

const CATEGORY_FIT: Record<WearableCategory, GarmentFitOptions> = {
  hoodie: { paddingScale: 1.01, widthPadding: 1.10, depthPadding: 1.14, verticalOffset: 0.01 },
  shirt: { paddingScale: 1, widthPadding: 1.06, depthPadding: 1.09, verticalOffset: 0.01 },
  jacket: { paddingScale: 1.02, widthPadding: 1.12, depthPadding: 1.16, verticalOffset: 0.01 },
  pants: { paddingScale: 1, widthPadding: 1.08, depthPadding: 1.10, verticalOffset: -0.01 },
  shorts: { paddingScale: 1, widthPadding: 1.08, depthPadding: 1.10, verticalOffset: 0 },
  shoes: { paddingScale: 1, widthPadding: 1.05, depthPadding: 1.10, verticalOffset: 0.005 },
  accessory: { paddingScale: 1, widthPadding: 1, depthPadding: 1, verticalOffset: 0 },
};

export type OutfitLayer = { id: string; url: string; visible: boolean; category?: string; preFitted?: boolean };
type Props = { avatarUrl: string | null; layers: OutfitLayer[]; className?: string };

function categoryOf(value?: string): WearableCategory | null {
  return value && value in CATEGORY_BODY_MESHES ? value as WearableCategory : null;
}

function invalidFit(object: Object3D, target: Box3) {
  object.updateMatrixWorld(true);
  const box = new Box3().setFromObject(object);
  const size = box.getSize(new Vector3());
  const targetSize = target.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const targetCenter = target.getCenter(new Vector3());
  return size.x > targetSize.x * 1.65 || size.y > targetSize.y * 1.65 || size.z > targetSize.z * 1.9 || center.distanceTo(targetCenter) > targetSize.y * 0.55;
}

function resetRootTransform(object: Object3D) {
  object.position.set(0, 0, 0);
  object.rotation.set(0, 0, 0);
  object.scale.set(1, 1, 1);
  object.updateMatrixWorld(true);
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
            const named = findAvatarBodyPart(avatarObj, CATEGORY_BODY_MESHES[category]);
            const target = named?.box ?? inferAvatarBodyPartBox(avatarObj, category);

            // Los GLB generados por Meshy suelen conservar offsets, escala o un
            // armature propio en la raíz. Copiar el transform del avatar hacía
            // que una prenda marcada como fitted pudiera quedar sobre la cabeza.
            // Para la vista previa siempre partimos de una raíz neutra y la
            // ajustamos contra la zona corporal real del avatar.
            resetRootTransform(obj);
            fitGarmentToBodyPart(obj, target, CATEGORY_FIT[category]);

            // Attach conserva el transform mundial calculado y hace que la pieza
            // acompañe al avatar al rotarlo en el visor.
            scene.add(obj);
            avatarObj.attach(obj);

            // Una segunda validación evita mostrar assets rotos o con geometría
            // residual muy alejada del cuerpo.
            if (invalidFit(obj, target)) {
              resetRootTransform(obj);
              fitGarmentToBodyPart(obj, target, CATEGORY_FIT[category]);
              avatarObj.attach(obj);
            }
            if (invalidFit(obj, target)) obj.visible = false;
          } else {
            normalizeAvatarObject(obj, { targetHeight: 0.65 });
            avatarObj.add(obj);
          }
          obj.visible = obj.visible !== false && layer.visible;
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
