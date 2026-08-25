import type { TrebolLiveEvent, TrebolLiveState } from "./types";

export const initialTrebolLiveState: TrebolLiveState = {
  status: "idle",
  muted: false,
  reconnectAttempt: 0,
  resumptionHandle: null,
  error: null,
  errorCode: null,
};

export function reduceTrebolLiveState(
  state: TrebolLiveState,
  event: TrebolLiveEvent,
): TrebolLiveState {
  switch (event.type) {
    case "REQUEST_PERMISSION":
      return { ...state, status: "requesting_permission", error: null, errorCode: null };
    case "PERMISSION_GRANTED":
      return { ...state, status: "connecting", error: null, errorCode: null };
    case "CONNECTED":
      return { ...state, status: "connected", reconnectAttempt: 0, error: null, errorCode: null };
    case "USER_SPEECH_STARTED":
      return state.muted ? state : { ...state, status: "user_speaking" };
    case "USER_SPEECH_ENDED":
      return { ...state, status: "trebol_thinking" };
    case "MODEL_AUDIO_STARTED":
      return { ...state, status: "trebol_speaking" };
    case "MODEL_AUDIO_ENDED":
      return { ...state, status: "connected" };
    case "INTERRUPTED":
      return { ...state, status: "interrupted" };
    case "MUTE_CHANGED":
      return { ...state, muted: event.muted };
    case "RECONNECTING":
      return {
        ...state,
        status: "reconnecting",
        reconnectAttempt: state.reconnectAttempt + 1,
        resumptionHandle: event.handle ?? state.resumptionHandle,
      };
    case "RESUMED":
      return {
        ...state,
        status: "connected",
        reconnectAttempt: 0,
        resumptionHandle: event.handle ?? state.resumptionHandle,
        error: null,
        errorCode: null,
      };
    case "RESUMPTION_HANDLE":
      return { ...state, resumptionHandle: event.handle };
    case "END":
      return { ...state, status: "ending" };
    case "ENDED":
      return { ...state, status: "ended" };
    case "ERROR":
      return { ...state, status: "error", error: event.error.slice(0, 500), errorCode: event.code ?? "LIVE_CONNECTION_FAILED" };
    case "RESET":
      return initialTrebolLiveState;
    default:
      return state;
  }
}
