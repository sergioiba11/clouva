"use client";

import { useEffect, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  DirectionalLight,
  HemisphereLight,
  Object3D,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  frameAvatar,
  normalizeAvatarObject,
  findAvatarBodyPart,
  fitGarmentToBodyPart,
  type GarmentFitOptions,
} from "@/lib/avatar-engine/frame-avatar";

const CATEGORY_BODY_MESHES: Record<string, string[]> = {
  hoodie: ["Casual_Body"],
  shirt: ["Casual_Body"],
  jacket: ["Casual_Body"],
  pants: ["Casual_Legs"],
  shorts: ["Casual_Legs"],
  shoes: ["Casual_Feet"],
};

const CATEGORY_FIT: Record<string, GarmentFitOptions> = {
  hoodie: { paddingScale: 1.03, widthPadding: 1.12, depthPadding: 1.16, verticalOffset: 0.01 },
  shirt: { paddingScale: 1.01, widthPadding: 1.07, depthPadding: 1.10, verticalOffset: 0.015 },
  jacket: { paddingScale: 1.05, widthPadding: 1.14, depthPadding: 1.18, verticalOffset: 0.01 },
  pants: { paddingScale: 1.02, widthPadding: 1.10, depthPadding: 1.12, verticalOffset: -0.015 },
  shorts: { paddingScale: 1.02, widthPadding: 1.09, depthPadding: 1.11, verticalOffset: 0 },
  shoes: { paddingScale: 1.01, widthPadding: 1.06, depthPadding: 1.10, verticalOffset: 0.005 },
};

export type OutfitLayer = {
  id: string;
  url: string;
  visible: boolean;
  category?: string;
  preFitted?: boolean;
};

type Props = {
  avatarUrl: string | null;
  layers: OutfitLayer[];
  className?: string;
};

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
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount.current);

    const loader = new GLTFLoader();

    const loadRaw = async (url: string) => {
      const gltf = await loader.loadAsync(url);
      return gltf.scene;
    };

    (async () => {
      try {
        const avatarObj = await loadRaw(avatarUrl);
        normalizeAvatarObject(avatarObj, { targetHeight: 2.05 });
        scene.add(avatarObj);
        mainModel = avatarObj;
        loadedRef.current["__avatar"] = avatarObj;

        for (const layer of layers) {
          if (disposed) return;
          const obj = await loadRaw(layer.url);

          if (layer.preFitted) {
            // Las prendas procesadas por Blender ya vienen posicionadas y riggeadas
            // en el espacio del avatar oficial. Solo copiamos la normalización global.
            obj.position.copy(avatarObj.position);
            obj.rotation.copy(avatarObj.rotation);
            obj.scale.copy(avatarObj.scale);
            scene.add(obj);
          } else {
            const bodyMeshNames = layer.category ? CATEGORY_BODY_MESHES[layer.category] : undefined;
            const bodyPart = bodyMeshNames ? findAvatarBodyPart(avatarObj, bodyMeshNames) : null;

            if (bodyPart) {
              fitGarmentToBodyPart(obj, bodyPart.box, layer.category ? CATEGORY_FIT[layer.category] : undefined);
              const fittedBox = new Box3().setFromObject(obj);
              const fittedSize = fittedBox.getSize(new Vector3());
              const bodySize = bodyPart.box.getSize(new Vector3());
              const oversized = fittedSize.y > bodySize.y * 1.8 || fittedSize.x > bodySize.x * 1.8;
              if (oversized) {
                // Algo salió mal en el ajuste automático (bounds absurdos) —
                // no la mostramos equipada para evitar el efecto "prenda
                // gigante flotando" que ya vimos antes.
                obj.visible = false;
                loadedRef.current[layer.id] = obj;
                continue;
              }
              scene.add(obj);
              avatarObj.attach(obj);
            } else {
              normalizeAvatarObject(obj, { targetHeight: 2.05 });
              avatarObj.add(obj);
            }
          }

          obj.visible = layer.visible;
          loadedRef.current[layer.id] = obj;
        }
        if (disposed) return;
        setStatus("ready");
        requestAnimationFrame(resize);
      } catch (error) {
        console.error("Outfit preview failed", error);
        if (!disposed) setStatus("error");
      }
    })();

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
      resizeObserver.disconnect();
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

  return (
    <div className={`relative h-full w-full ${className}`}>
      {status === "loading" ? <div className="absolute inset-0 grid place-items-center text-sm text-white/40">Cargando…</div> : null}
      {status === "error" ? <div className="absolute inset-0 grid place-items-center text-sm text-rose-400">No se pudo cargar la vista previa</div> : null}
      <div ref={mount} className="h-full w-full" />
    </div>
  );
}
