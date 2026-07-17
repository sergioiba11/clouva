"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AxesHelper, Bone, Box3, Group, Mesh, Object3D, Quaternion, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import {
  CreatorStudioAvatarViewer,
  type AnchorBoneKey,
  type CreatorPoseMode,
  type CreatorStudioAvatarContext,
} from "@/components/creator-studio/CreatorStudioAvatarViewer";
import { useActiveAvatarStore } from "@/lib/avatar-engine/active-avatar-store";
import { defaultAvatarConfig } from "@/lib/avatar-engine/catalog";

export type { AnchorBoneKey };

export type AnchorDiagnostics = {
  anchorBoneKey: AnchorBoneKey | null;
  boneFound: boolean;
  boneName: string | null;
  mode: "rigid_anchor" | "approx_fallback";
};

// Reglas de auto-ajuste: en vez de un offset fijo en metros (que rompe con cada GLB de
// tamaño distinto), describen QUÉ BORDE del propio bounding box del objeto debe tocar el
// origen del hueso. El desplazamiento real se calcula en cada carga a partir del tamaño
// real del asset, así que un GLB grande o chico se auto-acomoda sin recalibrar constantes.
type CategoryFitRule = {
  verticalAlign: "top" | "center" | "bottom"; // borde del objeto que se apoya en el hueso
  depthBias: number; // fracción del propio profundo del objeto para separarlo del cuerpo (+ adelante, - atrás)
  rotationY: number; // orientación base, radianes
};

const CATEGORY_FIT_RULES: Record<string, CategoryFitRule> = {
  gorra: { verticalAlign: "bottom", depthBias: 0, rotationY: 0 },
  lentes: { verticalAlign: "center", depthBias: 0.5, rotationY: 0 },
  cadena: { verticalAlign: "top", depthBias: 0.5, rotationY: 0 },
  mochila: { verticalAlign: "top", depthBias: -0.5, rotationY: Math.PI },
  pulseras: { verticalAlign: "center", depthBias: 0, rotationY: 0 },
  anillos: { verticalAlign: "center", depthBias: 0, rotationY: 0 },
};

function resolveAnchorBone(bones: CreatorStudioAvatarContext["bones"] | null, key: AnchorBoneKey | null): Bone | null {
  if (!bones || !key) return null;
  if (key === "neck") return bones.neck ?? bones.upperChest ?? bones.chest ?? null;
  if (key === "chest") return bones.chest ?? bones.upperChest ?? bones.spine ?? null;
  return bones[key] ?? null;
}

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
  anchorBoneKey?: AnchorBoneKey | null;
  showAnchorGizmo?: boolean;
  onReferenceStatus?: (status: string) => void;
  onAnchorDiagnostics?: (info: AnchorDiagnostics) => void;
};

type LoadedReference = {
  root: Group;
  originalSize: Vector3;
  anchorBoneKey: AnchorBoneKey | null;
  boneFound: boolean;
  bone: Bone | null;
};

const avatarSize = new Vector3();
const avatarCenter = new Vector3();
const targetPosition = new Vector3();
const headPosition = new Vector3();
const boneWorldScale = new Vector3();
const localOffset = new Vector3();
const rootWorldQuaternion = new Quaternion();
const rootBaseInverseQuaternion = new Quaternion();
const viewDeltaQuaternion = new Quaternion();
const headWorldQuaternion = new Quaternion();
const rootWorldInverseQuaternion = new Quaternion();
const headLocalQuaternion = new Quaternion();
const headBaseInverseQuaternion = new Quaternion();
const headDeltaQuaternion = new Quaternion();
const userRotationQuaternion = new Quaternion();
const Y_AXIS = new Vector3(0, 1, 0);
const HAIR_TOKENS = ["hair", "hairstyle", "pelo", "cabello", "fringe", "bangs", "bang", "scalp"];
const HEAD_TOKENS = ["head", "jbipchead", "bip01head", "mixamorighead"];

function cleanAssetName(value: unknown) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9áéíóúüñ]/g, "");
}

function isHairMesh(object: any) {
  const values = [object?.name, object?.userData?.name];
  const materials = Array.isArray(object?.material) ? object.material : object?.material ? [object.material] : [];
  for (const material of materials) values.push(material?.name, material?.userData?.name);
  const joined = values.map(cleanAssetName).join(" ");
  return HAIR_TOKENS.some((token) => joined.includes(cleanAssetName(token)));
}

function findHeadBone(root: Object3D) {
  let exact: Bone | null = null;
  const bones: Bone[] = [];
  root.traverse((object: any) => {
    if (!object.isBone) return;
    const bone = object as Bone;
    bones.push(bone);
    const name = cleanAssetName(bone.name);
    if (!exact && HEAD_TOKENS.some((token) => name === cleanAssetName(token) || name.includes(cleanAssetName(token)))) {
      exact = bone;
    }
  });
  if (exact) return exact;

  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root);
  const centerX = (box.min.x + box.max.x) * 0.5;
  const height = Math.max(box.max.y - box.min.y, 0.001);
  return bones
    .map((bone) => ({ bone, position: bone.getWorldPosition(new Vector3()) }))
    .filter(({ bone, position }) => {
      const name = cleanAssetName(bone.name);
      const excluded = ["eye", "jaw", "mouth", "finger", "hand"].some((token) => name.includes(token));
      return !excluded && Math.abs(position.x - centerX) < height * 0.18;
    })
    .sort((a, b) => b.position.y - a.position.y)[0]?.bone ?? null;
}

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
      return { width: height * 0.29, height: height * 0.13, depth: height * 0.29, y: 0.925, z: 0 };
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

function disposeReference(reference: LoadedReference | null) {
  if (!reference) return;
  reference.root.traverse((object: any) => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach((material: any) => material.dispose?.());
    else object.material?.dispose?.();
  });
  reference.root.removeFromParent();
}

export function SmartTryOnViewer({
  category,
  fit,
  pose,
  view,
  background,
  showBody,
  garmentOnly,
  adjustments,
  referenceModelUrl,
  anchorBoneKey = null,
  showAnchorGizmo = false,
  onReferenceStatus,
  onAnchorDiagnostics,
}: Props) {
  const avatar = useActiveAvatarStore((state) => state.avatar);
  const avatarRef = useRef<Object3D | null>(null);
  const headBoneRef = useRef<Bone | null>(null);
  const bonesRef = useRef<CreatorStudioAvatarContext["bones"] | null>(null);
  const showAnchorGizmoRef = useRef(showAnchorGizmo);
  showAnchorGizmoRef.current = showAnchorGizmo;
  const avatarBaseWorldQuaternionRef = useRef<Quaternion | null>(null);
  const headBaseLocalQuaternionRef = useRef<Quaternion | null>(null);
  const referenceRef = useRef<LoadedReference | null>(null);
  const anchorHelperRef = useRef<AxesHelper | null>(null);
  const frameRef = useRef(0);
  const statusRef = useRef(onReferenceStatus);
  const diagnosticsRef = useRef(onAnchorDiagnostics);
  const [avatarReadyVersion, setAvatarReadyVersion] = useState(0);
  const currentRef = useRef({ category, fit, showBody, garmentOnly, adjustments });
  currentRef.current = { category, fit, showBody, garmentOnly, adjustments };
  statusRef.current = onReferenceStatus;
  diagnosticsRef.current = onAnchorDiagnostics;

  const viewRotation = useMemo(() => view === "Frente" ? 0 : view === "Lateral" ? -Math.PI / 2 : Math.PI, [view]);
  const poseMode: CreatorPoseMode = pose === "T-Pose" ? "tpose" : pose === "Walk" ? "walk" : "idle";

  function attachAvatar(root: Object3D, context?: CreatorStudioAvatarContext) {
    avatarRef.current = root;
    headBoneRef.current = context?.headBone ?? findHeadBone(root);
    bonesRef.current = context?.bones ?? null;
    root.updateMatrixWorld(true);
    avatarBaseWorldQuaternionRef.current = root.getWorldQuaternion(new Quaternion()).clone();

    if (headBoneRef.current) {
      root.getWorldQuaternion(rootWorldQuaternion);
      rootWorldInverseQuaternion.copy(rootWorldQuaternion).invert();
      headBoneRef.current.getWorldQuaternion(headWorldQuaternion);
      headBaseLocalQuaternionRef.current = rootWorldInverseQuaternion.clone().multiply(headWorldQuaternion).clone();
    } else {
      headBaseLocalQuaternionRef.current = null;
    }
    setAvatarReadyVersion((value) => value + 1);
  }

  useEffect(() => {
    let cancelled = false;
    disposeReference(referenceRef.current);
    referenceRef.current = null;

    if (!referenceModelUrl) {
      statusRef.current?.("Subí o elegí un GLB de referencia para verlo sobre el avatar.");
      diagnosticsRef.current?.({ anchorBoneKey: null, boneFound: false, boneName: null, mode: "approx_fallback" });
      return;
    }

    if (!avatarRef.current) {
      statusRef.current?.("Esperando que termine de cargar el avatar…");
      return;
    }

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    statusRef.current?.("Cargando GLB de referencia…");

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
        }
      });

      if (meshCount === 0) throw new Error("El GLB no contiene ninguna malla visible.");

      model.updateMatrixWorld(true);
      const box = new Box3().setFromObject(model);
      const size = box.getSize(new Vector3());
      const center = box.getCenter(new Vector3());

      if (!Number.isFinite(size.x + size.y + size.z) || size.lengthSq() < 1e-12) {
        throw new Error("El GLB tiene dimensiones inválidas o está vacío.");
      }

      model.position.sub(center);
      model.updateMatrixWorld(true);

      const root = new Group();
      root.name = "CLOUVA_ASSET_ANCHOR";
      root.add(model);

      const resolvedBone = resolveAnchorBone(bonesRef.current, anchorBoneKey);
      if (resolvedBone) resolvedBone.add(root);
      else avatarRef.current.parent?.add(root);

      anchorHelperRef.current?.parent?.remove(anchorHelperRef.current);
      anchorHelperRef.current?.dispose();
      anchorHelperRef.current = null;
      if (resolvedBone) {
        const helper = new AxesHelper(0.15);
        helper.name = "CLOUVA_ANCHOR_GIZMO";
        helper.visible = showAnchorGizmoRef.current;
        resolvedBone.add(helper);
        anchorHelperRef.current = helper;
      }

      referenceRef.current = { root, originalSize: size, anchorBoneKey, boneFound: Boolean(resolvedBone), bone: resolvedBone };
      diagnosticsRef.current?.({
        anchorBoneKey,
        boneFound: Boolean(resolvedBone),
        boneName: resolvedBone?.name ?? null,
        mode: resolvedBone ? "rigid_anchor" : "approx_fallback",
      });
      statusRef.current?.(
        resolvedBone
          ? `✓ GLB real cargado (${meshCount} malla${meshCount === 1 ? "" : "s"}). Anclado al hueso "${resolvedBone.name}" — sigue la animación automáticamente.`
          : `✓ GLB real cargado (${meshCount} malla${meshCount === 1 ? "" : "s"}). No se encontró el hueso de anclaje: usando posicionamiento aproximado por altura.`,
      );
    }).catch((error) => {
      console.error("Reference GLB failed", error);
      statusRef.current?.(error instanceof Error ? `No se pudo mostrar el GLB: ${error.message}` : "No se pudo abrir este GLB. Probá exportarlo nuevamente desde Blender.");
    });

    return () => {
      cancelled = true;
      disposeReference(referenceRef.current);
      referenceRef.current = null;
      anchorHelperRef.current?.parent?.remove(anchorHelperRef.current);
      anchorHelperRef.current?.dispose();
      anchorHelperRef.current = null;
    };
  }, [referenceModelUrl, avatarReadyVersion, anchorBoneKey]);

  useEffect(() => {
    if (anchorHelperRef.current) anchorHelperRef.current.visible = showAnchorGizmo;
  }, [showAnchorGizmo]);

  useEffect(() => {
    const update = () => {
      const avatarRoot = avatarRef.current;
      const reference = referenceRef.current;
      const current = currentRef.current;

      if (avatarRoot) {
        avatarRoot.updateMatrixWorld(true);
        avatarRoot.traverse((object: any) => {
          if (!(object as Mesh).isMesh && !object.isSkinnedMesh) return;
          const hiddenByHat = current.category === "gorra" && isHairMesh(object);
          object.visible = current.showBody && !current.garmentOnly && !hiddenByHat;
        });
      }

      if (avatarRoot && reference) {
        avatarRoot.updateMatrixWorld(true);
        const avatarBox = new Box3().setFromObject(avatarRoot);
        avatarBox.getSize(avatarSize);
        avatarBox.getCenter(avatarCenter);
        const height = Math.max(avatarSize.y, 1.5);
        const target = categoryTarget(current.category, height);
        const original = reference.originalSize;
        const fitScale = current.fit === "Slim" ? 0.92 : current.fit === "Oversize" ? 1.1 : 1;
        const uniformBase = Math.min(
          target.width / Math.max(original.x, 0.001),
          target.height / Math.max(original.y, 0.001),
          target.depth / Math.max(original.z, 0.001),
        );
        const userScale = Math.min(Math.max(current.adjustments.scale / 100, 0.25), 3);
        const width = Math.min(Math.max(current.adjustments.width / 100, 0.35), 2.4);
        const length = Math.min(Math.max(current.adjustments.length / 100, 0.35), 2.4);
        const depth = current.category === "gorra"
          ? 1
          : Math.min(Math.max(1 + current.adjustments.distance / 100, 0.5), 1.8);

        reference.root.scale.set(
          uniformBase * userScale * fitScale * width,
          uniformBase * userScale * length,
          uniformBase * userScale * fitScale * depth,
        );

        if (reference.boneFound && reference.bone) {
          // Anclaje real: el grupo cuelga del hueso, así que solo hace falta el offset
          // local (metros/radianes). El scene graph propaga la animación del hueso solo.
          // Como el hueso puede traer su propia escala (bind pose, rigs escalados en cm,
          // etc.), se compensa dividiendo por su escala mundial para que el tamaño y el
          // offset final queden en metros reales, sin heredar la escala del hueso.
          reference.bone.getWorldScale(boneWorldScale);
          const scaleGuard = Math.max(Math.abs(boneWorldScale.y) || 1, 1e-4);
          const scaleX = (uniformBase * userScale * fitScale * width) / scaleGuard;
          const scaleY = (uniformBase * userScale * length) / scaleGuard;
          const scaleZ = (uniformBase * userScale * fitScale * depth) / scaleGuard;
          reference.root.scale.set(scaleX, scaleY, scaleZ);

          // Auto-ajuste: el offset sale del propio tamaño del objeto (medido en el espacio
          // local del hueso, o sea ya multiplicado por scaleY/scaleZ), no de una constante
          // fija. Así una gorra chica y una grande se acomodan solas sin recalibrar nada.
          const rule = CATEGORY_FIT_RULES[current.category] ?? { verticalAlign: "center", depthBias: 0, rotationY: 0 };
          const halfHeight = (reference.originalSize.y * scaleY) / 2;
          const fullDepth = reference.originalSize.z * scaleZ;
          const autoY = rule.verticalAlign === "bottom" ? halfHeight : rule.verticalAlign === "top" ? -halfHeight : 0;
          const autoZ = rule.depthBias * fullDepth;

          reference.root.position.set(
            current.adjustments.x / 100 / scaleGuard,
            autoY + (current.adjustments.y + current.adjustments.height) / 100 / scaleGuard,
            autoZ + current.adjustments.distance / 100 / scaleGuard,
          );
          reference.root.quaternion.setFromAxisAngle(
            Y_AXIS,
            rule.rotationY + (current.adjustments.rotation * Math.PI) / 180,
          );
          reference.root.visible = true;
          reference.root.updateMatrixWorld(true);
        } else {
          avatarRoot.getWorldQuaternion(rootWorldQuaternion);
          const baseRoot = avatarBaseWorldQuaternionRef.current;
          if (baseRoot) {
            rootBaseInverseQuaternion.copy(baseRoot).invert();
            viewDeltaQuaternion.copy(rootWorldQuaternion).multiply(rootBaseInverseQuaternion);
          } else {
            viewDeltaQuaternion.identity();
          }

          userRotationQuaternion.setFromAxisAngle(Y_AXIS, (current.adjustments.rotation * Math.PI) / 180);

          if (current.category === "gorra" && headBoneRef.current) {
            const headBone = headBoneRef.current;
            headBone.getWorldPosition(headPosition);
            headBone.getWorldQuaternion(headWorldQuaternion);
            rootWorldInverseQuaternion.copy(rootWorldQuaternion).invert();
            headLocalQuaternion.copy(rootWorldInverseQuaternion).multiply(headWorldQuaternion);

            const baseHead = headBaseLocalQuaternionRef.current;
            if (baseHead) {
              headBaseInverseQuaternion.copy(baseHead).invert();
              headDeltaQuaternion.copy(headLocalQuaternion).multiply(headBaseInverseQuaternion);
            } else {
              headDeltaQuaternion.identity();
            }

            reference.root.quaternion.copy(viewDeltaQuaternion).multiply(headDeltaQuaternion).multiply(userRotationQuaternion);

            const headRelativeY = (headPosition.y - avatarBox.min.y) / height;
            const automaticLift = Math.min(
              Math.max((target.y - headRelativeY) * height, height * 0.035),
              height * 0.16,
            );
            localOffset.set(
              current.adjustments.x / 100,
              automaticLift + (current.adjustments.y + current.adjustments.height) / 100,
              current.adjustments.distance / 100,
            ).applyQuaternion(viewDeltaQuaternion);
            targetPosition.copy(headPosition).add(localOffset);
          } else {
            reference.root.quaternion.copy(viewDeltaQuaternion).multiply(userRotationQuaternion);
            localOffset.set(
              current.adjustments.x / 100,
              0,
              current.category === "gorra" ? current.adjustments.distance / 100 : 0,
            ).applyQuaternion(viewDeltaQuaternion);
            targetPosition.set(
              avatarCenter.x,
              avatarBox.min.y + height * target.y + (current.adjustments.y + current.adjustments.height) / 100,
              avatarCenter.z + target.z,
            ).add(localOffset);
          }

          reference.root.position.copy(targetPosition);
          reference.root.visible = true;
          reference.root.updateMatrixWorld(true);
        }
      }

      frameRef.current = requestAnimationFrame(update);
    };

    frameRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameRef.current);
  }, []);

  useEffect(() => () => disposeReference(referenceRef.current), []);

  return (
    <div style={{ width: "100%", height: "100%", minHeight: 500, background }}>
      <CreatorStudioAvatarViewer
        modelUrl={avatar.modelUrl}
        fallbackModelUrl={avatar.fallbackUrl}
        frontRotationY={avatar.frontRotationY}
        viewRotationY={viewRotation}
        config={defaultAvatarConfig}
        poseMode={poseMode}
        className="h-full min-h-[500px] w-full"
        onReady={attachAvatar}
      />
    </div>
  );
}
