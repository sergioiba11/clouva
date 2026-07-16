"use client";

import { useEffect, useMemo, useRef } from "react";
import { Bone, Box3, Mesh, Object3D, Texture, TextureLoader, Vector3 } from "three";
import { CreatorStudioAvatarViewer, type CreatorPoseMode } from "@/components/creator-studio/CreatorStudioAvatarViewer";
import { useActiveAvatarStore } from "@/lib/avatar-engine/active-avatar-store";
import { defaultAvatarConfig } from "@/lib/avatar-engine/catalog";
import {
  createBaseGarmentTemplate,
  disposeBaseGarmentTemplate,
  type BaseGarmentCategory,
  type BaseGarmentTemplate,
} from "@/lib/creator-studio/base-garment-library";

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
  leftUpperArm?: Bone;
  rightUpperArm?: Bone;
  leftLowerArm?: Bone;
  rightLowerArm?: Bone;
  leftHand?: Bone;
  rightHand?: Bone;
  leftHip?: Bone;
  rightHip?: Bone;
  leftKnee?: Bone;
  rightKnee?: Bone;
};

const p1 = new Vector3();
const p2 = new Vector3();
const midpoint = new Vector3();
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
    leftUpperArm: findBone(bones, ["leftupperarm", "upperarml", "jbiplupperarm", "lupperarm"]),
    rightUpperArm: findBone(bones, ["rightupperarm", "upperarmr", "jbiprupperarm", "rupperarm"]),
    leftLowerArm: findBone(bones, ["leftlowerarm", "leftforearm", "lowerarml", "jbipllowerarm", "forearml"]),
    rightLowerArm: findBone(bones, ["rightlowerarm", "rightforearm", "lowerarmr", "jbiprlowerarm", "forearmr"]),
    leftHand: findBone(bones, ["lefthand", "handl", "jbiplhand"]),
    rightHand: findBone(bones, ["righthand", "handr", "jbiprhand"]),
    leftHip: findBone(bones, ["leftupperleg", "leftupleg", "thighl", "upperlegl", "jbiplupperleg"]),
    rightHip: findBone(bones, ["rightupperleg", "rightupleg", "thighr", "upperlegr", "jbiprupperleg"]),
    leftKnee: findBone(bones, ["leftlowerleg", "leftleg", "calfl", "lowerlegl", "jbipllowerleg"]),
    rightKnee: findBone(bones, ["rightlowerleg", "rightleg", "calfr", "lowerlegr", "jbiprlowerleg"]),
  };
}

function attachBetween(
  item: Mesh | undefined,
  start: Object3D | undefined,
  end: Object3D | undefined,
  radius: number,
  lengthMultiplier = 1,
) {
  if (!item || !start || !end) {
    if (item) item.visible = false;
    return false;
  }
  start.getWorldPosition(p1);
  end.getWorldPosition(p2);
  midpoint.copy(p1).add(p2).multiplyScalar(0.5);
  direction.copy(p2).sub(p1);
  const length = Math.max(direction.length() * lengthMultiplier, 0.01);
  direction.normalize();
  item.visible = true;
  item.position.copy(midpoint);
  item.quaternion.setFromUnitVectors(yAxis, direction);
  item.scale.set(radius, length * 0.72, radius);
  return true;
}

function normalizeCategory(category: string): BaseGarmentCategory | null {
  if (category === "hoodie" || category === "remera" || category === "campera" || category === "baggy") return category;
  return null;
}

export function SmartTryOnViewer({ category, fit, pose, view, background, showBody, garmentOnly, adjustments, imageUrl }: Props) {
  const avatar = useActiveAvatarStore((state) => state.avatar);
  const avatarRef = useRef<Object3D | null>(null);
  const rigRef = useRef<Rig>({});
  const templateRef = useRef<BaseGarmentTemplate | null>(null);
  const textureRef = useRef<Texture | null>(null);
  const frameRef = useRef(0);
  const currentRef = useRef({ fit, showBody, garmentOnly, adjustments });
  currentRef.current = { fit, showBody, garmentOnly, adjustments };

  const viewRotation = useMemo(() => view === "Frente" ? 0 : view === "Lateral" ? -Math.PI / 2 : Math.PI, [view]);
  const poseMode: CreatorPoseMode = pose === "T-Pose" ? "tpose" : pose === "Walk" ? "walk" : "idle";

  function rebuild(root: Object3D) {
    avatarRef.current = root;
    rigRef.current = collectRig(root);
    disposeBaseGarmentTemplate(templateRef.current);
    const baseCategory = normalizeCategory(category);
    templateRef.current = baseCategory
      ? createBaseGarmentTemplate(baseCategory, { map: textureRef.current })
      : null;
    if (templateRef.current) (root.parent ?? root).add(templateRef.current.root);
  }

  useEffect(() => {
    textureRef.current?.dispose();
    textureRef.current = null;
    if (!imageUrl) {
      if (avatarRef.current) rebuild(avatarRef.current);
      return;
    }
    const loader = new TextureLoader();
    loader.load(
      imageUrl,
      (texture) => {
        texture.colorSpace = "srgb" as any;
        textureRef.current = texture;
        if (avatarRef.current) rebuild(avatarRef.current);
      },
      undefined,
      () => {
        textureRef.current = null;
        if (avatarRef.current) rebuild(avatarRef.current);
      },
    );
  }, [imageUrl, category]);

  useEffect(() => {
    const update = () => {
      const avatarRoot = avatarRef.current;
      const template = templateRef.current;
      if (avatarRoot && template) {
        const current = currentRef.current;
        avatarRoot.updateMatrixWorld(true);
        avatarRoot.traverse((object) => {
          if ((object as Mesh).isMesh) object.visible = current.showBody && !current.garmentOnly;
        });

        const bounds = new Box3().setFromObject(avatarRoot);
        bounds.getSize(size);
        const avatarHeight = Math.max(size.y, 1.5);
        const avatarCenter = bounds.getCenter(midpoint);
        const rig = rigRef.current;
        const fitScale = current.fit === "Slim" ? 0.93 : current.fit === "Oversize" ? 1.11 : 1;
        const width = Math.min(Math.max(current.adjustments.width / 100, 0.7), 1.35);
        const length = Math.min(Math.max(current.adjustments.length / 100, 0.72), 1.3);
        const sleeveLength = Math.min(Math.max(current.adjustments.sleeveLength / 100, 0.72), 1.16);
        const depth = Math.min(Math.max(1 + current.adjustments.distance / 320, 0.92), 1.16);

        if (template.torso) {
          if (rig.chest && rig.hips) {
            rig.chest.getWorldPosition(p1);
            rig.hips.getWorldPosition(p2);
            template.torso.position.copy(p1).lerp(p2, category === "baggy" ? 0.8 : 0.52);
          } else {
            template.torso.position.set(
              avatarCenter.x,
              bounds.min.y + avatarHeight * (category === "baggy" ? 0.47 : 0.61),
              avatarCenter.z,
            );
          }
          if (category === "baggy") {
            template.torso.scale.set(avatarHeight * 0.16 * width, avatarHeight * 0.13, avatarHeight * 0.12 * depth);
          } else {
            template.torso.scale.set(
              avatarHeight * 0.23 * fitScale * width,
              avatarHeight * 0.25 * length,
              avatarHeight * 0.20 * fitScale * depth,
            );
          }
        }

        if (category !== "baggy") {
          const sleeveRadius = avatarHeight * 0.14 * fitScale * width;
          attachBetween(template.leftUpperSleeve, rig.leftUpperArm, rig.leftLowerArm, sleeveRadius, sleeveLength);
          attachBetween(template.rightUpperSleeve, rig.rightUpperArm, rig.rightLowerArm, sleeveRadius, sleeveLength);
          attachBetween(template.leftLowerSleeve, rig.leftLowerArm, rig.leftHand, sleeveRadius * 0.88, sleeveLength);
          attachBetween(template.rightLowerSleeve, rig.rightLowerArm, rig.rightHand, sleeveRadius * 0.88, sleeveLength);

          const chestPosition = rig.chest?.getWorldPosition(new Vector3())
            ?? new Vector3(avatarCenter.x, bounds.min.y + avatarHeight * 0.7, avatarCenter.z);

          if (template.collar) {
            template.collar.visible = true;
            template.collar.position.copy(chestPosition).add(new Vector3(0, avatarHeight * 0.055, avatarHeight * 0.005));
            const neck = avatarHeight * 0.21 * Math.min(Math.max(current.adjustments.neckSize / 50, 0.65), 1.35);
            template.collar.scale.set(neck, neck, neck * 0.72);
          }

          if (template.hood) {
            const headPosition = rig.head?.getWorldPosition(new Vector3())
              ?? new Vector3(avatarCenter.x, bounds.min.y + avatarHeight * 0.84, avatarCenter.z);
            template.hood.visible = true;
            template.hood.position.copy(headPosition).add(new Vector3(0, -avatarHeight * 0.075, -avatarHeight * 0.045));
            const hood = avatarHeight * 0.25 * Math.min(Math.max(current.adjustments.hoodSize / 50, 0.65), 1.35);
            template.hood.scale.set(hood, hood, hood);
          }

          if (template.pocket && template.torso) {
            template.pocket.visible = category === "hoodie";
            template.pocket.position.copy(template.torso.position).add(new Vector3(0, -avatarHeight * 0.085, avatarHeight * 0.105));
            template.pocket.scale.set(avatarHeight * 0.18 * width, avatarHeight * 0.12 * length, 1);
          }
        } else {
          attachBetween(template.leftLeg, rig.leftHip, rig.leftKnee, avatarHeight * 0.15 * fitScale * width, Math.min(current.adjustments.legLength / 100, 1.12));
          attachBetween(template.rightLeg, rig.rightHip, rig.rightKnee, avatarHeight * 0.15 * fitScale * width, Math.min(current.adjustments.legLength / 100, 1.12));
        }

        template.root.position.set(
          current.adjustments.x / 100,
          (current.adjustments.y + current.adjustments.height) / 100,
          current.adjustments.distance / 600,
        );
        template.root.rotation.y = (current.adjustments.rotation * Math.PI) / 180;
        template.root.scale.setScalar(Math.min(Math.max(current.adjustments.scale / 100, 0.6), 1.45));
      }
      frameRef.current = requestAnimationFrame(update);
    };

    frameRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameRef.current);
  }, [category]);

  useEffect(() => () => {
    disposeBaseGarmentTemplate(templateRef.current);
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
