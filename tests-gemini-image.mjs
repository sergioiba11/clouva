import assert from "node:assert/strict";
import test from "node:test";
import {
  extractGeminiImageResult,
  generateImage,
} from "./lib/gemini-image.ts";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=";
const PNG_BYTES = Buffer.from(PNG_BASE64, "base64");

function imagePayload(overrides = {}) {
  return {
    id: "v1_test_image",
    status: "completed",
    steps: [
      {
        type: "model_output",
        content: [{ type: "image", mime_type: "image/png", data: PNG_BASE64 }],
      },
    ],
    ...overrides,
  };
}

test("Gemini image generation uses stored inline Interactions REST delivery", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  let capturedUrl = "";
  let capturedInit;
  globalThis.fetch = async (url, init) => {
    capturedUrl = String(url);
    capturedInit = init;
    return Response.json(imagePayload());
  };

  const generated = await generateImage({
    apiKey: "test-key",
    prompt: "Plano técnico de CLOUVA",
    model: "gemini-3.1-flash-image",
    aspectRatio: "16:9",
    imageSize: "2K",
  });

  assert.equal(capturedUrl, "https://generativelanguage.googleapis.com/v1beta/interactions");
  assert.equal(capturedInit.method, "POST");
  assert.equal(capturedInit.headers["x-goog-api-key"], "test-key");

  const body = JSON.parse(capturedInit.body);
  assert.equal(body.model, "gemini-3.1-flash-image");
  assert.equal(body.store, true);
  assert.deepEqual(body.input, [
    { type: "text", text: "Plano técnico de CLOUVA" },
  ]);
  assert.deepEqual(body.response_format, {
    type: "image",
    delivery: "inline",
    mime_type: "image/jpeg",
    aspect_ratio: "16:9",
    image_size: "2K",
  });
  assert.deepEqual(generated.bytes, PNG_BYTES);
  assert.equal(generated.mimeType, "image/png");
  assert.equal(generated.providerOperationId, "v1_test_image");
});

test("extracts SDK-style output_image when present", async () => {
  const result = await extractGeminiImageResult({
    id: "v1_output_image",
    status: "completed",
    output_image: { type: "image", mime_type: "image/png", data: PNG_BASE64 },
  }, { apiKey: "test-key" });

  assert.equal(result?.mimeType, "image/png");
  assert.deepEqual(result?.bytes, PNG_BYTES);
});

test("extracts the canonical REST image from steps model_output content", async () => {
  const result = await extractGeminiImageResult(imagePayload(), { apiKey: "test-key" });
  assert.equal(result?.providerOperationId, "v1_test_image");
  assert.deepEqual(result?.bytes, PNG_BYTES);
});

test("accepts image bytes without type=image when MIME identifies the content", async () => {
  const result = await extractGeminiImageResult({
    id: "v1_mime_only",
    status: "completed",
    steps: [{ type: "model_output", content: [{ mime_type: "image/png", data: PNG_BASE64 }] }],
  }, { apiKey: "test-key" });

  assert.equal(result?.mimeType, "image/png");
});

test("extracts inline_data image variants", async () => {
  const result = await extractGeminiImageResult({
    id: "v1_inline_data",
    status: "completed",
    steps: [{
      type: "model_output",
      content: [{ type: "image", inline_data: { mime_type: "image/png", data: PNG_BASE64 } }],
    }],
  }, { apiKey: "test-key" });

  assert.deepEqual(result?.bytes, PNG_BYTES);
});

test("extracts inlineData image variants", async () => {
  const result = await extractGeminiImageResult({
    id: "v1_inlineData",
    status: "completed",
    response: {
      image: {
        inlineData: { mimeType: "image/png", data: PNG_BASE64 },
      },
    },
  }, { apiKey: "test-key" });

  assert.deepEqual(result?.bytes, PNG_BYTES);
});

test("accepts URL-safe base64 image data", async () => {
  const urlSafe = PNG_BASE64.replaceAll("+", "-").replaceAll("/", "_");
  const result = await extractGeminiImageResult({
    id: "v1_url_safe",
    status: "completed",
    steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/png", data: urlSafe }] }],
  }, { apiKey: "test-key" });

  assert.deepEqual(result?.bytes, PNG_BYTES);
});

test("downloads an authorized Gemini image URI server-side", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  let requestedUrl = "";
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(PNG_BYTES, {
      status: 200,
      headers: { "content-type": "image/png", "content-length": String(PNG_BYTES.length) },
    });
  };

  const result = await extractGeminiImageResult({
    id: "v1_uri",
    status: "completed",
    steps: [{
      type: "model_output",
      content: [{ type: "image", mime_type: "image/png", uri: "https://storage.googleapis.com/example/generated.png" }],
    }],
  }, { apiKey: "test-key" });

  assert.equal(requestedUrl, "https://storage.googleapis.com/example/generated.png");
  assert.deepEqual(result?.bytes, PNG_BYTES);
});

test("recovers an image with GET when the initial completed response omits media", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? "GET" });
    if ((init?.method ?? "GET") === "POST") {
      return Response.json({ id: "v1_recover", status: "completed", steps: [] });
    }
    return Response.json(imagePayload({ id: "v1_recover" }));
  };

  const generated = await generateImage({
    apiKey: "test-key",
    prompt: "Generá un iglú futurista violeta",
    aspectRatio: "16:9",
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, "https://generativelanguage.googleapis.com/v1beta/interactions/v1_recover");
  assert.deepEqual(generated.bytes, PNG_BYTES);
});

test("completed interactions keep retrying briefly while inline media propagates", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    if ((init?.method ?? "GET") === "POST") {
      return Response.json({ id: "v1_delayed", status: "completed", steps: [] });
    }
    if (calls < 4) return Response.json({ id: "v1_delayed", status: "completed", steps: [] });
    return Response.json(imagePayload({ id: "v1_delayed" }));
  };

  const generated = await generateImage({
    apiKey: "test-key",
    prompt: "Plano visual de CLOUVA",
    timeoutMs: 10_000,
  });

  assert.equal(calls, 4);
  assert.deepEqual(generated.bytes, PNG_BYTES);
});

test("completed response without an image fails after the bounded recovery window", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ id: "v1_empty", status: "completed", steps: [{ type: "model_output", content: [] }] });
  };

  await assert.rejects(
    generateImage({ apiKey: "test-key", prompt: "Generá una imagen", timeoutMs: 10_000 }),
    /sin devolver una imagen utilizable/,
  );
  assert.equal(calls, 6);
});

test("provider errors recorded on a completed interaction are surfaced", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  globalThis.fetch = async () => Response.json({
    id: "v1_provider_error",
    status: "completed",
    errors: [{ code: "IMAGE_OUTPUT_FAILED", message: "Provider image generation failed" }],
  });

  await assert.rejects(
    generateImage({ apiKey: "test-key", prompt: "Generá una imagen" }),
    /Provider image generation failed/,
  );
});

test("unknown payload returns null from the canonical extractor", async () => {
  const result = await extractGeminiImageResult({
    id: "v1_unknown",
    status: "completed",
    result: { something: "else" },
  }, { apiKey: "test-key" });
  assert.equal(result, null);
});

test("invalid base64 is never accepted as an image", async () => {
  const result = await extractGeminiImageResult({
    id: "v1_invalid",
    status: "completed",
    steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/png", data: "not-base64-image" }] }],
  }, { apiKey: "test-key" });
  assert.equal(result, null);
});

test("Gemini Interactions serializes reference images in the canonical input array", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  let capturedBody;
  globalThis.fetch = async (_url, init) => {
    capturedBody = JSON.parse(init.body);
    return Response.json(imagePayload({ id: "v1_reference" }));
  };

  await generateImage({
    apiKey: "test-key",
    prompt: "Convertí esta referencia en un plano",
    referenceImages: [{ mimeType: "image/png", data: PNG_BASE64 }],
  });

  assert.deepEqual(capturedBody.input, [
    { type: "text", text: "Convertí esta referencia en un plano" },
    { type: "image", mime_type: "image/png", data: PNG_BASE64 },
  ]);
  assert.equal(capturedBody.store, true);
  assert.equal(capturedBody.response_format.type, "image");
  assert.equal(capturedBody.response_format.delivery, "inline");
  assert.equal(capturedBody.response_format.mime_type, "image/jpeg");
});
