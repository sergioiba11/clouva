"use client";

import { useEffect, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  AmbientLight,
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
import { frameAvatar, normalizeAvatarObject, findAvatarBodyPart, fitGarmentToBodyPart } from "@/lib/avatar-engine/frame-avatar";

// Mapeo de categoría de prenda -> nombre(s) de malla real del avatar
// actual (hoodie-character.glb). Si el avatar activo es otro modelo,
// simplemente no se encuentra ninguna malla y se usa el respaldo por
// altura total (ver más abajo).
const CATEGORY_BODY_MESHES: Record<string, string[]> = {
  hoodie: ["Casual_Body"],
  shirt: ["Casual_Body"],
  jacket: ["Casual_Body"],
  pants: ["Casual_Legs"],
  shorts: ["Casual_Legs"],
  shoes: ["Casual_Feet"],
};

export type OutfitLayer = { id: string; url: string; visible: boolean; category?: string };

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
          const bodyMeshNames = layer.category ? CATEGORY_BODY_MESHES[layer.category] : undefined;
          const bodyPart = bodyMeshNames ? findAvatarBodyPart(avatarObj, bodyMeshNames) : null;
          if (bodyPart) {
            // Calce real: escala/posiciona contra la medida verdadera
            // de esa parte del cuerpo en el GLB del avatar.
            fitGarmentToBodyPart(obj, bodyPart.box);
          } else {
            // Respaldo: no sabemos qué malla del avatar corresponde
            // (categoría desconocida o modelo de avatar distinto), así
            // que al menos igualamos la altura total como antes.
            normalizeAvatarObject(obj, { targetHeight: 2.05 });
          }
          scene.add(obj);
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
  }, [avatarUrl, layers.map((l) => l.url).join(",")]);

  // Actualiza visibilidad de capas ya cargadas sin recargar toda la escena.
  useEffect(() => {
    for (const layer of layers) {
      const obj = loadedRef.current[layer.id];
      if (obj) obj.visible = layer.visible;
    }
  }, [layers.map((l) => `${l.id}:${l.visible}`).join(",")]);

  return (
    <div className={`relative h-full w-full ${className}`}>
      {status === "loading" ? <div className="absolute inset-0 grid place-items-center text-sm text-white/40">Cargando…</div> : null}
      {status === "error" ? <div className="absolute inset-0 grid place-items-center text-sm text-rose-400">No se pudo cargar la vista previa</div> : null}
      <div ref={mount} className="h-full w-full" />
    </div>
  );
}
