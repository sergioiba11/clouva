import assert from "node:assert/strict";
import test from "node:test";
import { generateImage } from "./lib/gemini-image.ts";

test("Gemini image generation uses Interactions and forces an image response", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  let capturedUrl = "";
  let capturedInit;
  globalThis.fetch = async (url, init) => {
    capturedUrl = String(url);
    capturedInit = init;
    return Response.json({
      id: "int_test_image",
      status: "completed",
      output_image: {
        type: "image",
        mime_type: "image/png",
        data: Buffer.from("generated-image").toString("base64"),
      },
      usage: {
        prompt_tokens: 12,
        completion_tokens: 34,
        total_tokens: 46,
      },
    });
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
    aspect_ratio: "16:9",
    image_size: "2K",
  });
  assert.equal(generated.bytes.toString(), "generated-image");
  assert.equal(generated.mimeType, "image/png");
  assert.equal(generated.providerOperationId, "int_test_image");
});

test("Gemini Interactions serializes reference images in the canonical input array", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  let capturedBody;
  globalThis.fetch = async (_url, init) => {
    capturedBody = JSON.parse(init.body);
    return Response.json({
      id: "int_test_reference",
      status: "completed",
      output_image: {
        type: "image",
        mime_type: "image/webp",
        data: Buffer.from("edited-image").toString("base64"),
      },
    });
  };

  await generateImage({
    apiKey: "test-key",
    prompt: "Convertí esta referencia en un plano",
    referenceImages: [{ mimeType: "image/png", data: "YWJj" }],
  });

  assert.deepEqual(capturedBody.input, [
    { type: "text", text: "Convertí esta referencia en un plano" },
    { type: "image", mime_type: "image/png", data: "YWJj" },
  ]);
  assert.equal(capturedBody.response_format.type, "image");
});
