export type VoiceToolDecision = "confirm" | "cancel";

/**
 * Voice confirmation is intentionally an exact allowlist, never an intent
 * classifier. Extra words, hedging and conversational "sí" stay ambiguous.
 */
export function normalizeVoiceToolDecision(
  value: string,
  explicit: boolean,
): VoiceToolDecision | null {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const cancellations = new Set([
    "cancelar",
    "cancelo la accion",
    "cancelar la accion",
    "no ejecutar",
    "no ejecutes",
    "rechazo el cambio",
  ]);
  if (cancellations.has(normalized)) return "cancel";
  const confirmations = explicit
    ? new Set(["confirmo la accion sensible", "confirmo la ejecucion", "si confirmo la accion sensible"])
    : new Set(["confirmo", "si confirmo", "confirmo el cambio", "confirmo la accion", "ejecutar el cambio"]);
  return confirmations.has(normalized) ? "confirm" : null;
}
