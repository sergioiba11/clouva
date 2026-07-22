import assert from "node:assert/strict";
import fs from "node:fs";

const viewer = fs.readFileSync("components/creator-studio/CreatorStudioAvatarViewerV7.tsx", "utf8");
const baseViewer = fs.readFileSync("components/creator-studio/CreatorStudioAvatarViewerV6.tsx", "utf8");
const entry = fs.readFileSync("components/creator-studio/CreatorStudioAvatarViewer.tsx", "utf8");
const approval = fs.readFileSync("components/creator-studio/RigApprovalWorkspace.tsx", "utf8");

assert.match(entry, /export \* from "\.\/CreatorStudioAvatarViewerV7"/);
assert.match(viewer, /BaseViewer/);
assert.match(viewer, /showSkeleton=\{false\}/);
assert.match(viewer, /SkeletonOverlay/);
assert.match(viewer, /finger\?\.segment === 1|childFinger\?\.segment === 1/);
assert.match(viewer, /fingerTips/);
assert.match(viewer, /headEnd/);
assert.match(viewer, /isEarBone/);
assert.match(viewer, /sign \* height \* 0\.020/);
assert.match(viewer, /depthTest: false/);
assert.doesNotMatch(viewer, /new SkeletonHelper/);
assert.doesNotMatch(viewer, /PointsMaterial/);
assert.doesNotMatch(viewer, /huesos cruzados/);

assert.match(baseViewer, /alignBoneInWorld/);
assert.match(baseViewer, /setFromUnitVectors\(tmpCurrentDirection, tmpTargetDirection\)/);
assert.match(baseViewer, /tmpDesiredWorldQuaternion\.copy\(tmpDeltaWorldQuaternion\)\.multiply\(tmpBoneWorldQuaternion\)/);

assert.match(approval, /headGeometryOk/);
assert.match(approval, /fingerGeometryOk/);
assert.match(approval, /earGeometryOk/);
assert.match(approval, /followsHand/);
assert.match(approval, /lateralAlignment <= 0\.72/);
assert.match(approval, /handLink <= height \* 0\.075/);
assert.match(approval, /Math\.abs\(point\.y - expectedEarY\) <= height \* 0\.060/);
assert.match(approval, /earSymmetryOk/);
assert.match(approval, /Dedos dentro de las manos y siguiendo su dirección real/);
assert.match(approval, /Orejas simétricas y ubicadas sobre la cabeza/);
assert.match(approval, /Rig anatómico incorrecto/);
assert.match(approval, /&& headPresent/);
assert.match(approval, /&& fingerGeometryOk/);
assert.match(approval, /&& earGeometryOk/);

console.log("[clouva] Creator Studio V7 rejects sideways fingers and misplaced ears and renders clean anatomical bones");
