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
  buildRetryImageRequest,
  imageGenerationErrorCopy,
  isStopImageGenerationFailure,
  MAX_AUTOMATIC_STOP_RETRIES,
  shouldAutoRetryImageGeneration,
} from "./lib/clouva-ai/image-generation-retry.ts";
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

test("Trébol enruta pedidos visuales al generador y conserva planos escritos como texto", () => {
  for (const prompt of [
    "HACE EL PLANO",
    "HACE EL PLANO PNG",
    "GENERAME EL PLANO",
    "AHORA HACE EL PLANO PNG",
    "haceme el plano que te pedi",
    "pasame eso a PNG",
    "EL PLANO QUE TE PEDI ANTES",
    "¿Y EL PLANO?",
    "ESE PLANO",
    "haceme un plano escrito en PNG",
    "quiero una imagen del plano escrito",
  ]) {
    assert.equal(detectImageGenerationIntent(prompt), true, prompt);
  }

  for (const prompt of [
    "hay un bug en el generador de imágenes",
    "explicame el plano de base de datos",
    "Recordas lo que quiero hacer? Necesito un plano escrito",
    "haceme un plano por escrito, paso a paso",
    "quiero revisar el plano antes de generarlo",
    "dame el diagrama en texto",
  ]) {
    assert.equal(detectImageGenerationIntent(prompt), false, prompt);
  }

  const intent = parseImageGenerationIntent("AHORA HACE EL PLANO PNG");
  assert.ok(intent);
  assert.equal(intent.aspectRatio, "16:9");
  assert.equal(intent.quality, "high");
  assert.match(intent.prompt, /plano png/i);
});

test("STOP se traduce a UX amigable y solo permite un retry automático", () => {
  assert.equal(isStopImageGenerationFailure("Gemini terminó sin imagen (STOP)."), true);
  assert.equal(isStopImageGenerationFailure("finishReason STOP"), true);
  assert.equal(isStopImageGenerationFailure("quota exceeded"), false);

  const copy = imageGenerationErrorCopy("Gemini terminó sin imagen (STOP).");
  assert.equal(copy.message, "Gemini terminó la solicitud sin devolver una imagen.");
  assert.equal(copy.detail, "finishReason STOP");
  assert.equal(MAX_AUTOMATIC_STOP_RETRIES, 1);
  assert.equal(shouldAutoRetryImageGeneration("STOP", 0), true);
  assert.equal(shouldAutoRetryImageGeneration("STOP", 1), false);
  assert.equal(shouldAutoRetryImageGeneration("otro error", 0), false);
});

test("el retry conserva prompt, ratio, calidad y referencia sin reutilizar estado del job", () => {
  const retry = buildRetryImageRequest({
    prompt: "Plano técnico CLOUVA",
    aspectRatio: "16:9",
    quality: "high",
    referenceUrl: "https://example.com/reference.png",
    referenceStoragePath: "references/source.png",
  });
  assert.deepEqual(retry, {
    prompt: "Plano técnico CLOUVA",
    aspectRatio: "16:9",
    quality: "high",
    referenceUrl: "https://example.com/reference.png",
    referenceStoragePath: "references/source.png",
  });
  assert.equal("jobId" in retry, false);
});

test("limita Veo a duraciones válidas y calcula el costo confirmado", () => {
  assert.deepEqual(VIDEO_DURATIONS, [4, 6, 8]);
  assert.equal(VIDEO_QUALITY_CONFIG.economy.model, "veo-3.1-lite-generate-001");
  assert.equal(VIDEO_QUALITY_CONFIG.fast.model, "veo-3.1-fast-generate-001");
  assert.equal(VIDEO_QUALITY_CONFIG.cinematic.model, "veo-3.1-generate-001");
  assert.equal(estimateVideoCostUsd("economy", 8), 0.24);
  assert.equal(estimateVideoCostUsd("fast", 8), 0.64);
  assert.equal(estimateVideoCostUsd("cinematic", 8), 1.6);
});

test("Cloud Video Engine extiende el ledger actual y orquesta Vertex + Cloud Run", async () => {
  const migration = await readFile(new URL("./supabase/migrations/20260919010930_cloud_video_engine.sql", import.meta.url), "utf8");
  const orchestrator = await readFile(new URL("./lib/server/video-projects.ts", import.meta.url), "utf8");
  const provider = await readFile(new URL("./lib/video/providers/vertex-veo.ts", import.meta.url), "utf8");
  const creator = await readFile(new URL("./components/video-engine/VideoProjectCreator.tsx", import.meta.url), "utf8");
  const worker = await readFile(new URL("./worker/video-render/render.mjs", import.meta.url), "utf8");
  const audioRoute = await readFile(new URL("./app/api/video/projects/[projectId]/audio/route.ts", import.meta.url), "utf8");
  const playerRoute = await readFile(new URL("./app/api/video/projects/[projectId]/player/route.ts", import.meta.url), "utf8");
  const infra = await readFile(new URL("./scripts/setup-video-engine-infra.sh", import.meta.url), "utf8");

  assert.match(migration, /create table if not exists public\.video_projects/i);
  assert.match(migration, /alter table public\.media_generation_jobs/i);
  assert.doesNotMatch(migration, /create table[^;]*video_generation_jobs/i);
  assert.match(orchestrator, /enqueueVideoProjectStep/);
  assert.match(orchestrator, /runVideoRenderJob/);
  assert.match(orchestrator, /last_frame_url/);
  assert.match(provider, /vertexai:\s*true/);
  assert.match(provider, /outputGcsUri/);
  assert.match(provider, /lastFrame/);
  assert.match(creator, /GENERAR EN CLOUD/);
  assert.match(creator, /Audio master/);
  assert.match(worker, /ffmpeg/);
  assert.match(worker, /audio_storage_path/);
  assert.match(worker, /status:\s*"completed"/);
  assert.match(audioRoute, /createResumableUpload/);
  assert.match(audioRoute, /audio_owner_mismatch/);
  assert.match(playerRoute, /player_media/);
  assert.match(playerRoute, /clouva-video-project:/);
  assert.match(infra, /CLOUVA_VIDEO_ARTIFACT_REPOSITORY:-clouva/);
  assert.match(infra, /gcloud builds submit worker\/video-render/);
  assert.match(infra, /gcloud run jobs create/);
  assert.doesNotMatch(infra, /gcloud projects add-iam-policy-binding/);
  assert.doesNotMatch(infra, /gcloud services enable/);
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

test("CLOUVA AI mantiene composer visible, media card reintentable y no niega generación de imágenes", async () => {
  const pageCss = await readFile(new URL("./app/clouva-ai/page.module.css", import.meta.url), "utf8");
  const card = await readFile(new URL("./components/clouva-ai/ClouvaAIMediaCard.tsx", import.meta.url), "utf8");
  const hook = await readFile(new URL("./components/clouva-ai/useClouvaAIConversation.ts", import.meta.url), "utf8");
  const vision = await readFile(new URL("./lib/clouva-ai/vision.ts", import.meta.url), "utf8");
  assert.match(pageCss, /#clouva-ai-composer/);
  assert.match(pageCss, /min-height:\s*0/);
  assert.match(pageCss, /overflow-y:\s*auto/);
  assert.match(card, /scrollIntoView/);
  assert.match(card, /Reintentar/);
  assert.match(hook, /shouldAutoRetryImageGeneration/);
  assert.match(hook, /action:\s*"retry_image"/);
  assert.match(vision, /sí está integrada con el generador real de imágenes de CLOUVA/);
  assert.match(vision, /Nunca digas que "no podés generar imágenes"/);
});
