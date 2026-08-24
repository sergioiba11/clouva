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

test("Gemini image generation uses Interactions and explicitly requests inline delivery", async (t) => {
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
  assert.equal(body.input, "Plano técnico de CLOUVA");
  assert.deepEqual(body.response_format, {
    type: "image",
    delivery: "inline",
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

test("completed response without an image fails only after recovery is checked", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ id: "v1_empty", status: "completed", steps: [{ type: "model_output", content: [] }] });
  };

  await assert.rejects(
    generateImage({ apiKey: "test-key", prompt: "Generá una imagen" }),
    /sin devolver una imagen utilizable/,
  );
  assert.equal(calls, 2);
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
  assert.equal(capturedBody.response_format.type, "image");
  assert.equal(capturedBody.response_format.delivery, "inline");
});
