"use client";

// V8 usa una sola escena, una sola cámara y un solo OrbitControls para la malla
// y el esqueleto. Así nunca se separan al rotar, acercar o desplazar el avatar.
export {
  CreatorStudioAvatarViewer,
  type AnchorBoneKey,
  type CreatorPoseMode,
  type CreatorStudioAvatarContext,
} from "./CreatorStudioAvatarViewerV6";
