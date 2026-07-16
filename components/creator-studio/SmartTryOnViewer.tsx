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
  collar?: Mesh;
  hood?: Mesh;
  leftUpperSleeve?: Mesh;
  rightUpperSleeve?: Mesh;
  leftLowerSleeve?: Mesh;
  rightLowerSleeve?: Mesh;
  leftLeg?: Mesh;
  rightLeg?: Mesh;
};

type Segment = { bone: Bone; child: Bone; midpoint: Vector3; direction: Vector3 };

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
  root.updateMatrixWorld(true);
  const boneSet = new Set<Bone>();
  root.traverse((object: any) => {
    if (object.isBone) boneSet.add(object as Bone);
    if (object.isSkinnedMesh) {
      for (const bone of object.skeleton?.bones ?? []) boneSet.add(bone as Bone);
    }
  });
  const bones = [...boneSet];
  const box = new Box3().setFromObject(root);
  const height = Math.max(box.max.y - box.min.y, 0.001);
  const centerX = (box.min.x + box.max.x) * 0.5;
  const segments: Segment[] = [];
  for (const bone of bones) {
    for (const child of bone.children.filter((item: any) => item.isBone) as Bone[]) {
      const start = bone.getWorldPosition(new Vector3());
      const end = child.getWorldPosition(new Vector3());
      const vector = end.clone().sub(start);
      if (vector.length() < 0.0001) continue;
      segments.push({ bone, child, midpoint: start.clone().add(end).multiplyScalar(0.5), direction: vector.normalize() });
    }
  }
  const relativeY = (point: Vector3) => (point.y - box.min.y) / height;
  const relativeX = (point: Vector3) => (point.x - centerX) / height;

  function limb(side: -1 | 1, type: "arm" | "leg") {
    const candidates = segments.filter((segment) => {
      const y = relativeY(segment.midpoint);
      const x = relativeX(segment.midpoint) * side;
      if (type === "arm") {
        const horizontal = Math.abs(segment.direction.x) > Math.abs(segment.direction.y) * 0.35;
        return y > 0.43 && y < 0.82 && x > 0.035 && horizontal;
      }
      const vertical = Math.abs(segment.direction.y) > Math.abs(segment.direction.x) * 0.55;
      return y > 0.08 && y < 0.58 && x > 0.008 && vertical;
    });
    for (const upper of candidates) {
      const lower = segments.find((segment) => segment.bone === upper.child);
      if (lower) return { upper: upper.bone, lower: lower.bone, end: lower.child };
    }
    return { upper: undefined, lower: undefined, end: undefined };
  }

  const leftArm = limb(-1, "arm");
  const rightArm = limb(1, "arm");
  const leftLeg = limb(-1, "leg");
  const rightLeg = limb(1, "leg");

  return {
    hips: findBone(bones, ["hips", "pelvis", "jbiphips"]) ?? segments.find((segment) => relativeY(segment.midpoint) > 0.35 && relativeY(segment.midpoint) < 0.55 && Math.abs(relativeX(segment.midpoint)) < 0.1)?.bone,
    chest: findBone(bones, ["upperchest", "chest", "spine2", "jbipupperchest", "jbipchest"]) ?? segments.find((segment) => relativeY(segment.midpoint) > 0.62 && relativeY(segment.midpoint) < 0.8 && Math.abs(relativeX(segment.midpoint)) < 0.1)?.bone,
    head: findBone(bones, ["head", "jbiphead"]) ?? bones.slice().sort((a, b) => b.getWorldPosition(new Vector3()).y - a.getWorldPosition(new Vector3()).y)[0],
    leftShoulder: findBone(bones, ["leftshoulder", "shoulderl", "jbiplshoulder", "leftupperarm"]) ?? leftArm.upper,
    rightShoulder: findBone(bones, ["rightshoulder", "shoulderr", "jbiprshoulder", "rightupperarm"]) ?? rightArm.upper,
    leftElbow: findBone(bones, ["leftlowerarm", "leftforearm", "lowerarml", "forearml", "jbipllowerarm"]) ?? leftArm.lower,
    rightElbow: findBone(bones, ["rightlowerarm", "rightforearm", "lowerarmr", "forearmr", "jbiprlowerarm"]) ?? rightArm.lower,
    leftHand: findBone(bones, ["lefthand", "handl", "jbiplhand"]) ?? leftArm.end,
    rightHand: findBone(bones, ["righthand", "handr", "jbiprhand"]) ?? rightArm.end,
    leftHip: findBone(bones, ["leftupperleg", "leftupleg", "thighl", "upperlegl", "jbiplupperleg"]) ?? leftLeg.upper,
    rightHip: findBone(bones, ["rightupperleg", "rightupleg", "thighr", "upperlegr", "jbiprupperleg"]) ?? rightLeg.upper,
    leftKnee: findBone(bones, ["leftlowerleg", "leftleg", "calfl", "lowerlegl", "jbipllowerleg"]) ?? leftLeg.lower,
    rightKnee: findBone(bones, ["rightlowerleg", "rightleg", "calfr", "lowerlegr", "jbiprlowerleg"]) ?? rightLeg.lower,
  };
}

function material(texture: Texture | null) {
  return new MeshPhysicalMaterial({
    color: texture ? 0xffffff : 0x7b4dd4,
    map: texture,
    roughness: 0.78,
    metalness: 0.01,
    clearcoat: 0.04,
    side: DoubleSide,
    transparent: true,
    opacity: 0.96,
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
    parts.torso = make("torso", new CylinderGeometry(0.82, 0.62, 1.42, 28, 5, false), mat);
    parts.leftUpperSleeve = make("leftUpperSleeve", new CylinderGeometry(0.92, 0.78, 1, 18), mat);
    parts.rightUpperSleeve = make("rightUpperSleeve", new CylinderGeometry(0.92, 0.78, 1, 18), mat);
    parts.leftLowerSleeve = make("leftLowerSleeve", new CylinderGeometry(0.78, 0.64, 1, 18), mat);
    parts.rightLowerSleeve = make("rightLowerSleeve", new CylinderGeometry(0.78, 0.64, 1, 18), mat);
    parts.collar = make("collar", new TorusGeometry(1, 0.22, 12, 32), mat);
    root.add(parts.torso, parts.leftUpperSleeve, parts.rightUpperSleeve, parts.leftLowerSleeve, parts.rightLowerSleeve, parts.collar);

    if (category === "hoodie") {
      parts.hood = make("hood", new SphereGeometry(1, 24, 18, 0, Math.PI * 2, 0, Math.PI * 0.72), mat);
      root.add(parts.hood);
    }
  } else if (category === "baggy") {
    parts.torso = make("waist", new CylinderGeometry(0.86, 0.76, 0.5, 22), mat);
    parts.leftLeg = make("leftLeg", new CylinderGeometry(0.86, 0.68, 1, 18), mat);
    parts.rightLeg = make("rightLeg", new CylinderGeometry(0.86, 0.68, 1, 18), mat);
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
  item.scale.set(radius, length * 0.5, radius * 0.92);
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
        avatarRoot.traverse((object) => { if ((object as Mesh).isMesh) object.visible = current.showBody && !current.garmentOnly; });

        const box = new Box3().setFromObject(avatarRoot);
        box.getSize(boundsSize);
        const height = Math.max(boundsSize.y, 1.5);
        const fitScale = current.fit === "Slim" ? 0.9 : current.fit === "Oversize" ? 1.1 : 1;
        const widthScale = current.adjustments.width / 100;
        const lengthScale = current.adjustments.length / 100;
        const depthScale = 1 + Math.min(current.adjustments.distance, 20) / 140;
        const sleeve = Math.min(current.adjustments.sleeveLength / 100, 1.08);
        const rig = rigRef.current;
        const sleeveRadius = height * 0.026 * fitScale * widthScale;

        const leftUpperOk = between(parts.leftUpperSleeve, rig.leftShoulder, rig.leftElbow, sleeveRadius, sleeve);
        const rightUpperOk = between(parts.rightUpperSleeve, rig.rightShoulder, rig.rightElbow, sleeveRadius, sleeve);
        const leftLowerOk = between(parts.leftLowerSleeve, rig.leftElbow, rig.leftHand, sleeveRadius * 0.9, sleeve);
        const rightLowerOk = between(parts.rightLowerSleeve, rig.rightElbow, rig.rightHand, sleeveRadius * 0.9, sleeve);
        const bodyCenter = box.getCenter(center);

        if (parts.torso) {
          parts.torso.visible = true;
          if (rig.chest && rig.hips) {
            rig.chest.getWorldPosition(p1);
            rig.hips.getWorldPosition(p2);
            parts.torso.position.copy(p1).lerp(p2, 0.48);
          } else {
            parts.torso.position.set(bodyCenter.x, box.min.y + height * 0.6, bodyCenter.z);
          }
          parts.torso.scale.set(
            height * 0.115 * fitScale * widthScale,
            height * 0.185 * lengthScale,
            height * 0.062 * fitScale * depthScale,
          );
        }

        if (parts.collar) {
          parts.collar.visible = ["hoodie", "campera", "remera"].includes(category);
          const collarBase = rig.chest?.getWorldPosition(new Vector3()) ?? new Vector3(bodyCenter.x, box.min.y + height * 0.72, bodyCenter.z);
          parts.collar.position.copy(collarBase).add(new Vector3(0, height * 0.055, 0));
          parts.collar.rotation.x = Math.PI / 2;
          const neck = height * 0.044 * (current.adjustments.neckSize / 50);
          parts.collar.scale.set(neck, neck, neck * 0.65);
        }

        if (parts.hood) {
          parts.hood.visible = category === "hoodie" || category === "gorra";
          if (rig.head) rig.head.getWorldPosition(parts.hood.position);
          else parts.hood.position.set(bodyCenter.x, box.min.y + height * 0.81, bodyCenter.z);
          if (category === "hoodie") {
            parts.hood.position.add(new Vector3(0, -height * 0.055, -height * 0.045));
            const hood = height * 0.055 * (current.adjustments.hoodSize / 50);
            parts.hood.scale.set(hood, hood * 0.95, hood * 0.72);
          } else {
            parts.hood.scale.set(height * 0.09, height * 0.055, height * 0.09);
          }
        }

        if (!leftUpperOk && parts.leftUpperSleeve) parts.leftUpperSleeve.visible = false;
        if (!rightUpperOk && parts.rightUpperSleeve) parts.rightUpperSleeve.visible = false;
        if (!leftLowerOk && parts.leftLowerSleeve) parts.leftLowerSleeve.visible = false;
        if (!rightLowerOk && parts.rightLowerSleeve) parts.rightLowerSleeve.visible = false;

        between(parts.leftLeg, rig.leftHip, rig.leftKnee, height * 0.05 * fitScale, Math.min(current.adjustments.legLength / 100, 1.08));
        between(parts.rightLeg, rig.rightHip, rig.rightKnee, height * 0.05 * fitScale, Math.min(current.adjustments.legLength / 100, 1.08));

        parts.root.position.set(
          current.adjustments.x / 100,
          (current.adjustments.y + current.adjustments.height) / 100,
          current.adjustments.distance / 420,
        );
        parts.root.rotation.y = (current.adjustments.rotation * Math.PI) / 180;
        parts.root.scale.setScalar(current.adjustments.scale / 100);
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
