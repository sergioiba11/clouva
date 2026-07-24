import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const {
  AVATAR_REFERENCE_ORDER,
  getTriptychCropRegions,
  isValidTriptychRatio,
} = await import("./lib/avatar-triptych.ts");
const {
  AVATAR_MULTI_IMAGE_TASK_CONFIG,
  createAvatarMultiImageTask,
  createMultiImageTask,
} = await import("./lib/meshy.ts");

const page = readFileSync("app/mi-flow/avatar-ia/page.tsx", "utf8");
const fromImageRoute = readFileSync("app/api/avatar/from-image/route.ts", "utf8");
const finalizeRoute = readFileSync("app/api/avatar/finalize/route.ts", "utf8");
const syncRoute = readFileSync("app/api/avatar/sync/route.ts", "utf8");
const generationServer = readFileSync("lib/avatar-generation-server.ts", "utf8");
const triptychClient = readFileSync("lib/avatar-triptych-client.ts", "utf8");
const library = readFileSync("components/avatar-engine/AvatarLibrary.tsx", "utf8");
const meshy = readFileSync("lib/meshy.ts", "utf8");


test("una lámina 3000 x 1000 produce tres recortes 1000 x 1000", () => {
  assert.deepEqual(getTriptychCropRegions(3000, 1000), [
    { role: "front", x: 0, y: 0, width: 1000, height: 1000 },
    { role: "back", x: 1000, y: 0, width: 1000, height: 1000 },
    { role: "side", x: 2000, y: 0, width: 1000, height: 1000 },
  ]);
});


test("los píxeles sobrantes se distribuyen sin perder columnas", () => {
  const regions = getTriptychCropRegions(3002, 1000);
  assert.deepEqual(regions.map((region) => region.width), [1001, 1001, 1000]);
  assert.equal(regions.at(-1).x + regions.at(-1).width, 3002);
  assert.equal(regions.reduce((sum, region) => sum + region.width, 0), 3002);
});


test("el orden semántico es frente, espalda y costado", () => {
  assert.deepEqual(AVATAR_REFERENCE_ORDER, ["front", "back", "side"]);
  assert.deepEqual(getTriptychCropRegions(3001, 1000).map((region) => region.role), ["front", "back", "side"]);
});


test("las proporciones incompatibles se rechazan", () => {
  assert.equal(isValidTriptychRatio(3000, 1000), true);
  assert.equal(isValidTriptychRatio(2850, 1000), true);
  assert.equal(isValidTriptychRatio(3150, 1000), true);
  assert.equal(isValidTriptychRatio(2000, 1000), false);
  assert.throws(() => getTriptychCropRegions(1000, 1600), /horizontal/);
});


test("la API exige exactamente front, back y side y valida tipo y tamaño", () => {
  assert.match(fromImageRoute, /form\.getAll\(role\)/);
  assert.match(fromImageRoute, /values\.length !== 1/);
  assert.match(fromImageRoute, /Se requieren exactamente front, back y side/);
  assert.match(fromImageRoute, /ALLOWED_AVATAR_REFERENCE_TYPES/);
  assert.match(fromImageRoute, /MAX_AVATAR_REFERENCE_BYTES/);
  assert.match(fromImageRoute, /Campo inesperado/);
  assert.doesNotMatch(fromImageRoute, /form\.get\("prompt"\)/);
});


test("el navegador recorta sin reescalar y exporta WEBP con nombres estables", () => {
  assert.match(triptychClient, /canvas\.width = region\.width/);
  assert.match(triptychClient, /canvas\.height = region\.height/);
  assert.match(triptychClient, /context\.drawImage\([\s\S]*region\.x[\s\S]*region\.width[\s\S]*region\.width/);
  assert.match(triptychClient, /"image\/webp"/);
  assert.match(triptychClient, /avatar-front\.webp/);
  assert.match(triptychClient, /avatar-back\.webp/);
  assert.match(triptychClient, /avatar-side\.webp/);
  assert.match(triptychClient, /imageOrientation: "from-image"/);
});


test("Meshy recibe exactamente tres URLs y la configuración específica de avatar", async () => {
  const originalFetch = globalThis.fetch;
  const previousKey = process.env.MESHY_API_KEY;
  const requests = [];
  process.env.MESHY_API_KEY = "test-key";
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body || "{}")) });
    return new Response(JSON.stringify({ result: `task-${requests.length}` }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const avatarUrls = ["https://cdn/front.webp", "https://cdn/back.webp", "https://cdn/side.webp"];
    assert.equal(await createAvatarMultiImageTask(avatarUrls), "task-1");
    assert.deepEqual(requests[0].body, {
      image_urls: avatarUrls,
      ...AVATAR_MULTI_IMAGE_TASK_CONFIG,
    });
    assert.equal("texture_prompt" in requests[0].body, false);

    assert.equal(await createMultiImageTask(["https://cdn/a.webp", "https://cdn/b.webp"], "detalle de prenda"), "task-2");
    assert.deepEqual(requests[1].body, {
      image_urls: ["https://cdn/a.webp", "https://cdn/b.webp"],
      should_texture: true,
      enable_pbr: true,
      target_formats: ["glb"],
      texture_prompt: "detalle de prenda",
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.MESHY_API_KEY;
    else process.env.MESHY_API_KEY = previousKey;
  }
});


test("el flujo de avatar no cambia el comportamiento general de createMultiImageTask", () => {
  assert.match(meshy, /export async function createMultiImageTask\(imageUrls: string\[], texturePrompt\?: string\)/);
  assert.match(meshy, /enable_pbr: true/);
  assert.match(meshy, /body\.texture_prompt = texturePrompt/);
  assert.match(meshy, /export async function createAvatarMultiImageTask/);
});


test("el guardado consulta Meshy por task ID y no acepta una URL arbitraria", () => {
  assert.match(finalizeRoute, /meshyTaskId/);
  assert.match(finalizeRoute, /No se aceptan URLs de modelos enviadas por el navegador/);
  assert.match(generationServer, /getMultiImageTask\(meshyTaskId\)/);
  assert.match(generationServer, /\.eq\("user_id", userId\)/);
  assert.match(generationServer, /\.eq\("meshy_task_id", meshyTaskId\)/);
  assert.match(generationServer, /task\.status !== "SUCCEEDED"/);
});


test("el GLB se valida, hashea y copia permanentemente a Supabase", () => {
  assert.match(generationServer, /MAX_AVATAR_GLB_BYTES = 25 \* 1024 \* 1024/);
  assert.match(generationServer, /subarray\(0, 4\)\.toString\("ascii"\) !== "glTF"/);
  assert.match(generationServer, /createHash\("sha256"\)/);
  assert.match(generationServer, /source\/avatar-meshy\.glb/);
  assert.match(generationServer, /source\/avatar-pre-remeshed\.glb/);
  assert.match(generationServer, /upsert: false/);
  assert.match(generationServer, /glb_sha256/);
  assert.match(generationServer, /timestamp: now/);
  assert.match(generationServer, /meshy_remote_urls:[\s\S]*temporary: true/);
});


test("el avatar queda pending_analysis, inactivo y conserva el activo anterior", () => {
  assert.match(generationServer, /status: "pending_analysis"/);
  assert.match(generationServer, /is_active: false/);
  assert.match(generationServer, /analyzer_status: "not_started"/);
  assert.doesNotMatch(generationServer, /from\("profiles"\)/);
  assert.doesNotMatch(finalizeRoute, /from\("profiles"\)/);
  assert.doesNotMatch(generationServer, /\.eq\("is_active", true\)/);
  assert.doesNotMatch(finalizeRoute, /avatar_3d_url/);
});


test("sync también conserva el borrador pendiente sin marcarlo ready", () => {
  assert.match(syncRoute, /finalizePendingAvatarGeneration/);
  assert.match(syncRoute, /status: "pending_analysis"/);
  assert.doesNotMatch(syncRoute, /status: "ready"/);
  assert.doesNotMatch(syncRoute, /from\("profiles"\)/);
});


test("la página no ejecuta rig ni activa el avatar", () => {
  assert.doesNotMatch(page, /\/api\/avatar\/rig/);
  assert.doesNotMatch(page, /completeRigAndActivate/);
  assert.doesNotMatch(page, /setActiveAvatar/);
  assert.doesNotMatch(page, /Avatar creado y riggeado/);
  assert.match(page, /body: JSON\.stringify\(\{ meshyTaskId: created\.taskId \}\)/);
});


test("la interfaz muestra la lámina, los tres recortes y el GLB permanente", () => {
  assert.match(page, /Lámina del personaje/);
  assert.match(page, /Frente \| Espalda \| Costado/);
  assert.match(page, /3072 × 1024/);
  assert.match(page, /referencePreviews\[role\]/);
  assert.match(page, /<model-viewer/);
  assert.match(page, /Personaje 3D generado\. Revisalo antes de continuar con el Analyzer\./);
  assert.match(page, /Pendiente de análisis/);
  assert.doesNotMatch(page, /Describí detalles/);
  assert.doesNotMatch(page, /texture_prompt/);
});


test("la biblioteca renderiza el borrador y no permite activarlo antes del análisis", () => {
  assert.match(library, /pending_analysis/);
  assert.match(library, /Pendiente de análisis/);
  assert.match(library, /const hasModel = Boolean\(avatar\.model_url\)/);
  assert.match(library, /const activatable = avatar\.status === "ready"/);
  assert.match(library, /<model-viewer/);
});


test("la lámina completa nunca se agrega al FormData enviado al servidor", () => {
  assert.match(page, /for \(const role of AVATAR_REFERENCE_ORDER\)/);
  assert.match(page, /form\.append\(role, file, file\.name\)/);
  assert.doesNotMatch(page, /form\.append\("sheet"/);
  assert.doesNotMatch(page, /form\.append\("triptych"/);
  assert.doesNotMatch(fromImageRoute, /form\.get\("sheet"\)/);
});
