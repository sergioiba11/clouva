import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const assetsSource = readFileSync("./lib/creator-studio/reference-assets-v2.ts", "utf8");
const librarySource = readFileSync("./components/creator-studio/ReferenceAssetLibraryV2.tsx", "utf8");
const automaticSource = readFileSync("./components/creator-studio/CreatorStudioAutomatic.tsx", "utf8");

test("cada resultado riggeado se guarda como un asset nuevo", () => {
  assert.match(assetsSource, /const resultId = crypto\.randomUUID\(\)/);
  assert.match(assetsSource, /const resultStoragePath = `\$\{userId\}\/\$\{resultId\}/);
  assert.match(assetsSource, /status: "ready"/);
  assert.match(assetsSource, /sourceAssetId/);
  assert.match(assetsSource, /await supabase\.from\(TABLE\)\.insert\(resultRow\)/);
  assert.doesNotMatch(assetsSource, /\.update\(\{[\s\S]{0,220}rigged_storage_path: resultStoragePath/);
});

test("procesar o fallar un intento no marca ni modifica el GLB fuente", () => {
  const processing = assetsSource.slice(
    assetsSource.indexOf("export async function setReferenceAssetProcessing"),
    assetsSource.indexOf("export async function saveRiggedReferenceAsset"),
  );
  const failure = assetsSource.slice(
    assetsSource.indexOf("export async function markReferenceAssetError"),
    assetsSource.indexOf("export async function deleteReferenceAsset"),
  );
  assert.match(processing, /keepSourceClean\(id, userId\)/);
  assert.doesNotMatch(processing, /status:\s*"processing"/);
  assert.doesNotMatch(processing, /preview_settings:\s*_previewSettings/);
  assert.match(failure, /keepSourceClean\(id, userId\)/);
  assert.doesNotMatch(failure, /status:\s*"error"/);
});

test("los registros viejos que mezclaban original y rig se separan automáticamente", () => {
  assert.match(assetsSource, /function isLegacyCombinedRow/);
  assert.match(assetsSource, /row\.storage_path !== row\.rigged_storage_path/);
  assert.match(assetsSource, /async function migrateLegacyCombinedRow/);
  assert.match(assetsSource, /resultKind: "migrated-rigged-copy"/);
  assert.match(assetsSource, /rigged_storage_path: null/);
  assert.match(assetsSource, /return cleanSourceRow\(row, userId\)/);
});

test("la biblioteca separa originales de resultados sin badges de job", () => {
  assert.match(librarySource, /GLB originales/);
  assert.match(librarySource, /Resultados guardados/);
  assert.match(librarySource, /GLB ORIGINAL/);
  assert.match(librarySource, /RESULTADO RIGGEADO/);
  assert.match(librarySource, /Usar en Auto Rig/);
  assert.match(librarySource, /Cada intento vuelve a empezar desde este archivo/);
  assert.doesNotMatch(librarySource, /asset\.status === "processing"/);
  assert.doesNotMatch(librarySource, /Con error/);
});

test("Creator Studio conserva su API actual mientras cambia la persistencia", () => {
  assert.match(automaticSource, /setReferenceAssetProcessing/);
  assert.match(automaticSource, /saveRiggedReferenceAsset/);
  assert.match(automaticSource, /markReferenceAssetError/);
  assert.match(assetsSource, /export async function setReferenceAssetProcessing/);
  assert.match(assetsSource, /export async function saveRiggedReferenceAsset/);
  assert.match(assetsSource, /export async function markReferenceAssetError/);
});
