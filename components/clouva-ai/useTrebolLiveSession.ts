"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import type { PendingToolActionView } from "@/lib/clouva-ai/tool-confirmation";
import { TrebolAudioCapture } from "@/lib/clouva-ai/live/audio-capture";
import { TrebolAudioPlayback } from "@/lib/clouva-ai/live/audio-playback";
import { TrebolLiveClient } from "@/lib/clouva-ai/live/client";
import { initialTrebolLiveState, reduceTrebolLiveState } from "@/lib/clouva-ai/live/state-machine";
import { asTrebolLiveError } from "@/lib/clouva-ai/live/errors";
import { useClouvaAIAssistant } from "./ClouvaAIAssistantProvider";

export function useTrebolLiveSession() {
  const { session } = useAuth();
  const assistant = useClouvaAIAssistant();
  const [state, dispatch] = useReducer(reduceTrebolLiveState, initialTrebolLiveState);
  const [transcript, setTranscript] = useState({ user: "", assistant: "" });
  const clientRef = useRef<TrebolLiveClient | null>(null);
  const captureRef = useRef<TrebolAudioCapture | null>(null);
  const playbackRef = useRef<TrebolAudioPlayback | null>(null);
  const contextRef = useRef(assistant.context);
  const assistantRef = useRef(assistant);
  const voiceDecisionRef = useRef<string | null>(null);
  const toolDecisionNoticeRef = useRef<number | null>(null);
  const syncTimerRef = useRef<number | null>(null);
  contextRef.current = assistant.context;
  assistantRef.current = assistant;

  const stop = useCallback(async () => {
    dispatch({ type: "END" });
    if (syncTimerRef.current !== null) window.clearTimeout(syncTimerRef.current);
    syncTimerRef.current = null;
    const client = clientRef.current;
    const capture = captureRef.current;
    const playback = playbackRef.current;
    clientRef.current = null;
    captureRef.current = null;
    playbackRef.current = null;
    await Promise.all([client?.close(), capture?.stop(), playback?.stop()]);
    dispatch({ type: "ENDED" });
  }, []);

  const start = useCallback(async () => {
    if (!session?.access_token || clientRef.current) return;
    setTranscript({ user: "", assistant: "" });
    dispatch({ type: "REQUEST_PERMISSION" });

    const playback = new TrebolAudioPlayback();
    const capture = new TrebolAudioCapture((chunk) => clientRef.current?.sendAudio(chunk));
    playbackRef.current = playback;
    captureRef.current = capture;
    try {
      await playback.start().catch((error) => {
        throw asTrebolLiveError(error, "AUDIO_PLAYBACK_ERROR", "No se pudo iniciar la reproducción de audio.");
      });
      await capture.start().catch((error) => {
        throw asTrebolLiveError(error, "AUDIO_CAPTURE_ERROR", "No se pudo iniciar el micrófono.");
      });
      dispatch({ type: "PERMISSION_GRANTED" });

      const client = new TrebolLiveClient({
        accessToken: session.access_token,
        conversationId: assistant.conversationId,
        studioId: assistant.context.active.studioId,
        getContext: () => contextRef.current,
        callbacks: {
          onConnected: ({ conversationId }) => {
            assistant.setConversationId(conversationId);
            dispatch({ type: "CONNECTED" });
          },
          onAudio: (audio) => {
            playbackRef.current?.enqueue(audio);
            dispatch({ type: "MODEL_AUDIO_STARTED" });
          },
          onTurnComplete: () => dispatch({ type: "MODEL_AUDIO_ENDED" }),
          onInterrupted: () => {
            playbackRef.current?.clear();
            dispatch({ type: "INTERRUPTED" });
          },
          onTranscript: (role, text, final) => {
            setTranscript((current) => ({ ...current, [role]: text }));
            if (role === "user") dispatch({ type: final ? "USER_SPEECH_ENDED" : "USER_SPEECH_STARTED" });
            else dispatch({ type: final ? "MODEL_AUDIO_ENDED" : "MODEL_AUDIO_STARTED" });
            const pending = assistantRef.current.pendingAction;
            if (role === "user" && final && pending && voiceDecisionRef.current !== pending.id) {
              voiceDecisionRef.current = pending.id;
              void fetch("/api/clouva-ai/tools/confirm", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
                body: JSON.stringify({
                  conversationId: assistantRef.current.conversationId,
                  pendingMessageId: pending.messageId,
                  pendingActionId: pending.id,
                  transcript: text,
                }),
                cache: "no-store",
              }).then(async (response) => {
                const payload = await response.json().catch(() => ({})) as { error?: string; message?: string };
                if (!response.ok) {
                  if (response.status !== 422) throw new Error(payload.error || "No se pudo confirmar por voz.");
                  return;
                }
                assistantRef.current.setPendingAction(null);
                clientRef.current?.sendText(`[El servidor confirmó la decisión humana sobre la acción pendiente. ${payload.message ?? "La acción fue resuelta."}]`);
              }).catch((error) => {
                dispatch({ type: "ERROR", error: error instanceof Error ? error.message : "No se pudo confirmar por voz." });
              }).finally(() => {
                voiceDecisionRef.current = null;
              });
            }
          },
          onPendingAction: (action) => assistant.setPendingAction(action as PendingToolActionView),
          onReconnecting: () => dispatch({ type: "RECONNECTING" }),
          onResumptionHandle: (handle) => dispatch({ type: "RESUMPTION_HANDLE", handle }),
          onClosed: () => {
            void captureRef.current?.stop();
            void playbackRef.current?.stop();
            captureRef.current = null;
            playbackRef.current = null;
            clientRef.current = null;
            dispatch({ type: "ENDED" });
          },
          onError: (error) => {
            const typed = asTrebolLiveError(error, "LIVE_CONNECTION_FAILED", "Falló la sesión Live.");
            dispatch({ type: "ERROR", error: typed.message, code: typed.code });
          },
        },
      });
      clientRef.current = client;
      await client.connect();
    } catch (error) {
      const typed = asTrebolLiveError(error, "LIVE_CONNECTION_FAILED", "No se pudo iniciar Trébol Live.");
      dispatch({ type: "ERROR", error: typed.message, code: typed.code });
      await Promise.all([capture.stop(), playback.stop()]);
      captureRef.current = null;
      playbackRef.current = null;
      clientRef.current = null;
    }
  }, [assistant, session?.access_token]);

  const setMuted = useCallback((muted: boolean) => {
    captureRef.current?.setMuted(muted);
    clientRef.current?.setMuted(muted);
    dispatch({ type: "MUTE_CHANGED", muted });
  }, []);

  useEffect(() => {
    if (!["connected", "user_speaking", "trebol_thinking", "trebol_speaking", "interrupted"].includes(state.status)) return;
    if (!Object.keys(assistant.contextPatch).length) return;
    if (syncTimerRef.current !== null) window.clearTimeout(syncTimerRef.current);
    syncTimerRef.current = window.setTimeout(() => {
      syncTimerRef.current = null;
      clientRef.current?.syncContext(assistant.contextPatch);
    }, 500);
  }, [assistant.contextPatch, state.status]);

  useEffect(() => {
    const notice = assistant.toolDecisionNotice;
    if (!notice || toolDecisionNoticeRef.current === notice.id) return;
    toolDecisionNoticeRef.current = notice.id;
    if (!clientRef.current) return;
    clientRef.current.sendText(`[El servidor informa el resultado de una decisión humana sobre una acción pendiente. ${notice.message}]`);
  }, [assistant.toolDecisionNotice]);

  useEffect(() => () => {
    void clientRef.current?.close();
    void captureRef.current?.stop();
    void playbackRef.current?.stop();
  }, []);

  return { state, transcript, start, stop, setMuted };
}
