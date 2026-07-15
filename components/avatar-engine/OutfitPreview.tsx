"use client";

import { useEffect, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  AmbientLight,
  Bone,
  Box3,
  Clock,
  DirectionalLight,
  Euler,
  HemisphereLight,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Skeleton,
  SkinnedMesh,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  frameAvatar,
  normalizeAvatarObject,
  inferAvatarBodyPartBox,
  fitGarmentToBodyPart,
  type GarmentFitOptions,
  type WearableCategory,
} from "@/lib/avatar-engine/frame-avatar";

const CATEGORY_FIT: Record<WearableCategory, GarmentFitOptions> = {
  hoodie: { paddingScale: 0.98, widthPadding: 1.07, depthPadding: 1.08, verticalOffset: -0.025, forwardOffset: 0.008, minAxisRatio: 0.76, maxAxisRatio: 1.2 },
  shirt: { paddingScale: 0.96, widthPadding: 1.03, depthPadding: 1.05, verticalOffset: -0.018, forwardOffset: 0.006, minAxisRatio: 0.78, maxAxisRatio: 1.18 },
  jacket: { paddingScale: 1, widthPadding: 1.1, depthPadding: 1.12, verticalOffset: -0.025, forwardOffset: 0.01, minAxisRatio: 0.75, maxAxisRatio: 1.22 },
  pants: { paddingScale: 1, widthPadding: 1.06, depthPadding: 1.08, verticalOffset: 0, forwardOffset: 0.004, minAxisRatio: 0.78, maxAxisRatio: 1.2 },
  shorts: { paddingScale: 1, widthPadding: 1.06, depthPadding: 1.08, verticalOffset: 0, forwardOffset: 0.004, minAxisRatio: 0.78, maxAxisRatio: 1.2 },
  shoes: { paddingScale: 1, widthPadding: 1.04, depthPadding: 1.08, verticalOffset: 0, forwardOffset: 0.008, minAxisRatio: 0.72, maxAxisRatio: 1.25 },
  accessory: { paddingScale: 1, widthPadding: 1, depthPadding: 1, verticalOffset: 0, forwardOffset: 0, minAxisRatio: 0.75, maxAxisRatio: 1.25 },
};

const IDLE_BONES = {
  hips: ["Hips", "mixamorig:Hips", "pelvis", "Pelvis"],
  spine: ["Spine", "Spine01", "Spine1", "mixamorig:Spine"],
  chest: ["Spine02", "Spine2", "mixamorig:Spine2", "Chest", "chest"],
  neck: ["Neck", "neck", "mixamorig:Neck"],
  head: ["Head", "head", "mixamorig:Head"],
  leftShoulder: ["LeftShoulder", "mixamorig:LeftShoulder", "shoulder.L", "Shoulder_L"],
  rightShoulder: ["RightShoulder", "mixamorig:RightShoulder", "shoulder.R", "Shoulder_R"],
  leftArm: ["LeftArm", "mixamorig:LeftArm", "upper_arm.L", "UpperArm_L"],
  rightArm: ["RightArm", "mixamorig:RightArm", "upper_arm.R", "UpperArm_R"],
} as const;

const MIN_SHARED_BONES = 8;

type IdleBoneKey = keyof typeof IDLE_BONES;
type IdleBone = { object: Object3D; base: Quaternion };
type IdleRig = Partial<Record<IdleBoneKey, IdleBone>>;

export type OutfitLayer = {
  id: string;
  url: string;
  visible: boolean;
  category?: string;
  preFitted?: boolean;
};

type Props = { avatarUrl: string | null; layers: OutfitLayer[]; className?: string };

function normalizeBoneName(name: string) {
  return name.toLowerCase().replace(/^mixamorig:/, "").replace(/[^a-z0-9]/g, "");
}

function categoryOf(value?: string): WearableCategory | null {
  return value && value in CATEGORY_FIT ? (value as WearableCategory) : null;
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

function findNamedBone(root: Object3D, aliases: readonly string[]) {
  let found: Object3D | null = null;
  root.traverse((object) => {
    if (!found && aliases.includes(object.name)) found = object;
  });
  return found;
}

function collectIdleRig(root: Object3D): IdleRig {
  const rig: IdleRig = {};
  for (const [key, aliases] of Object.entries(IDLE_BONES) as [IdleBoneKey, readonly string[]][]) {
    const object = findNamedBone(root, aliases);
    if (object) rig[key] = { object, base: object.quaternion.clone() };
  }
  return rig;
}

function collectAvatarBones(root: Object3D) {
  const bones = new Map<string, Bone>();
  root.traverse((object) => {
    if (!(object as Bone).isBone || !object.name) return;
    const bone = object as Bone;
    bones.set(object.name, bone);
    bones.set(normalizeBoneName(object.name), bone);
  });
  return bones;
}

function shareAvatarSkeleton(garment: Object3D, avatar: Object3D) {
  const avatarBones = collectAvatarBones(avatar);
  const meshes: SkinnedMesh[] = [];
  garment.traverse((object) => {
    if ((object as SkinnedMesh).isSkinnedMesh) meshes.push(object as SkinnedMesh);
  });

  if (meshes.length === 0) {
    return { ok: false, reason: "La pieza no contiene ninguna malla riggeada", sharedBones: 0 };
  }

  let lowestSharedCount = Number.POSITIVE_INFINITY;
  for (const mesh of meshes) {
    const mappedBones: Bone[] = [];
    const missing: string[] = [];

    for (const sourceBone of mesh.skeleton.bones) {
      const match = avatarBones.get(sourceBone.name) ?? avatarBones.get(normalizeBoneName(sourceBone.name));
      if (!match) missing.push(sourceBone.name || "(sin nombre)");
      else mappedBones.push(match);
    }

    if (missing.length > 0 || mappedBones.length !== mesh.skeleton.bones.length) {
      return {
        ok: false,
        reason: `Rig incompatible: faltan huesos ${missing.slice(0, 6).join(", ")}`,
        sharedBones: mappedBones.length,
      };
    }

    if (mappedBones.length < MIN_SHARED_BONES) {
      return {
        ok: false,
        reason: `Rig incompleto: solo comparte ${mappedBones.length} huesos`,
        sharedBones: mappedBones.length,
      };
    }

    const sharedSkeleton = new Skeleton(
      mappedBones,
      mesh.skeleton.boneInverses.map((inverse) => inverse.clone()),
    );
    mesh.bind(sharedSkeleton, mesh.bindMatrix.clone());
    mesh.normalizeSkinWeights();
    lowestSharedCount = Math.min(lowestSharedCount, mappedBones.length);
  }

  return { ok: true, reason: "", sharedBones: lowestSharedCount };
}

const idleEuler = new Euler();
const idleQuaternion = new Quaternion();

function rotateIdleBone(bone: IdleBone | undefined, x: number, y: number, z: number) {
  if (!bone) return;
  idleEuler.set(x, y, z, "XYZ");
  idleQuaternion.setFromEuler(idleEuler);
  bone.object.quaternion.copy(bone.base).multiply(idleQuaternion);
}

function applyIdlePose(rig: IdleRig, time: number) {
  const breath = Math.sin(time * 1.65);
  const slow = Math.sin(time * 0.62);
  const sway = Math.sin(time * 0.38);
  rotateIdleBone(rig.hips, 0, sway * 0.012, -slow * 0.008);
  rotateIdleBone(rig.spine, breath * 0.01, sway * 0.01, slow * 0.006);
  rotateIdleBone(rig.chest, breath * 0.018, -sway * 0.008, -slow * 0.006);
  rotateIdleBone(rig.neck, -breath * 0.004, sway * 0.018, slow * 0.007);
  rotateIdleBone(rig.head, breath * 0.004, sway * 0.025, slow * 0.01);
  rotateIdleBone(rig.leftShoulder, 0, 0, breath * 0.01);
  rotateIdleBone(rig.rightShoulder, 0, 0, -breath * 0.01);
  rotateIdleBone(rig.leftArm, breath * 0.008, 0, slow * 0.012);
  rotateIdleBone(rig.rightArm, breath * 0.008, 0, -slow * 0.012);
}

export function OutfitPreview({ avatarUrl, layers, className = "" }: Props) {
  const mount = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [rigError, setRigError] = useState<string | null>(null);
  const loadedRef = useRef<Record<string, Object3D>>({});

  useEffect(() => {
    if (!mount.current || !avatarUrl) return;
    let disposed = false;
    let raf = 0;
    let mainModel: Object3D | null = null;
    let avatarBaseY = 0;
    const idleRigs: IdleRig[] = [];
    const clock = new Clock();
    const scene = new Scene();
    const camera = new PerspectiveCamera(31, 1, 0.02, 100);
    const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 768 ? 1 : 1.5));
    Object.assign(renderer.domElement.style, { width: "100%", height: "100%", display: "block", touchAction: "none" });
    mount.current.appendChild(renderer.domElement);
    setRigError(null);

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
        avatarBaseY = avatarObj.position.y;
        idleRigs.push(collectIdleRig(avatarObj));
        loadedRef.current.__avatar = avatarObj;

        for (const layer of layers) {
          if (disposed) return;
          const obj = (await loader.loadAsync(layer.url)).scene;
          const category = categoryOf(layer.category);

          if (category) {
            const target = inferAvatarBodyPartBox(avatarObj, category);

            if (layer.preFitted) {
              copyNormalizedAvatarTransform(obj, avatarObj);
              const rig = shareAvatarSkeleton(obj, avatarObj);
              if (!rig.ok || invalidFit(obj, target)) {
                obj.visible = false;
                setRigError(`La pieza “${layer.id}” fue bloqueada: ${rig.ok ? "el ajuste exportado está fuera del avatar" : rig.reason}. No vuelvas a gastar créditos con esta variante.`);
                console.error("CLOUVA rejected incompatible wearable", { layerId: layer.id, category, ...rig });
                continue;
              }
            } else {
              resetRootTransform(obj);
              fitGarmentToBodyPart(obj, target, CATEGORY_FIT[category]);
              if (invalidFit(obj, target)) {
                obj.visible = false;
                setRigError(`La pieza “${layer.id}” no pasó el ajuste automático y fue bloqueada para evitar que aparezca gigante.`);
                console.error("CLOUVA rejected unfitted wearable", { layerId: layer.id, category });
                continue;
              }
            }

            scene.add(obj);
            avatarObj.attach(obj);
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
      if (!document.hidden) {
        const elapsed = clock.getElapsedTime();
        for (const rig of idleRigs) applyIdlePose(rig, elapsed);
        if (mainModel) mainModel.position.y = avatarBaseY + Math.sin(elapsed * 1.65) * 0.004;
        controls.update();
        renderer.render(scene, camera);
      }
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
    {rigError ? <div className="absolute left-3 right-3 top-3 z-20 rounded-2xl border border-rose-400/30 bg-rose-950/80 px-4 py-3 text-xs leading-relaxed text-rose-100 backdrop-blur">{rigError}</div> : null}
    {status === "ready" && !rigError ? <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-full border border-emerald-300/20 bg-black/35 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-emerald-200/70 backdrop-blur">Rig validado · esqueleto compartido</div> : null}
    <div ref={mount} className="h-full w-full" />
  </div>;
}
