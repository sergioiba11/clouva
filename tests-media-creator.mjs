import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  estimateVideoCostUsd,
  IMAGE_QUALITY_CONFIG,
  VIDEO_DURATIONS,
  VIDEO_QUALITY_CONFIG,
} from "./lib/media-generation-config.ts";
import {
  detectImageGenerationIntent,
  parseImageGenerationIntent,
} from "./lib/clouva-ai/image-generation-intent.ts";
import {
  downloadGeneratedVideo,
  getVideoOperation,
  startVideoGeneration,
} from "./lib/gemini-video.ts";

test("mapea calidad de imagen a modelos y resolución oficiales", () => {
  assert.deepEqual(IMAGE_QUALITY_CONFIG.quick, {
    label: "Rápida",
    model: "gemini-3.1-flash-image",
    imageSize: "1K",
  });
  assert.equal(IMAGE_QUALITY_CONFIG.high.imageSize, "2K");
  assert.equal(IMAGE_QUALITY_CONFIG.maximum.model, "gemini-3-pro-image");
  assert.equal(IMAGE_QUALITY_CONFIG.maximum.imageSize, "4K");
});

test("Trébol enruta pedidos de plano y PNG al generador real", () => {
  assert.equal(detectImageGenerationIntent("AHORA HACE EL PLANO PNG"), true);
  assert.equal(detectImageGenerationIntent("haceme el plano que te pedi"), true);
  assert.equal(detectImageGenerationIntent("pasame eso a PNG"), true);
  assert.equal(detectImageGenerationIntent("hay un bug en el generador de imágenes"), false);

  const intent = parseImageGenerationIntent("AHORA HACE EL PLANO PNG");
  assert.ok(intent);
  assert.equal(intent.aspectRatio, "16:9");
  assert.equal(intent.quality, "high");
  assert.match(intent.prompt, /plano png/i);
});

test("limita Veo a duraciones válidas y calcula el costo confirmado", () => {
  assert.deepEqual(VIDEO_DURATIONS, [4, 6, 8]);
  assert.equal(VIDEO_QUALITY_CONFIG.economy.model, "veo-3.1-lite-generate-preview");
  assert.equal(VIDEO_QUALITY_CONFIG.fast.model, "veo-3.1-fast-generate-preview");
  assert.equal(VIDEO_QUALITY_CONFIG.cinematic.model, "veo-3.1-generate-preview");
  assert.equal(estimateVideoCostUsd("economy", 8), 0.4);
  assert.equal(estimateVideoCostUsd("fast", 8), 0.8);
  assert.equal(estimateVideoCostUsd("cinematic", 8), 3.2);
});

test("inicia Veo con predictLongRunning y serializa la referencia real", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let capturedUrl = "";
  let capturedInit;
  globalThis.fetch = async (url, init) => {
    capturedUrl = String(url);
    capturedInit = init;
    return Response.json({ name: "models/veo-3.1-fast-generate-preview/operations/op_123" });
  };

  const operation = await startVideoGeneration({
    apiKey: "test-key",
    prompt: "Una cámara avanza por la lluvia",
    model: "veo-3.1-fast-generate-preview",
    aspectRatio: "9:16",
    durationSeconds: 6,
    resolution: "720p",
    referenceImage: { bytes: Buffer.from("reference"), mimeType: "image/png" },
  });

  assert.match(capturedUrl, /veo-3\.1-fast-generate-preview:predictLongRunning$/);
  assert.equal(capturedInit.headers["x-goog-api-key"], "test-key");
  const body = JSON.parse(capturedInit.body);
  assert.equal(body.instances[0].prompt, "Una cámara avanza por la lluvia");
  assert.equal(body.instances[0].image.inlineData.data, Buffer.from("reference").toString("base64"));
  assert.equal(body.instances[0].image.inlineData.mimeType, "image/png");
  assert.deepEqual(body.parameters, {
    aspectRatio: "9:16",
    durationSeconds: 6,
    resolution: "720p",
    numberOfVideos: 1,
    personGeneration: "allow_adult",
  });
  assert.equal(operation.done, false);
});

test("consulta y normaliza el resultado de una operación Veo", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => Response.json({
    done: true,
    response: {
      generateVideoResponse: {
        generatedSamples: [{ video: { uri: "https://generativelanguage.googleapis.com/v1beta/files/video:download", mimeType: "video/mp4" } }],
      },
    },
  });
  const operation = await getVideoOperation({ apiKey: "test-key", operationName: "operations/op_123" });
  assert.equal(operation.done, true);
  assert.equal(operation.videoUri, "https://generativelanguage.googleapis.com/v1beta/files/video:download");
  assert.equal(operation.mimeType, "video/mp4");
});

test("rechaza identificadores y descargas externas", async () => {
  await assert.rejects(() => getVideoOperation({ apiKey: "test-key", operationName: "../secret" }), /inválido/i);
  await assert.rejects(() => downloadGeneratedVideo({ apiKey: "test-key", videoUri: "https://example.com/video.mp4" }), /inválida/i);
});

test("la migración aplica aislamiento por usuario e idempotencia", async () => {
  const sql = await readFile(new URL("./supabase/migrations/20260823023000_media_generation_jobs.sql", import.meta.url), "utf8");
  assert.match(sql, /unique \(user_id, idempotency_key\)/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /\(select auth\.uid\(\)\) = user_id/);
  assert.match(sql, /grant all on table public\.media_generation_jobs to service_role/);
  assert.doesNotMatch(sql, /create policy[\s\S]*for insert[\s\S]*to authenticated/i);
});

test("las rutas mantienen secretos en servidor y exigen costo e idempotencia", async () => {
  const route = await readFile(new URL("./app/api/media/generate/route.ts", import.meta.url), "utf8");
  const auth = await readFile(new URL("./lib/server/media-auth.ts", import.meta.url), "utf8");
  assert.match(route, /process\.env\.GEMINI_API_KEY/);
  assert.match(route, /idempotencyKey/);
  assert.match(route, /confirmedCostUsd/);
  assert.match(route, /enforceRateLimit/);
  assert.match(auth, /requireUser\(request\)/);
  assert.match(auth, /admin_required/);
  assert.doesNotMatch(route, /NEXT_PUBLIC_GEMINI/);
});

test("la UI incluye estados, historial, carga accesible y corte responsive", async () => {
  const page = await readFile(new URL("./components/media-creator/MediaCreatorPage.tsx", import.meta.url), "utf8");
  const uploader = await readFile(new URL("./components/media-creator/ReferenceUploader.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("./components/media-creator/media-creator.module.css", import.meta.url), "utf8");
  assert.match(page, /Ctrl|ctrlKey/);
  assert.match(page, /Confirmar video/);
  assert.match(page, /Estado real informado por el proveedor/);
  assert.match(uploader, /image\/jpeg,image\/png,image\/webp/);
  assert.match(uploader, /onDrop=/);
  assert.match(css, /@media \(max-width: 1030px\)/);
  assert.match(css, /@media \(max-width: 680px\)/);
});
