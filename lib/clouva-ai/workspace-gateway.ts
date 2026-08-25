// The pairing-handshake half of talking to CLOUVA Workspace's Control
// Gateway — pulled out of app/api/clouva-ai/workspace-link/route.ts so it's
// unit-testable via a real `ws` server (tests-workspace-gateway.mjs) instead
// of only exercisable through a live Next.js route, same reasoning as
// lib/clouva-ai/gemini-stream.ts. Deliberately kept in lockstep with
// clouva-workspace/mobile/src/transport/pairing.ts's pairOverGateway rather
// than importing it — that file lives in a separate repo with its own
// build/dependency graph.

import WebSocket from "ws";

export type DeviceSummary = {
  id: string;
  name: string;
  trusted: boolean;
  permissions: string[];
  lastSeen: string | null;
  createdAt: string;
  revoked: boolean;
};
export type PairResult = { device: DeviceSummary; token: string };

/** The Gateway's own `/relay` URL (what Desktop's Devices page shows) with
 * `/mobile?workspaceId=...` substituted in — matches
 * gateway/src/server.ts's two upgrade paths and
 * mobile/src/transport/pairing.ts's identically-named helper. */
export function mobileUrl(gatewayUrl: string, workspaceId: string): string {
  const base = gatewayUrl.replace(/\/relay\/?$/, "");
  return `${base}/mobile?workspaceId=${encodeURIComponent(workspaceId)}`;
}

/** Same handshake CLOUVA Mobile performs: connect to `/mobile`, send
 * `{kind:"pair",code,deviceName}`, wait for the `pairing:success` /
 * `pairing:error` event frame — or the Gateway's 4004 close code when this
 * workspace has no Desktop connected right now. */
export function pairOverGateway(args: {
  gatewayUrl: string;
  workspaceId: string;
  code: string;
  deviceName: string;
  timeoutMs?: number;
}): Promise<PairResult> {
  return new Promise((resolve, reject) => {
    let socket: WebSocket;
    try {
      socket = new WebSocket(mobileUrl(args.gatewayUrl, args.workspaceId));
    } catch (error) {
      reject(error instanceof Error ? error : new Error("No se pudo conectar al Gateway."));
      return;
    }

    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.terminate();
      reject(new Error("El Gateway de CLOUVA Workspace no respondió a tiempo."));
    }, args.timeoutMs ?? 10_000);

    function finish(run: () => void) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      run();
    }

    socket.on("open", () => {
      socket.send(JSON.stringify({ kind: "pair", code: args.code, deviceName: args.deviceName }));
    });

    socket.on("message", (raw) => {
      let msg: { kind?: string; event?: string; payload?: unknown };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.kind === "event" && msg.event === "pairing:success") {
        finish(() => {
          socket.close();
          resolve(msg.payload as PairResult);
        });
      } else if (msg.kind === "event" && msg.event === "pairing:error") {
        const payload = msg.payload as { message?: string } | undefined;
        finish(() => {
          socket.close();
          reject(new Error(payload?.message ?? "El pareo falló."));
        });
      }
    });

    socket.on("close", (closeCode) => {
      if (closeCode === 4004) {
        finish(() => reject(new Error("La PC (Desktop) no está conectada al Gateway ahora mismo.")));
      }
    });

    socket.on("error", () => {
      finish(() => reject(new Error("No se pudo conectar al Gateway de CLOUVA Workspace.")));
    });
  });
}

// --- Ongoing authenticated connection (Task 10 — WorkspaceExecutor) --------
//
// A second, longer-lived kind of connection to the same `/mobile` path,
// used *after* pairing already produced a real device token: send
// `{kind:"auth",deviceToken,clientType:"mobile"}` (the exact frame
// electron/controlServer/dispatcher.ts's `message.kind === "auth"` branch
// expects — `clientType` is typed "mobile"|"desktop-relay" but never
// actually read there, only `deviceToken` is; see gateway/relay.ts too,
// which never inspects it either), wait for `auth:accepted`, then send
// `{kind:"request",id,tool,args}` frames correlated by `id` and read back
// `{kind:"response",id,ok,result|error}` — same shape
// mobile/src/transport's SocketTransportBase uses for its ongoing
// connection. `{kind:"event"}` frames the Gateway relays that aren't the
// auth ack (Desktop's own `emit()` callback in dispatcher.ts, e.g. terminal
// output) are exposed via `onEvent()` rather than dropped — the "long op
// isn't a blocking fetch" requirement from the plan is this: a tool's
// `request()` can resolve quickly with just a processId/sessionId in its
// result, and the caller separately subscribes to `onEvent()` for whatever
// streams in afterward, instead of one request blocking until an entire
// build/terminal session finishes.

export type ControlEventFrame = { event: string; payload: unknown };
type EventListener = (frame: ControlEventFrame) => void;

const DEFAULT_AUTH_TIMEOUT_MS = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

export class WorkspaceGatewayConnection {
  private socket: WebSocket;
  private closed = false;
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout }>();
  private eventListeners = new Set<EventListener>();

  private constructor(socket: WebSocket) {
    this.socket = socket;
    this.socket.on("message", (raw) => this.handleMessage(raw));
    this.socket.on("close", () => this.handleClose());
    this.socket.on("error", () => this.handleClose());
  }

  /** Opens the socket, sends the device-auth frame, and resolves only once
   * Desktop has actually accepted it — callers never hold a connection that
   * looks open but isn't authenticated yet. */
  static connect(args: { gatewayUrl: string; workspaceId: string; deviceToken: string; timeoutMs?: number }): Promise<WorkspaceGatewayConnection> {
    return new Promise((resolve, reject) => {
      let raw: WebSocket;
      try {
        raw = new WebSocket(mobileUrl(args.gatewayUrl, args.workspaceId));
      } catch (error) {
        reject(error instanceof Error ? error : new Error("No se pudo conectar al Gateway."));
        return;
      }

      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        raw.terminate();
        reject(new Error("El Gateway de CLOUVA Workspace no respondió a tiempo (auth)."));
      }, args.timeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS);

      function finish(run: () => void) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        run();
      }

      raw.on("open", () => {
        raw.send(JSON.stringify({ kind: "auth", deviceToken: args.deviceToken, clientType: "mobile" }));
      });

      function onAuthMessage(msgRaw: unknown) {
        let msg: { kind?: string; event?: string };
        try {
          msg = JSON.parse(String(msgRaw));
        } catch {
          return;
        }
        if (msg.kind === "event" && msg.event === "auth:accepted") {
          finish(() => {
            raw.off("message", onAuthMessage);
            resolve(new WorkspaceGatewayConnection(raw));
          });
        } else if (msg.kind === "event" && msg.event === "auth:rejected") {
          finish(() => {
            raw.close();
            reject(new Error("El dispositivo pareado fue rechazado o revocado — reconectá el Workspace desde CLOUVA AI."));
          });
        }
      }
      raw.on("message", onAuthMessage);

      raw.on("close", (closeCode) => {
        if (closeCode === 4004) {
          finish(() => reject(new Error("La PC (Desktop) no está conectada al Gateway ahora mismo.")));
        }
      });

      raw.on("error", () => {
        finish(() => reject(new Error("No se pudo conectar al Gateway de CLOUVA Workspace.")));
      });
    });
  }

  private handleMessage(raw: unknown) {
    let msg: { kind?: string; id?: string; ok?: boolean; result?: unknown; error?: string; event?: string; payload?: unknown };
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (msg.kind === "response" && msg.id) {
      const waiting = this.pending.get(msg.id);
      if (!waiting) return; // late/duplicate/unknown response — nothing to resolve
      this.pending.delete(msg.id);
      clearTimeout(waiting.timeout);
      if (msg.ok) waiting.resolve(msg.result);
      else waiting.reject(new Error(msg.error ?? "El Workspace devolvió un error."));
      return;
    }

    if (msg.kind === "event" && msg.event) {
      const frame: ControlEventFrame = { event: msg.event, payload: msg.payload };
      for (const listener of this.eventListeners) listener(frame);
    }
  }

  private handleClose() {
    if (this.closed) return;
    this.closed = true;
    const error = new Error("Se perdió la conexión con el Workspace.");
    for (const waiting of this.pending.values()) {
      clearTimeout(waiting.timeout);
      waiting.reject(error);
    }
    this.pending.clear();
  }

  /** Subscribe to every `{kind:"event"}` frame Desktop emits on this
   * connection (not correlated to any one `request()` — the caller filters
   * by whatever discriminator its own payload carries, e.g. a sessionId).
   * Returns an unsubscribe function. */
  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /** Sends `{kind:"request",id,tool,args}` and resolves with `result` once
   * the matching `{kind:"response"}` arrives. A long-running tool (not used
   * by any WorkspaceExecutor tool yet — see this file's header comment)
   * would resolve quickly with a processId/sessionId in `result`; its
   * actual progress arrives separately via `onEvent()`, not by this promise
   * staying pending for the op's full duration. */
  request(tool: string, args: Record<string, unknown>, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("La conexión con el Workspace ya está cerrada."));

    const id = globalThis.crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`El Workspace no respondió a '${tool}' a tiempo.`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timeout });
      this.socket.send(JSON.stringify({ kind: "request", id, tool, args }));
    });
  }

  close(): void {
    if (this.closed) return;
    this.handleClose();
    this.socket.close();
  }
}
