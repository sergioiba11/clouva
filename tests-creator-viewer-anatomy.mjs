import assert from "node:assert/strict";
import fs from "node:fs";

const viewer = fs.readFileSync("components/creator-studio/CreatorStudioAvatarViewerV5.tsx", "utf8");
const entry = fs.readFileSync("components/creator-studio/CreatorStudioAvatarViewer.tsx", "utf8");

assert.match(entry, /export \* from "\.\/CreatorStudioAvatarViewerV5"/);
assert.match(viewer, /leftLowerArm/);
assert.match(viewer, /rightLowerArm/);
assert.match(viewer, /alignBoneInWorld/);
assert.match(viewer, /setFromUnitVectors\(tmpCurrentDirection, tmpTargetDirection\)/);
assert.match(viewer, /tmpDesiredWorldQuaternion\.copy\(tmpDeltaWorldQuaternion\)\.multiply\(tmpBoneWorldQuaternion\)/);
assert.match(viewer, /outwardWorldDirection/);
assert.match(viewer, /nearestVisibleBoneAncestor/);
assert.match(viewer, /while \(current\)/);
assert.match(viewer, /createSkeletonPreview/);
assert.match(viewer, /depthTest: false/);
assert.doesNotMatch(viewer, /new SkeletonHelper/);
assert.doesNotMatch(viewer, /parent instanceof Bone/);

console.log("[clouva] Creator Studio V5 world-space T-pose and complete anatomical skeleton contract OK");
