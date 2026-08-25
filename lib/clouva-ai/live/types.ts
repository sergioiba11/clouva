import type { TrebolLiveErrorCode } from "./errors";

export type TrebolLiveStatus =
  | "idle"
  | "requesting_permission"
  | "connecting"
  | "connected"
  | "user_speaking"
  | "trebol_thinking"
  | "trebol_speaking"
  | "interrupted"
  | "reconnecting"
  | "ending"
  | "ended"
  | "error";

export type TrebolLiveState = {
  status: TrebolLiveStatus;
  muted: boolean;
  reconnectAttempt: number;
  resumptionHandle: string | null;
  error: string | null;
  errorCode: TrebolLiveErrorCode | null;
};

export type TrebolLiveEvent =
  | { type: "REQUEST_PERMISSION" }
  | { type: "PERMISSION_GRANTED" }
  | { type: "CONNECTED" }
  | { type: "USER_SPEECH_STARTED" }
  | { type: "USER_SPEECH_ENDED" }
  | { type: "MODEL_AUDIO_STARTED" }
  | { type: "MODEL_AUDIO_ENDED" }
  | { type: "INTERRUPTED" }
  | { type: "MUTE_CHANGED"; muted: boolean }
  | { type: "RECONNECTING"; handle?: string | null }
  | { type: "RESUMED"; handle?: string | null }
  | { type: "RESUMPTION_HANDLE"; handle: string }
  | { type: "END" }
  | { type: "ENDED" }
  | { type: "ERROR"; error: string; code?: TrebolLiveErrorCode }
  | { type: "RESET" };
