import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const studio = readFileSync("./components/creator-studio/CreatorStudioSimple.tsx", "utf8");
const bootstrap = readFileSync("./components/creator-studio/CreatorStudioBootstrap.tsx", "utf8");
const avatarRigRoute = readFileSync("./app/api/avatar/rig/route.ts", "utf8");
const clothingRoute = readFileSync("./app/api/clothing/finalize/route.ts", "utf8");
const clothingFinalization = readFileSync("./lib/clothing-finalization.ts", "utf8");
const workerApi = readFileSync("./worker/garment-rig/app_v15.py", "utf8");
const workerScript = readFileSync("./worker/garment-rig/complete_avatar_rig.py", "utf8");
const workerDockerfile = readFileSync("./worker/garment-rig/Dockerfile", "utf8");

test("Creator Studio monta solamente el flujo simple validado", () => {
  assert.match(bootstrap, /CreatorStudioSimple/);
  assert.doesNotMatch(bootstrap, /UnrealObjectExport/);
  assert.match(studio, /Elegir GLB/);
  assert.match(studio, /Elegí primero el GLB/);
  assert.match(studio, /Riggear avatar/);
  assert.match(studio, /Enviar FBX/);
  assert.match(studio, /Traer data/);
  assert.match(studio, /Riggear GLB/);
  assert.match(studio, /VISOR 3D/);
  assert.match(studio, /BLENDER WORKER/);
  assert.match(studio, />UNREAL</);
});

test("el rigeador de usuario completa y valida dedos y orejas", () => {
  assert.match(studio, /\/api\/avatar\/rig/);
  assert.match(avatarRigRoute, /createRiggingTask/);
  assert.match(avatarRigRoute, /\/avatar\/complete-rig/);
  assert.match(avatarRigRoute, /profile\.fingers\?\.complete !== true/);
  assert.match(avatarRigRoute, /profile\.ears\?\.complete !== true/);
  assert.match(workerScript, /clouva_\{finger\}_\{segment:02d\}_\{side\}/);
  assert.match(workerScript, /clouva_ear_l/);
  assert.match(workerScript, /clouva_ear_r/);
  assert.match(workerScript, /assign_extended_weights/);
  assert.match(workerScript, /Extended rig validation failed/);
});

test("Unreal entrega el snapshot y Blender lo usa como fuente del molde", () => {
  assert.match(studio, /unrealSnapshot: unreal\.snapshot/);
  assert.match(clothingRoute, /readUnrealSnapshot/);
  assert.match(clothingRoute, /mold_source: "unreal-avatar-snapshot"/);
  assert.match(clothingFinalization, /\/rig-with-unreal-mold/);
  assert.match(workerApi, /@app\.post\("\/rig-with-unreal-mold"\)/);
  assert.match(workerApi, /"unrealSnapshot": request\.unreal_snapshot/);
});

test("el Worker activo incluye el completador de rig", () => {
  assert.match(workerDockerfile, /app_v15\.py/);
  assert.match(workerDockerfile, /complete_avatar_rig\.py/);
  assert.match(workerDockerfile, /mv app_v15\.py app\.py/);
  assert.match(workerApi, /@app\.post\("\/avatar\/complete-rig"\)/);
});
