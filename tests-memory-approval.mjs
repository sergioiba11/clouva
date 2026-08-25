import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const {
  createMemoryProposal,
  memoryDedupeKey,
  parseMemoryCandidate,
  pendingMemoryProposalView,
} = await import("./lib/clouva-ai/memory-proposals.ts");
const {
  decideMemoryProposal,
  loadEffectiveMemory,
} = await import("./lib/server/memory-approval.ts");

function fakeSupabase(plans = {}) {
  const queues = Object.fromEntries(Object.entries(plans).map(([table, responses]) => [table, [...responses]]));
  const calls = [];
  return {
    calls,
    from(table) {
      const response = queues[table]?.shift() ?? { data: null, error: null };
      const call = { table, operations: [] };
      calls.push(call);
      const builder = {
        select(...args) { call.operations.push(["select", ...args]); return builder; },
        eq(...args) { call.operations.push(["eq", ...args]); return builder; },
        is(...args) { call.operations.push(["is", ...args]); return builder; },
        contains(...args) { call.operations.push(["contains", ...args]); return builder; },
        limit(...args) { call.operations.push(["limit", ...args]); return builder; },
        order(...args) { call.operations.push(["order", ...args]); return builder; },
        insert(...args) { call.operations.push(["insert", ...args]); return builder; },
        update(...args) { call.operations.push(["update", ...args]); return builder; },
        maybeSingle() { call.operations.push(["maybeSingle"]); return Promise.resolve(response); },
        single() { call.operations.push(["single"]); return Promise.resolve(response); },
        then(resolve, reject) { return Promise.resolve(response).then(resolve, reject); },
      };
      return builder;
    },
  };
}

function candidate(overrides = {}) {
  return {
    memoryType: "architecture",
    title: "Cloud Run es el runtime productivo",
    content: "CLOUVA se despliega en Google Cloud Run y no en Railway.",
    importance: 5,
    reason: "Evita repetir una decisión de arquitectura.",
    ...overrides,
  };
}

function proposal(overrides = {}) {
  return createMemoryProposal({
    candidate: candidate(),
    userId: "user-1",
    studioId: null,
    conversationId: "conversation-1",
    sourceMessageId: "message-1",
    detectorModel: "gemini-test",
    id: "proposal-1",
    now: new Date("2026-08-09T20:00:00.000Z"),
    ...overrides,
  });
}

function messageRow(memoryProposal) {
  return {
    id: "message-1",
    conversation_id: "conversation-1",
    user_id: "user-1",
    metadata: { model: "gemini-test", memoryProposal },
  };
}

const fixedDeps = {
  now: () => new Date("2026-08-09T20:01:00.000Z"),
  authorizeStudio: async () => ({ role: "owner", studioOsActive: true, studio: { id: "studio-1" } }),
};

test("detector output becomes a bounded proposal, never a persisted memory by itself", () => {
  const parsed = parseMemoryCandidate(JSON.stringify({
    save: true,
    classification: "conversational_memory",
    memory_type: "architecture",
    title: "  Cloud Run productivo  ",
    content: " CLOUVA usa Cloud Run. ",
    importance: 9,
    reason: "Decisión durable.",
  }));
  assert.deepEqual(parsed, {
    memoryType: "architecture",
    title: "Cloud Run productivo",
    content: "CLOUVA usa Cloud Run.",
    importance: 5,
    reason: "Decisión durable.",
  });

  const created = createMemoryProposal({
    candidate: parsed,
    userId: "user-1",
    studioId: "studio-1",
    conversationId: "conversation-1",
    sourceMessageId: "message-1",
    detectorModel: "gemini-test",
    id: "proposal-1",
    now: new Date("2026-08-09T20:00:00.000Z"),
  });
  assert.equal(created.status, "pending");
  assert.equal(created.scope, "studio");
  assert.equal(created.studioId, "studio-1");
  assert.equal(created.dedupeKey, memoryDedupeKey(parsed));
  assert.equal(pendingMemoryProposalView(created, "message-1").messageId, "message-1");
});

test("structured domain data and secrets are never proposed as conversational memory", () => {
  assert.equal(parseMemoryCandidate(JSON.stringify({
    save: true,
    classification: "structured_domain",
    memory_type: "fact",
    title: "Rol del Player",
    content: "El Player tiene rol Productor.",
    importance: 3,
    reason: "Dato estructurado.",
  })), null);

  assert.equal(parseMemoryCandidate(JSON.stringify({
    save: true,
    classification: "conversational_memory",
    memory_type: "fact",
    title: "API",
    content: "api_key = abcdefghijklmnop",
    importance: 5,
    reason: "Recordar.",
  })), null);
});

test("approval promotes exactly one personal proposal into effective memory", async () => {
  const pending = proposal();
  const supabase = fakeSupabase({
    ai_messages: [
      { data: messageRow(pending), error: null },
      { data: { id: "message-1" }, error: null },
      { data: { id: "message-1" }, error: null },
    ],
    ai_conversations: [{ data: { id: "conversation-1", user_id: "user-1", studio_id: null }, error: null }],
    project_memory: [
      { data: null, error: null },
      { data: null, error: null },
      { data: { id: "memory-1" }, error: null },
    ],
  });

  const result = await decideMemoryProposal({
    supabase,
    admin: fakeSupabase(),
    userId: "user-1",
    conversationId: "conversation-1",
    messageId: "message-1",
    proposalId: "proposal-1",
    decision: "approve",
    dependencies: fixedDeps,
  });
  assert.deepEqual(result, {
    status: "approved",
    proposalId: "proposal-1",
    memoryId: "memory-1",
    duplicate: false,
    idempotent: false,
  });

  const insert = supabase.calls
    .filter((call) => call.table === "project_memory")
    .flatMap((call) => call.operations)
    .find(([operation]) => operation === "insert");
  assert.equal(insert[1].user_id, "user-1");
  assert.equal(insert[1].studio_id, null);
  assert.equal(insert[1].source_conversation_id, "conversation-1");
  assert.equal(insert[1].source_message_id, "message-1");
  assert.equal(insert[1].approved_by, "user-1");
  assert.equal(insert[1].dedupe_key, pending.dedupeKey);
});

test("rejection resolves the proposal without inserting project_memory", async () => {
  const pending = proposal();
  const supabase = fakeSupabase({
    ai_messages: [
      { data: messageRow(pending), error: null },
      { data: { id: "message-1" }, error: null },
    ],
    ai_conversations: [{ data: { id: "conversation-1", user_id: "user-1", studio_id: null }, error: null }],
  });

  const result = await decideMemoryProposal({
    supabase,
    admin: fakeSupabase(),
    userId: "user-1",
    conversationId: "conversation-1",
    messageId: "message-1",
    proposalId: "proposal-1",
    decision: "reject",
    dependencies: fixedDeps,
  });
  assert.equal(result.status, "rejected");
  assert.equal(supabase.calls.some((call) => call.table === "project_memory"), false);
  const update = supabase.calls
    .flatMap((call) => call.operations)
    .find(([operation]) => operation === "update");
  assert.equal(update[1].metadata.memoryProposal.status, "rejected");
});

test("a user cannot approve another user's proposal even in a readable Studio conversation", async () => {
  const supabase = fakeSupabase({
    ai_messages: [{ data: null, error: null }],
  });
  await assert.rejects(
    () => decideMemoryProposal({
      supabase,
      admin: fakeSupabase(),
      userId: "user-2",
      conversationId: "conversation-1",
      messageId: "message-1",
      proposalId: "proposal-1",
      decision: "approve",
      dependencies: fixedDeps,
    }),
    (error) => error.status === 404 && /otro usuario/i.test(error.message),
  );
  assert.equal(supabase.calls.some((call) => call.table === "project_memory"), false);
});

test("a proposal cannot cross from one Studio scope into another", async () => {
  const studioProposal = proposal({ studioId: "studio-1" });
  const supabase = fakeSupabase({
    ai_messages: [{ data: messageRow(studioProposal), error: null }],
    ai_conversations: [{ data: { id: "conversation-1", user_id: "user-1", studio_id: "studio-2" }, error: null }],
  });
  await assert.rejects(
    () => decideMemoryProposal({
      supabase,
      admin: fakeSupabase(),
      userId: "user-1",
      conversationId: "conversation-1",
      messageId: "message-1",
      proposalId: "proposal-1",
      decision: "approve",
      dependencies: fixedDeps,
    }),
    (error) => error.status === 409 && /scope/i.test(error.message),
  );
  assert.equal(supabase.calls.some((call) => call.table === "project_memory"), false);
});

test("Studio memory approval revalidates manager permission and stays Studio-scoped", async () => {
  const studioProposal = proposal({ studioId: "studio-1" });
  const supabase = fakeSupabase({
    ai_messages: [
      { data: messageRow(studioProposal), error: null },
      { data: { id: "message-1" }, error: null },
      { data: { id: "message-1" }, error: null },
    ],
    ai_conversations: [{ data: { id: "conversation-1", user_id: "user-1", studio_id: "studio-1" }, error: null }],
    project_memory: [
      { data: null, error: null },
      { data: null, error: null },
      { data: { id: "memory-studio" }, error: null },
    ],
  });
  const authorizations = [];
  const result = await decideMemoryProposal({
    supabase,
    admin: fakeSupabase(),
    userId: "user-1",
    conversationId: "conversation-1",
    messageId: "message-1",
    proposalId: "proposal-1",
    decision: "approve",
    dependencies: {
      ...fixedDeps,
      authorizeStudio: async (args) => {
        authorizations.push(args);
        return { role: "owner", studioOsActive: true, studio: { id: args.studioId } };
      },
    },
  });
  assert.equal(result.memoryId, "memory-studio");
  assert.equal(authorizations[0].studioId, "studio-1");
  const insert = supabase.calls
    .flatMap((call) => call.operations)
    .find(([operation]) => operation === "insert");
  assert.equal(insert[1].studio_id, "studio-1");
  assert.equal(insert[1].user_id, "user-1");
});

test("duplicate approval reuses the equivalent memory instead of inserting", async () => {
  const pending = proposal();
  const supabase = fakeSupabase({
    ai_messages: [
      { data: messageRow(pending), error: null },
      { data: { id: "message-1" }, error: null },
      { data: { id: "message-1" }, error: null },
    ],
    ai_conversations: [{ data: { id: "conversation-1", user_id: "user-1", studio_id: null }, error: null }],
    project_memory: [
      { data: null, error: null },
      { data: { id: "memory-existing" }, error: null },
    ],
  });
  const result = await decideMemoryProposal({
    supabase,
    admin: fakeSupabase(),
    userId: "user-1",
    conversationId: "conversation-1",
    messageId: "message-1",
    proposalId: "proposal-1",
    decision: "approve",
    dependencies: fixedDeps,
  });
  assert.equal(result.memoryId, "memory-existing");
  assert.equal(result.duplicate, true);
  const inserts = supabase.calls
    .flatMap((call) => call.operations)
    .filter(([operation]) => operation === "insert");
  assert.equal(inserts.length, 0);
});

test("repeating an already-approved decision is idempotent", async () => {
  const approved = { ...proposal(), status: "approved", memoryId: "memory-1", duplicate: false };
  const supabase = fakeSupabase({
    ai_messages: [{ data: messageRow(approved), error: null }],
    ai_conversations: [{ data: { id: "conversation-1", user_id: "user-1", studio_id: null }, error: null }],
  });
  const result = await decideMemoryProposal({
    supabase,
    admin: fakeSupabase(),
    userId: "user-1",
    conversationId: "conversation-1",
    messageId: "message-1",
    proposalId: "proposal-1",
    decision: "approve",
    dependencies: fixedDeps,
  });
  assert.equal(result.memoryId, "memory-1");
  assert.equal(result.idempotent, true);
  assert.equal(supabase.calls.some((call) => call.table === "project_memory"), false);
});

test("effective context reads only approved project_memory in the requested scope", async () => {
  const approvedRows = [{ id: "memory-1", title: "Aprobada", studio_id: "studio-1" }];
  const supabase = fakeSupabase({
    project_memory: [{ data: approvedRows, error: null }],
  });
  const rows = await loadEffectiveMemory({
    supabase,
    userId: "user-1",
    studioId: "studio-1",
  });
  assert.deepEqual(rows, approvedRows);
  assert.deepEqual(supabase.calls.map((call) => call.table), ["project_memory"]);
  const operations = supabase.calls[0].operations;
  assert.ok(operations.some(([operation, field, value]) => operation === "eq" && field === "status" && value === "active"));
  assert.ok(operations.some(([operation, field, value]) => operation === "eq" && field === "studio_id" && value === "studio-1"));
});

test("migration extends project_memory with scoped RLS and never creates a parallel proposal table", () => {
  const migration = fs.readFileSync(
    new URL("./supabase/migrations/20260809213731_clouva_ai_memory_approval.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /alter table public\.project_memory/i);
  assert.match(migration, /source_message_id uuid references public\.ai_messages/i);
  assert.match(migration, /project_memory_personal_dedupe_idx/i);
  assert.match(migration, /project_memory_studio_dedupe_idx/i);
  assert.match(migration, /create policy ai_messages_update[\s\S]*using[\s\S]*with check/i);
  assert.match(migration, /create policy project_memory_update[\s\S]*using[\s\S]*with check/i);
  assert.doesNotMatch(migration, /create table .*memory_proposal/i);

  const route = fs.readFileSync(new URL("./app/api/clouva-ai/chat/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /captureMemory/);
  assert.match(route, /loadEffectiveMemory/);
  assert.match(route, /pendingMemoryProposal/);
});
