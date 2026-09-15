import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("Live tokens are user-authenticated, rate-limited, constrained and never return the API key", () => {
  const source = read("./app/api/clouva-ai/live/token/route.ts");
  assert.match(source, /authenticateAgentRequest\(request\)/);
  assert.match(source, /consume_trebol_live_token_limit/);
  assert.match(source, /liveConnectConstraints/);
  assert.match(source, /uses:\s*1/);
  assert.match(source, /responseModalities:\s*\[Modality\.AUDIO\]/);
  const responseBlock = source.slice(source.indexOf("return NextResponse.json({", source.indexOf("authToken.name")));
  assert.doesNotMatch(responseBlock.slice(0, responseBlock.indexOf("});") + 3), /apiKey|GEMINI_API_KEY/);
});

test("Live tool and transcript endpoints fail closed without a persisted owned run", () => {
  for (const path of ["./app/api/clouva-ai/tools/execute/route.ts", "./app/api/clouva-ai/live/turn/route.ts"]) {
    const source = read(path);
    assert.match(source, /requireAgentRun/);
    assert.match(source, /if \(!run\.persisted\)/);
  }
});

test("audio uses worklets with the documented PCM rates and barge-in clears playback", () => {
  const capture = read("./lib/clouva-ai/live/audio-capture.ts");
  const playback = read("./lib/clouva-ai/live/audio-playback.ts");
  const client = read("./lib/clouva-ai/live/client.ts");
  const clientHook = read("./components/clouva-ai/useTrebolLiveSession.ts");
  assert.match(capture, /targetSampleRate:\s*16_000/);
  assert.match(playback, /inputSampleRate:\s*24_000/);
  assert.match(client, /mimeType:\s*"audio\/pcm;rate=16000"/);
  assert.match(client, /if \(!this\.session \|\| this\.muted \|\| !base64Pcm\) return/);
  assert.doesNotMatch(`${capture}\n${playback}`, /MediaRecorder|ScriptProcessorNode/);
  assert.match(clientHook, /onInterrupted:[\s\S]*playbackRef\.current\?\.clear\(\)/);
});

test("Live exposes connected state only after Gemini setupComplete and captures close diagnostics", () => {
  const client = read("./lib/clouva-ai/live/client.ts");
  const connectStart = client.indexOf("const session = await ai.live.connect");
  const sessionAssignment = client.indexOf("this.session = session", connectStart);
  const connectedCallback = client.indexOf("this.options.callbacks?.onConnected?.(identity)", sessionAssignment);
  assert.ok(connectStart >= 0 && sessionAssignment > connectStart && connectedCallback > sessionAssignment);
  assert.match(client, /onopen:[\s\S]{0,900}this\.phase = "setup"[\s\S]{0,900}this\.markSent\("setup"\)/);
  assert.match(client, /message\.setupComplete[\s\S]{0,240}this\.markReceived\("setupComplete"\)/);
  assert.match(client, /closeCode:\s*typeof event\?\.code === "number" \? event\.code : null/);
  assert.match(client, /wasClean:\s*typeof event\?\.wasClean === "boolean" \? event\.wasClean : null/);
  assert.match(client, /socketLifetimeMs:/);
  assert.match(client, /lastSentEvent:/);
  assert.match(client, /lastReceivedEvent:/);
  assert.match(client, /action:\s*"diagnostic"/);
});

test("assistant transcript persists at semantic model boundaries, not transcription-segment boundaries", () => {
  const client = read("./lib/clouva-ai/live/client.ts");
  assert.doesNotMatch(
    client,
    /outputTranscription\.finished\)\s*void this\.flushTranscript\("assistant"/,
  );
  assert.match(
    client,
    /content\?\.interrupted[\s\S]*flushTranscript\("assistant", "MODEL_INTERRUPTED"\)/,
  );
  assert.match(
    client,
    /content\?\.turnComplete[\s\S]*flushTranscript\("assistant", wasInterrupted \? "MODEL_INTERRUPTED" : "MODEL_TURN_COMPLETE"\)/,
  );
});

test("Live does not inject changing page context as unsolicited realtime user text", () => {
  const hook = read("./components/clouva-ai/useTrebolLiveSession.ts");
  assert.doesNotMatch(hook, /syncContext\(assistant\.contextPatch\)/);
  assert.doesNotMatch(hook, /syncTimerRef/);
});

test("Live run completion requires an explicit semantic finish reason", () => {
  const route = read("./app/api/clouva-ai/live/turn/route.ts");
  assert.match(route, /if \(!isTrebolLiveEndReason\(body\.finishReason\)\)/);
  assert.match(route, /finishReason:\s*body\.finishReason/);
  assert.match(route, /const transcriptFinal = isCompletedTranscriptReason\(body\.finishReason\)/);
  assert.match(route, /metadata:\s*\{[\s\S]{0,220}transcriptFinal,[\s\S]{0,120}finishReason:\s*body\.finishReason/);
  assert.doesNotMatch(
    route,
    /body\.action === "end"[\s\S]{0,220}finishAgentRun\(\{\s*supabase,\s*run,\s*status:\s*"completed"/,
  );
});

test("unexpected Live socket closure keeps the semantic reason and stores provider diagnostics", () => {
  const route = read("./app/api/clouva-ai/live/turn/route.ts");
  const runStore = read("./lib/clouva-ai/agent/run-store.ts");
  const migration = read("./supabase/migrations/20260915233000_trebol_live_diagnostics.sql");
  assert.match(route, /case "SOCKET_CLOSED_UNEXPECTEDLY"[\s\S]{0,260}errorCode:\s*"GEMINI_LIVE_SOCKET_CLOSED"/);
  assert.match(route, /closeReason/);
  assert.match(route, /closeCode/);
  assert.match(route, /socketLifetimeMs/);
  assert.match(route, /updateAgentRunDiagnostics/);
  assert.match(runStore, /diagnostic_metadata/);
  assert.match(migration, /add column if not exists diagnostic_metadata jsonb not null default '\{\}'::jsonb/i);
  assert.doesNotMatch(migration, /audio|api[_ ]?key|access[_ ]?token|credential/i);
});

test("rate-limit storage is service-role only", () => {
  const migration = read("./supabase/migrations/20260825021000_trebol_live_rate_limit.sql");
  assert.match(migration, /revoke all on public\.trebol_live_token_limits from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant select, insert, update on public\.trebol_live_token_limits to service_role/i);
  assert.match(migration, /create policy trebol_live_token_limits_deny_user_access[\s\S]*as restrictive[\s\S]*to authenticated[\s\S]*using \(false\)[\s\S]*with check \(false\)/i);
  assert.match(migration, /grant execute on function public\.consume_trebol_live_token_limit\([\s\S]*to service_role/i);
  assert.doesNotMatch(migration, /grant execute[\s\S]*to authenticated/i);
});

test("agent audit grants minimal Data API privileges and supports Studio participants", () => {
  const migration = read("./supabase/migrations/20260825020000_trebol_agent_audit.sql");
  assert.match(migration, /grant select, insert, update on public\.ai_agent_runs to authenticated/i);
  assert.match(migration, /grant select, insert, update on public\.ai_tool_calls to authenticated/i);
  assert.match(migration, /revoke all on public\.ai_agent_runs from public, anon, authenticated, service_role/i);
  assert.match(migration, /revoke all on public\.ai_tool_calls from public, anon, authenticated, service_role/i);
  assert.doesNotMatch(migration, /grant[^;]*(?:delete|truncate)[^;]*ai_(?:agent_runs|tool_calls)/i);
  assert.match(migration, /conversation\.studio_id is null[\s\S]*conversation\.user_id = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /public\.is_active_studio_participant\([\s\S]*conversation\.studio_id[\s\S]*select auth\.uid\(\)/i);
  assert.match(migration, /agent_run\.conversation_id = ai_tool_calls\.conversation_id/i);
});
