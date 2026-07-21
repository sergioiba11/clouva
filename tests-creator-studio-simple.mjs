import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const studio = readFileSync("./components/creator-studio/CreatorStudioSimple.tsx", "utf8");
const rigWorkspace = readFileSync("./components/creator-studio/RigApprovalWorkspace.tsx", "utf8");
const worker = readFileSync("./worker/garment-rig/app_v16.py", "utf8");
const dockerfile = readFileSync("./worker/garment-rig/Dockerfile", "utf8");
const exportRoute = readFileSync("./app/api/avatar/export-unreal/route.ts", "utf8");
const commandRoute = readFileSync("./app/api/unreal/commands/route.ts", "utf8");
const bridge = readFileSync("./clouva-unreal-bridge/src/index.ts", "utf8");
const importer = readFileSync("./clouva-unreal-bridge/unreal/Content/Python/clouva_importer.py", "utf8");

test("Creator Studio conserva el flujo simple", () => {
  for (const label of ["Elegir GLB", "Riggear avatar", "Enviar FBX", "Traer data", "Riggear GLB", "VISOR 3D"]) assert.ok(studio.includes(label));
});

test("el rig se revisa visualmente antes de habilitar Unreal", () => {
  for (const label of ["Modelo", "Huesos", "Animación", "Diagnóstico", "Aprobar rig"]) assert.ok(rigWorkspace.includes(label));
  assert.match(rigWorkspace, /showSkeleton=\{mode === "bones" \|\| mode === "diagnostics"\}/);
  assert.match(rigWorkspace, /weightedRatio >= 0\.995/);
  assert.match(rigWorkspace, /leftFingerChains >= 5/);
  assert.match(rigWorkspace, /rightFingerChains >= 5/);
  assert.match(studio, /avatarRigReady && rigApproved/);
  assert.match(studio, /Primero aprobá el rig en el visor/);
});

test("el diagnóstico no confunde la bind pose con una escala inválida", () => {
  assert.match(rigWorkspace, /Los huesos pueden contener escalas internas legítimas de la bind pose/);
  assert.doesNotMatch(rigWorkspace, /object\.isBone \|\| object\.isSkinnedMesh/);
  assert.match(rigWorkspace, /ARM_MARKERS/);
  assert.match(rigWorkspace, /LEG_MARKERS/);
  assert.match(rigWorkspace, /structurallyCompleteRig/);
});

test("Enviar FBX crea una orden que el bridge importa dentro de Unreal", () => {
  assert.match(exportRoute, /unreal_import_commands/);
  assert.match(exportRoute, /sentToUnreal: true/);
  assert.match(commandRoute, /\.eq\("status", "pending"\)/);
  assert.match(bridge, /Saved\/ClouvaInbox/);
  assert.match(bridge, /api\/unreal\/commands/);
  assert.match(importer, /AssetImportTask/);
  assert.match(importer, /import_asset_tasks/);
});

test("Worker V16 está activo para el molde", () => {
  assert.ok(dockerfile.includes("app_v16.py"));
  assert.ok(dockerfile.includes("mv app_v16.py app.py"));
  assert.ok(worker.includes("unreal_mold_health_v2"));
});
