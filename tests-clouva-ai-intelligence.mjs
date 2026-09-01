import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "./supabase/migrations/20260831220000_clouva_ai_intelligence_pipeline.sql",
  import.meta.url,
);
const ingestionPath = new URL("./app/api/internal/clouva-ai/ingest/route.ts", import.meta.url);
const memoryPath = new URL("./lib/clouva-ai/memory-proposals.ts", import.meta.url);

const [migration, ingestion, memoryProposals] = await Promise.all([
  readFile(migrationPath, "utf8"),
  readFile(ingestionPath, "utf8"),
  readFile(memoryPath, "utf8"),
]);

test("project_events evolves into a versioned idempotent outbox", () => {
  assert.match(migration, /add column if not exists schema_version integer not null default 1/i);
  assert.match(migration, /idempotency_key text/i);
  assert.match(migration, /project_events_user_idempotency_idx/i);
  assert.match(migration, /processing_status text not null default 'pending'/i);
  assert.match(migration, /context_eligible boolean not null default true/i);
  assert.match(migration, /knowledge_eligible boolean not null default false/i);
  assert.match(migration, /training_eligible boolean not null default false/i);
});

test("onboarding and Player mutations emit versioned domain events", () => {
  assert.match(migration, /profile\.mode\.activated\.v1/);
  assert.match(migration, /player\.created\.v1/);
  assert.match(migration, /player\.identity\.updated\.v1/);
  assert.match(migration, /player\.published\.v1/);
  assert.match(migration, /player\.unpublished\.v1/);
  assert.match(migration, /create trigger clouva_profile_mode_event/i);
  assert.match(migration, /create trigger clouva_player_event/i);
});

test("CLOUVA AI resolves current canonical personal context without project_memory", () => {
  assert.match(migration, /ai\.context\.resolved\.v1/);
  assert.match(migration, /from public\.profile_modes pm/i);
  assert.match(migration, /from public\.players p/i);
  assert.match(migration, /professional_categories/);
  assert.match(migration, /create trigger clouva_ai_context_snapshot/i);
  assert.doesNotMatch(migration, /insert\s+into\s+public\.project_memory/i);
});

test("structured Player and Studio data remains excluded from conversational memory", () => {
  assert.match(memoryProposals, /structured_domain/);
  assert.match(memoryProposals, /Player\/Studio fields belong\s*\n?\s*\*?\s*to domain services/i);
});

test("Dataset Manager core exists but does not auto-train", () => {
  assert.match(migration, /create table if not exists public\.ai_dataset_candidates/i);
  assert.match(migration, /create table if not exists public\.ai_datasets/i);
  assert.match(migration, /create table if not exists public\.ai_dataset_versions/i);
  assert.match(migration, /create table if not exists public\.ai_dataset_examples/i);
  assert.match(ingestion, /if \(!event\.training_eligible\) return false/);
  assert.match(ingestion, /quality_status: "pending"/);
  assert.doesNotMatch(ingestion, /gemini|generateWithFallback|streamGemini/i);
});

test("ingestion is internal, retryable and schema-version guarded", () => {
  assert.match(ingestion, /INTERNAL_AI_INGESTION_SECRET/);
  assert.match(ingestion, /SUPPORTED_SCHEMA_VERSIONS = new Set\(\[1\]\)/);
  assert.match(ingestion, /MAX_ATTEMPTS = 5/);
  assert.match(ingestion, /processing_status: "processing"/);
  assert.match(ingestion, /processing_status: "processed"/);
  assert.match(ingestion, /processing_status: "failed"/);
  assert.match(ingestion, /sanitizeAgentPayload/);
});

test("authenticated users cannot curate or process intelligence assets directly", () => {
  assert.match(migration, /revoke update, delete on public\.project_events from authenticated/i);
  assert.match(migration, /training_eligible = false/i);
  assert.match(migration, /knowledge_eligible = false/i);
  assert.match(migration, /revoke all on public\.ai_dataset_candidates from public, anon, authenticated/i);
  assert.match(migration, /revoke all on public\.ai_knowledge_facts from public, anon, authenticated/i);
});
