import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

const { BaseToolExecutor } = await import("./lib/clouva-ai/tool-executor.ts");
const { ToolRouter } = await import("./lib/clouva-ai/tool-router.ts");
const { ToolConfirmationGate, createTextDiff } = await import("./lib/clouva-ai/tool-confirmation.ts");

class FakeExecutor extends BaseToolExecutor {
  target = "workspace";
  calls = [];
  definitions = [
    {
      name: "workspace.read.status",
      description: "Lee estado.",
      risk: "read",
      parameters: { type: "OBJECT", properties: { scope: { type: "STRING", description: "Scope" } }, required: ["scope"] },
      execute: async (args) => {
        this.calls.push({ tool: "read", args });
        return { clean: true };
      },
    },
    {
      name: "workspace.write.file",
      description: "Escribe archivo.",
      risk: "write",
      parameters: { type: "OBJECT", properties: { path: { type: "STRING", description: "Path" } }, required: ["path"] },
      execute: async (args) => {
        this.calls.push({ tool: "write", args });
        return { ok: true };
      },
    },
    {
      name: "workspace.secret.rotate",
      description: "Rota un secreto.",
      risk: "sensitive",
      parameters: { type: "OBJECT", properties: { name: { type: "STRING", description: "Name" } }, required: ["name"] },
      execute: async (args) => {
        this.calls.push({ tool: "sensitive", args });
        return { ok: true };
      },
    },
  ];
}

function setup() {
  const executor = new FakeExecutor();
  const router = new ToolRouter([executor]);
  const gate = new ToolConfirmationGate({
    id: () => "action-1",
    now: () => new Date("2026-08-09T12:00:00.000Z"),
  });
  return { executor, router, gate };
}

test("ToolRouter exposes Gemini-safe names and strips undeclared confirmation flags", () => {
  const { router } = setup();
  const declaration = router.declarations().find((item) => item.name === "workspace_write_file");
  assert.ok(declaration);
  assert.match(declaration.description, /espera confirmación humana/i);

  const routed = router.resolve("workspace_write_file");
  assert.deepEqual(router.normalizeArguments(routed, { path: "a.txt", confirm: true, expectedSha: "forged" }), { path: "a.txt" });
  assert.throws(() => router.normalizeArguments(routed, {}), /Falta el argumento requerido 'path'/);
});

test("read tools execute immediately without producing a confirmation", async () => {
  const { executor, router, gate } = setup();
  const routed = router.resolve("workspace_read_status");
  const decision = await gate.evaluate(routed, router.normalizeArguments(routed, { scope: "repo" }));
  assert.equal(decision.kind, "executed");
  assert.deepEqual(decision.result, { clean: true });
  assert.equal(executor.calls.length, 1);
});

test("write tools stop at a reviewable proposal until the server confirms", async () => {
  const { executor, router, gate } = setup();
  const routed = router.resolve("workspace_write_file");
  const decision = await gate.evaluate(routed, router.normalizeArguments(routed, { path: "a.txt", confirm: true }));

  assert.equal(decision.kind, "confirmation_required");
  assert.equal(decision.action.confirmation, "review");
  assert.equal(decision.action.status, "pending");
  assert.equal(decision.action.id, "action-1");
  assert.equal(executor.calls.length, 0);

  const result = await gate.confirm(router, { ...decision.action, status: "executing" });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(executor.calls[0], { tool: "write", args: { path: "a.txt", confirm: true } });
});

test("sensitive tools require reinforced explicit confirmation", async () => {
  const { executor, router, gate } = setup();
  const routed = router.resolve("workspace_secret_rotate");
  const decision = await gate.evaluate(routed, router.normalizeArguments(routed, { name: "API_KEY" }));
  assert.equal(decision.kind, "confirmation_required");
  assert.equal(decision.action.confirmation, "explicit");
  assert.equal(executor.calls.length, 0);
});

test("createTextDiff shows a bounded unified-style diff", () => {
  const preview = createTextDiff("docs/a.md", "uno\ndos\ntres", "uno\nDOS\ntres");
  assert.equal(preview.kind, "diff");
  assert.match(preview.diff, /--- a\/docs\/a\.md/);
  assert.match(preview.diff, /-dos/);
  assert.match(preview.diff, /\+DOS/);
});

test("a local file write reads the current version, produces a diff, and adds its hash only after approval", async () => {
  const calls = [];
  class FileExecutor extends BaseToolExecutor {
    target = "workspace";
    definitions = [
      {
        name: "workspace.files.read",
        description: "Lee archivo.",
        risk: "read",
        parameters: { type: "OBJECT", properties: { path: { type: "STRING", description: "Path" } }, required: ["path"] },
        execute: async () => ({ content: "antes\n" }),
      },
      {
        name: "workspace.files.write",
        description: "Escribe archivo.",
        risk: "write",
        parameters: {
          type: "OBJECT",
          properties: { path: { type: "STRING", description: "Path" }, content: { type: "STRING", description: "Content" } },
          required: ["path", "content"],
        },
        execute: async (args) => { calls.push(args); return { written: args.path }; },
      },
    ];
  }
  const router = new ToolRouter([new FileExecutor()]);
  const gate = new ToolConfirmationGate({ id: () => "file-action" });
  const routed = router.resolve("workspace_files_write");
  const normalized = router.normalizeArguments(routed, { path: "D:/repo/page.tsx", content: "después\n", confirm: true, expectedContentHash: "forged" });
  const decision = await gate.evaluate(routed, normalized);

  assert.equal(decision.kind, "confirmation_required");
  assert.match(decision.action.preview.diff, /-antes/);
  assert.match(decision.action.preview.diff, /\+después/);
  assert.equal(calls.length, 0, "client-provided confirm:true must not execute the write");

  await gate.confirm(router, { ...decision.action, status: "executing" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].confirm, true);
  assert.equal(calls[0].expectedContentHash, createHash("sha256").update("antes\n", "utf8").digest("hex"));
});
