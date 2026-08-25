export type TrebolLiveErrorCode =
  | "MIC_PERMISSION_DENIED"
  | "LIVE_TOKEN_ERROR"
  | "LIVE_CONNECTION_FAILED"
  | "LIVE_SESSION_EXPIRED"
  | "LIVE_RECONNECTING"
  | "AUDIO_CAPTURE_ERROR"
  | "AUDIO_PLAYBACK_ERROR"
  | "TOOL_FAILED"
  | "TOOL_PERMISSION_DENIED"
  | "MODEL_UNAVAILABLE";

export class TrebolLiveError extends Error {
  constructor(
    public readonly code: TrebolLiveErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "TrebolLiveError";
  }
}

export function asTrebolLiveError(
  error: unknown,
  fallback: TrebolLiveErrorCode,
  fallbackMessage: string,
): TrebolLiveError {
  if (error instanceof TrebolLiveError) return error;
  if (error instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(error.name)) {
    return new TrebolLiveError("MIC_PERMISSION_DENIED", "El navegador no concedió permiso para usar el micrófono.");
  }
  return new TrebolLiveError(fallback, error instanceof Error ? error.message : fallbackMessage);
}
