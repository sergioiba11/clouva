import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { selectedModelFromRequest } from "./lib/clouva-ai/providers/config.ts";
import { classifyProviderError } from "./lib/clouva-ai/providers/errors.ts";
import { parseMemoryProposal } from "./lib/clouva-ai/memory-proposals.ts";

const chatSource = fs.readFileSync(new URL("./app/api/clouva-ai/chat/route.ts", import.meta.url), "utf8");
const providerRouterSource = fs.readFileSync(new URL("./lib/clouva-ai/providers/provider-router.ts", import.meta.url), "utf8");
const toolLoopSource = fs.readFileSync(new URL("./lib/clouva-ai/provider-tool-loop.ts", import.meta.url), "utf8");
const liveTokenSource = fs.readFileSync(new URL("./app/api/clouva-ai/live/token/route.ts", import.meta.url), "utf8");

test("canonical chat has no direct Gemini dependency and keeps NDJSON frames", () => {
  assert.doesNotMatch(chatSource, /gemini-(?:text|stream|tools)/);
  assert.doesNotMatch(chatSource, /GEMINI_API_KEY/);
  assert.match(chatSource, /type:\s*"chunk"/);
  assert.match(chatSource, /type:\s*"done"/);
  assert.match(chatSource, /type:\s*"error"/);
});

test("provider router forbids silent fallback after visible streaming output", () => {
  assert.match(providerRouterSource, /if \(emitted \|\| !lastError\.retryable\) throw lastError/);
});

test("generic tool loop owns ToolRouter and ToolConfirmationGate", () => {
  assert.match(toolLoopSource, /ToolRouter/);
  assert.match(toolLoopSource, /ToolConfirmationGate/);
  assert.match(toolLoopSource, /confirmation_required/);
  assert.doesNotMatch(toolLoopSource, /generativelanguage\.googleapis\.com|@google\/genai/);
});

test("Gemini billing depletion is normalized", () => {
  const error = classifyProviderError("gemini", 400, "Your prepayment credits are depleted");
  assert.equal(error.code, "PROVIDER_BILLING_DEPLETED");
  assert.equal(error.retryable, true);
});

test("legacy Gemini model cookie remains readable", () => {
  const request = new Request("https://clouva.com.ar/api/clouva-ai/chat", {
    headers: { cookie: "clouva_gemini_model=gemini-legacy-model" },
  });
  assert.equal(selectedModelFromRequest(request, "clouva-default"), "gemini-legacy-model");
});

test("new provider-neutral model cookie wins over legacy cookie", () => {
  const request = new Request("https://clouva.com.ar/api/clouva-ai/chat", {
    headers: { cookie: "clouva_ai_model=clouva-main; clouva_gemini_model=gemini-old" },
  });
  assert.equal(selectedModelFromRequest(request, "fallback"), "clouva-main");
});

test("historical Gemini memory proposals remain valid", () => {
  const proposal = parseMemoryProposal({
    id: "11111111-1111-4111-8111-111111111111",
    status: "pending",
    scope: "user",
    userId: "user-1",
    studioId: null,
    conversationId: "22222222-2222-4222-8222-222222222222",
    sourceMessageId: "33333333-3333-4333-8333-333333333333",
    memoryType: "architecture",
    title: "Arquitectura histórica",
    content: "Memoria creada antes de la migración de providers.",
    importance: 4,
    reason: "Compatibilidad",
    dedupeKey: "abc",
    proposedBy: "gemini",
    provider: "gemini",
    detectorModel: "gemini-3.5-flash",
    proposedAt: new Date(0).toISOString(),
  });
  assert.ok(proposal);
  assert.equal(proposal.provider, "gemini");
});

test("Live token route no longer imports Google SDK directly", () => {
  assert.doesNotMatch(liveTokenSource, /@google\/genai|GoogleGenAI|GEMINI_API_KEY/);
  assert.match(liveTokenSource, /createRealtimeSession/);
});
