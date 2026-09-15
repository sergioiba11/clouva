"use client";

import { Pause, Play, RotateCcw } from "lucide-react";
import { useRadio } from "@/components/radio/RadioProvider";

function statusLabel(status: ReturnType<typeof useRadio>["status"]) {
  if (status === "LIVE") return "LIVE";
  if (status === "CONNECTING") return "CONECTANDO SEÑAL";
  if (status === "ERROR") return "NO SE PUDO CONECTAR";
  if (status === "OFFLINE") return "SIN TRANSMISIÓN";
  return "SEÑAL LISTA";
}

export function ProfileRadioHome() {
  const { station, status, hasStream, isPlaying, metadata, togglePlay, retry } = useRadio();

  return (
    <section className="mx-auto flex min-h-[72vh] w-full max-w-6xl flex-col justify-center px-4 pb-36 pt-12 sm:px-6 lg:px-8">
      <div className="max-w-3xl">
        <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.34em] text-cyan-100/55">RADIO PÚBLICA · CLOUVA</p>
        <h1 className="text-balance text-5xl font-black uppercase tracking-[-0.055em] text-white sm:text-7xl lg:text-8xl">
          {station.name}
        </h1>
        {station.tagline ? (
          <p className="mt-5 max-w-2xl text-sm uppercase tracking-[0.18em] text-cyan-50/55 sm:text-base">{station.tagline}</p>
        ) : null}

        <div className="mt-9 flex flex-wrap items-center gap-3">
          <span className="rounded-full border border-cyan-100/15 bg-black/25 px-4 py-2 text-[10px] font-black tracking-[0.18em] text-cyan-50/75">
            {statusLabel(status)}
          </span>
          {hasStream ? (
            <button
              type="button"
              onClick={() => void togglePlay()}
              className="inline-flex min-h-12 items-center gap-2 rounded-full bg-white px-5 text-xs font-black uppercase tracking-[0.14em] text-black transition hover:scale-[1.02]"
            >
              {isPlaying ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
              {isPlaying ? "Pausar" : "Escuchar"}
            </button>
          ) : null}
          {status === "ERROR" ? (
            <button
              type="button"
              onClick={() => void retry()}
              className="inline-flex min-h-12 items-center gap-2 rounded-full border border-white/15 px-5 text-xs font-black uppercase tracking-[0.14em] text-white"
            >
              <RotateCcw size={16} /> Reintentar
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-14 grid gap-4 md:grid-cols-2">
        <article className="rounded-[28px] border border-white/10 bg-black/25 p-6 backdrop-blur-xl">
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-cyan-100/45">AHORA AL AIRE</p>
          <h2 className="mt-3 text-2xl font-black text-white">{metadata.title || station.name}</h2>
          <p className="mt-2 text-sm text-white/55">
            {[metadata.artist, metadata.program].filter(Boolean).join(" · ")}
          </p>
          {metadata.host ? <p className="mt-2 text-xs uppercase tracking-[0.16em] text-white/35">HOST · {metadata.host}</p> : null}
        </article>

        <article className="rounded-[28px] border border-white/10 bg-black/25 p-6 backdrop-blur-xl">
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-cyan-100/45">SEÑAL</p>
          <p className="mt-3 text-lg font-bold text-white">
            {hasStream ? "La señal está disponible. Tocá Escuchar para entrar a la frecuencia." : "La radio todavía no está transmitiendo."}
          </p>
          <p className="mt-3 text-sm text-white/45">La reproducción y el estado se basan en la señal real; no se muestran oyentes ni programación inventada.</p>
        </article>
      </div>
    </section>
  );
}
