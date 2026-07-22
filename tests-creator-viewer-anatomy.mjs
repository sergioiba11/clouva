import assert from "node:assert/strict";
import fs from "node:fs";

const viewer = fs.readFileSync("components/creator-studio/CreatorStudioAvatarViewerV6.tsx", "utf8");
const entry = fs.readFileSync("components/creator-studio/CreatorStudioAvatarViewer.tsx", "utf8");
const v8 = fs.readFileSync("components/creator-studio/CreatorStudioAvatarViewerV8.tsx", "utf8");
const approval = fs.readFileSync("components/creator-studio/RigApprovalWorkspace.tsx", "utf8");

assert.match(entry, /export \* from "\.\/CreatorStudioAvatarViewerV8"/);
assert.match(v8, /una sola escena, una sola cámara/);
assert.match(v8, /from "\.\/CreatorStudioAvatarViewerV6"/);
assert.doesNotMatch(v8, /SkeletonOverlay/);
assert.doesNotMatch(v8, /BaseViewer/);

assert.match(viewer, /createSkeletonPreview\(model, rig, camera\)/);
assert.match(viewer, /scene\.add\(skeletonPreview\.group\)/);
assert.match(viewer, /controls\.enableRotate = true/);
assert.match(viewer, /controls\.enablePan = true/);
assert.match(viewer, /controls\.enableZoom = true/);
assert.match(viewer, /controls\.screenSpacePanning = true/);
assert.match(viewer, /controls\.zoomToCursor = true/);
assert.match(viewer, /fittedDistance \/ 1000/);
assert.match(viewer, /controls\.minDistance = Math\.max\(0\.28, fittedDistance \* 0\.22\)/);
assert.match(viewer, /dblclick/);
assert.match(viewer, /finger\?\.segment === 1/);
assert.match(viewer, /fingerTips/);
assert.match(viewer, /headEnd/);
assert.match(viewer, /isEarBone/);
assert.match(viewer, /sign \* height \* 0\.020/);
assert.match(viewer, /depthTest: false/);
assert.match(viewer, /const sideView =/);
assert.match(viewer, /linkSide !== nearSide/);
assert.match(viewer, /tipSide !== nearSide/);
assert.doesNotMatch(viewer, /new SkeletonHelper/);
assert.doesNotMatch(viewer, /PointsMaterial/);
assert.doesNotMatch(viewer, /huesos cruzados/);

assert.match(approval, /headGeometryOk/);
assert.match(approval, /fingerGeometryOk/);
assert.match(approval, /earGeometryOk/);
assert.match(approval, /followsHand/);
assert.match(approval, /earSymmetryOk/);
assert.match(approval, /Rig anatómico incorrecto/);
assert.match(approval, /next\.issues\.join/);
assert.match(approval, /&& headPresent/);
assert.match(approval, /&& fingerGeometryOk/);
assert.match(approval, /&& earGeometryOk/);

console.log("[clouva] Creator Studio V8 keeps one interactive camera and hides the far-side rig in lateral views");
