import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseMemoryProposal,
  type MemoryProposal,
} from "@/lib/clouva-ai/memory-proposals";
import { requireStudioManager } from "@/lib/server/studio-permissions";

type MemoryDecision = "approve" | "reject";
type MemoryDependencies = {
  authorizeStudio: typeof requireStudioManager;
  now: () => Date;
};

const DEFAULT_DEPENDENCIES: MemoryDependencies = {
  authorizeStudio: requireStudioManager,
  now: () => new Date(),
};

type MessageMetadata = Record<string, unknown> & { memoryProposal?: MemoryProposal | null };

function statusError(message: string, status: number): Error {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function findExistingMemory(
  supabase: SupabaseClient,
  proposal: MemoryProposal,
): Promise<{ id: string } | null> {
  const { data: bySource, error: sourceError } = await supabase
    .from("project_memory")
    .select("id")
    .eq("source_message_id", proposal.sourceMessageId)
    .maybeSingle();
  if (sourceError) throw new Error(sourceError.message);
  if (bySource) return bySource;

  let query = supabase
    .from("project_memory")
    .select("id")
    .eq("project_key", "clouva")
    .eq("dedupe_key", proposal.dedupeKey);
  query = proposal.studioId
    ? query.eq("studio_id", proposal.studioId)
    : query.eq("user_id", proposal.userId).is("studio_id", null);
  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function promoteProposal(
  supabase: SupabaseClient,
  proposal: MemoryProposal,
  userId: string,
  now: string,
): Promise<{ memoryId: string; duplicate: boolean }> {
  const existing = await findExistingMemory(supabase, proposal);
  if (existing) return { memoryId: existing.id, duplicate: true };

  const { data, error } = await supabase
    .from("project_memory")
    .insert({
      user_id: userId,
      studio_id: proposal.studioId,
      project_key: "clouva",
      memory_type: proposal.memoryType,
      title: proposal.title,
      content: proposal.content,
      importance: proposal.importance,
      source_conversation_id: proposal.conversationId,
      source_message_id: proposal.sourceMessageId,
      approved_by: userId,
      approved_at: now,
      dedupe_key: proposal.dedupeKey,
      status: "active",
      metadata: {
        approval_origin: "memory_proposal",
        proposal_id: proposal.id,
        proposed_by: proposal.proposedBy,
        detector_model: proposal.detectorModel,
      },
    })
    .select("id")
    .single();

  if (!error && data) return { memoryId: data.id, duplicate: false };
  if (error?.code === "23505") {
    const raced = await findExistingMemory(supabase, proposal);
    if (raced) return { memoryId: raced.id, duplicate: true };
  }
  throw new Error(error?.message ?? "No se pudo promover la memoria aprobada.");
}

export async function decideMemoryProposal(args: {
  supabase: SupabaseClient;
  admin: SupabaseClient;
  userId: string;
  conversationId: string;
  messageId: string;
  proposalId: string;
  decision: MemoryDecision;
  dependencies?: Partial<MemoryDependencies>;
}) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...args.dependencies };
  const { data: row, error: rowError } = await args.supabase
    .from("ai_messages")
    .select("id,conversation_id,user_id,metadata")
    .eq("id", args.messageId)
    .eq("conversation_id", args.conversationId)
    .eq("user_id", args.userId)
    .maybeSingle();
  if (rowError) throw new Error(rowError.message);
  if (!row) throw statusError("La propuesta no existe o pertenece a otro usuario.", 404);

  const metadata = isRecord(row.metadata) ? row.metadata as MessageMetadata : null;
  const proposal = parseMemoryProposal(metadata?.memoryProposal);
  if (!metadata || !proposal || proposal.id !== args.proposalId) {
    throw statusError("La propuesta de memoria no es válida.", 404);
  }
  if (
    proposal.userId !== args.userId
    || proposal.conversationId !== args.conversationId
    || proposal.sourceMessageId !== args.messageId
  ) {
    throw statusError("No podés decidir una propuesta de memoria ajena.", 403);
  }

  const { data: conversation, error: conversationError } = await args.supabase
    .from("ai_conversations")
    .select("id,user_id,studio_id")
    .eq("id", args.conversationId)
    .maybeSingle();
  if (conversationError) throw new Error(conversationError.message);
  if (!conversation) throw statusError("La conversación ya no está disponible.", 404);
  if (proposal.studioId !== conversation.studio_id) {
    throw statusError("El scope de la propuesta no coincide con la conversación.", 409);
  }
  if (!proposal.studioId && conversation.user_id !== args.userId) {
    throw statusError("La conversación personal pertenece a otro usuario.", 403);
  }
  if (proposal.studioId) {
    await dependencies.authorizeStudio({
      admin: args.admin,
      userId: args.userId,
      studioId: proposal.studioId,
    });
  }

  if (args.decision === "reject") {
    if (proposal.status === "rejected") {
      return { status: "rejected" as const, proposalId: proposal.id, idempotent: true };
    }
    if (proposal.status === "approved") {
      throw statusError("La memoria ya fue aprobada y no puede rechazarse desde esta propuesta.", 409);
    }
    if (proposal.status !== "pending") {
      throw statusError("La propuesta está siendo procesada.", 409);
    }

    const rejected: MemoryProposal = {
      ...proposal,
      status: "rejected",
      updatedAt: dependencies.now().toISOString(),
    };
    const { data: locked, error } = await args.supabase
      .from("ai_messages")
      .update({ metadata: { ...metadata, memoryProposal: rejected } })
      .eq("id", args.messageId)
      .contains("metadata", { memoryProposal: { id: proposal.id, status: "pending" } })
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!locked) throw statusError("La propuesta fue resuelta desde otra sesión.", 409);
    return { status: "rejected" as const, proposalId: proposal.id, idempotent: false };
  }

  if (proposal.status === "approved" && proposal.memoryId) {
    return {
      status: "approved" as const,
      proposalId: proposal.id,
      memoryId: proposal.memoryId,
      duplicate: Boolean(proposal.duplicate),
      idempotent: true,
    };
  }
  if (proposal.status === "rejected") throw statusError("La propuesta fue rechazada y no puede aprobarse.", 409);
  if (proposal.status !== "pending") throw statusError("La propuesta está siendo procesada.", 409);

  const now = dependencies.now().toISOString();
  const approving: MemoryProposal = { ...proposal, status: "approving", updatedAt: now };
  const { data: locked, error: lockError } = await args.supabase
    .from("ai_messages")
    .update({ metadata: { ...metadata, memoryProposal: approving } })
    .eq("id", args.messageId)
    .contains("metadata", { memoryProposal: { id: proposal.id, status: "pending" } })
    .select("id")
    .maybeSingle();
  if (lockError) throw new Error(lockError.message);
  if (!locked) throw statusError("La propuesta fue resuelta desde otra sesión.", 409);

  try {
    const promoted = await promoteProposal(args.supabase, proposal, args.userId, now);
    const approved: MemoryProposal = {
      ...approving,
      status: "approved",
      memoryId: promoted.memoryId,
      duplicate: promoted.duplicate,
      updatedAt: dependencies.now().toISOString(),
    };
    const { data: finalized, error: finalizeError } = await args.supabase
      .from("ai_messages")
      .update({ metadata: { ...metadata, memoryProposal: approved } })
      .eq("id", args.messageId)
      .contains("metadata", { memoryProposal: { id: proposal.id, status: "approving" } })
      .select("id")
      .maybeSingle();
    if (finalizeError) throw new Error(finalizeError.message);
    if (!finalized) throw statusError("La aprobación cambió desde otra sesión.", 409);

    return {
      status: "approved" as const,
      proposalId: proposal.id,
      memoryId: promoted.memoryId,
      duplicate: promoted.duplicate,
      idempotent: false,
    };
  } catch (error) {
    const retryable: MemoryProposal = {
      ...proposal,
      status: "pending",
      updatedAt: dependencies.now().toISOString(),
      error: error instanceof Error ? error.message.slice(0, 500) : "No se pudo promover la memoria.",
    };
    await args.supabase
      .from("ai_messages")
      .update({ metadata: { ...metadata, memoryProposal: retryable } })
      .eq("id", args.messageId)
      .contains("metadata", { memoryProposal: { id: proposal.id, status: "approving" } });
    throw error;
  }
}

/** The sole effective-memory reader used by the canonical Orchestrator.
 * Pending/rejected proposals live in ai_messages and can never enter here. */
export async function loadEffectiveMemory(args: {
  supabase: SupabaseClient;
  userId: string;
  studioId: string | null;
  limit?: number;
}) {
  let query = args.supabase
    .from("project_memory")
    .select("id,memory_type,title,content,importance,studio_id,source_conversation_id,source_message_id")
    .eq("project_key", "clouva")
    .eq("status", "active");
  query = args.studioId
    ? query.eq("studio_id", args.studioId)
    : query.eq("user_id", args.userId).is("studio_id", null);
  const { data, error } = await query
    .order("importance", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(args.limit ?? 12);
  if (error) throw new Error(error.message);
  return data ?? [];
}
