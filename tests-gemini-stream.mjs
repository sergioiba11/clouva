import assert from "node:assert/strict";
import { test } from "node:test";

const { streamGeminiWithFallback } = await import("./lib/clouva-ai/gemini-stream.ts");

// Builds a fake `Response` whose body is a real ReadableStream emitting the
// given SSE `data: {...}` lines — the same shape
// https://generativelanguage.googleapis.com/.../streamGenerateContent?alt=sse
// actually returns, split arbitrarily across chunks to also exercise the
// buffer/line-reassembly logic (a real network stream rarely lines up with
// SSE record boundaries).
function fakeSseResponse(dataLines, { ok = true, status = 200 } = {}) {
  const body = dataLines.join("\n") + "\n";
  const half = Math.ceil(body.length / 2);
  const parts = [body.slice(0, half), body.slice(half)];

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });

  return {
    ok,
    status,
    body,
    text: async () => body,
    // Response.body isn't actually a ReadableStream in this fake — swap it
    // in as the real thing so reader.read()/getReader() work as production
    // code expects.
    __body: stream,
  };
}

function sseLine(text, finishReason) {
  const payload = { candidates: [{ content: { parts: [{ text }] }, ...(finishReason ? { finishReason } : {}) }] };
  return `data: ${JSON.stringify(payload)}`;
}

test("yields text deltas in order, reassembling across chunk boundaries", async () => {
  const fake = fakeSseResponse([sseLine("Hola "), sseLine("che, "), sseLine("¿todo bien?")]);
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ...fake, body: fake.__body });

  try {
    const generator = streamGeminiWithFallback({
      apiKey: "test-key",
      selectedModel: "gemini-3.5-flash",
      instruction: "system",
      contents: [{ role: "user", parts: [{ text: "hola" }] }],
    });

    let collected = "";
    let result;
    while (true) {
      const step = await generator.next();
      if (step.done) {
        result = step.value;
        break;
      }
      collected += step.value;
    }

    assert.equal(collected, "Hola che, ¿todo bien?");
    assert.equal(result.model, "gemini-3.5-flash");
  } finally {
    global.fetch = originalFetch;
  }
});

test("falls back to the secondary model when the primary fails before any text", async () => {
  const originalFetch = global.fetch;
  let call = 0;
  global.fetch = async () => {
    call += 1;
    if (call === 1) {
      return { ok: false, status: 503, text: async () => JSON.stringify({ error: { message: "overloaded" } }) };
    }
    const fake = fakeSseResponse([sseLine("Respuesta del modelo de respaldo.")]);
    return { ...fake, body: fake.__body };
  };

  try {
    const generator = streamGeminiWithFallback({
      apiKey: "test-key",
      selectedModel: "gemini-3.5-flash",
      instruction: "system",
      contents: [],
    });

    let collected = "";
    let result;
    while (true) {
      const step = await generator.next();
      if (step.done) {
        result = step.value;
        break;
      }
      collected += step.value;
    }

    assert.equal(collected, "Respuesta del modelo de respaldo.");
    assert.notEqual(result.model, "gemini-3.5-flash");
    assert.equal(call, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test("does not retry once real text already streamed to the caller", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    // A stream that yields one chunk, then the underlying body errors —
    // simulating a mid-stream network drop after real output was already
    // sent to the client.
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(new TextEncoder().encode(`${sseLine("Empezó a responder... ")}\n`));
        // A real network drop happens strictly after the reader has had a
        // chance to actually consume what already arrived — not in the same
        // synchronous tick as the enqueue (which the Streams spec treats as
        // "never delivered": error() clears the still-queued chunk).
        await new Promise((resolve) => setTimeout(resolve, 10));
        controller.error(new Error("connection reset"));
      },
    });
    return { ok: true, status: 200, body: stream, text: async () => "" };
  };

  try {
    const generator = streamGeminiWithFallback({
      apiKey: "test-key",
      selectedModel: "gemini-3.5-flash",
      instruction: "system",
      contents: [],
    });

    let collected = "";
    let threw = false;
    try {
      while (true) {
        const step = await generator.next();
        if (step.done) break;
        collected += step.value;
      }
    } catch {
      threw = true;
    }

    assert.equal(collected, "Empezó a responder... ");
    assert.equal(threw, true, "a mid-stream failure after real output must surface as an error, not a silent retry");
  } finally {
    global.fetch = originalFetch;
  }
});
