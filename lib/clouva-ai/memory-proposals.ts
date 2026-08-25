import { createHash, randomUUID } from "node:crypto";
import { generateWithFallback } from "./gemini-text";

export const MEMORY_TYPES = [
  "decision", "fact", "procedure", "incident", "solution", "preference", "architecture", "goal",
] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];
export type MemoryProposalStatus = "pending" | "approving" | "approved" | "rejected";
export type MemoryScope = "user" | "studio";

export interface MemoryCandidate {
  memoryType: MemoryType;
  title: string;
  content: string;
  importance: number;
  reason: string;
}

export interface MemoryProposal {
  id: string;
  status: MemoryProposalStatus;
  scope: MemoryScope;
  userId: string;
  studioId: string | null;
  conversationId: string;
  sourceMessageId: string;
  memoryType: MemoryType;
  title: string;
  content: string;
  importance: number;
  reason: string;
  dedupeKey: string;
  proposedBy: "gemini";
  provider: "gemini";
  detectorModel: string;
  proposedAt: string;
  updatedAt?: string;
  memoryId?: string;
  duplicate?: boolean;
  error?: string;
}

export interface PendingMemoryProposalView
  extends Omit<MemoryProposal, "userId" | "dedupeKey" | "detectorModel" | "provider"> {
  messageId: string;
}

type RawCandidate = {
  save?: unknown;
  classification?: unknown;
  memory_type?: unknown;
  title?: unknown;
  content?: unknown;
  importance?: unknown;
  reason?: unknown;
};

const MAX_TITLE = 180;
const MAX_CONTENT = 4_000;
const MAX_REASON = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeFingerprintPart(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("es");
}

export function memoryDedupeKey(candidate: Pick<MemoryCandidate, "memoryType" | "title" | "content">): string {
  return createHash("sha256")
    .update([
      candidate.memoryType,
      normalizeFingerprintPart(candidate.title),
      normalizeFingerprintPart(candidate.content),
    ].join("|"))
    .digest("hex");
}

function containsSensitiveMaterial(value: string): boolean {
  return [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
    /\b(?:sk|rk|pk)_[a-z0-9_-]{16,}\b/i,
    /\bAIza[0-9A-Za-z_-]{30,}\b/,
    /\bBearer\s+[A-Za-z0-9._~+\/-]{16,}/i,
    /\b(?:password|contrase(?:ñ|n)a|api[_ -]?key|secret|token)\s*[:=]\s*\S{8,}/i,
  ].some((pattern) => pattern.test(value));
}

/** Parses Gemini's detector response as an untrusted proposal. Structured
 * domain data is deliberately discarded here: Player/Studio fields belong
 * to domain services and their confirmation gate, never project_memory. */
export function parseMemoryCandidate(rawText: string): MemoryCandidate | null {
  const cleaned = rawText.replace(/^\s*```json\s*/i, "").replace(/```\s*$/i, "").trim();
  let value: RawCandidate;
  try {
    const parsed = JSON.parse(cleaned) as unknown;
    if (!isRecord(parsed)) return null;
    value = parsed;
  } catch {
    return null;
  }

  if (value.save !== true || value.classification !== "conversational_memory") return null;
  if (typeof value.memory_type !== "string" || !MEMORY_TYPES.includes(value.memory_type as MemoryType)) return null;
  if (typeof value.title !== "string" || typeof value.content !== "string") return null;

  const title = value.title.trim().slice(0, MAX_TITLE);
  const content = value.content.trim().slice(0, MAX_CONTENT);
  const reason = typeof value.reason === "string" ? value.reason.trim().slice(0, MAX_REASON) : "";
  if (!title || !content || containsSensitiveMaterial(`${title}\n${content}`)) return null;

  const importanceValue = Number(value.importance);
  const importance = Number.isFinite(importanceValue)
    ? Math.max(1, Math.min(5, Math.round(importanceValue)))
    : 3;

  return {
    memoryType: value.memory_type as MemoryType,
    title,
    content,
    importance,
    reason,
  };
}

export async function detectMemoryCandidate(args: {
  apiKey: string;
  selectedModel: string;
  userMessage: string;
  assistantMessage: string;
  studioId: string | null;
  generate?: typeof generateWithFallback;
}): Promise<{ candidate: MemoryCandidate | null; model: string }> {
  const generate = args.generate ?? generateWithFallback;
  const instruction = `
Analizá el intercambio para decidir si corresponde PROPONER una memoria durable.
No guardes nada: sólo devolvé una propuesta para revisión humana.

Reglas:
- Sólo proponé información explícitamente confirmada por el usuario y útil en conversaciones futuras.
- No conviertas inferencias, sugerencias del asistente, saludos, datos casuales ni resúmenes del turno en memoria.
- No incluyas secretos, credenciales, tokens, claves, contraseñas ni datos sensibles.
- Si el dato es un campo estructurado de CLOUVA (Player, rol dentro de un Studio, perfil, membresía, servicio, publicación o generación), clasificá "structured_domain": esos datos se gestionan con herramientas de dominio, nunca como memoria conversacional.
- Como máximo una propuesta por turno.

Devolvé únicamente JSON válido:
{"save":boolean,"classification":"conversational_memory|structured_domain|none","memory_type":"decision|fact|procedure|incident|solution|preference|architecture|goal","title":"...","content":"...","importance":1,"reason":"..."}

Si no corresponde proponer:
{"save":false,"classification":"none","memory_type":"fact","title":"","content":"","importance":1,"reason":""}
`.trim();

  const result = await generate({
    apiKey: args.apiKey,
    selectedModel: args.selectedModel,
    instruction,
    contents: [{
      role: "user",
      parts: [{
        text: `SCOPE: ${args.studioId ? `studio:${args.studioId}` : "usuario personal"}\n\nUSUARIO:\n${args.userMessage}\n\nASISTENTE:\n${args.assistantMessage}`,
      }],
    }],
    temperature: 0,
    maxOutputTokens: 900,
  });

  return { candidate: parseMemoryCandidate(result.text), model: result.model };
}

export function createMemoryProposal(args: {
  candidate: MemoryCandidate;
  userId: string;
  studioId: string | null;
  conversationId: string;
  sourceMessageId: string;
  detectorModel: string;
  now?: Date;
  id?: string;
}): MemoryProposal {
  return {
    id: args.id ?? randomUUID(),
    status: "pending",
    scope: args.studioId ? "studio" : "user",
    userId: args.userId,
    studioId: args.studioId,
    conversationId: args.conversationId,
    sourceMessageId: args.sourceMessageId,
    memoryType: args.candidate.memoryType,
    title: args.candidate.title,
    content: args.candidate.content,
    importance: args.candidate.importance,
    reason: args.candidate.reason,
    dedupeKey: memoryDedupeKey(args.candidate),
    proposedBy: "gemini",
    provider: "gemini",
    detectorModel: args.detectorModel,
    proposedAt: (args.now ?? new Date()).toISOString(),
  };
}

export function parseMemoryProposal(value: unknown): MemoryProposal | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string"
    || !["pending", "approving", "approved", "rejected"].includes(String(value.status))
    || !["user", "studio"].includes(String(value.scope))
    || typeof value.userId !== "string"
    || !(value.studioId === null || typeof value.studioId === "string")
    || typeof value.conversationId !== "string"
    || typeof value.sourceMessageId !== "string"
    || typeof value.memoryType !== "string"
    || !MEMORY_TYPES.includes(value.memoryType as MemoryType)
    || typeof value.title !== "string"
    || typeof value.content !== "string"
    || typeof value.importance !== "number"
    || typeof value.reason !== "string"
    || typeof value.dedupeKey !== "string"
    || value.proposedBy !== "gemini"
    || value.provider !== "gemini"
    || typeof value.detectorModel !== "string"
    || typeof value.proposedAt !== "string"
  ) {
    return null;
  }
  if ((value.scope === "studio") !== Boolean(value.studioId)) return null;
  return value as unknown as MemoryProposal;
}

export function pendingMemoryProposalView(
  proposal: MemoryProposal,
  messageId: string,
): PendingMemoryProposalView | null {
  if (proposal.status !== "pending") return null;
  const { userId: _userId, dedupeKey: _dedupeKey, detectorModel: _detectorModel, provider: _provider, ...visible } = proposal;
  return { ...visible, messageId };
}
