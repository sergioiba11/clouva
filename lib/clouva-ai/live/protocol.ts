export const TREBOL_LIVE_END_REASONS = [
  "MODEL_TURN_COMPLETE",
  "CLIENT_CANCELLED",
  "SOCKET_CLOSED_UNEXPECTEDLY",
  "RECONNECT_EXHAUSTED",
] as const;

export type TrebolLiveEndReason = (typeof TREBOL_LIVE_END_REASONS)[number];

export const TREBOL_LIVE_TRANSCRIPT_REASONS = [
  "USER_TURN_COMPLETE",
  "MODEL_TURN_COMPLETE",
  "MODEL_INTERRUPTED",
  "CLIENT_CANCELLED",
  "SOCKET_CLOSED_UNEXPECTEDLY",
  "RECONNECT_EXHAUSTED",
] as const;

export type TrebolLiveTranscriptFinishReason = (typeof TREBOL_LIVE_TRANSCRIPT_REASONS)[number];

export function isTrebolLiveEndReason(value: unknown): value is TrebolLiveEndReason {
  return typeof value === "string" && (TREBOL_LIVE_END_REASONS as readonly string[]).includes(value);
}

export function isTrebolLiveTranscriptFinishReason(value: unknown): value is TrebolLiveTranscriptFinishReason {
  return typeof value === "string" && (TREBOL_LIVE_TRANSCRIPT_REASONS as readonly string[]).includes(value);
}

export function isCompletedTranscriptReason(reason: TrebolLiveTranscriptFinishReason): boolean {
  return reason === "USER_TURN_COMPLETE" || reason === "MODEL_TURN_COMPLETE";
}
