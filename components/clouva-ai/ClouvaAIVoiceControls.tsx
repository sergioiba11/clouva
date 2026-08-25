"use client";

import { Mic, MicOff, PhoneOff, Radio } from "lucide-react";
import { useTrebolLiveSession } from "./useTrebolLiveSession";

const STATUS: Record<string, string> = {
  idle: "Listo para hablar",
  requesting_permission: "Esperando permiso del micrófono",
  connecting: "Conectando con Trébol",
  connected: "Escuchando",
  user_speaking: "Te escucho",
  trebol_thinking: "Trébol está pensando",
  trebol_speaking: "Trébol está hablando",
  interrupted: "Interrumpido · te escucho",
  reconnecting: "Retomando la sesión",
  ending: "Cerrando",
  ended: "Sesión finalizada",
  error: "No se pudo continuar",
};

export function ClouvaAIVoiceControls() {
  const { state, transcript, start, stop, setMuted } = useTrebolLiveSession();
  // An error can be non-fatal (for example, transcript persistence). Keep
  // the hang-up control available until the session actually closes.
  const active = !["idle", "ended"].includes(state.status);

  return (
    <section className="space-y-3 rounded-2xl border border-violet-300/15 bg-violet-500/[0.06] p-3" aria-label="Controles de voz de Trébol Live">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-violet-100"><Radio className="h-3.5 w-3.5" /> Live</p>
          <p className="mt-0.5 truncate text-[11px] text-white/50">{STATUS[state.status] ?? state.status}</p>
        </div>
        {!active ? (
          <button type="button" onClick={() => void start()} className="flex items-center gap-2 rounded-full bg-violet-500 px-3 py-2 text-xs font-semibold hover:bg-violet-400">
            <Mic className="h-4 w-4" /> Hablar
          </button>
        ) : (
          <div className="flex gap-2">
            <button type="button" onClick={() => setMuted(!state.muted)} aria-label={state.muted ? "Activar micrófono" : "Silenciar micrófono"} className="rounded-full border border-white/10 p-2 hover:bg-white/10">
              {state.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
            <button type="button" onClick={() => void stop()} aria-label="Finalizar Live" className="rounded-full bg-red-500/15 p-2 text-red-200 hover:bg-red-500/25">
              <PhoneOff className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
      {state.error ? <p className="rounded-xl bg-red-500/10 p-2 text-[11px] text-red-200">{state.errorCode ? `${state.errorCode} · ` : ""}{state.error}</p> : null}
      {transcript.user || transcript.assistant ? (
        <div className="max-h-28 space-y-1.5 overflow-y-auto text-[11px] leading-5">
          {transcript.user ? <p><span className="text-white/35">Vos:</span> {transcript.user}</p> : null}
          {transcript.assistant ? <p><span className="text-violet-300">Trébol:</span> {transcript.assistant}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
