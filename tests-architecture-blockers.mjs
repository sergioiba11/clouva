import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("the legacy GitHub route cannot accept client-provided write confirmation", async () => {
  const route = await import("./app/api/clouva-ai/github/route.ts");
  const source = fs.readFileSync("app/api/clouva-ai/github/route.ts", "utf8");

  assert.equal(typeof route.GET, "function");
  assert.equal(route.POST, undefined);
  assert.doesNotMatch(source, /writeRepositoryFile|body\.confirm|action\s*===\s*["']write["']/);
});

test("Studio context does not claim approved Studio memory is unavailable", () => {
  const source = fs.readFileSync("lib/clouva-ai/context-resolver.ts", "utf8");

  assert.doesNotMatch(source, /Memoria compartida del Estudio:\s*no implementada/i);
  assert.doesNotMatch(source, /Studio-scoped shared memory[^\n]*Task 13/i);
  assert.doesNotMatch(source, /project_memory/);
});

test("parallel legacy voice endpoints remain retired in favor of audited Trebol Live", () => {
  const sessionRoute = fs.readFileSync("app/api/clouva-ai/voice/session/route.ts", "utf8");
  const turnRoute = fs.readFileSync("app/api/clouva-ai/voice/turn/route.ts", "utf8");

  assert.match(sessionRoute, /status:\s*410/);
  assert.match(sessionRoute, /\/api\/clouva-ai\/live\/token/);
  assert.doesNotMatch(sessionRoute, /auth_tokens|GEMINI_API_KEY|ai_conversations/);

  assert.match(turnRoute, /status:\s*410/);
  assert.match(turnRoute, /\/api\/clouva-ai\/live\/turn/);
  assert.doesNotMatch(turnRoute, /ai_messages|project_events|requireUser/);
});
