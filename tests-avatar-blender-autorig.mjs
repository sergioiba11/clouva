import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const sourceRoots = ["app", "components", "lib"];
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const forbiddenRiggingRoute = ["", "openapi", "v1", "rigging"].join("/");

function walk(path) {
  const result = [];
  for (const entry of readdirSync(path)) {
    const fullPath = join(path, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) result.push(...walk(fullPath));
    else if ([...sourceExtensions].some((extension) => fullPath.endsWith(extension))) result.push(fullPath);
  }
  return result;
}

const sourceFiles = sourceRoots.flatMap(walk);
const rigRoute = readFileSync("app/api/avatar/rig/route.ts", "utf8");
const libraryButton = readFileSync("components/library/ActiveAvatarDownload.tsx", "utf8");
const meshy = readFileSync("lib/meshy.ts", "utf8");

test("el autorig de avatar no puede volver a llamar la ruta de rigging de Meshy", () => {
  const offenders = sourceFiles.filter((file) => readFileSync(file, "utf8").includes(forbiddenRiggingRoute));
  assert.deepEqual(offenders, [], `Se encontró la ruta prohibida en: ${offenders.join(", ")}`);
  assert.doesNotMatch(rigRoute, /createRiggingTask|getRiggingTask|@\/lib\/meshy/);
});

test("Meshy sigue disponible para generar avatares y prendas", () => {
  assert.match(meshy, /createPreviewTask/);
  assert.match(meshy, /createRefineTask/);
  assert.match(meshy, /createMultiImageTask/);
  assert.match(meshy, /multi-image-to-3d/);
});

test("AUTORIGGEAR AVATAR envía el original limpio al Blender Worker", () => {
  assert.match(libraryButton, /fetch\("\/api\/avatar\/rig"/);
  assert.doesNotMatch(libraryButton, /debug\/rig-official/);
  assert.match(rigRoute, /\/avatar\/complete-rig/);
  assert.match(rigRoute, /completeRigWithWorker\(source\.originalUrl\)/);
  assert.match(rigRoute, /sourceKind: "original-clean-glb"/);
  assert.match(rigRoute, /randomUUID\(\)/);
  assert.match(rigRoute, /jobIsActive\(storedJob, source\)/);
});

test("un avatar terminado no vuelve a riggearse y un trabajo activo no se duplica", () => {
  assert.match(rigRoute, /if \(alreadyRigged\) \{/);
  assert.doesNotMatch(rigRoute, /alreadyRigged\s*&&\s*!force/);
  assert.match(rigRoute, /if \(jobIsActive\(storedJob, source\)\) \{/);
  assert.match(rigRoute, /resumed: true/);
});

test("Blender guarda el resultado en Supabase y actualiza el avatar activo", () => {
  assert.match(rigRoute, /storage\.from\("avatars"\)\.upload/);
  assert.match(rigRoute, /COMPLETE_FILENAME/);
  assert.match(rigRoute, /model_url: publicUrl/);
  assert.match(rigRoute, /is_active: true/);
  assert.match(rigRoute, /avatar_3d_url: publicUrl/);
});

test("la interfaz muestra las cuatro etapas oficiales de Blender", () => {
  for (const label of [
    "Preparando avatar en Blender",
    "Creando esqueleto",
    "Asignando pesos",
    "Listo para Unreal",
  ]) {
    assert.ok(rigRoute.includes(label), `Falta la etapa ${label} en la API`);
    assert.ok(libraryButton.includes(label), `Falta la etapa ${label} en la interfaz`);
  }
});
