import assert from "node:assert/strict";
import test from "node:test";
import {
  applyWorkspacePreviewAuthSync,
  installWorkspacePreviewAuthBridge,
  isWorkspacePreviewAuthBridgeAllowed,
} from "./lib/workspace-preview-auth.ts";

const session = {
  access_token: "access",
  refresh_token: "refresh",
  expires_in: 3600,
  expires_at: 1,
  token_type: "bearer",
  user: { id: "user-a" },
};

test("the Workspace auth bridge exists only on the local development preview", () => {
  assert.equal(
    isWorkspacePreviewAuthBridgeAllowed({ protocol: "http:", hostname: "localhost" }, "development"),
    true,
  );
  assert.equal(
    isWorkspacePreviewAuthBridgeAllowed({ protocol: "https:", hostname: "clouva.com.ar" }, "development"),
    false,
  );
  assert.equal(
    isWorkspacePreviewAuthBridgeAllowed({ protocol: "http:", hostname: "localhost" }, "production"),
    false,
  );
});

test("a Workspace user session is installed with Supabase setSession", async () => {
  const calls = [];
  let stopped = 0;
  const result = await applyWorkspacePreviewAuthSync(
    { type: "signed-in", access_token: "access", refresh_token: "refresh" },
    {
      setSession: async (tokens) => {
        calls.push(tokens);
        return { data: { session }, error: null };
      },
      signOut: async () => ({ error: null }),
      stopAutoRefresh: () => { stopped += 1; },
    },
  );

  assert.deepEqual(calls, [{ access_token: "access", refresh_token: "refresh" }]);
  assert.equal(stopped, 1);
  assert.deepEqual(result, { accepted: true, signedIn: true, userId: "user-a" });
});

test("a signed-out Workspace clears only the Preview-local browser session", async () => {
  const calls = [];
  const result = await applyWorkspacePreviewAuthSync(
    { type: "signed-out" },
    {
      setSession: async () => ({ data: { session }, error: null }),
      signOut: async (options) => {
        calls.push(options);
        return { error: null };
      },
    },
  );

  assert.deepEqual(calls, [{ scope: "local" }]);
  assert.deepEqual(result, { accepted: true, signedIn: false, userId: null });
});

test("the receiver is not installed on a non-local page", () => {
  const target = {};
  const cleanup = installWorkspacePreviewAuthBridge({
    target,
    location: { protocol: "https:", hostname: "clouva.com.ar" },
    environment: "development",
    auth: {
      setSession: async () => ({ data: { session }, error: null }),
      signOut: async () => ({ error: null }),
    },
  });

  assert.equal(target.__CLOUVA_WORKSPACE_SYNC_SESSION__, undefined);
  cleanup();
});
