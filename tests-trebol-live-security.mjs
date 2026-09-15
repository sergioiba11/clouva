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
  const clientHook = read("./components/clouva-ai/useTrebolLiveSession.ts");
  assert.match(capture, /targetSampleRate:\s*16_000/);
  assert.match(playback, /inputSampleRate:\s*24_000/);
  assert.doesNotMatch(`${capture}\n${playback}`, /MediaRecorder|ScriptProcessorNode/);
  assert.match(clientHook, /onInterrupted:[\s\S]*playbackRef\.current\?\.clear\(\)/);
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
