import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeAgentPayload } from "./context-builder";
import type { AgentRunRecord, AgentRunStatus, AgentTransport, TrebolRuntimeContext } from "./types";
import type { RoutedTool } from "../tool-router";
import { logTrebolEvent } from "../telemetry";

type SafeDatabaseError = { code?: string; message?: string } | null;

function isAuditMigrationPending(error: SafeDatabaseError): boolean {
  return error?.code === "42P01"
    || error?.code === "PGRST205"
    || /ai_(?:agent_runs|tool_calls).*schema cache|relation .* does not exist/i.test(error?.message ?? "");
}

function safeToolArguments(routed: RoutedTool, value: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...value };
  for (const key of Object.keys(copy)) {
    if (/^(?:content|data|dataBase64|audio|expectedSha|expectedContentHash|confirm)$/i.test(key)) {
      const raw = copy[key];
      copy[key] = typeof raw === "string" ? { redacted: true, characters: raw.length } : { redacted: true };
    }
  }
  return sanitizeAgentPayload({ tool: routed.definition.name, arguments: copy }).arguments as Record<string, unknown> ?? {};
}

function boundedResult(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return { kind: "array", count: value.length };
  if (!value || typeof value !== "object") return sanitizeAgentPayload({ value });

  const record = value as Record<string, unknown>;
  const summary: Record<string, unknown> = { keys: Object.keys(record).slice(0, 30) };
  for (const key of ["id", "status", "path", "branch", "commitSha", "jobId", "repository", "connected", "reused", "truncated", "count"]) {
    const item = record[key];
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") summary[key] = item;
  }
  for (const [key, item] of Object.entries(record)) {
    if (Array.isArray(item)) summary[`${key}Count`] = item.length;
  }
  return sanitizeAgentPayload(summary);
}

export async function startAgentRun(args: {
  supabase: SupabaseClient;
  userId: string;
  conversationId: string;
  transport: AgentTransport;
  model: string;
  context: TrebolRuntimeContext;
}): Promise<AgentRunRecord> {
  const id = randomUUID();
  const { data, error } = await args.supabase
    .from("ai_agent_runs")
    .insert({
      id,
      user_id: args.userId,
      conversation_id: args.conversationId,
      mode: args.transport,
      model: args.model,
      status: "running",
      context_snapshot: args.context,
    })
    .select("id")
    .single();

  if (!error && data) {
    logTrebolEvent("TREBOL_RUN_STARTED", { runId: data.id, conversationId: args.conversationId, transport: args.transport, model: args.model });
    return { id: data.id, persisted: true, conversationId: args.conversationId, transport: args.transport };
  }
  if (!isAuditMigrationPending(error)) throw new Error(error?.message ?? "No se pudo iniciar la auditoría del agente.");

  console.warn("Trébol audit migration is pending; continuing without ai_agent_runs persistence.");
  return { id, persisted: false, conversationId: args.conversationId, transport: args.transport };
}

export async function finishAgentRun(args: {
  supabase: SupabaseClient;
  run: AgentRunRecord;
  status: AgentRunStatus;
  errorCode?: string | null;
  errorMessage?: string | null;
}) {
  if (!args.run.persisted) return;
  const completed = args.status === "running" || args.status === "waiting_confirmation" ? null : new Date().toISOString();
  const { error } = await args.supabase
    .from("ai_agent_runs")
    .update({
      status: args.status,
      error_code: args.errorCode?.slice(0, 120) || null,
      error_message: args.errorMessage?.slice(0, 500) || null,
      completed_at: completed,
      updated_at: new Date().toISOString(),
    })
    .eq("id", args.run.id);
  if (error) throw new Error(error.message);
}

export async function requireAgentRun(args: {
  supabase: SupabaseClient;
  runId: string;
  userId: string;
  conversationId: string;
  transport?: AgentTransport;
}): Promise<AgentRunRecord> {
  const { data, error } = await args.supabase
    .from("ai_agent_runs")
    .select("id,mode,conversation_id")
    .eq("id", args.runId)
    .eq("user_id", args.userId)
    .eq("conversation_id", args.conversationId)
    .maybeSingle();
  if (!error && data) {
    if (args.transport && data.mode !== args.transport) {
      throw Object.assign(new Error("El transporte de la ejecución no coincide."), { status: 409 });
    }
    return {
      id: data.id,
      persisted: true,
      conversationId: data.conversation_id,
      transport: data.mode as AgentTransport,
    };
  }
  if (isAuditMigrationPending(error)) {
    return {
      id: args.runId,
      persisted: false,
      conversationId: args.conversationId,
      transport: args.transport ?? "live",
    };
  }
  if (error) throw new Error(error.message);
  throw Object.assign(new Error("La ejecución del agente no existe o no te pertenece."), { status: 404 });
}

export async function recordAgentToolCall(args: {
  supabase: SupabaseClient;
  run: AgentRunRecord;
  userId: string;
  routed: RoutedTool;
  toolArguments: Record<string, unknown>;
  status: "requested" | "executed" | "pending_confirmation" | "cancelled" | "failed";
  confirmation?: Record<string, unknown> | null;
  result?: unknown;
  errorMessage?: string | null;
}): Promise<string> {
  const id = randomUUID();
  if (!args.run.persisted) return id;
  logTrebolEvent("TREBOL_TOOL_REQUESTED", { runId: args.run.id, target: args.routed.executor.target, tool: args.routed.definition.name, risk: args.routed.definition.risk });
  const completed = args.status === "requested" || args.status === "pending_confirmation"
    ? null
    : new Date().toISOString();
  const { error } = await args.supabase.from("ai_tool_calls").insert({
    id,
    run_id: args.run.id,
    conversation_id: args.run.conversationId,
    user_id: args.userId,
    function_name: args.routed.functionName,
    target: args.routed.executor.target,
    tool_name: args.routed.definition.name,
    risk: args.routed.definition.risk,
    status: args.status,
    arguments: safeToolArguments(args.routed, args.toolArguments),
    confirmation: args.confirmation ? sanitizeAgentPayload(args.confirmation) : null,
    result: args.result === undefined ? null : boundedResult(args.result),
    error_message: args.errorMessage?.slice(0, 500) || null,
    completed_at: completed,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  if (args.status === "failed") logTrebolEvent("TREBOL_TOOL_FAILED", { runId: args.run.id, tool: args.routed.definition.name });
  else if (args.status === "pending_confirmation") logTrebolEvent("TREBOL_CONFIRMATION_REQUIRED", { runId: args.run.id, tool: args.routed.definition.name, risk: args.routed.definition.risk });
  else if (args.status === "executed") logTrebolEvent("TREBOL_TOOL_COMPLETED", { runId: args.run.id, tool: args.routed.definition.name });
  return id;
}
