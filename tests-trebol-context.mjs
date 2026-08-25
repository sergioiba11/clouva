import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTrebolRuntimeContext,
  diffTrebolRuntimeContext,
} from "./lib/clouva-ai/agent/context-builder.ts";
import { normalizeScreenContext } from "./lib/clouva-ai/multimodal.ts";

test("sanitizes secrets, signed URLs and unbounded page data", () => {
  const context = buildTrebolRuntimeContext({
    navigation: {
      route: "/creator-studio/[id]",
      pathname: "/creator-studio/demo",
      params: { id: "demo" },
      url: "https://clouva.com/creator-studio/demo?tab=rig#progress",
    },
    active: { avatarId: "avatar-1" },
    user: { id: "user-1", token: "never-store-user-token" },
    scopes: {
      creator: {
        selectedAsset: { id: "asset-1", modelUrl: "https://storage.invalid/model.glb?X-Goog-Signature=secret" },
        token: "never-store-me",
        note: "x".repeat(2_000),
      },
    },
  });

  assert.equal(context.navigation.url, "https://clouva.com/creator-studio/demo");
  assert.equal(context.active.avatarId, "avatar-1");
  assert.equal(context.user.id, "user-1");
  assert.equal(context.user.token, undefined);
  assert.equal(context.scopes.creator.token, undefined);
  assert.equal(context.scopes.creator.selectedAsset.modelUrl, undefined);
  assert.equal(context.scopes.creator.note.length, 500);
});

test("produces a full initial snapshot and later differential patches", () => {
  const first = buildTrebolRuntimeContext({
    navigation: { pathname: "/one" },
    active: { playerId: "p1" },
  });
  const second = buildTrebolRuntimeContext({
    navigation: { pathname: "/two" },
    active: { playerId: "p1", avatarId: "a1" },
  });

  assert.equal(diffTrebolRuntimeContext(null, first).active.playerId, "p1");
  const patch = diffTrebolRuntimeContext(first, second);
  assert.equal(patch.navigation.pathname, "/two");
  assert.deepEqual(patch.active, { avatarId: "a1" });
  assert.equal("runtime" in patch, false);
});

test("server-normalizes client screen context before persistence", () => {
  const context = normalizeScreenContext({
    navigation: { pathname: "/creator", url: "https://clouva.com.ar/creator?token=secret#x" },
    scopes: { page: { token: "secret", note: "safe" } },
    surface: "desktop",
    project: { id: "clouva", path: "D:\\Clouva", credential: "secret" },
    preview: { url: "http://localhost:3000/preview?key=secret", state: "running", html: "<main>secret</main>" },
  });
  assert.equal(context.navigation.url, "");
  assert.equal(context.scopes.page.token, undefined);
  assert.equal(context.scopes.page.note, "safe");
  assert.equal(context.surface, "desktop");
  assert.equal(context.project.path, "D:\\Clouva");
  assert.equal(context.preview.url, "http://localhost:3000/preview");
  assert.equal(context.preview.html, undefined);
});
