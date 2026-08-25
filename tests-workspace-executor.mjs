import assert from "node:assert/strict";
import { test } from "node:test";
import { WebSocketServer } from "ws";
import { randomBytes } from "node:crypto";

process.env.WORKSPACE_DEVICE_TOKEN_ENCRYPTION_KEY =
  process.env.WORKSPACE_DEVICE_TOKEN_ENCRYPTION_KEY || randomBytes(32).toString("base64");

const { WorkspaceExecutor } = await import("./lib/clouva-ai/workspace-executor.ts");
const { workspaceDeviceTokenBox } = await import("./core/crypto/secret-box.ts");

function startFakeGateway(onConnection) {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 });
    wss.on("listening", () => {
      const { port } = wss.address();
      resolve({ relayUrl: `ws://127.0.0.1:${port}/relay`, close: () => wss.close() });
    });
    wss.on("connection", onConnection);
  });
}

function startFakeDesktop(onRequest) {
  return startFakeGateway((ws) => {
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.kind === "auth") {
        ws.send(JSON.stringify({ kind: "event", event: "auth:accepted", payload: { deviceId: "dev-1" } }));
        return;
      }
      if (msg.kind === "request") onRequest(ws, msg);
    });
  });
}

/** A minimal fake of the one Supabase query chain WorkspaceExecutor
 * actually calls (`.from("workspace_links").select(...).eq(...).is(...).order(...).limit(...).maybeSingle()`
 * for the read, plus a chained `.update(...).eq(...).eq(...).is(...)` for
 * the best-effort last_used_at bump) — not a real Supabase client, just
 * enough surface to drive WorkspaceExecutor's own logic in isolation. */
function fakeSupabase({ row = null, selectError = null } = {}) {
  const calls = [];
  const chain = {
    eq() { return chain; },
    is() { return chain; },
    order() { return chain; },
    limit() { return chain; },
    async maybeSingle() {
      return { data: row, error: selectError };
    },
    then(onFulfilled) {
      // The update chain (the best-effort last_used_at bump) is used as
      // `.then(undefined, errorHandler)`, never awaited — behave like a
      // real resolved thenable so that call doesn't hang or throw.
      if (onFulfilled) onFulfilled({ data: null, error: null });
    },
  };
  return {
    calls,
    from(table) {
      calls.push(table);
      return {
        select: () => chain,
        update: () => chain,
      };
    },
  };
}

test("exposes canonical read, Preview and gated file tools through one WorkspaceExecutor", () => {
  const executor = new WorkspaceExecutor("user-1", { supabase: fakeSupabase() });
  assert.equal(executor.target, "workspace");

  const names = executor.tools().map((t) => t.name).sort();
  assert.deepEqual(
    names,
    [
      "workspace.activity.list",
      "workspace.aiAnalyzer.activity",
      "workspace.aiAnalyzer.compare",
      "workspace.aiAnalyzer.context",
      "workspace.aiAnalyzer.issues",
      "workspace.aiAnalyzer.snapshot",
      "workspace.aiAnalyzer.status",
      "workspace.analyzer.status",
      "workspace.files.list",
      "workspace.files.read",
      "workspace.files.write",
      "workspace.git.log",
      "workspace.git.status",
      "workspace.process.list",
      "workspace.projects.inspect",
      "workspace.projects.list",
      "workspace.webPreview.logs",
      "workspace.webPreview.start",
      "workspace.webPreview.status",
      "workspace.webPreview.stop",
    ].sort(),
  );
  assert.equal(executor.getTool("workspace.files.write").risk, "write");
  assert.equal(executor.getTool("workspace.webPreview.start").risk, "write");
  assert.equal(executor.getTool("workspace.webPreview.stop").risk, "destructive");
  assert.ok(executor.tools().filter((tool) => !["workspace.files.write", "workspace.webPreview.start", "workspace.webPreview.stop"].includes(tool.name)).every((tool) => tool.risk === "read"));
});

test("throws a clear error when the user has no active workspace link", async () => {
  const executor = new WorkspaceExecutor("user-1", {
    supabase: fakeSupabase({ row: null }),
    gatewayUrl: "ws://127.0.0.1:1/relay",
  });

  await assert.rejects(
    () => executor.getTool("workspace.projects.list").execute({}),
    /no tiene un Workspace conectado/,
  );
});

test("decrypts the stored token, connects, authenticates, and dispatches a real tool call", async () => {
  const secret = workspaceDeviceTokenBox.encrypt("raw-device-token-abc");
  const gateway = await startFakeDesktop((ws, msg) => {
    assert.equal(msg.tool, "workspace.git.status");
    assert.deepEqual(msg.args, { projectId: "p1" });
    ws.send(JSON.stringify({ kind: "response", id: msg.id, ok: true, result: { branch: "main", staged: [] } }));
  });

  try {
    const supabase = fakeSupabase({
      row: {
        workspace_id: "ws-1",
        device_token_ciphertext: secret.ciphertext,
        device_token_iv: secret.iv,
        device_token_auth_tag: secret.authTag,
      },
    });
    const executor = new WorkspaceExecutor("user-1", { supabase, gatewayUrl: gateway.relayUrl });

    const result = await executor.getTool("workspace.git.status").execute({ projectId: "p1" });
    assert.deepEqual(result, { branch: "main", staged: [] });
    assert.ok(supabase.calls.includes("workspace_links"));

    await executor.close();
  } finally {
    gateway.close();
  }
});

test("reuses the same connection across two tool calls instead of reconnecting", async () => {
  const secret = workspaceDeviceTokenBox.encrypt("raw-device-token-abc");
  let connectionCount = 0;
  const gateway = await startFakeGateway((ws) => {
    connectionCount += 1;
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.kind === "auth") {
        ws.send(JSON.stringify({ kind: "event", event: "auth:accepted", payload: {} }));
        return;
      }
      ws.send(JSON.stringify({ kind: "response", id: msg.id, ok: true, result: [] }));
    });
  });

  try {
    const supabase = fakeSupabase({
      row: {
        workspace_id: "ws-1",
        device_token_ciphertext: secret.ciphertext,
        device_token_iv: secret.iv,
        device_token_auth_tag: secret.authTag,
      },
    });
    const executor = new WorkspaceExecutor("user-1", { supabase, gatewayUrl: gateway.relayUrl });

    await executor.getTool("workspace.projects.list").execute({});
    await executor.getTool("workspace.process.list").execute({});
    assert.equal(connectionCount, 1, "a second tool call must reuse the already-open connection, not reconnect");

    await executor.close();
  } finally {
    gateway.close();
  }
});
