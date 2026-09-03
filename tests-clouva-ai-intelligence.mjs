import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "./supabase/migrations/20260831220000_clouva_ai_intelligence_pipeline.sql",
  import.meta.url,
);
const graphMigrationPath = new URL(
  "./supabase/migrations/20260903104616_clouva_ai_knowledge_graph.sql",
  import.meta.url,
);
const graphConstraintsPath = new URL(
  "./supabase/migrations/20260903105004_clouva_ai_knowledge_graph_constraints.sql",
  import.meta.url,
);
const ingestionPath = new URL("./app/api/internal/clouva-ai/ingest/route.ts", import.meta.url);
const memoryPath = new URL("./lib/clouva-ai/memory-proposals.ts", import.meta.url);
const contextServicePath = new URL("./lib/clouva-ai/knowledge/context-service.ts", import.meta.url);
const knowledgeExecutorPath = new URL("./lib/clouva-ai/knowledge-executor.ts", import.meta.url);
const toolServicePath = new URL("./lib/clouva-ai/agent/tool-service.ts", import.meta.url);
const debugPanelPath = new URL("./components/clouva-ai/KnowledgeDebugPanel.tsx", import.meta.url);

const [
  migration,
  graphMigration,
  graphConstraints,
  ingestion,
  memoryProposals,
  contextService,
  knowledgeExecutor,
  toolService,
  debugPanel,
] = await Promise.all([
  readFile(migrationPath, "utf8"),
  readFile(graphMigrationPath, "utf8"),
  readFile(graphConstraintsPath, "utf8"),
  readFile(ingestionPath, "utf8"),
  readFile(memoryPath, "utf8"),
  readFile(contextServicePath, "utf8"),
  readFile(knowledgeExecutorPath, "utf8"),
  readFile(toolServicePath, "utf8"),
  readFile(debugPanelPath, "utf8"),
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

test("persistent knowledge graph extends the existing intelligence architecture", () => {
  assert.match(graphMigration, /create table if not exists public\.ai_knowledge_entities/i);
  assert.match(graphMigration, /create table if not exists public\.ai_knowledge_relations/i);
  assert.match(graphMigration, /create table if not exists public\.ai_knowledge_procedures/i);
  assert.match(graphMigration, /create table if not exists public\.ai_core_knowledge/i);
  assert.match(graphMigration, /canonical_source_table text/i);
  assert.match(graphMigration, /canonical_source_id text/i);
  assert.match(graphMigration, /source in \('user','database','system','tool','github','calendar','external_api','ai_inferred'\)/i);
  assert.match(graphMigration, /alter table public\.ai_knowledge_entities enable row level security/i);
  assert.match(graphMigration, /revoke all on public\.ai_knowledge_entities from public, anon, authenticated/i);
});

test("canonical domain changes synchronize graph references without copying live money or stock", () => {
  assert.match(graphMigration, /create trigger clouva_knowledge_sync/i);
  assert.match(graphMigration, /'players','studios','flow_projects','creator_3d_assets','flow_music_tracks'/i);
  assert.match(graphMigration, /'commerce_spots','commerce_products','agenda_events'/i);
  const syncSection = graphMigration.slice(
    graphMigration.indexOf("create or replace function public.clouva_sync_knowledge_entity_trigger"),
    graphMigration.indexOf("create or replace function public.clouva_archive_knowledge_entity_trigger"),
  );
  assert.doesNotMatch(syncSection, /'stock'|'price'|'balance'|'saldo'/i);
  assert.match(graphConstraints, /'belongs_to'/i);
});

test("context resolver is caller-scoped and keeps live data in canonical tables", () => {
  assert.match(graphMigration, /create or replace function public\.clouva_resolve_knowledge_context/i);
  assert.match(graphMigration, /v_auth_uid uuid := auth\.uid\(\)/i);
  assert.match(graphMigration, /Knowledge context access denied/i);
  assert.match(graphMigration, /is_active_studio_participant/i);
  assert.match(graphMigration, /from public\.agenda_events/i);
  assert.match(graphMigration, /from public\.commerce_products/i);
  assert.match(graphMigration, /Live Data comes directly from canonical tables/i);
  assert.match(graphMigration, /ai\.knowledge\.context\.v1/i);
  assert.match(graphMigration, /create trigger clouva_ai_knowledge_context/i);
});

test("getClouvaContext composes graph, approved memory and recent events selectively", () => {
  assert.match(contextService, /export async function getClouvaContext/i);
  assert.match(contextService, /loadEffectiveMemory/i);
  assert.match(contextService, /clouva_resolve_knowledge_context/i);
  assert.match(contextService, /project_events/i);
  assert.match(contextService, /requiredScopes/i);
  assert.match(contextService, /sourceOfTruth/i);
});

test("knowledge.context is registered in the single Tool Router", () => {
  assert.match(knowledgeExecutor, /name: "knowledge\.context"/i);
  assert.match(knowledgeExecutor, /risk: "read"/i);
  assert.match(knowledgeExecutor, /getClouvaContext/i);
  assert.match(toolService, /new KnowledgeExecutor\(/i);
  assert.doesNotMatch(knowledgeExecutor, /new ToolRouter/i);
});

test("admin-only UI can inspect the exact context layers used by CLOUVA AI", () => {
  assert.match(debugPanel, /clouva_control_is_admin/i);
  assert.match(debugPanel, /Contexto usado/i);
  assert.match(debugPanel, /Entidades/i);
  assert.match(debugPanel, /Memorias/i);
  assert.match(debugPanel, /Procedimientos/i);
  assert.match(debugPanel, /Relaciones/i);
  assert.match(debugPanel, /Live Data/i);
});

test("platform procedure identity treats NULL owner and Studio as canonical", () => {
  assert.match(graphConstraints, /unique nulls not distinct \(procedure_key, owner_user_id, studio_id\)/i);
});
