"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Box3, Group, Mesh, Object3D, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { CreatorStudioAvatarViewer, type CreatorPoseMode } from "@/components/creator-studio/CreatorStudioAvatarViewer";
import { useActiveAvatarStore } from "@/lib/avatar-engine/active-avatar-store";
import { defaultAvatarConfig } from "@/lib/avatar-engine/catalog";

export type TryOnAdjustments = {
  scale: number;
  length: number;
  width: number;
  x: number;
  y: number;
  rotation: number;
  height: number;
  distance: number;
  sleeveLength: number;
  legLength: number;
  waistHeight: number;
  neckSize: number;
  hoodSize: number;
};

type Pose = "T-Pose" | "Idle" | "Walk";
type Props = {
  category: string;
  fit: "Slim" | "Regular" | "Oversize";
  pose: Pose;
  view: "Frente" | "Lateral" | "Espalda";
  background: string;
  showBody: boolean;
  garmentOnly: boolean;
  adjustments: TryOnAdjustments;
  imageUrl?: string | null;
  referenceModelUrl?: string | null;
  onReferenceStatus?: (status: string) => void;
};

type LoadedReference = {
  root: Group;
  originalSize: Vector3;
  attachedParts: Object3D[];
  rigged: boolean;
  settledFrames: number;
};

const avatarSize = new Vector3();
const avatarCenter = new Vector3();
const targetPosition = new Vector3();
const partCenter = new Vector3();
const bonePosition = new Vector3();

function categoryTarget(category: string, height: number) {
  switch (category) {
    case "hoodie":
    case "remera":
    case "campera":
      return { width: height * 0.52, height: height * 0.48, depth: height * 0.28, y: 0.61, z: 0 };
    case "baggy":
      return { width: height * 0.38, height: height * 0.52, depth: height * 0.25, y: 0.36, z: 0 };
    case "zapatillas":
      return { width: height * 0.35, height: height * 0.13, depth: height * 0.38, y: 0.075, z: height * 0.035 };
    case "gorra":
      return { width: height * 0.28, height: height * 0.15, depth: height * 0.28, y: 0.88, z: 0 };
    case "cadena":
      return { width: height * 0.22, height: height * 0.2, depth: height * 0.09, y: 0.68, z: height * 0.065 };
    case "lentes":
      return { width: height * 0.2, height: height * 0.07, depth: height * 0.08, y: 0.82, z: height * 0.09 };
    case "mochila":
      return { width: height * 0.35, height: height * 0.42, depth: height * 0.2, y: 0.58, z: -height * 0.1 };
    case "guantes":
    case "pulseras":
    case "anillos":
      return { width: height * 0.18, height: height * 0.1, depth: height * 0.12, y: 0.55, z: 0 };
    default:
      return { width: height * 0.3, height: height * 0.3, depth: height * 0.2, y: 0.58, z: 0 };
  }
}

function cleanBoneName(value: string) {
  return value.toLowerCase().replace(/^mixamorig:/, "").replace(/[^a-z0-9]/g, "");
}

function wantedBoneWords(category: string) {
  if (["hoodie", "remera", "campera"].includes(category)) return ["spine", "chest", "neck", "shoulder", "upperarm", "lowerarm", "forearm", "hand"];
  if (category === "baggy") return ["hips", "pelvis", "thigh", "upperleg", "calf", "lowerleg", "foot"];
  if (category === "zapatillas") return ["foot", "toe", "lowerleg", "calf"];
  if (["gorra", "lentes"].includes(category)) return ["head", "neck"];
  if (category === "cadena") return ["neck", "chest", "head"];
  if (category === "mochila") return ["spine", "chest", "shoulder", "hips"];
  if (["guantes", "pulseras", "anillos"].includes(category)) return ["hand", "forearm", "lowerarm"];
  return ["spine", "chest", "hips"];
}

function attachReferenceParts(reference: LoadedReference, avatarRoot: Object3D, category: string) {
  const words = wantedBoneWords(category);
  const bones: Object3D[] = [];
  avatarRoot.traverse((object: any) => {
    if (object.isBone && words.some((word) => cleanBoneName(object.name).includes(word))) bones.push(object);
  });
  if (bones.length === 0) return 0;

  const parts: Object3D[] = [];
  reference.root.traverse((object: any) => {
    if (object.isMesh && !object.isSkinnedMesh) parts.push(object);
  });

  avatarRoot.updateMatrixWorld(true);
  reference.root.updateMatrixWorld(true);

  for (const part of parts) {
    new Box3().setFromObject(part).getCenter(partCenter);
    let nearest = bones[0];
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const bone of bones) {
      bone.getWorldPosition(bonePosition);
      const distance = partCenter.distanceToSquared(bonePosition);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = bone;
      }
    }
    part.userData.clouvaReference = true;
    nearest.attach(part);
    reference.attachedParts.push(part);
  }

  reference.rigged = reference.attachedParts.length > 0;
  return reference.attachedParts.length;
}

function disposeObject(object: any) {
  object.geometry?.dispose?.();
  if (Array.isArray(object.material)) object.material.forEach((material: any) => material.dispose?.());
  else object.material?.dispose?.();
  object.removeFromParent?.();
}

function disposeReference(reference: LoadedReference | null) {
  if (!reference) return;
  for (const part of reference.attachedParts) disposeObject(part);
  reference.root.traverse((object: any) => disposeObject(object));
  reference.root.removeFromParent();
}

export function SmartTryOnViewer({ category, fit, pose, view, background, showBody, garmentOnly, adjustments, referenceModelUrl, onReferenceStatus }: Props) {
  const avatar = useActiveAvatarStore((state) => state.avatar);
  const avatarRef = useRef<Object3D | null>(null);
  const referenceRef = useRef<LoadedReference | null>(null);
  const frameRef = useRef(0);
  const [avatarReadyVersion, setAvatarReadyVersion] = useState(0);
  const currentRef = useRef({ category, fit, showBody, garmentOnly, adjustments });
  currentRef.current = { category, fit, showBody, garmentOnly, adjustments };

  const viewRotation = useMemo(() => view === "Frente" ? 0 : view === "Lateral" ? -Math.PI / 2 : Math.PI, [view]);
  const poseMode: CreatorPoseMode = pose === "T-Pose" ? "tpose" : pose === "Walk" ? "walk" : "idle";

  function attachAvatar(root: Object3D) {
    avatarRef.current = root;
    setAvatarReadyVersion((value) => value + 1);
  }

  useEffect(() => {
    let cancelled = false;
    disposeReference(referenceRef.current);
    referenceRef.current = null;

    if (!referenceModelUrl) {
      onReferenceStatus?.("Subí o elegí un GLB de referencia para verlo sobre el avatar.");
      return;
    }
    if (!avatarRef.current) {
      onReferenceStatus?.("Esperando que termine de cargar el avatar…");
      return;
    }

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    onReferenceStatus?.("Cargando GLB de referencia…");

    void loader.loadAsync(referenceModelUrl).then((gltf) => {
      if (cancelled || !avatarRef.current) return;
      const model = gltf.scene;
      let meshCount = 0;
      model.traverse((object: any) => {
        if (object.isMesh || object.isSkinnedMesh) {
          meshCount += 1;
          object.visible = true;
          object.frustumCulled = false;
          object.castShadow = true;
          object.receiveShadow = true;
          object.userData.clouvaReference = true;
        }
      });
      if (meshCount === 0) throw new Error("El GLB no contiene ninguna malla visible.");

      model.updateMatrixWorld(true);
      const box = new Box3().setFromObject(model);
      const size = box.getSize(new Vector3());
      const center = box.getCenter(new Vector3());
      if (!Number.isFinite(size.x + size.y + size.z) || size.lengthSq() < 1e-12) throw new Error("El GLB tiene dimensiones inválidas o está vacío.");

      model.position.sub(center);
      model.updateMatrixWorld(true);
      const root = new Group();
      root.name = "CLOUVA_REFERENCE_ASSET";
      root.add(model);
      avatarRef.current.parent?.add(root);
      referenceRef.current = { root, originalSize: size, attachedParts: [], rigged: false, settledFrames: 0 };
      onReferenceStatus?.(`✓ GLB real cargado (${meshCount} malla${meshCount === 1 ? "" : "s"}). Ajustándolo antes de vincularlo al rig…`);
    }).catch((error) => {
      console.error("Reference GLB failed", error);
      onReferenceStatus?.(error instanceof Error ? `No se pudo mostrar el GLB: ${error.message}` : "No se pudo abrir este GLB. Probá exportarlo nuevamente desde Blender.");
    });

    return () => {
      cancelled = true;
      disposeReference(referenceRef.current);
      referenceRef.current = null;
    };
  }, [referenceModelUrl, avatarReadyVersion, onReferenceStatus]);

  useEffect(() => {
    const update = () => {
      const avatarRoot = avatarRef.current;
      const reference = referenceRef.current;
      const current = currentRef.current;

      if (avatarRoot) {
        avatarRoot.traverse((object: any) => {
          if (object.isMesh && !object.userData.clouvaReference) object.visible = current.showBody && !current.garmentOnly;
          if (object.userData.clouvaReference) object.visible = true;
        });
      }

      if (avatarRoot && reference && !reference.rigged) {
        avatarRoot.updateMatrixWorld(true);
        const avatarBox = new Box3().setFromObject(avatarRoot);
        avatarBox.getSize(avatarSize);
        avatarBox.getCenter(avatarCenter);
        const height = Math.max(avatarSize.y, 1.5);
        const target = categoryTarget(current.category, height);
        const original = reference.originalSize;
        const fitScale = current.fit === "Slim" ? 0.92 : current.fit === "Oversize" ? 1.1 : 1;
        const uniformBase = Math.min(target.width / Math.max(original.x, 0.001), target.height / Math.max(original.y, 0.001), target.depth / Math.max(original.z, 0.001));
        const userScale = Math.min(Math.max(current.adjustments.scale / 100, 0.25), 3);
        const width = Math.min(Math.max(current.adjustments.width / 100, 0.35), 2.4);
        const length = Math.min(Math.max(current.adjustments.length / 100, 0.35), 2.4);
        const depth = Math.min(Math.max(1 + current.adjustments.distance / 100, 0.5), 1.8);

        reference.root.scale.set(uniformBase * userScale * fitScale * width, uniformBase * userScale * length, uniformBase * userScale * fitScale * depth);
        targetPosition.set(avatarCenter.x + current.adjustments.x / 100, avatarBox.min.y + height * target.y + (current.adjustments.y + current.adjustments.height) / 100, avatarCenter.z + target.z);
        reference.root.position.copy(targetPosition);
        reference.root.rotation.set(0, (current.adjustments.rotation * Math.PI) / 180, 0);
        reference.root.visible = true;
        reference.root.updateMatrixWorld(true);

        reference.settledFrames += 1;
        if (reference.settledFrames === 3) {
          const count = attachReferenceParts(reference, avatarRoot, current.category);
          if (count > 0) onReferenceStatus?.(`✓ Rig visual aplicado: ${count} pieza${count === 1 ? "" : "s"} vinculada${count === 1 ? "" : "s"} a los huesos del avatar.`);
          else onReferenceStatus?.("GLB visible, pero no se encontraron piezas separadas o huesos compatibles. Usá Blender Worker para el rig con pesos.");
        }
      }

      frameRef.current = requestAnimationFrame(update);
    };

    frameRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameRef.current);
  }, [onReferenceStatus]);

  useEffect(() => () => disposeReference(referenceRef.current), []);

  return (
    <div style={{ width: "100%", height: "100%", minHeight: 500, background }}>
      <CreatorStudioAvatarViewer modelUrl={avatar.modelUrl} fallbackModelUrl={avatar.fallbackUrl} frontRotationY={avatar.frontRotationY + viewRotation} config={defaultAvatarConfig} poseMode={poseMode} className="h-full min-h-[500px] w-full" onReady={attachAvatar}/>
    </div>
  );
}
