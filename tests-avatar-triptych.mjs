import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const {
  calculateTriptychCropRegions,
  TRIPTYCH_REFERENCE_ORDER,
  validateTriptychDimensions,
} = await import("./lib/avatar/triptych.ts");
const {
  AVATAR_MULTI_IMAGE_CONFIG,
  buildAvatarMultiImageRequest,
} = await import("./lib/meshy.ts");

const page = readFileSync("./app/mi-flow/avatar-ia/page.tsx", "utf8");
const fromImageRoute = readFileSync("./app/api/avatar/from-image/route.ts", "utf8");
const finalizeRoute = readFileSync("./app/api/avatar/finalize/route.ts", "utf8");
const syncRoute = readFileSync("./app/api/avatar/sync/route.ts", "utf8");
const storage = readFileSync("./lib/avatar/meshy-avatar-storage.ts", "utf8");
const meshy = readFileSync("./lib/meshy.ts", "utf8");
const library = readFileSync("./components/avatar-engine/AvatarLibrary.tsx", "utf8");

test("una lámina 3000 x 1000 produce tres recortes cuadrados", () => {
  assert.deepEqual(calculateTriptychCropRegions(3000, 1000), [
    { key: "front", x: 0, y: 0, width: 1000, height: 1000 },
    { key: "back", x: 1000, y: 0, width: 1000, height: 1000 },
    { key: "side", x: 2000, y: 0, width: 1000, height: 1000 },
  ]);
});

test("los píxeles sobrantes se distribuyen sin perder columnas", () => {
  const regions = calculateTriptychCropRegions(3002, 1000);
  assert.deepEqual(regions.map((region) => region.width), [1001, 1001, 1000]);
  assert.equal(regions[0].x, 0);
  assert.equal(regions[1].x, regions[0].width);
  assert.equal(regions[2].x, regions[0].width + regions[1].width);
  assert.equal(regions.reduce((total, region) => total + region.width, 0), 3002);
});

test("el orden semántico es frente, espalda y costado", () => {
  assert.deepEqual(TRIPTYCH_REFERENCE_ORDER, ["front", "back", "side"]);
  assert.deepEqual(calculateTriptychCropRegions(3000, 1000).map((region) => region.key), ["front", "back", "side"]);
});

test("una proporción inválida se rechaza", () => {
  assert.equal(validateTriptychDimensions(1000, 1000).valid, false);
  assert.equal(validateTriptychDimensions(2800, 1000).valid, false);
  assert.equal(validateTriptychDimensions(3200, 1000).valid, false);
  assert.equal(validateTriptychDimensions(3000, 1000).valid, true);
});

test("la API exige front, back y side y valida archivos", () => {
  assert.match(fromImageRoute, /TRIPTYCH_REFERENCE_ORDER\.map/);
  assert.match(fromImageRoute, /form\.get\(key\)/);
  assert.match(fromImageRoute, /TRIPTYCH_ALLOWED_TYPES/);
  assert.match(fromImageRoute, /MAX_TRIPTYCH_FILE_BYTES/);
  assert.doesNotMatch(fromImageRoute, /form\.get\("prompt"\)/);
});

test("Meshy recibe exactamente tres URLs con la configuración específica del avatar", () => {
  const imageUrls = ["https://example.com/front.webp", "https://example.com/back.webp", "https://example.com/side.webp"];
  const request = buildAvatarMultiImageRequest(imageUrls);
  assert.deepEqual(request, { image_urls: imageUrls, ...AVATAR_MULTI_IMAGE_CONFIG });
  assert.deepEqual(request, {
    image_urls: imageUrls,
    ai_model: "meshy-6",
    pose_mode: "a-pose",
    should_texture: true,
    enable_pbr: false,
    should_remesh: true,
    topology: "quad",
    target_polycount: 100000,
    save_pre_remeshed_model: true,
    image_enhancement: false,
    remove_lighting: true,
    multi_view_thumbnails: true,
    target_formats: ["glb"],
  });
  assert.equal("texture_prompt" in request, false);
  assert.throws(() => buildAvatarMultiImageRequest(imageUrls.slice(0, 2)), /exactamente tres/);
});

test("otros consumidores de createMultiImageTask conservan su contrato", () => {
  assert.match(meshy, /imageUrls\.length < 2 \|\| imageUrls\.length > 4/);
  assert.match(meshy, /export async function createMultiImageTask\(imageUrls: string\[\], texturePrompt\?: string\)/);
  assert.match(meshy, /enable_pbr: true/);
  assert.match(meshy, /body\.texture_prompt = texturePrompt\.trim\(\)\.slice\(0, 600\)/);
});

test("el guardado consulta Meshy por task ID y copia los GLB a Supabase", () => {
  assert.match(finalizeRoute, /getMultiImageTask\(meshyTaskId\)/);
  assert.doesNotMatch(finalizeRoute, /body\?\.modelUrl/);
  assert.match(finalizeRoute, /persistMeshyAvatarSources/);
  assert.match(storage, /source\/avatar-meshy\.glb/);
  assert.match(storage, /source\/avatar-pre-remeshed\.glb/);
  assert.match(storage, /subarray\(0, 4\)\.toString\("ascii"\) !== "glTF"/);
  assert.match(storage, /createHash\("sha256"\)/);
  assert.match(storage, /MAX_AVATAR_SOURCE_GLB_BYTES = 25 \* 1024 \* 1024/);
  assert.match(storage, /upsert: false/);
});

test("el avatar queda pendiente de análisis e inactivo sin reemplazar el activo", () => {
  assert.match(finalizeRoute, /status: "pending_analysis"/);
  assert.match(finalizeRoute, /is_active: false/);
  assert.doesNotMatch(finalizeRoute, /profiles/);
  assert.doesNotMatch(finalizeRoute, /avatar_3d_url/);
  assert.doesNotMatch(finalizeRoute, /eq\("is_active", true\)/);
  assert.match(syncRoute, /status: "pending_analysis"/);
  assert.match(syncRoute, /analyzer_status: "not_started"/);
});

test("la interfaz usa el GLB guardado y no ejecuta el rig", () => {
  assert.match(page, /saved\.avatar\.model_url/);
  assert.match(page, /Personaje 3D generado\. Revisalo antes de continuar con el Analyzer\./);
  assert.match(page, /Pendiente de análisis/);
  assert.doesNotMatch(page, /\/api\/avatar\/rig/);
  assert.doesNotMatch(page, /completeRigAndActivate/);
  assert.doesNotMatch(page, /Avatar creado y riggeado/);
  assert.match(library, /pending_analysis/);
  assert.match(library, /Pendiente de análisis/);
});
