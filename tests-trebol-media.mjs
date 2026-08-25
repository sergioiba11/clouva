import assert from "node:assert/strict";
import test from "node:test";
import { MediaExecutor } from "./lib/clouva-ai/media-executor.ts";
import { ToolConfirmationGate } from "./lib/clouva-ai/tool-confirmation.ts";
import { ToolRouter } from "./lib/clouva-ai/tool-router.ts";

test("media generation is shared through ToolRouter and always requires reinforced confirmation", async () => {
  const calls = [];
  const service = {
    generateImage: async (args) => {
      calls.push(args);
      return { kind: "image", status: "completed", jobId: "job-1", url: "https://storage.googleapis.com/bucket/image.png" };
    },
  };
  const router = new ToolRouter([new MediaExecutor(service, "live", "conversation-1")]);
  const routed = router.resolve("media_generate_image");
  assert.ok(routed);

  const gate = new ToolConfirmationGate({ id: () => "action-1", now: () => new Date("2026-08-25T00:00:00Z") });
  const decision = await gate.evaluate(routed, { prompt: "Una portada púrpura", aspectRatio: "1:1" });
  assert.equal(decision.kind, "confirmation_required");
  assert.equal(decision.action.risk, "sensitive");
  assert.equal(decision.action.confirmation, "explicit");
  assert.equal(calls.length, 0);

  const result = await gate.confirm(router, decision.action);
  assert.equal(result.status, "completed");
  assert.deepEqual(calls, [{
    prompt: "Una portada púrpura",
    aspectRatio: "1:1",
    transport: "live",
    conversationId: "conversation-1",
  }]);
});

test("media executor cannot be called directly without the server confirmation flag", async () => {
  const executor = new MediaExecutor({ generateImage: async () => ({}) }, "text", null);
  await assert.rejects(
    executor.getTool("media.generate_image").execute({ prompt: "x" }),
    /confirmación reforzada/i,
  );
});
