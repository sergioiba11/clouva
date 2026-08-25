import assert from "node:assert/strict";
import { test } from "node:test";

const { BaseToolExecutor } = await import("./lib/clouva-ai/tool-executor.ts");
const { ToolRouter } = await import("./lib/clouva-ai/tool-router.ts");
const { ToolConfirmationGate } = await import("./lib/clouva-ai/tool-confirmation.ts");
const { runGeminiToolLoop } = await import("./lib/clouva-ai/gemini-tools.ts");

class LoopExecutor extends BaseToolExecutor {
  target = "fake";
  calls = [];
  definitions = [
    {
      name: "read_status",
      description: "Read status",
      risk: "read",
      parameters: { type: "OBJECT", properties: {}, required: [] },
      execute: async (args) => {
        this.calls.push({ tool: "read_status", args });
        return { branch: "main", clean: true };
      },
    },
    {
      name: "write_file",
      description: "Write file",
      risk: "write",
      parameters: {
        type: "OBJECT",
        properties: { path: { type: "STRING", description: "Path" } },
        required: ["path"],
      },
      execute: async (args) => {
        this.calls.push({ tool: "write_file", args });
        return { ok: true };
      },
    },
  ];
}

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

function harness() {
  const executor = new LoopExecutor();
  return {
    executor,
    router: new ToolRouter([executor]),
    gate: new ToolConfirmationGate({ id: () => "pending-1", now: () => new Date("2026-08-09T12:00:00Z") }),
  };
}

test("Gemini function calling executes reads and sends their result back before answering", async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    if (requests.length === 1) {
      return response({ candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "read_status", args: {} } }] } }] });
    }
    return response({ candidates: [{ content: { role: "model", parts: [{ text: "El repo está limpio en main." }] } }] });
  };

  try {
    const { executor, router, gate } = harness();
    const result = await runGeminiToolLoop({
      apiKey: "test-key",
      selectedModel: "gemini-test",
      instruction: "Use tools",
      contents: [{ role: "user", parts: [{ text: "estado" }] }],
      router,
      gate,
    });

    assert.equal(result.text, "El repo está limpio en main.");
    assert.equal(result.pendingAction, null);
    assert.equal(executor.calls.length, 1);
    assert.equal(result.continuationContents.at(-1).role, "user");
    assert.equal(result.limitReached, false);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].tools[0].functionDeclarations[0].name, "read_status");
    assert.equal(requests[1].contents.at(-1).role, "user");
    assert.deepEqual(requests[1].contents.at(-1).parts[0].functionResponse.response, {
      ok: true,
      result: { branch: "main", clean: true },
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("Gemini write calls become pending actions and never execute", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => response({
    candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "write_file", args: { path: "a.txt", confirm: true } } }] } }],
  });

  try {
    const { executor, router, gate } = harness();
    const result = await runGeminiToolLoop({
      apiKey: "test-key",
      selectedModel: "gemini-test",
      instruction: "Use tools",
      contents: [{ role: "user", parts: [{ text: "cambiá a.txt" }] }],
      router,
      gate,
    });

    assert.equal(result.pendingAction.id, "pending-1");
    assert.deepEqual(result.pendingAction.arguments, { path: "a.txt" });
    assert.equal(executor.calls.length, 0);
    assert.equal(result.traces[0].status, "confirmation_required");
    assert.equal(result.limitReached, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("Gemini receives function responses as user turns with the original call id", async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    if (requests.length === 1) {
      return response({ candidates: [{ content: { role: "model", parts: [{ functionCall: { id: "call-7", name: "read_status", args: {} } }] } }] });
    }
    return response({ candidates: [{ content: { role: "model", parts: [{ text: "Listo." }] } }] });
  };

  try {
    const { router, gate } = harness();
    await runGeminiToolLoop({
      apiKey: "test-key",
      selectedModel: "gemini-test",
      instruction: "Use tools",
      contents: [{ role: "user", parts: [{ text: "estado" }] }],
      router,
      gate,
    });

    const toolTurn = requests[1].contents.at(-1);
    assert.equal(toolTurn.role, "user");
    assert.equal(toolTurn.parts[0].functionResponse.id, "call-7");
  } finally {
    global.fetch = originalFetch;
  }
});

test("duplicate reads are not executed twice", async () => {
  const originalFetch = global.fetch;
  let turn = 0;
  global.fetch = async () => {
    turn += 1;
    if (turn <= 2) {
      return response({ candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "read_status", args: {} } }] } }] });
    }
    return response({ candidates: [{ content: { role: "model", parts: [{ text: "Usé el primer resultado." }] } }] });
  };

  try {
    const { executor, router, gate } = harness();
    const result = await runGeminiToolLoop({
      apiKey: "test-key",
      selectedModel: "gemini-test",
      instruction: "Use tools",
      contents: [{ role: "user", parts: [{ text: "estado" }] }],
      router,
      gate,
    });

    assert.equal(executor.calls.length, 1);
    assert.equal(result.text, "Usé el primer resultado.");
    assert.equal(result.traces.some((trace) => trace.error?.includes("ya se ejecutó")), true);
  } finally {
    global.fetch = originalFetch;
  }
});

test("the bounded loop returns safe finalization context instead of a transport error", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => response({
    candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "read_status", args: {} } }] } }],
  });

  try {
    const { executor, router, gate } = harness();
    const result = await runGeminiToolLoop({
      apiKey: "test-key",
      selectedModel: "gemini-test",
      instruction: "Use tools",
      contents: [{ role: "user", parts: [{ text: "estado" }] }],
      router,
      gate,
      maxSteps: 2,
    });

    assert.equal(result.limitReached, true);
    assert.equal(result.pendingAction, null);
    assert.equal(result.continuationContents.at(-1).role, "user");
    assert.equal(executor.calls.length, 1);
    assert.match(result.text, /No se ejecutó ni se propuso ninguna escritura/);
  } finally {
    global.fetch = originalFetch;
  }
});
