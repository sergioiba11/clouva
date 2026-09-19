"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Map, Server } from "lucide-react";

const JAVA_ADDRESS = "35.198.44.243:25565";
const BEDROCK_ADDRESS = "35.198.44.243";
const BEDROCK_PORT = "19132";
const DEFAULT_MAP_URL = "http://35.198.44.243:8100";

export function MinecraftServerPanel() {
  const [loaded, setLoaded] = useState(false);
  const mapUrl = useMemo(
    () => process.env.NEXT_PUBLIC_MINECRAFT_MAP_URL || DEFAULT_MAP_URL,
    []
  );

  return (
    <main className="min-h-screen bg-[#050505] px-4 pb-8 pt-24 text-white">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <header className="rounded-3xl border border-white/10 bg-white/[0.035] p-5 backdrop-blur-xl">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-violet-300">CLOUVA · Minecraft</p>
              <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">NIÑOS RATA SERVER</h1>
              <p className="mt-2 max-w-2xl text-sm text-white/55">Mapa del mundo en vivo. El visor se conecta directamente al BlueMap del servidor.</p>
            </div>
            <a href={mapUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-violet-400/30 bg-violet-500/10 px-4 py-2 text-sm font-semibold text-violet-100 transition hover:bg-violet-500/20">
              Abrir mapa completo <ExternalLink size={15} />
            </a>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-white/40"><Server size={14}/> Java</div>
              <div className="mt-2 font-mono text-sm text-white/90">{JAVA_ADDRESS}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-white/40"><Server size={14}/> Bedrock</div>
              <div className="mt-2 font-mono text-sm text-white/90">{BEDROCK_ADDRESS} · puerto {BEDROCK_PORT}</div>
            </div>
          </div>
        </header>

        <div className="relative min-h-[68vh] overflow-hidden rounded-3xl border border-white/10 bg-[#0a0a0a] shadow-2xl shadow-violet-950/20">
          {!loaded && (
            <div className="absolute inset-0 grid place-items-center">
              <div className="flex flex-col items-center gap-3 text-center">
                <Map className="text-violet-300" size={34}/>
                <div className="font-semibold">Conectando con BlueMap…</div>
                <div className="max-w-sm px-6 text-xs leading-5 text-white/45">El mapa aparecerá acá automáticamente cuando el webserver de BlueMap quede publicado.</div>
              </div>
            </div>
          )}
          <iframe
            title="Mapa en vivo — Niños Rata Server"
            src={mapUrl}
            onLoad={() => setLoaded(true)}
            className="relative z-10 h-[68vh] min-h-[520px] w-full border-0"
            allowFullScreen
            referrerPolicy="no-referrer"
          />
        </div>
      </section>
    </main>
  );
}
