import assert from "node:assert/strict";
import fs from "node:fs";

const viewer = fs.readFileSync("components/creator-studio/CreatorStudioAvatarViewerV4.tsx", "utf8");
const entry = fs.readFileSync("components/creator-studio/CreatorStudioAvatarViewer.tsx", "utf8");

assert.match(entry, /export \* from "\.\/CreatorStudioAvatarViewerV4"/);
assert.match(viewer, /leftLowerArm/);
assert.match(viewer, /rightLowerArm/);
assert.match(viewer, /aimBone\(root, rig\.leftUpperArm, rig\.leftLowerArm, leftAxis\)/);
assert.match(viewer, /aimBone\(root, rig\.leftLowerArm, rig\.leftHand/);
assert.match(viewer, /aimBone\(root, rig\.rightUpperArm, rig\.rightLowerArm, rightAxis\)/);
assert.match(viewer, /aimBone\(root, rig\.rightLowerArm, rig\.rightHand/);
assert.match(viewer, /childName\.startsWith\("clouvapalmroot"\)/);
assert.match(viewer, /childName\.startsWith\("clouvaear"\)/);
assert.match(viewer, /createSkeletonPreview/);
assert.doesNotMatch(viewer, /new SkeletonHelper/);

console.log("[clouva] Creator Studio anatomical T-pose and filtered skeleton preview contract OK");
