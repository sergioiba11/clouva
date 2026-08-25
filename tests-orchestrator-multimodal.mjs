import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const { normalizeAttachments, normalizeScreenContext } = await import("./lib/clouva-ai/multimodal.ts");

test("the canonical Orchestrator accepts bounded Preview images and trusts the decoded size", () => {
  const result = normalizeAttachments([{
    name: "preview.png",
    mimeType: "image/png",
    size: 999999,
    dataBase64: Buffer.from("real image bytes").toString("base64"),
    kind: "preview",
  }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "preview");
  assert.equal(result[0].size, Buffer.byteLength("real image bytes"));
});

test("the canonical Orchestrator rejects unsupported, malformed, oversized, or excessive attachments", () => {
  assert.throws(() => normalizeAttachments([{ name: "secret.exe", mimeType: "application/octet-stream", dataBase64: "YWJj", kind: "file" }]), /MIME|contenido inválido/i);
  assert.throws(() => normalizeAttachments([{ name: "bad.png", mimeType: "image/png", dataBase64: "not-base64", kind: "image" }]), /inválido/i);
  assert.throws(() => normalizeAttachments(Array.from({ length: 5 }, (_, index) => ({ name: `${index}.png`, mimeType: "image/png", dataBase64: "YWJj", kind: "image" }))), /hasta 4/i);
  assert.throws(() => normalizeAttachments([{ name: "huge.png", mimeType: "image/png", dataBase64: Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64"), kind: "image" }]), /5 MB/i);
});

test("Workspace visual context is structured and bounded", () => {
  const context = normalizeScreenContext({ preview: { route: "/studios", viewport: { width: 412, height: 915 } } });
  assert.equal(context.preview.route, "/studios");
  assert.deepEqual(context.preview.viewport, { width: 412, height: 915 });
  assert.throws(() => normalizeScreenContext({ logs: "x".repeat(24_100) }), /demasiado grande/i);
});

test("binary attachments are sent to Gemini but never persisted into ai_messages metadata", () => {
  const source = fs.readFileSync(new URL("./app/api/clouva-ai/chat/route.ts", import.meta.url), "utf8");
  assert.match(source, /attachments\.map\(attachmentPart\)/);
  assert.match(source, /attachments\.map\(\(\{ name, mimeType, size, kind \}\) => \(\{ name, mimeType, size, kind \}\)\)/);
  assert.doesNotMatch(source, /metadata:\s*\{[^}]*dataBase64/s);
});
