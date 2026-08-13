import assert from "node:assert/strict";
import test from "node:test";
import { installWorkspaceAuthBridge } from "./workspaceAuthBridge.js";

test("Analyzer accepts the canonical Workspace session without owning refresh", async () => {
  const target = {};
  const calls = [];
  let stopped = 0;
  let managed = false;
  let session = null;
  const cleanup = installWorkspaceAuthBridge({
    target,
    client: {
      auth: {
        setSession: async (tokens) => {
          calls.push(tokens);
          return { data: { session: { user: { id: "user-a" } } }, error: null };
        },
        signOut: async () => ({ error: null }),
        stopAutoRefresh: () => { stopped += 1; },
      },
    },
    onManagedChange: (value) => { managed = value; },
    onSession: (value) => { session = value; },
  });

  const result = await target.__CLOUVA_WORKSPACE_SYNC_SESSION__({
    type: "signed-in",
    access_token: "access",
    refresh_token: "refresh",
  });

  assert.deepEqual(calls, [{ access_token: "access", refresh_token: "refresh" }]);
  assert.equal(stopped, 1);
  assert.equal(managed, true);
  assert.equal(session.user.id, "user-a");
  assert.deepEqual(result, { accepted: true, signedIn: true, userId: "user-a" });
  cleanup();
  assert.equal(target.__CLOUVA_WORKSPACE_SYNC_SESSION__, undefined);
});

test("Analyzer Workspace sign-out is local and never revokes other CLOUVA sessions", async () => {
  const target = {};
  const signOutCalls = [];
  const cleanup = installWorkspaceAuthBridge({
    target,
    client: {
      auth: {
        setSession: async () => ({ data: { session: null }, error: null }),
        signOut: async (options) => { signOutCalls.push(options); return { error: null }; },
        stopAutoRefresh: () => {},
      },
    },
    onManagedChange: () => {},
    onSession: () => {},
  });

  await target.__CLOUVA_WORKSPACE_SYNC_SESSION__({ type: "signed-out" });
  assert.deepEqual(signOutCalls, [{ scope: "local" }]);
  cleanup();
});
