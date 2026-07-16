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
import { AvatarModelViewer, type AvatarPoseMode } from "@/components/avatar-engine/AvatarModelViewer";
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
  leftShoulder?: Bone;
  rightShoulder?: Bone;
  leftElbow?: Bone;
  rightElbow?: Bone;
  leftHand?: Bone;
  rightHand?: Bone;
  leftHip?: Bone;
  rightHip?: Bone;
  leftKnee?: Bone;
  rightKnee?: Bone;
};

type Parts = {
  root: Group;
  torso?: Mesh;
  hood?: Mesh;
  leftUpperSleeve?: Mesh;
  rightUpperSleeve?: Mesh;
  leftLowerSleeve?: Mesh;
  rightLowerSleeve?: Mesh;
  leftLeg?: Mesh;
  rightLeg?: Mesh;
};

const p1 = new Vector3();
const p2 = new Vector3();
const center = new Vector3();
const direction = new Vector3();
const boundsSize = new Vector3();
const yAxis = new Vector3(0, 1, 0);

function clean(value: string) {
  return value.toLowerCase().replace(/^mixamorig:/, "").replace(/[^a-z0-9]/g, "");
}

function findBone(bones: Bone[], names: string[]) {
  return bones.find((bone) => names.includes(clean(bone.name)))
    ?? bones.find((bone) => names.some((name) => clean(bone.name).includes(name)));
}

function collectRig(root: Object3D): Rig {
  const bones: Bone[] = [];
  root.traverse((object) => {
    const bone = object as Bone;
    if (bone.isBone) bones.push(bone);
  });
  return {
    hips: findBone(bones, ["hips", "pelvis", "jbiphips"]),
    chest: findBone(bones, ["upperchest", "chest", "spine2", "jbipupperchest", "jbipchest"]),
    head: findBone(bones, ["head", "jbiphead"]),
    leftShoulder: findBone(bones, ["leftshoulder", "shoulderl", "jbiplshoulder", "leftupperarm", "jbiplupperarm"]),
    rightShoulder: findBone(bones, ["rightshoulder", "shoulderr", "jbiprshoulder", "rightupperarm", "jbiprupperarm"]),
    leftElbow: findBone(bones, ["leftlowerarm", "leftforearm", "lowerarml", "jbipllowerarm"]),
    rightElbow: findBone(bones, ["rightlowerarm", "rightforearm", "lowerarmr", "jbiprlowerarm"]),
    leftHand: findBone(bones, ["lefthand", "handl", "jbiplhand"]),
    rightHand: findBone(bones, ["righthand", "handr", "jbiprhand"]),
    leftHip: findBone(bones, ["leftupperleg", "leftupleg", "thighl", "jbiplupperleg"]),
    rightHip: findBone(bones, ["rightupperleg", "rightupleg", "thighr", "jbiprupperleg"]),
    leftKnee: findBone(bones, ["leftlowerleg", "leftleg", "calfl", "jbipllowerleg"]),
    rightKnee: findBone(bones, ["rightlowerleg", "rightleg", "calfr", "jbiprlowerleg"]),
  };
}

function material(texture: Texture | null) {
  return new MeshPhysicalMaterial({
    color: texture ? 0xffffff : 0x7b4dd4,
    map: texture,
    roughness: 0.72,
    metalness: 0.02,
    clearcoat: 0.08,
    side: DoubleSide,
    transparent: true,
    opacity: 0.9,
  });
}

function make(name: string, geometry: BoxGeometry | CylinderGeometry | SphereGeometry | TorusGeometry, mat: MeshPhysicalMaterial) {
  const item = new Mesh(geometry, mat);
  item.name = name;
  item.castShadow = true;
  item.frustumCulled = false;
  return item;
}

function createParts(category: string, texture: Texture | null): Parts {
  const root = new Group();
  const mat = material(texture);
  const parts: Parts = { root };

  if (["hoodie", "campera", "remera"].includes(category)) {
    parts.torso = make("torso", new SphereGeometry(1, 28, 20), mat);
    parts.leftUpperSleeve = make("leftUpperSleeve", new CylinderGeometry(1, 1, 1, 18), mat);
    parts.rightUpperSleeve = make("rightUpperSleeve", new CylinderGeometry(1, 1, 1, 18), mat);
    parts.leftLowerSleeve = make("leftLowerSleeve", new CylinderGeometry(1, 1, 1, 18), mat);
    parts.rightLowerSleeve = make("rightLowerSleeve", new CylinderGeometry(1, 1, 1, 18), mat);
    root.add(parts.torso, parts.leftUpperSleeve, parts.rightUpperSleeve, parts.leftLowerSleeve, parts.rightLowerSleeve);
    if (category === "hoodie") {
      parts.hood = make("hood", new SphereGeometry(1, 24, 18), mat);
      root.add(parts.hood);
    }
  } else if (category === "baggy") {
    parts.torso = make("waist", new CylinderGeometry(1, 1.12, 1, 22), mat);
    parts.leftLeg = make("leftLeg", new CylinderGeometry(1, 1.12, 1, 18), mat);
    parts.rightLeg = make("rightLeg", new CylinderGeometry(1, 1.12, 1, 18), mat);
    root.add(parts.torso, parts.leftLeg, parts.rightLeg);
  } else if (category === "zapatillas") {
    parts.leftLeg = make("leftShoe", new BoxGeometry(1, 1, 1.6), mat);
    parts.rightLeg = make("rightShoe", new BoxGeometry(1, 1, 1.6), mat);
    root.add(parts.leftLeg, parts.rightLeg);
  } else if (category === "gorra") {
    parts.hood = make("cap", new SphereGeometry(1, 24, 16), mat);
    root.add(parts.hood);
  } else if (category === "cadena") {
    parts.torso = make("chain", new TorusGeometry(1, 0.1, 10, 42), mat);
    root.add(parts.torso);
  }
  return parts;
}

function between(item: Mesh | undefined, start: Object3D | undefined, end: Object3D | undefined, radius: number, multiplier = 1) {
  if (!item || !start || !end) return false;
  start.getWorldPosition(p1);
  end.getWorldPosition(p2);
  center.copy(p1).add(p2).multiplyScalar(0.5);
  direction.copy(p2).sub(p1);
  const length = Math.max(direction.length() * multiplier, 0.01);
  direction.normalize();
  item.visible = true;
  item.position.copy(center);
  item.quaternion.setFromUnitVectors(yAxis, direction);
  item.scale.set(radius, length * 0.5, radius);
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
  const poseMode: AvatarPoseMode = pose === "T-Pose" ? "tpose" : pose === "Walk" ? "walk" : "idle";

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
        box.getSize(boundsSize);
        const height = Math.max(boundsSize.y, 1.5);
        const fitScale = current.fit === "Slim" ? 0.92 : current.fit === "Oversize" ? 1.12 : 1;
        const radius = height * 0.034 * fitScale * (current.adjustments.width / 100);
        const sleeve = current.adjustments.sleeveLength / 100;
        const rig = rigRef.current;

        const leftUpperOk = between(parts.leftUpperSleeve, rig.leftShoulder, rig.leftElbow, radius, sleeve);
        const rightUpperOk = between(parts.rightUpperSleeve, rig.rightShoulder, rig.rightElbow, radius, sleeve);
        const leftLowerOk = between(parts.leftLowerSleeve, rig.leftElbow, rig.leftHand, radius * 0.9, sleeve);
        const rightLowerOk = between(parts.rightLowerSleeve, rig.rightElbow, rig.rightHand, radius * 0.9, sleeve);

        const bodyCenter = box.getCenter(center);
        if (parts.torso) {
          parts.torso.visible = true;
          if (rig.chest && rig.hips) {
            rig.chest.getWorldPosition(p1);
            rig.hips.getWorldPosition(p2);
            parts.torso.position.copy(p1).lerp(p2, 0.38);
          } else {
            parts.torso.position.set(bodyCenter.x, box.min.y + height * 0.58, bodyCenter.z);
          }
          parts.torso.scale.set(height * 0.13 * fitScale * (current.adjustments.width / 100), height * 0.19 * (current.adjustments.length / 100), height * 0.085 * fitScale * (1 + current.adjustments.distance / 100));
        }

        if (parts.hood) {
          parts.hood.visible = true;
          if (rig.head) rig.head.getWorldPosition(parts.hood.position);
          else parts.hood.position.set(bodyCenter.x, box.min.y + height * 0.82, bodyCenter.z - height * 0.03);
          parts.hood.scale.set(height * 0.09, height * 0.105, height * 0.075);
        }

        if (!leftUpperOk && parts.leftUpperSleeve) {
          parts.leftUpperSleeve.visible = true;
          parts.leftUpperSleeve.position.set(bodyCenter.x - height * 0.17, box.min.y + height * 0.59, bodyCenter.z);
          parts.leftUpperSleeve.scale.set(radius, height * 0.13, radius);
        }
        if (!rightUpperOk && parts.rightUpperSleeve) {
          parts.rightUpperSleeve.visible = true;
          parts.rightUpperSleeve.position.set(bodyCenter.x + height * 0.17, box.min.y + height * 0.59, bodyCenter.z);
          parts.rightUpperSleeve.scale.set(radius, height * 0.13, radius);
        }
        if (!leftLowerOk && parts.leftLowerSleeve) parts.leftLowerSleeve.visible = false;
        if (!rightLowerOk && parts.rightLowerSleeve) parts.rightLowerSleeve.visible = false;

        between(parts.leftLeg, rig.leftHip, rig.leftKnee, height * 0.055 * fitScale, current.adjustments.legLength / 100);
        between(parts.rightLeg, rig.rightHip, rig.rightKnee, height * 0.055 * fitScale, current.adjustments.legLength / 100);

        parts.root.position.set(current.adjustments.x / 100, (current.adjustments.y + current.adjustments.height) / 100, current.adjustments.distance / 250);
        parts.root.rotation.y = (current.adjustments.rotation * Math.PI) / 180;
        parts.root.scale.setScalar(current.adjustments.scale / 100);
      }
      frameRef.current = requestAnimationFrame(update);
    };
    frameRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameRef.current);
  }, []);

  useEffect(() => () => {
    dispose(partsRef.current);
    textureRef.current?.dispose();
  }, []);

  return (
    <div style={{ width: "100%", height: "100%", minHeight: 500, background }}>
      <AvatarModelViewer
        modelUrl={avatar.modelUrl}
        fallbackModelUrl={avatar.fallbackUrl}
        frontRotationY={avatar.frontRotationY + viewRotation}
        config={defaultAvatarConfig}
        playAnimations
        motionTest={false}
        poseMode={poseMode}
        className="h-full min-h-[500px] w-full"
        alt="Vista previa 3D con ropa vinculada al avatar CLOUVA"
        onReady={rebuild}
      />
    </div>
  );
}
