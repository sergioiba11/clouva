"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  Bone,
  Box3,
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  Object3D,
  SphereGeometry,
  Texture,
  TextureLoader,
  TorusGeometry,
  Vector3,
} from "three";
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
};

type Rig = {
  hips?: Bone;
  chest?: Bone;
  head?: Bone;
  leftHip?: Bone;
  rightHip?: Bone;
  leftKnee?: Bone;
  rightKnee?: Bone;
};

type Parts = {
  root: Group;
  torso?: Mesh;
  leftLeg?: Mesh;
  rightLeg?: Mesh;
  accessory?: Mesh;
};

const p1 = new Vector3();
const p2 = new Vector3();
const center = new Vector3();
const direction = new Vector3();
const size = new Vector3();
const yAxis = new Vector3(0, 1, 0);

function clean(value: string) {
  return value.toLowerCase().replace(/^mixamorig:/, "").replace(/[^a-z0-9]/g, "");
}

function findBone(bones: Bone[], names: string[]) {
  return bones.find((bone) => names.includes(clean(bone.name)))
    ?? bones.find((bone) => names.some((name) => clean(bone.name).includes(name)));
}

function collectRig(root: Object3D): Rig {
  const set = new Set<Bone>();
  root.traverse((object: any) => {
    if (object.isBone) set.add(object as Bone);
    if (object.isSkinnedMesh) {
      for (const bone of object.skeleton?.bones ?? []) set.add(bone as Bone);
    }
  });
  const bones = [...set];
  return {
    hips: findBone(bones, ["hips", "pelvis", "jbiphips"]),
    chest: findBone(bones, ["upperchest", "chest", "spine2", "jbipupperchest", "jbipchest"]),
    head: findBone(bones, ["head", "jbiphead"]),
    leftHip: findBone(bones, ["leftupperleg", "leftupleg", "thighl", "upperlegl", "jbiplupperleg"]),
    rightHip: findBone(bones, ["rightupperleg", "rightupleg", "thighr", "upperlegr", "jbiprupperleg"]),
    leftKnee: findBone(bones, ["leftlowerleg", "leftleg", "calfl", "lowerlegl", "jbipllowerleg"]),
    rightKnee: findBone(bones, ["rightlowerleg", "rightleg", "calfr", "lowerlegr", "jbiprlowerleg"]),
  };
}

function makeMaterial(texture: Texture | null) {
  return new MeshPhysicalMaterial({
    color: texture ? 0xffffff : 0x7b4dd4,
    map: texture,
    roughness: 0.82,
    metalness: 0,
    clearcoat: 0.02,
    side: DoubleSide,
    transparent: true,
    opacity: 0.94,
  });
}

function make(name: string, geometry: BoxGeometry | CylinderGeometry | SphereGeometry | TorusGeometry, material: MeshPhysicalMaterial) {
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

function createParts(category: string, texture: Texture | null): Parts {
  const root = new Group();
  const material = makeMaterial(texture);
  const parts: Parts = { root };

  if (["hoodie", "campera", "remera"].includes(category)) {
    // Vista previa estable del volumen principal. Las mangas y capucha reales
    // deben provenir del GLB generado/ajustado, no de huesos inferidos.
    parts.torso = make("garmentTorso", new CylinderGeometry(0.76, 0.64, 1.2, 32, 4, false), material);
    root.add(parts.torso);
  } else if (category === "baggy") {
    parts.torso = make("waist", new CylinderGeometry(0.82, 0.76, 0.42, 24), material);
    parts.leftLeg = make("leftLeg", new CylinderGeometry(0.78, 0.62, 1, 20), material);
    parts.rightLeg = make("rightLeg", new CylinderGeometry(0.78, 0.62, 1, 20), material);
    root.add(parts.torso, parts.leftLeg, parts.rightLeg);
  } else if (category === "zapatillas") {
    parts.leftLeg = make("leftShoe", new BoxGeometry(1, 0.7, 1.7), material);
    parts.rightLeg = make("rightShoe", new BoxGeometry(1, 0.7, 1.7), material);
    root.add(parts.leftLeg, parts.rightLeg);
  } else if (category === "gorra") {
    parts.accessory = make("cap", new SphereGeometry(1, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.58), material);
    root.add(parts.accessory);
  } else if (category === "cadena") {
    parts.accessory = make("chain", new TorusGeometry(1, 0.08, 10, 42), material);
    root.add(parts.accessory);
  }

  return parts;
}

function between(item: Mesh | undefined, start: Object3D | undefined, end: Object3D | undefined, radius: number, multiplier = 1) {
  if (!item || !start || !end) {
    if (item) item.visible = false;
    return false;
  }
  start.getWorldPosition(p1);
  end.getWorldPosition(p2);
  center.copy(p1).add(p2).multiplyScalar(0.5);
  direction.copy(p2).sub(p1);
  const length = Math.max(direction.length() * multiplier, 0.01);
  direction.normalize();
  item.visible = true;
  item.position.copy(center);
  item.quaternion.setFromUnitVectors(yAxis, direction);
  item.scale.set(radius, length * 0.5, radius * 0.95);
  return true;
}

function dispose(parts: Parts | null) {
  if (!parts) return;
  parts.root.traverse((object: any) => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach((value: any) => value.dispose?.());
    else object.material?.dispose?.();
  });
  parts.root.removeFromParent();
}

export function SmartTryOnViewer({ category, fit, pose, view, background, showBody, garmentOnly, adjustments, imageUrl }: Props) {
  const avatar = useActiveAvatarStore((state) => state.avatar);
  const avatarRef = useRef<Object3D | null>(null);
  const rigRef = useRef<Rig>({});
  const partsRef = useRef<Parts | null>(null);
  const textureRef = useRef<Texture | null>(null);
  const frameRef = useRef(0);
  const currentRef = useRef({ fit, showBody, garmentOnly, adjustments });
  currentRef.current = { fit, showBody, garmentOnly, adjustments };

  const viewRotation = useMemo(() => view === "Frente" ? 0 : view === "Lateral" ? -Math.PI / 2 : Math.PI, [view]);
  const poseMode: CreatorPoseMode = pose === "T-Pose" ? "tpose" : pose === "Walk" ? "walk" : "idle";

  function rebuild(root: Object3D) {
    avatarRef.current = root;
    rigRef.current = collectRig(root);
    dispose(partsRef.current);
    partsRef.current = createParts(category, textureRef.current);
    (root.parent ?? root).add(partsRef.current.root);
  }

  useEffect(() => {
    textureRef.current?.dispose();
    textureRef.current = null;
    if (!imageUrl) {
      if (avatarRef.current) rebuild(avatarRef.current);
      return;
    }
    new TextureLoader().load(imageUrl, (texture) => {
      texture.colorSpace = "srgb" as any;
      textureRef.current = texture;
      if (avatarRef.current) rebuild(avatarRef.current);
    });
  }, [imageUrl, category]);

  useEffect(() => {
    const update = () => {
      const avatarRoot = avatarRef.current;
      const parts = partsRef.current;
      if (avatarRoot && parts) {
        const current = currentRef.current;
        avatarRoot.updateMatrixWorld(true);
        avatarRoot.traverse((object) => {
          if ((object as Mesh).isMesh) object.visible = current.showBody && !current.garmentOnly;
        });

        const box = new Box3().setFromObject(avatarRoot);
        box.getSize(size);
        const avatarHeight = Math.max(size.y, 1.5);
        const bodyCenter = box.getCenter(center);
        const rig = rigRef.current;
        const fitScale = current.fit === "Slim" ? 0.92 : current.fit === "Oversize" ? 1.08 : 1;
        const width = Math.min(Math.max(current.adjustments.width / 100, 0.65), 1.35);
        const length = Math.min(Math.max(current.adjustments.length / 100, 0.65), 1.3);
        const depth = Math.min(Math.max(1 + current.adjustments.distance / 300, 0.88), 1.15);

        if (parts.torso && ["hoodie", "campera", "remera"].includes(category)) {
          parts.torso.visible = true;
          if (rig.chest && rig.hips) {
            rig.chest.getWorldPosition(p1);
            rig.hips.getWorldPosition(p2);
            parts.torso.position.copy(p1).lerp(p2, 0.5);
          } else {
            parts.torso.position.set(bodyCenter.x, box.min.y + avatarHeight * 0.61, bodyCenter.z);
          }
          parts.torso.scale.set(
            avatarHeight * 0.108 * fitScale * width,
            avatarHeight * 0.18 * length,
            avatarHeight * 0.058 * fitScale * depth,
          );
        }

        if (category === "baggy") {
          if (parts.torso) {
            parts.torso.visible = true;
            parts.torso.position.set(bodyCenter.x, box.min.y + avatarHeight * 0.47, bodyCenter.z);
            parts.torso.scale.set(avatarHeight * 0.09 * width, avatarHeight * 0.055, avatarHeight * 0.06 * depth);
          }
          between(parts.leftLeg, rig.leftHip, rig.leftKnee, avatarHeight * 0.045 * fitScale, Math.min(current.adjustments.legLength / 100, 1.08));
          between(parts.rightLeg, rig.rightHip, rig.rightKnee, avatarHeight * 0.045 * fitScale, Math.min(current.adjustments.legLength / 100, 1.08));
        }

        if (category === "gorra" && parts.accessory) {
          parts.accessory.visible = true;
          if (rig.head) rig.head.getWorldPosition(parts.accessory.position);
          else parts.accessory.position.set(bodyCenter.x, box.min.y + avatarHeight * 0.88, bodyCenter.z);
          parts.accessory.position.y += avatarHeight * 0.045;
          parts.accessory.scale.set(avatarHeight * 0.075, avatarHeight * 0.04, avatarHeight * 0.075);
        }

        if (category === "cadena" && parts.accessory) {
          parts.accessory.visible = true;
          const chest = rig.chest?.getWorldPosition(new Vector3()) ?? new Vector3(bodyCenter.x, box.min.y + avatarHeight * 0.68, bodyCenter.z);
          parts.accessory.position.copy(chest).add(new Vector3(0, -avatarHeight * 0.025, avatarHeight * 0.025));
          parts.accessory.rotation.x = Math.PI / 2;
          parts.accessory.scale.setScalar(avatarHeight * 0.055);
        }

        parts.root.position.set(
          current.adjustments.x / 100,
          (current.adjustments.y + current.adjustments.height) / 100,
          current.adjustments.distance / 500,
        );
        parts.root.rotation.y = (current.adjustments.rotation * Math.PI) / 180;
        parts.root.scale.setScalar(Math.min(Math.max(current.adjustments.scale / 100, 0.55), 1.5));
      }
      frameRef.current = requestAnimationFrame(update);
    };

    frameRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameRef.current);
  }, [category]);

  useEffect(() => () => {
    dispose(partsRef.current);
    textureRef.current?.dispose();
  }, []);

  return (
    <div style={{ width: "100%", height: "100%", minHeight: 500, background }}>
      <CreatorStudioAvatarViewer
        modelUrl={avatar.modelUrl}
        fallbackModelUrl={avatar.fallbackUrl}
        frontRotationY={avatar.frontRotationY + viewRotation}
        config={defaultAvatarConfig}
        poseMode={poseMode}
        className="h-full min-h-[500px] w-full"
        onReady={rebuild}
      />
    </div>
  );
}
