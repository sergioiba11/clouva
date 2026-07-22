import assert from "node:assert/strict";
import fs from "node:fs";

const viewer = fs.readFileSync("components/creator-studio/CreatorStudioAvatarViewerV6.tsx", "utf8");
const entry = fs.readFileSync("components/creator-studio/CreatorStudioAvatarViewer.tsx", "utf8");
const approval = fs.readFileSync("components/creator-studio/RigApprovalWorkspace.tsx", "utf8");

assert.match(entry, /export \* from "\.\/CreatorStudioAvatarViewerV6"/);
assert.match(viewer, /leftLowerArm/);
assert.match(viewer, /rightLowerArm/);
assert.match(viewer, /alignBoneInWorld/);
assert.match(viewer, /setFromUnitVectors\(tmpCurrentDirection, tmpTargetDirection\)/);
assert.match(viewer, /tmpDesiredWorldQuaternion\.copy\(tmpDeltaWorldQuaternion\)\.multiply\(tmpBoneWorldQuaternion\)/);
assert.match(viewer, /finger\?\.segment === 1/);
assert.match(viewer, /fingerTips/);
assert.match(viewer, /Proyectamos la última falange/);
assert.match(viewer, /headEnd/);
assert.match(viewer, /Dibujamos el volumen óseo hacia la coronilla/);
assert.match(viewer, /isEarBone/);
assert.match(viewer, /pequeños huesos cruzados/);
assert.match(viewer, /new PointsMaterial/);
assert.match(viewer, /depthTest: false/);
assert.doesNotMatch(viewer, /new SkeletonHelper/);
assert.doesNotMatch(viewer, /mano→raíz de cada dedo:[^\n]*links\.push/);

assert.match(approval, /headGeometryOk/);
assert.match(approval, /fingerGeometryOk/);
assert.match(approval, /earGeometryOk/);
assert.match(approval, /Cadenas de tres falanges con longitud y posición válidas/);
assert.match(approval, /Hueso de cabeza presente y dentro del cráneo/);
assert.match(approval, /&& headPresent/);
assert.match(approval, /&& fingerGeometryOk/);
assert.match(approval, /&& earGeometryOk/);

console.log("[clouva] Creator Studio V6 renders and validates head, ears and complete finger chains");
