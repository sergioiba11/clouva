import assert from "node:assert/strict";
import { test } from "node:test";
import { WebSocketServer } from "ws";

const { ClouvaDomainExecutor } = await import("./lib/clouva-ai/clouva-domain-executor.ts");
const { BaseToolExecutor } = await import("./lib/clouva-ai/tool-executor.ts");
const { ToolRouter } = await import("./lib/clouva-ai/tool-router.ts");
const { ToolConfirmationGate } = await import("./lib/clouva-ai/tool-confirmation.ts");
const { pairOverGateway } = await import("./lib/clouva-ai/workspace-gateway.ts");

const EL_IGLU_ID = "aabd5413-9f00-475c-aff4-33eee90fc24b";
const CONVERSATION_ID = "conversation-el-iglu";

function fakeGateway() {
  return new Promise((resolve) => {
    const server = new WebSocketServer({ port: 0 });
    server.on("listening", () => {
      const { port } = server.address();
      resolve({ relayUrl: `ws://127.0.0.1:${port}/relay`, close: () => server.close() });
    });
    server.on("connection", (socket) => {
      socket.on("message", (raw) => {
        const message = JSON.parse(String(raw));
        assert.deepEqual(message, { kind: "pair", code: "IGLU15", deviceName: "CLOUVA Cloud" });
        socket.send(JSON.stringify({
          kind: "event",
          event: "pairing:success",
          payload: {
            device: { id: "device-1", name: "CLOUVA Cloud", permissions: ["projects.read", "git.read"] },
            token: "test-device-token",
          },
        }));
      });
    });
  });
}

class LocalProjectExecutor extends BaseToolExecutor {
  target = "workspace";
  calls = [];
  definitions = [
    {
      name: "workspace.projects.inspect",
      description: "Revisa el proyecto local seleccionado.",
      risk: "read",
      parameters: { type: "OBJECT", properties: { projectId: { type: "STRING", description: "Proyecto" } }, required: ["projectId"] },
      execute: async (args) => {
        this.calls.push(["inspect", args]);
        return { id: args.projectId, rootPath: "D:/Clouva/Clouva app/clouva" };
      },
    },
    {
      name: "workspace.git.status",
      description: "Lee errores y cambios del proyecto local.",
      risk: "read",
      parameters: { type: "OBJECT", properties: { projectId: { type: "STRING", description: "Proyecto" } }, required: ["projectId"] },
      execute: async (args) => {
        this.calls.push(["git", args]);
        return { branch: "main", clean: false, files: ["mobile/src/screens/AIChatScreen.tsx"] };
      },
    },
  ];
}

test("scripted CLOUVA Cloud → El Iglú → approved actions → project review → same conversation on Mobile", async () => {
  const gateway = await fakeGateway();
  try {
    const pairing = await pairOverGateway({
      gatewayUrl: gateway.relayUrl,
      workspaceId: "workspace-1",
      code: "IGLU15",
      deviceName: "CLOUVA Cloud",
    });
    assert.equal(pairing.device.id, "device-1");

    const domainCalls = [];
    const domainService = {
      async getStudio() {
        domainCalls.push(["getStudio"]);
        return { studio: { id: EL_IGLU_ID, name: "El Iglú" }, role: "owner", studioOsActive: true };
      },
      async getStudioPlayers() {
        domainCalls.push(["getStudioPlayers"]);
        return { players: [{ player_id: "player-1", display_name: "Player", role: "Artista" }] };
      },
      async updatePlayer(playerId, changes) {
        domainCalls.push(["updatePlayer", playerId, changes]);
        return { player: { player_id: playerId, ...changes } };
      },
      async startPlayerProfileGeneration(playerId) {
        domainCalls.push(["startPlayerProfileGeneration", playerId]);
        return { jobId: "job-1", status: "queued", reused: false };
      },
    };
    const workspace = new LocalProjectExecutor();
    const router = new ToolRouter([new ClouvaDomainExecutor(domainService), workspace]);
    let actionNumber = 0;
    const gate = new ToolConfirmationGate({ id: () => `action-${++actionNumber}` });

    const readStudio = router.resolve("getStudio");
    const studioResult = await gate.evaluate(readStudio, router.normalizeArguments(readStudio, {}));
    assert.equal(studioResult.kind, "executed");
    assert.equal(studioResult.result.studio.id, EL_IGLU_ID);

    const readPlayers = router.resolve("getStudioPlayers");
    const playersResult = await gate.evaluate(readPlayers, router.normalizeArguments(readPlayers, {}));
    assert.equal(playersResult.kind, "executed");
    assert.equal(playersResult.result.players[0].player_id, "player-1");

    const update = router.resolve("updatePlayer");
    const updateProposal = await gate.evaluate(update, router.normalizeArguments(update, { playerId: "player-1", role: "Productor" }));
    assert.equal(updateProposal.kind, "confirmation_required");
    assert.equal(updateProposal.action.confirmation, "review");
    assert.equal(domainCalls.some(([name]) => name === "updatePlayer"), false);
    await gate.confirm(router, { ...updateProposal.action, status: "executing" });

    const generation = router.resolve("startPlayerProfileGeneration");
    const generationProposal = await gate.evaluate(generation, router.normalizeArguments(generation, { playerId: "player-1" }));
    assert.equal(generationProposal.kind, "confirmation_required");
    assert.equal(generationProposal.action.confirmation, "explicit");
    assert.equal(domainCalls.some(([name]) => name === "startPlayerProfileGeneration"), false);
    await gate.confirm(router, { ...generationProposal.action, status: "executing" });

    for (const [name, args] of [
      ["workspace_projects_inspect", { projectId: "clouva-web" }],
      ["workspace_git_status", { projectId: "clouva-web" }],
    ]) {
      const routed = router.resolve(name);
      const decision = await gate.evaluate(routed, router.normalizeArguments(routed, args));
      assert.equal(decision.kind, "executed");
    }
    assert.deepEqual(workspace.calls.map(([name]) => name), ["inspect", "git"]);

    // The source of truth is one server conversation. Each surface appends
    // to that same record; there is no per-client copy or local history DB.
    const canonicalConversation = {
      id: CONVERSATION_ID,
      studioId: EL_IGLU_ID,
      messages: [
        { surface: "web", content: "Abrí El Iglú y revisé sus miembros." },
        { surface: "desktop", content: "Revisé el proyecto local." },
      ],
      memories: [
        { id: "memory-pending", status: "pending", content: "No efectiva" },
        { id: "memory-approved", status: "active", content: "Rol aprobado: Productor" },
      ],
    };
    const mobileRequest = { conversationId: canonicalConversation.id, studioId: canonicalConversation.studioId };
    assert.deepEqual(mobileRequest, { conversationId: CONVERSATION_ID, studioId: EL_IGLU_ID });
    canonicalConversation.messages.push({ surface: "mobile", content: "Continuemos esta misma conversación." });
    assert.deepEqual(canonicalConversation.messages.map(({ surface }) => surface), ["web", "desktop", "mobile"]);
    assert.deepEqual(canonicalConversation.memories.filter(({ status }) => status === "active").map(({ id }) => id), ["memory-approved"]);
  } finally {
    gateway.close();
  }
});
