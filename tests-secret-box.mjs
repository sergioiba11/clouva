import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes } from "node:crypto";

const { createSecretBox } = await import("./core/crypto/secret-box.ts");

test("round-trips a value through encrypt/decrypt", () => {
  process.env.TEST_SECRET_BOX_KEY_A = randomBytes(32).toString("base64");
  const box = createSecretBox("TEST_SECRET_BOX_KEY_A");

  const secret = box.encrypt("gt_live_super_secret_device_token");
  assert.notEqual(secret.ciphertext, "gt_live_super_secret_device_token");
  assert.equal(box.decrypt(secret), "gt_live_super_secret_device_token");
});

test("accepts a 64-char hex key too, not just base64", () => {
  process.env.TEST_SECRET_BOX_KEY_HEX = randomBytes(32).toString("hex");
  const box = createSecretBox("TEST_SECRET_BOX_KEY_HEX");

  const secret = box.encrypt("hola");
  assert.equal(box.decrypt(secret), "hola");
});

test("throws a clear error when the env var is missing", () => {
  delete process.env.TEST_SECRET_BOX_KEY_MISSING;
  const box = createSecretBox("TEST_SECRET_BOX_KEY_MISSING");
  assert.throws(() => box.encrypt("x"), /TEST_SECRET_BOX_KEY_MISSING/);
});

test("throws on a malformed key (wrong length)", () => {
  process.env.TEST_SECRET_BOX_KEY_SHORT = Buffer.from("too-short").toString("base64");
  const box = createSecretBox("TEST_SECRET_BOX_KEY_SHORT");
  assert.throws(() => box.encrypt("x"), /32 bytes/);
});

test("rejects a tampered ciphertext instead of returning garbage", () => {
  process.env.TEST_SECRET_BOX_KEY_B = randomBytes(32).toString("base64");
  const box = createSecretBox("TEST_SECRET_BOX_KEY_B");

  const secret = box.encrypt("no me toques");
  const tampered = { ...secret, ciphertext: Buffer.from("otra-cosa-totalmente-distinta").toString("base64") };
  assert.throws(() => box.decrypt(tampered));
});

test("two boxes bound to different env vars are not interchangeable", () => {
  process.env.TEST_SECRET_BOX_KEY_C1 = randomBytes(32).toString("base64");
  process.env.TEST_SECRET_BOX_KEY_C2 = randomBytes(32).toString("base64");
  const boxOne = createSecretBox("TEST_SECRET_BOX_KEY_C1");
  const boxTwo = createSecretBox("TEST_SECRET_BOX_KEY_C2");

  const secret = boxOne.encrypt("solo para box uno");
  assert.throws(() => boxTwo.decrypt(secret));
});

test("workspaceDeviceTokenBox is bound to WORKSPACE_DEVICE_TOKEN_ENCRYPTION_KEY", async () => {
  process.env.WORKSPACE_DEVICE_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  // Re-import fresh so the module-level `workspaceDeviceTokenBox` binds
  // after the env var above is set — Node's ESM cache would otherwise hand
  // back the already-imported instance from an earlier test file.
  const mod = await import(`./core/crypto/secret-box.ts?t=${Date.now()}`);
  const secret = mod.workspaceDeviceTokenBox.encrypt("device-token-abc123");
  assert.equal(mod.workspaceDeviceTokenBox.decrypt(secret), "device-token-abc123");
});
