import type { RealtimeProvider, RealtimeSessionRequest } from "./types";

export class ClouvaRealtimeProvider implements RealtimeProvider {
  readonly id = "clouva" as const;

  async createSession(_request: RealtimeSessionRequest) {
    // The provider boundary is complete, but CLOUVA realtime needs a real
    // external STT/text/TTS gateway before this adapter can issue sessions.
    // Do not fake a token or silently fall back here; routing owns fallback.
    throw Object.assign(
      new Error("CLOUVA Realtime todavía no tiene un gateway STT/TTS configurado. Usá Gemini Live hasta conectar el servicio realtime de CLOUVA."),
      { status: 503, code: "PROVIDER_UNAVAILABLE" },
    );
  }
}
