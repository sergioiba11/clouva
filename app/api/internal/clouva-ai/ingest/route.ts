import { NextRequest, NextResponse } from "next/server";
import { sanitizeAgentPayload } from "@/lib/clouva-ai/agent/context-builder";
import { createAdminSupabase } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 50;
const LEASE_TIMEOUT_MS = 10 * 60 * 1000;
const SUPPORTED_SCHEMA_VERSIONS = new Set([1]);

type EventRow = {
  id: string;
  user_id: string;
  studio_id: string | null;
  event_type: string;
  schema_version: number;
  entity_type: string | null;
  entity_id: string | null;
  component: string | null;
  source: string;
  scope: "private" | "studio" | "platform" | "public";
  payload: Record<string, unknown> | null;
  knowledge_eligible: boolean;
  training_eligible: boolean;
  attempts: number;
  occurred_at: string;
};

type KnowledgePayload = {
  subject_type: string;
  subject_id: string;
  predicate: string;
  value: unknown;
  is_inferred?: boolean;
  confidence?: number;
};

function authorized(request: NextRequest) {
  const expected = process.env.INTERNAL_AI_INGESTION_SECRET?.trim();
  const received = request.headers.get("x-clouva-internal-secret")?.trim();
  return Boolean(expected && received && expected === received);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseKnowledge(value: unknown): KnowledgePayload | null {
  if (!isRecord(value)) return null;
  const subjectType = typeof value.subject_type === "string" ? value.subject_type.trim() : "";
  const subjectId = typeof value.subject_id === "string" ? value.subject_id.trim() : "";
  const predicate = typeof value.predicate === "string" ? value.predicate.trim() : "";
  if (!subjectType || !subjectId || !predicate || !("value" in value)) return null;

  const confidenceValue = Number(value.confidence ?? 1);
  const confidence = Number.isFinite(confidenceValue)
    ? Math.max(0, Math.min(1, confidenceValue))
    : 1;

  return {
    subject_type: subjectType.slice(0, 120),
    subject_id: subjectId.slice(0, 240),
    predicate: predicate.slice(0, 160),
    value: value.value,
    is_inferred: value.is_inferred === true,
    confidence,
  };
}

function log(event: string, fields: Record<string, unknown>) {
  const safe = Object.fromEntries(
    Object.entries(fields)
      .slice(0, 20)
      .filter(([, value]) => value === null || ["string", "number", "boolean"].includes(typeof value))
      .map(([key, value]) => [key.slice(0, 80), typeof value === "string" ? value.slice(0, 240) : value]),
  );
  console.info(JSON.stringify({ event, at: new Date().toISOString(), ...safe }));
}

async function recoverStaleLeases(admin: ReturnType<typeof createAdminSupabase>) {
  const staleBefore = new Date(Date.now() - LEASE_TIMEOUT_MS).toISOString();
  const { error } = await admin
    .from("project_events")
    .update({
      processing_status: "failed",
      processing_started_at: null,
      last_error: "processing_lease_expired",
      processed_at: null,
    })
    .eq("processing_status", "processing")
    .lt("processing_started_at", staleBefore)
    .lt("attempts", MAX_ATTEMPTS);
  if (error) throw new Error(error.message);
}

async function claimEvent(admin: ReturnType<typeof createAdminSupabase>, event: EventRow) {
  const { data, error } = await admin
    .from("project_events")
    .update({
      processing_status: "processing",
      processing_started_at: new Date().toISOString(),
      attempts: event.attempts + 1,
      last_error: null,
    })
    .eq("id", event.id)
    .in("processing_status", ["pending", "failed"])
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data?.id);
}

async function createKnowledgeFact(admin: ReturnType<typeof createAdminSupabase>, event: EventRow) {
  if (!event.knowledge_eligible) return false;
  const knowledge = parseKnowledge(event.payload?.knowledge);
  if (!knowledge) throw new Error("knowledge_eligible requiere payload.knowledge válido.");

  const sanitized = sanitizeAgentPayload({ value: knowledge.value });
  const safeValue = "value" in sanitized ? sanitized.value : null;
  const { error } = await admin.from("ai_knowledge_facts").upsert(
    {
      source_event_id: event.id,
      user_id: event.scope === "private" ? event.user_id : null,
      studio_id: event.scope === "studio" ? event.studio_id : null,
      scope: event.scope,
      subject_type: knowledge.subject_type,
      subject_id: knowledge.subject_id,
      predicate: knowledge.predicate,
      value: safeValue === null ? { value: null } : { value: safeValue },
      is_inferred: knowledge.is_inferred === true,
      confidence: knowledge.confidence ?? 1,
      valid_from: event.occurred_at,
      metadata: {
        event_type: event.event_type,
        component: event.component,
        source: event.source,
        schema_version: event.schema_version,
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "source_event_id" },
  );
  if (error) throw new Error(error.message);
  return true;
}

async function createDatasetCandidate(admin: ReturnType<typeof createAdminSupabase>, event: EventRow) {
  if (!event.training_eligible) return false;

  const input = sanitizeAgentPayload({
    event_type: event.event_type,
    schema_version: event.schema_version,
    entity_type: event.entity_type,
    entity_id: event.entity_id,
    component: event.component,
    source: event.source,
    payload: event.payload ?? {},
  });

  const { error } = await admin.from("ai_dataset_candidates").upsert(
    {
      source_event_id: event.id,
      user_id: event.user_id,
      studio_id: event.studio_id,
      task_type: event.event_type,
      input,
      output: null,
      metadata: {
        entity_type: event.entity_type,
        entity_id: event.entity_id,
        component: event.component,
        source: event.source,
        schema_version: event.schema_version,
      },
      scope: event.scope,
      training_eligible: true,
      quality_status: "pending",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "source_event_id" },
  );
  if (error) throw new Error(error.message);
  return true;
}

async function markProcessed(admin: ReturnType<typeof createAdminSupabase>, eventId: string) {
  const now = new Date().toISOString();
  const { error } = await admin
    .from("project_events")
    .update({
      processing_status: "processed",
      processing_started_at: null,
      processed_at: now,
      last_error: null,
    })
    .eq("id", eventId)
    .eq("processing_status", "processing");
  if (error) throw new Error(error.message);
}

async function markFailed(admin: ReturnType<typeof createAdminSupabase>, eventId: string, message: string) {
  const { error } = await admin
    .from("project_events")
    .update({
      processing_status: "failed",
      processing_started_at: null,
      last_error: message.slice(0, 1000),
      processed_at: null,
    })
    .eq("id", eventId);
  if (error) console.error("CLOUVA AI ingestion could not persist failure", error);
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const admin = createAdminSupabase();
  try {
    await recoverStaleLeases(admin);
  } catch (leaseError) {
    const message = leaseError instanceof Error ? leaseError.message : "No se pudieron recuperar leases vencidos.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const { data, error } = await admin
    .from("project_events")
    .select(
      "id,user_id,studio_id,event_type,schema_version,entity_type,entity_id,component,source,scope,payload,knowledge_eligible,training_eligible,attempts,occurred_at",
    )
    .in("processing_status", ["pending", "failed"])
    .lt("attempts", MAX_ATTEMPTS)
    .order("occurred_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: Array<Record<string, unknown>> = [];
  for (const rawEvent of data ?? []) {
    const event = rawEvent as EventRow;
    let claimed = false;
    try {
      claimed = await claimEvent(admin, event);
      if (!claimed) continue;

      if (!SUPPORTED_SCHEMA_VERSIONS.has(event.schema_version)) {
        throw new Error(`schema_version ${event.schema_version} no soportado.`);
      }

      // Deterministic processing only. No model/provider call belongs here.
      const knowledgeCreated = await createKnowledgeFact(admin, event);
      const datasetCandidateCreated = await createDatasetCandidate(admin, event);
      await markProcessed(admin, event.id);

      log("CLOUVA_AI_INGESTION_PROCESSED", {
        eventId: event.id,
        eventType: event.event_type,
        knowledgeCreated,
        datasetCandidateCreated,
      });
      results.push({
        eventId: event.id,
        ok: true,
        knowledgeCreated,
        datasetCandidateCreated,
      });
    } catch (processingError) {
      const message = processingError instanceof Error ? processingError.message : "unknown";
      if (claimed) await markFailed(admin, event.id, message);
      log("CLOUVA_AI_INGESTION_FAILED", { eventId: event.id, eventType: event.event_type, error: message });
      results.push({ eventId: event.id, ok: false, error: message });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
