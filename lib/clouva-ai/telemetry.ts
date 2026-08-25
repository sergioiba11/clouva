export type TrebolTelemetryEvent =
  | "TREBOL_RUN_STARTED"
  | "TREBOL_CONTEXT_UPDATED"
  | "TREBOL_TOOL_REQUESTED"
  | "TREBOL_TOOL_COMPLETED"
  | "TREBOL_TOOL_FAILED"
  | "TREBOL_CONFIRMATION_REQUIRED"
  | "TREBOL_CONFIRMATION_ACCEPTED"
  | "TREBOL_LIVE_CONNECTING"
  | "TREBOL_LIVE_CONNECTED"
  | "TREBOL_LIVE_INTERRUPTED"
  | "TREBOL_LIVE_RECONNECTING"
  | "TREBOL_LIVE_ENDED";

/** Structured, deliberately metadata-only telemetry. Never pass prompts,
 * context snapshots, arguments, audio, credentials or tokens here. */
export function logTrebolEvent(
  event: TrebolTelemetryEvent,
  fields: Record<string, string | number | boolean | null | undefined> = {},
) {
  const safeFields = Object.fromEntries(
    Object.entries(fields)
      .slice(0, 20)
      .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value) || value === null)
      .map(([key, value]) => [key.slice(0, 80), typeof value === "string" ? value.slice(0, 200) : value]),
  );
  console.info(JSON.stringify({ event, at: new Date().toISOString(), ...safeFields }));
}
