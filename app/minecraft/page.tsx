"use client";

import Link from "next/link";
import { Activity, Check, Copy, Gamepad2, Map, RefreshCw, Server, ShieldCheck, Smartphone, Swords, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";

type MinecraftStatus = {
  configured: boolean; online: boolean; host: string | null; publicJavaHost?: string | null; publicBedrockHost?: string | null;
  javaPort: number; bedrockPort: number; latencyMs?: number; version?: string | null; motd?: string | null; mapUrl?: string | null;
  players?: { online: number; max: number; sample: string[] }; error?: string;
};

// Production surface for the integrated Minecraft dashboard and live map.
const REFRESH_MS = 10_000;

function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1500); };
  return <button type="button" onClick={() => void copy()} className="flex w-full items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-left transition hover:border-emerald-300/30 hover:bg-white/[0.04]">
    <span className="min-w-0"><span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">{label}</span><span className="mt-1 block truncate font-mono text-sm font-semibold text-white">{value}</span></span>
    {copied ? <Check className="h-5 w-5 text-emerald-300" /> : <Copy className="h-5 w-5 text-white/45" />}
  </button>;
}

export default function MinecraftFamilyPage() {
  const { user, loading } = useAuth();
  const [status, setStatus] = useState<MinecraftStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    setRefreshing(true);
    try { const r = await fetch("/api/minecraft/status", { cache: "no-store" }); setStatus(await r.json()); }
    catch { setStatus({ configured:false, online:false, host:null, javaPort:25565, bedrockPort:19132, error:"No se pudo consultar el servidor." }); }
    finally { setRefreshing(false); }
  }, []);
  useEffect(() => { if (!user) return; void load(); const i=window.setInterval(()=>void load(),REFRESH_MS); return()=>window.clearInterval(i); },[load,user]);

  const javaAddress=status?.publicJavaHost || (status?.host ? `${status.host}:${status.javaPort}` : "Preparando servidor");
  const bedrockAddress=status?.publicBedrockHost || status?.host || "Preparando servidor";
  const playerSummary=useMemo(()=>status?.players ? `${status.players.online} / ${status.players.max}` : "—",[status]);

  if (loading) return <main className="min-h-screen bg-[#050607] text-white"><div className="mx-auto max-w-6xl px-5 py-16 text-sm text-white/45">Cargando Minecraft…</div></main>;
  if (!user) return <main className="min-h-screen bg-[#050607] text-white"><div className="mx-auto max-w-xl px-5 py-20 text-center"><Gamepad2 className="mx-auto h-10 w-10 text-emerald-300"/><h1 className="mt-5 text-3xl font-black">Minecraft</h1><p className="mt-3 text-sm text-white/50">Entrá a CLOUVA para abrir el panel del server.</p><Link href="/login" className="mt-6 inline-flex rounded-xl bg-emerald-400 px-5 py-3 text-sm font-black text-black">Entrar</Link></div></main>;

  return <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(34,197,94,.12),_transparent_34%),#050607] text-white">
    <div className="mx-auto w-full max-w-7xl px-4 pb-20 pt-8 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-emerald-300/80"><Gamepad2 className="h-4 w-4"/> CLOUVA · NIÑOS RATA</div><h1 className="mt-3 text-3xl font-black tracking-[-.04em] sm:text-5xl">Control del server</h1><p className="mt-2 text-sm text-white/45">Jugadores, mapa y estado en vivo desde CLOUVA.</p></div>
        <button onClick={()=>void load()} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[.035] px-4 py-2.5 text-xs font-semibold text-white/65"><RefreshCw className={`h-4 w-4 ${refreshing?"animate-spin":""}`}/> Actualizar</button>
      </header>

      <section className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-white/[.035] p-4"><Activity className="h-5 w-5 text-emerald-300"/><p className="mt-4 text-2xl font-black">{status?.online?"ONLINE":"OFFLINE"}</p><p className="text-xs text-white/35">Estado</p></div>
        <div className="rounded-2xl border border-white/10 bg-white/[.035] p-4"><Users className="h-5 w-5 text-sky-300"/><p className="mt-4 text-2xl font-black">{playerSummary}</p><p className="text-xs text-white/35">Jugadores</p></div>
        <div className="rounded-2xl border border-white/10 bg-white/[.035] p-4"><Server className="h-5 w-5 text-violet-300"/><p className="mt-4 text-2xl font-black">{status?.latencyMs!=null?`${status.latencyMs} ms`:"—"}</p><p className="text-xs text-white/35">Respuesta</p></div>
        <div className="rounded-2xl border border-white/10 bg-white/[.035] p-4"><Swords className="h-5 w-5 text-amber-300"/><p className="mt-4 truncate text-lg font-black">{status?.version||"—"}</p><p className="text-xs text-white/35">Paper / versión</p></div>
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-[1.65fr_.85fr]">
        <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#090c0a]">
          <div className="flex items-center justify-between border-b border-white/[.07] px-5 py-4"><div className="flex items-center gap-2"><Map className="h-5 w-5 text-emerald-300"/><b>Mapa en vivo</b></div>{status?.mapUrl?<a href={status.mapUrl} target="_blank" rel="noreferrer" className="text-xs text-emerald-300">Abrir completo ↗</a>:null}</div>
          {status?.mapUrl ? <iframe title="Mapa Minecraft" src={status.mapUrl} className="h-[58vh] min-h-[430px] w-full border-0" allow="fullscreen"/> : <div className="flex h-[430px] items-center justify-center px-6 text-center text-sm text-white/35">BlueMap está instalado; falta publicar su URL para incrustarlo acá.</div>}
        </div>

        <div className="space-y-4">
          <div className="rounded-[28px] border border-white/10 bg-[#090c0a] p-5"><div className="flex items-center gap-2"><Users className="h-5 w-5 text-sky-300"/><h2 className="font-bold">Conectados ahora</h2></div><div className="mt-4 space-y-2">{status?.players?.sample?.length ? status.players.sample.map(name=><div key={name} className="flex items-center gap-3 rounded-xl border border-white/[.07] bg-white/[.025] px-3 py-3"><span className="h-2.5 w-2.5 rounded-full bg-emerald-400"/><span className="font-semibold">{name}</span></div>) : <p className="text-sm text-white/35">{status?.players?.online ? "El server no publica los nombres en el ping. El bridge los va a completar." : "No hay jugadores conectados."}</p>}</div></div>
          <div className="rounded-[28px] border border-white/10 bg-[#090c0a] p-5"><ShieldCheck className="h-5 w-5 text-emerald-300"/><h2 className="mt-3 font-bold">Administración</h2><p className="mt-2 text-xs leading-5 text-white/40">Preparado para acciones del bridge seguro: teleport, hub, kick, anuncios, arenas y eventos. No se exponen comandos RCON al navegador.</p></div>
        </div>
      </section>

      <section className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-white/[.07] bg-black/25 p-4"><div className="flex items-center gap-2"><Server className="h-5 w-5 text-emerald-300"/><b>Java</b></div><div className="mt-3"><CopyValue value={javaAddress} label="Dirección"/></div></div>
        <div className="rounded-2xl border border-white/[.07] bg-black/25 p-4"><div className="flex items-center gap-2"><Smartphone className="h-5 w-5 text-sky-300"/><b>Bedrock</b></div><div className="mt-3 grid gap-2"><CopyValue value={bedrockAddress} label="Servidor"/><CopyValue value={String(status?.bedrockPort??19132)} label="Puerto"/></div></div>
      </section>
    </div>
  </main>;
}
