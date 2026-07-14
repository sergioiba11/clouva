"use client";

import { useEffect, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  AmbientLight,
  AnimationMixer,
  Bone,
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
import {
  frameAvatar,
  normalizeAvatarObject,
  findAvatarBodyPart,
  fitWearableToBodyPart,
  type WearableCategory,
} from "@/lib/avatar-engine/frame-avatar";
import { autoSkinGarmentToAvatar } from "@/lib/avatar-engine/auto-skin-garment";

const CATEGORY_BODY_MESHES: Record<string, string[]> = {
  hoodie: ["Casual_Body"],
  shirt: ["Casual_Body"],
  jacket: ["Casual_Body"],
  pants: ["Casual_Legs"],
  shorts: ["Casual_Legs"],
  shoes: ["Casual_Feet"],
  accessory: ["Casual_Body"],
};

const CATEGORY_BONE_HINTS: Record<WearableCategory, string[]> = {
  hoodie: ["chest", "spine2", "spine_02", "upperchest", "spine1", "spine"],
  shirt: ["chest", "spine2", "spine_02", "upperchest", "spine1", "spine"],
  jacket: ["chest", "spine2", "spine_02", "upperchest", "spine1", "spine"],
  pants: ["hips", "pelvis", "root"],
  shorts: ["hips", "pelvis", "root"],
  shoes: ["hips", "pelvis", "root"],
  accessory: ["chest", "head", "spine"],
};

export type OutfitLayer = { id: string; url: string; visible: boolean; category?: string };

type Props = {
  avatarUrl: string | null;
  layers: OutfitLayer[];
  className?: string;
};

function isWearableCategory(value?: string): value is WearableCategory {
  return Boolean(value && value in CATEGORY_BODY_MESHES);
}

function findAttachmentBone(avatar: Object3D, category: WearableCategory): Bone | null {
  const hints = CATEGORY_BONE_HINTS[category];
  let exact: Bone | null = null;
  let partial: Bone | null = null;

  avatar.traverse((child) => {
    if (!(child as Bone).isBone || exact) return;
    const name = child.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const hint of hints) {
      const normalizedHint = hint.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (name === normalizedHint) {
        exact = child as Bone;
        return;
      }
      if (!partial && name.includes(normalizedHint)) partial = child as Bone;
    }
  });

  return exact ?? partial;
}

function attachPreservingWorld(child: Object3D, parent: Object3D) {
  child.updateMatrixWorld(true);
  parent.updateMatrixWorld(true);
  parent.attach(child);
  child.updateMatrixWorld(true);
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
    let mixer: AnimationMixer | null = null;
    const clock = new Clock();

    setStatus("loading");
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

    (async () => {
      try {
        const avatarGltf = await loader.loadAsync(avatarUrl);
        const avatarObj = avatarGltf.scene;
        normalizeAvatarObject(avatarObj, { targetHeight: 2.05 });
        scene.add(avatarObj);
        mainModel = avatarObj;
        loadedRef.current["__avatar"] = avatarObj;

        if (avatarGltf.animations.length > 0) {
          mixer = new AnimationMixer(avatarObj);
          mixer.clipAction(avatarGltf.animations[0]).reset().fadeIn(0.25).play();
        }

        for (const layer of layers) {
          if (disposed) return;
          const garmentGltf = await loader.loadAsync(layer.url);
          const obj = garmentGltf.scene;
          const category = isWearableCategory(layer.category) ? layer.category : null;
          const bodyPart = category ? findAvatarBodyPart(avatarObj, CATEGORY_BODY_MESHES[category]) : null;

          if (category && bodyPart) {
            fitWearableToBodyPart(obj, bodyPart.box, category);
          } else {
            normalizeAvatarObject(obj, { targetHeight: 2.05 });
          }

          scene.add(obj);

          let visibleRoot: Object3D = obj;
          if (category) {
            const skinnedRoot = autoSkinGarmentToAvatar(avatarObj, obj, category);
            if (skinnedRoot) {
              visibleRoot = skinnedRoot;
            } else {
              const attachmentBone = findAttachmentBone(avatarObj, category);
              if (attachmentBone) attachPreservingWorld(obj, attachmentBone);
            }
          }

          visibleRoot.visible = layer.visible;
          loadedRef.current[layer.id] = visibleRoot;
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
        const delta = Math.min(clock.getDelta(), 0.05);
        mixer?.update(delta);
        controls.update();
        renderer.render(scene, camera);
      } else {
        clock.getDelta();
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      controls.dispose();
      mixer?.stopAllAction();
      renderer.dispose();
      mount.current?.replaceChildren();
      loadedRef.current = {};
    };
  }, [avatarUrl, layers.map((layer) => `${layer.url}:${layer.category ?? ""}`).join(",")]);

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
