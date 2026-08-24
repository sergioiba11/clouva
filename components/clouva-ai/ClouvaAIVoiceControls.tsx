"use client";

import { Loader2, Mic, MicOff, Radio, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import { CLOUVA_AI_START_VOICE_EVENT } from "@/lib/clouva-ai/engine-router";
import styles from "./ClouvaAIVoiceControls.module.css";

const LIVE_WS_ENDPOINT = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";
const INPUT_SAMPLE_RATE = 16_000;
const OUTPUT_SAMPLE_RATE = 24_000;
const PROCESSOR_SIZE = 4096;
const MAX_RECONNECT_ATTEMPTS = 2;

export type ClouvaAIVoiceState = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error";

export type ClouvaAIVoiceTurn = {
  conversationId: string;
  userText: string;
  assistantText: string;
  model: string;
};

type VoiceSessionPayload = {
  ok: true;
  conversationId: string;
  model: string;
  token: string;
  expiresAt?: string;
};

type LiveServerMessage = {
  setupComplete?: Record<string, never>;
  serverContent?: {
    modelTurn?: {
      parts?: Array<{
        inlineData?: { data?: string; mimeType?: string };
        inline_data?: { data?: string; mime_type?: string };
      }>;
    };
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    input_transcription?: { text?: string };
    output_transcription?: { text?: string };
    turnComplete?: boolean;
    turn_complete?: boolean;
    interrupted?: boolean;
  };
  goAway?: { timeLeft?: string };
  go_away?: { time_left?: string };
};

type Props = {
  conversationId: string | null;
  disabled?: boolean;
  onConversationReady?: (conversationId: string) => void | Promise<void>;
  onTurn?: (turn: ClouvaAIVoiceTurn) => void;
  onError?: (message: string) => void;
};

function mergeTranscript(current: string, incoming: string | undefined) {
  const next = incoming?.replace(/\s+/g, " ").trim() ?? "";
  if (!next) return current;
  if (!current) return next;
  if (next.startsWith(current)) return next;
  if (current.endsWith(next)) return current;
  if (current.includes(next)) return current;
  return `${current} ${next}`.replace(/\s+/g, " ").trim();
}

function resample(input: Float32Array, inputRate: number, outputRate = INPUT_SAMPLE_RATE) {
  if (inputRate === outputRate) return input;
  const ratio = inputRate / outputRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, input.length - 1);
    const fraction = position - left;
    output[index] = input[left] * (1 - fraction) + input[right] * fraction;
  }
  return output;
}

function floatToPcmBase64(input: Float32Array) {
  const bytes = new Uint8Array(input.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return window.btoa(binary);
}

function base64ToFloat32(data: string) {
  const binary = window.atob(data);
  const length = Math.floor(binary.length / 2);
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const low = binary.charCodeAt(index * 2);
    const high = binary.charCodeAt(index * 2 + 1);
    let value = (high << 8) | low;
    if (value >= 0x8000) value -= 0x10000;
    output[index] = value / 0x8000;
  }
  return output;
}

function statusCopy(state: ClouvaAIVoiceState) {
  if (state === "connecting") return "Conectando voz…";
  if (state === "listening") return "Te escucho";
  if (state === "thinking") return "Pensando…";
  if (state === "speaking") return "Trébol hablando";
  if (state === "error") return "Error de voz";
  return "Hablar con Trébol";
}

export function ClouvaAIVoiceControls({ conversationId, disabled = false, onConversationReady, onTurn, onError }: Props) {
  const [voiceState, setVoiceState] = useState<ClouvaAIVoiceState>("idle");
  const socketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const playbackSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextPlaybackTimeRef = useRef(0);
  const activeRef = useRef(false);
  const manualCloseRef = useRef(false);
  const readyRef = useRef(false);
  const currentConversationRef = useRef<string | null>(conversationId);
  const modelRef = useRef("gemini-3.1-flash-live-preview");
  const userTranscriptRef = useRef("");
  const assistantTranscriptRef = useRef("");
  const finalizeTimerRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const startHandlerRef = useRef<() => void>(() => undefined);

  function updateState(next: ClouvaAIVoiceState) {
    setVoiceState(next);
  }

  function clearFinalizeTimer() {
    if (finalizeTimerRef.current !== null) {
      window.clearTimeout(finalizeTimerRef.current);
      finalizeTimerRef.current = null;
    }
  }

  function clearReconnectTimer() {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }

  function stopPlayback() {
    for (const source of playbackSourcesRef.current) {
      try { source.stop(); } catch { /* already stopped */ }
    }
    playbackSourcesRef.current.clear();
    nextPlaybackTimeRef.current = outputContextRef.current?.currentTime ?? 0;
  }

  async function playPcmChunk(data: string) {
    if (!data) return;
    let context = outputContextRef.current;
    if (!context || context.state === "closed") {
      context = new AudioContext();
      outputContextRef.current = context;
    }
    if (context.state === "suspended") await context.resume();

    const samples = base64ToFloat32(data);
    if (!samples.length) return;
    const audioBuffer = context.createBuffer(1, samples.length, OUTPUT_SAMPLE_RATE);
    audioBuffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(context.destination);
    playbackSourcesRef.current.add(source);
    source.onended = () => playbackSourcesRef.current.delete(source);
    const startAt = Math.max(context.currentTime + 0.01, nextPlaybackTimeRef.current);
    source.start(startAt);
    nextPlaybackTimeRef.current = startAt + audioBuffer.duration;
    updateState("speaking");
  }

  function stopMicrophone() {
    processorRef.current?.disconnect();
    inputSourceRef.current?.disconnect();
    silentGainRef.current?.disconnect();
    processorRef.current = null;
    inputSourceRef.current = null;
    silentGainRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const context = inputContextRef.current;
    inputContextRef.current = null;
    if (context && context.state !== "closed") void context.close();
  }

  async function startMicrophone() {
    if (streamRef.current) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
      video: false,
    });
    streamRef.current = stream;

    const context = new AudioContext();
    inputContextRef.current = context;
    if (context.state === "suspended") await context.resume();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(PROCESSOR_SIZE, 1, 1);
    const silentGain = context.createGain();
    silentGain.gain.value = 0;
    inputSourceRef.current = source;
    processorRef.current = processor;
    silentGainRef.current = silentGain;

    processor.onaudioprocess = (event) => {
      const socket = socketRef.current;
      if (!activeRef.current || !readyRef.current || !socket || socket.readyState !== WebSocket.OPEN) return;
      const input = event.inputBuffer.getChannelData(0);
      let rmsTotal = 0;
      for (let index = 0; index < input.length; index += 1) rmsTotal += input[index] * input[index];
      const rms = Math.sqrt(rmsTotal / input.length);
      if (rms > 0.04 && playbackSourcesRef.current.size) stopPlayback();
      const pcm = resample(input, context.sampleRate, INPUT_SAMPLE_RATE);
      socket.send(JSON.stringify({
        realtimeInput: {
          audio: {
            data: floatToPcmBase64(pcm),
            mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}`,
          },
        },
      }));
    };

    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(context.destination);
    updateState("listening");
  }

  async function persistTurn() {
    clearFinalizeTimer();
    const activeConversationId = currentConversationRef.current;
    const userText = userTranscriptRef.current.trim();
    const assistantText = assistantTranscriptRef.current.trim();
    if (!activeConversationId || (!userText && !assistantText)) return;

    userTranscriptRef.current = "";
    assistantTranscriptRef.current = "";
    try {
      const response = await authenticatedFetch("/api/clouva-ai/voice/turn", {
        method: "POST",
        body: JSON.stringify({
          conversationId: activeConversationId,
          projectKey: "clouva",
          userText,
          assistantText,
          model: modelRef.current,
        }),
      });
      await readApiJson<{ ok: true }>(response);
      onTurn?.({ conversationId: activeConversationId, userText, assistantText, model: modelRef.current });
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo guardar la transcripción de voz.";
      onError?.(message);
    }
  }

  function schedulePersistTurn() {
    clearFinalizeTimer();
    finalizeTimerRef.current = window.setTimeout(() => void persistTurn(), 280);
  }

  function handleServerMessage(raw: string) {
    let message: LiveServerMessage;
    try {
      message = JSON.parse(raw) as LiveServerMessage;
    } catch {
      return;
    }

    if (message.setupComplete) {
      readyRef.current = true;
      reconnectAttemptsRef.current = 0;
      void startMicrophone().catch((error) => fail(error));
      return;
    }

    const content = message.serverContent;
    if (content) {
      const inputText = content.inputTranscription?.text ?? content.input_transcription?.text;
      const outputText = content.outputTranscription?.text ?? content.output_transcription?.text;
      if (inputText) {
        userTranscriptRef.current = mergeTranscript(userTranscriptRef.current, inputText);
        if (!playbackSourcesRef.current.size) updateState("thinking");
        if (finalizeTimerRef.current !== null) schedulePersistTurn();
      }
      if (outputText) {
        assistantTranscriptRef.current = mergeTranscript(assistantTranscriptRef.current, outputText);
        if (finalizeTimerRef.current !== null) schedulePersistTurn();
      }
      if (content.interrupted) {
        stopPlayback();
        updateState("listening");
      }

      for (const part of content.modelTurn?.parts ?? []) {
        const inlineData = part.inlineData ?? (part.inline_data ? { data: part.inline_data.data, mimeType: part.inline_data.mime_type } : undefined);
        if (inlineData?.data && (inlineData.mimeType ?? "").startsWith("audio/")) {
          void playPcmChunk(inlineData.data).catch((error) => fail(error));
        }
      }

      if (content.turnComplete || content.turn_complete) {
        schedulePersistTurn();
        if (!playbackSourcesRef.current.size) updateState("listening");
      }
    }

    if (message.goAway || message.go_away) socketRef.current?.close(1012, "Gemini Live pidió reconexión");
  }

  async function provisionAndConnect(requestedConversationId: string | null) {
    if (!activeRef.current) return;
    updateState("connecting");
    readyRef.current = false;
    const response = await authenticatedFetch("/api/clouva-ai/voice/session", {
      method: "POST",
      body: JSON.stringify({ conversationId: requestedConversationId, projectKey: "clouva" }),
    });
    const session = await readApiJson<VoiceSessionPayload>(response);
    currentConversationRef.current = session.conversationId;
    modelRef.current = session.model;
    await onConversationReady?.(session.conversationId);
    if (!activeRef.current) return;

    const socket = new WebSocket(`${LIVE_WS_ENDPOINT}?access_token=${encodeURIComponent(session.token)}`);
    socketRef.current = socket;
    socket.onopen = () => {
      console.info("AI_VOICE_CONNECTED", { conversationId: session.conversationId, model: session.model });
      socket.send(JSON.stringify({
        setup: {
          model: `models/${session.model}`,
          generationConfig: { responseModalities: ["AUDIO"] },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      }));
    };
    socket.onmessage = (event) => {
      if (typeof event.data === "string") handleServerMessage(event.data);
    };
    socket.onerror = () => {
      if (activeRef.current) updateState("connecting");
    };
    socket.onclose = () => {
      readyRef.current = false;
      console.info("AI_VOICE_DISCONNECTED", { conversationId: currentConversationRef.current });
      if (!activeRef.current || manualCloseRef.current) return;
      if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        fail(new Error("La sesión de voz se desconectó. Tocá el micrófono para volver a iniciar."));
        return;
      }
      reconnectAttemptsRef.current += 1;
      updateState("connecting");
      clearReconnectTimer();
      reconnectTimerRef.current = window.setTimeout(() => {
        void provisionAndConnect(currentConversationRef.current).catch((error) => fail(error));
      }, 650);
    };
  }

  function fail(error: unknown) {
    const message = error instanceof Error ? error.message : "No se pudo usar la voz en tiempo real.";
    manualCloseRef.current = true;
    activeRef.current = false;
    readyRef.current = false;
    clearReconnectTimer();
    clearFinalizeTimer();
    stopMicrophone();
    stopPlayback();
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1011, "CLOUVA voice error");
    updateState("error");
    onError?.(message);
  }

  async function start() {
    if (disabled || activeRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof WebSocket === "undefined" || typeof AudioContext === "undefined") {
      fail(new Error("Este navegador no tiene las APIs de audio necesarias para conversación en tiempo real."));
      return;
    }
    manualCloseRef.current = false;
    activeRef.current = true;
    reconnectAttemptsRef.current = 0;
    userTranscriptRef.current = "";
    assistantTranscriptRef.current = "";
    try {
      let outputContext = outputContextRef.current;
      if (!outputContext || outputContext.state === "closed") {
        outputContext = new AudioContext();
        outputContextRef.current = outputContext;
      }
      if (outputContext.state === "suspended") await outputContext.resume();
      await provisionAndConnect(conversationId);
    } catch (error) {
      fail(error);
    }
  }

  async function stop() {
    if (!activeRef.current && voiceState === "idle") return;
    manualCloseRef.current = true;
    activeRef.current = false;
    clearReconnectTimer();
    clearFinalizeTimer();
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      try { socket.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } })); } catch { /* socket is closing */ }
    }
    socketRef.current = null;
    readyRef.current = false;
    stopMicrophone();
    stopPlayback();
    await persistTurn();
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "CLOUVA voice closed");
    const outputContext = outputContextRef.current;
    outputContextRef.current = null;
    if (outputContext && outputContext.state !== "closed") await outputContext.close();
    updateState("idle");
  }

  startHandlerRef.current = () => {
    if (!activeRef.current) void start();
  };

  useEffect(() => {
    const handler = () => startHandlerRef.current();
    window.addEventListener(CLOUVA_AI_START_VOICE_EVENT, handler);
    return () => window.removeEventListener(CLOUVA_AI_START_VOICE_EVENT, handler);
  }, []);

  useEffect(() => {
    if (activeRef.current && conversationId !== currentConversationRef.current) {
      void stop();
      return;
    }
    currentConversationRef.current = conversationId;
    // stop is intentionally driven only by an external conversation switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => () => {
    manualCloseRef.current = true;
    activeRef.current = false;
    clearReconnectTimer();
    clearFinalizeTimer();
    stopMicrophone();
    stopPlayback();
    socketRef.current?.close();
    socketRef.current = null;
    const outputContext = outputContextRef.current;
    if (outputContext && outputContext.state !== "closed") void outputContext.close();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = voiceState !== "idle" && voiceState !== "error";

  return (
    <span className={`${styles.voiceControl} ${styles[voiceState]}`}>
      <button
        type="button"
        className={styles.voiceButton}
        onClick={() => void (active ? stop() : start())}
        disabled={disabled || voiceState === "connecting"}
        aria-label={active ? "Detener conversación por voz" : "Iniciar conversación por voz con Trébol"}
        title={active ? "Detener conversación por voz" : "Hablar con Trébol"}
      >
        {voiceState === "connecting" ? <Loader2 size={14} className={styles.spin} /> : active ? <MicOff size={14} /> : <Mic size={14} />}
        <span>{active ? "Detener voz" : "Voz"}</span>
      </button>
      {voiceState !== "idle" ? (
        <span className={styles.voiceStatus} aria-live="polite">
          {voiceState === "speaking" ? <Volume2 size={12} /> : voiceState === "listening" ? <Radio size={12} /> : voiceState === "error" ? <MicOff size={12} /> : <Loader2 size={12} className={voiceState === "connecting" || voiceState === "thinking" ? styles.spin : undefined} />}
          {statusCopy(voiceState)}
        </span>
      ) : null}
    </span>
  );
}
