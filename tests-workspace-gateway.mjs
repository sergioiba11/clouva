import assert from "node:assert/strict";
import { test } from "node:test";
import { WebSocketServer } from "ws";

const { pairOverGateway, mobileUrl, WorkspaceGatewayConnection } = await import("./lib/clouva-ai/workspace-gateway.ts");

/** Starts a tiny fake Gateway on an ephemeral port and hands back its
 * `/relay`-shaped base URL — real `ws` sockets end to end, no mocking,
 * same level of realism tests-gemini-stream.mjs uses for its fetch/stream
 * boundary. `onConnection(ws, workspaceId)` decides what this fake Gateway
 * does with the one `/mobile` connection a test opens. */
function startFakeGateway(onConnection) {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 });
    wss.on("listening", () => {
      const { port } = wss.address();
      resolve({
        relayUrl: `ws://127.0.0.1:${port}/relay`,
        close: () => wss.close(),
      });
    });
    wss.on("connection", (ws, req) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      onConnection(ws, url.searchParams.get("workspaceId"));
    });
  });
}

test("mobileUrl swaps /relay for /mobile?workspaceId=...", () => {
  assert.equal(
    mobileUrl("wss://clouva-gateway-xxx.a.run.app/relay", "ws-123"),
    "wss://clouva-gateway-xxx.a.run.app/mobile?workspaceId=ws-123",
  );
  assert.equal(mobileUrl("wss://clouva-gateway-xxx.a.run.app/relay/", "a b"), "wss://clouva-gateway-xxx.a.run.app/mobile?workspaceId=a%20b");
});

test("resolves on pairing:success with the real device+token payload", async () => {
  const gateway = await startFakeGateway((ws) => {
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      assert.equal(msg.kind, "pair");
      assert.equal(msg.code, "ABC123");
      assert.equal(msg.deviceName, "CLOUVA Cloud");
      ws.send(JSON.stringify({
        kind: "event",
        event: "pairing:success",
        payload: { device: { id: "dev-1", name: "CLOUVA Cloud", permissions: ["projects.read"] }, token: "raw-token-xyz" },
      }));
    });
  });

  try {
    const result = await pairOverGateway({
      gatewayUrl: gateway.relayUrl,
      workspaceId: "ws-1",
      code: "ABC123",
      deviceName: "CLOUVA Cloud",
    });
    assert.equal(result.token, "raw-token-xyz");
    assert.equal(result.device.id, "dev-1");
  } finally {
    gateway.close();
  }
});

test("rejects with the server's message on pairing:error", async () => {
  const gateway = await startFakeGateway((ws) => {
    ws.on("message", () => {
      ws.send(JSON.stringify({ kind: "event", event: "pairing:error", payload: { message: "Código incorrecto." } }));
    });
  });

  try {
    await assert.rejects(
      () => pairOverGateway({ gatewayUrl: gateway.relayUrl, workspaceId: "ws-1", code: "BAD", deviceName: "CLOUVA Cloud" }),
      /Código incorrecto/,
    );
  } finally {
    gateway.close();
  }
});

test("rejects when the Gateway closes with 4004 (workspace offline)", async () => {
  const gateway = await startFakeGateway((ws) => {
    ws.close(4004, "workspace offline");
  });

  try {
    await assert.rejects(
      () => pairOverGateway({ gatewayUrl: gateway.relayUrl, workspaceId: "ws-1", code: "ABC123", deviceName: "CLOUVA Cloud" }),
      /no está conectada/,
    );
  } finally {
    gateway.close();
  }
});

test("rejects on timeout when the Gateway never responds", async () => {
  const gateway = await startFakeGateway(() => {
    // Accepts the connection, never sends anything back.
  });

  try {
    await assert.rejects(
      () => pairOverGateway({ gatewayUrl: gateway.relayUrl, workspaceId: "ws-1", code: "ABC123", deviceName: "CLOUVA Cloud", timeoutMs: 200 }),
      /no respondió a tiempo/,
    );
  } finally {
    gateway.close();
  }
});

// --- WorkspaceGatewayConnection (Task 10) -----------------------------

/** A fake Desktop dispatcher: accepts the auth frame (accept/reject per
 * `authOutcome`), then answers `{kind:"request"}` frames per `onRequest`. */
function startFakeDesktop({ authOutcome = "accepted", onRequest } = {}) {
  return startFakeGateway((ws) => {
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.kind === "auth") {
        if (authOutcome === "accepted") {
          ws.send(JSON.stringify({ kind: "event", event: "auth:accepted", payload: { deviceId: "dev-1" } }));
        } else if (authOutcome === "rejected") {
          ws.send(JSON.stringify({ kind: "event", event: "auth:rejected", payload: {} }));
        } // "silent" outcome: never respond, exercises the auth timeout
        return;
      }
      if (msg.kind === "request") onRequest?.(ws, msg);
    });
  });
}

test("WorkspaceGatewayConnection: connects and authenticates before resolving", async () => {
  const gateway = await startFakeDesktop();
  try {
    const connection = await WorkspaceGatewayConnection.connect({
      gatewayUrl: gateway.relayUrl,
      workspaceId: "ws-1",
      deviceToken: "raw-token",
    });
    assert.ok(connection);
    connection.close();
  } finally {
    gateway.close();
  }
});

test("WorkspaceGatewayConnection: rejects on auth:rejected", async () => {
  const gateway = await startFakeDesktop({ authOutcome: "rejected" });
  try {
    await assert.rejects(
      () => WorkspaceGatewayConnection.connect({ gatewayUrl: gateway.relayUrl, workspaceId: "ws-1", deviceToken: "bad-token" }),
      /rechazado o revocado/,
    );
  } finally {
    gateway.close();
  }
});

test("WorkspaceGatewayConnection: request() resolves with the matching response's result", async () => {
  const gateway = await startFakeDesktop({
    onRequest: (ws, msg) => {
      assert.equal(msg.tool, "workspace.projects.list");
      ws.send(JSON.stringify({ kind: "response", id: msg.id, ok: true, result: [{ id: "p1" }] }));
    },
  });

  try {
    const connection = await WorkspaceGatewayConnection.connect({ gatewayUrl: gateway.relayUrl, workspaceId: "ws-1", deviceToken: "raw-token" });
    const result = await connection.request("workspace.projects.list", {});
    assert.deepEqual(result, [{ id: "p1" }]);
    connection.close();
  } finally {
    gateway.close();
  }
});

test("WorkspaceGatewayConnection: request() rejects with the server's error message on ok:false", async () => {
  const gateway = await startFakeDesktop({
    onRequest: (ws, msg) => {
      ws.send(JSON.stringify({ kind: "response", id: msg.id, ok: false, error: "Unknown tool 'x'" }));
    },
  });

  try {
    const connection = await WorkspaceGatewayConnection.connect({ gatewayUrl: gateway.relayUrl, workspaceId: "ws-1", deviceToken: "raw-token" });
    await assert.rejects(() => connection.request("x", {}), /Unknown tool/);
    connection.close();
  } finally {
    gateway.close();
  }
});

test("WorkspaceGatewayConnection: request() times out when no response arrives", async () => {
  const gateway = await startFakeDesktop({ onRequest: () => {} });
  try {
    const connection = await WorkspaceGatewayConnection.connect({ gatewayUrl: gateway.relayUrl, workspaceId: "ws-1", deviceToken: "raw-token" });
    await assert.rejects(() => connection.request("workspace.projects.list", {}, 150), /no respondió/);
    connection.close();
  } finally {
    gateway.close();
  }
});

test("WorkspaceGatewayConnection: two concurrent requests each resolve with their own result (id correlation)", async () => {
  const gateway = await startFakeDesktop({
    onRequest: (ws, msg) => {
      // Reply out of order on purpose — correlation must be by id, not by
      // send/receive order.
      const delay = msg.tool === "slow" ? 30 : 5;
      setTimeout(() => ws.send(JSON.stringify({ kind: "response", id: msg.id, ok: true, result: msg.tool })), delay);
    },
  });

  try {
    const connection = await WorkspaceGatewayConnection.connect({ gatewayUrl: gateway.relayUrl, workspaceId: "ws-1", deviceToken: "raw-token" });
    const [slow, fast] = await Promise.all([connection.request("slow", {}), connection.request("fast", {})]);
    assert.equal(slow, "slow");
    assert.equal(fast, "fast");
    connection.close();
  } finally {
    gateway.close();
  }
});

test("WorkspaceGatewayConnection: onEvent() delivers unsolicited event frames", async () => {
  const gateway = await startFakeGateway((ws) => {
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.kind !== "auth") return;
      ws.send(JSON.stringify({ kind: "event", event: "auth:accepted", payload: {} }));
      setTimeout(() => ws.send(JSON.stringify({ kind: "event", event: "terminal:data", payload: { sessionId: "s1", chunk: "hola" } })), 10);
    });
  });

  try {
    const connection = await WorkspaceGatewayConnection.connect({ gatewayUrl: gateway.relayUrl, workspaceId: "ws-1", deviceToken: "raw-token" });
    const received = await new Promise((resolve) => {
      connection.onEvent((frame) => {
        if (frame.event === "terminal:data") resolve(frame);
      });
    });
    assert.equal(received.event, "terminal:data");
    assert.deepEqual(received.payload, { sessionId: "s1", chunk: "hola" });
    connection.close();
  } finally {
    gateway.close();
  }
});

test("WorkspaceGatewayConnection: a dropped connection rejects any still-pending request", async () => {
  const gateway = await startFakeDesktop({ onRequest: () => {} });
  try {
    const connection = await WorkspaceGatewayConnection.connect({ gatewayUrl: gateway.relayUrl, workspaceId: "ws-1", deviceToken: "raw-token" });
    const pending = connection.request("workspace.projects.list", {}, 5_000);
    connection.close();
    await assert.rejects(() => pending, /conexión|perdió/i);
  } finally {
    gateway.close();
  }
});
