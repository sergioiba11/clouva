"use client";

import Link from "next/link";
import { Check, Copy, Gamepad2, RefreshCw, Server, ShieldCheck, Smartphone, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";

type MinecraftStatus = {
  configured: boolean;
  online: boolean;
  host: string | null;
  publicJavaHost?: string | null;
  publicBedrockHost?: string | null;
  javaPort: number;
  bedrockPort: number;
  latencyMs?: number;
  version?: string | null;
  motd?: string | null;
  players?: {
    online: number;
    max: number;
    sample: string[];
  };
  error?: string;
};

const REFRESH_MS = 15_000;

function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="flex w-full items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-left transition hover:border-emerald-300/30 hover:bg-white/[0.04]"
      aria-label={`Copiar ${label}`}
    >
      <span className="min-w-0">
        <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">{label}</span>
        <span className="mt-1 block truncate font-mono text-sm font-semibold text-white">{value}</span>
      </span>
      {copied ? <Check className="h-5 w-5 shrink-0 text-emerald-300" /> : <Copy className="h-5 w-5 shrink-0 text-white/45" />}
    </button>
  );
}

export default function MinecraftFamilyPage() {
  const { user, loading } = useAuth();
  const [status, setStatus] = useState<MinecraftStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/minecraft/status", { cache: "no-store" });
      const payload = (await response.json()) as MinecraftStatus;
      setStatus(payload);
    } catch {
      setStatus({
        configured: false,
        online: false,
        host: null,
        javaPort: 25565,
        bedrockPort: 19132,
        error: "No se pudo consultar el servidor.",
      });
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void load();
    const interval = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [load, user]);

  const javaAddress = status?.publicJavaHost || (status?.host ? `${status.host}:${status.javaPort}` : "Preparando servidor");
  const bedrockAddress = status?.publicBedrockHost || status?.host || "Preparando servidor";
  const playerSummary = useMemo(() => {
    if (!status?.players) return "Sin datos de jugadores";
    return `${status.players.online} / ${status.players.max} conectados`;
  }, [status]);

  if (loading) {
    return <main className="min-h-screen bg-[#050607] text-white"><div className="mx-auto max-w-5xl px-5 py-16 text-sm text-white/45">Cargando Minecraft…</div></main>;
  }

  if (!user) {
    return (
      <main className="min-h-screen bg-[#050607] text-white">
        <div className="mx-auto max-w-xl px-5 py-20 text-center">
          <Gamepad2 className="mx-auto h-10 w-10 text-emerald-300" />
          <h1 className="mt-5 text-3xl font-black tracking-tight">Minecraft Familiar</h1>
          <p className="mt-3 text-sm text-white/50">Entrá a CLOUVA para ver el acceso al mundo familiar.</p>
          <Link href="/login" className="mt-6 inline-flex rounded-xl bg-emerald-400 px-5 py-3 text-sm font-black text-black">Entrar</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(34,197,94,.12),_transparent_34%),#050607] text-white">
      <div className="mx-auto w-full max-w-5xl px-4 pb-20 pt-8 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-emerald-300/80">
              <Gamepad2 className="h-4 w-4" /> CLOUVA · Familia
            </div>
            <h1 className="mt-3 text-3xl font-black tracking-[-0.04em] sm:text-5xl">Minecraft 24/7</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/45">Un mundo permanente para jugar juntos. El mapa queda guardado aunque cierres CLOUVA o apagues tu PC.</p>
          </div>

          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-4 py-2.5 text-xs font-semibold text-white/65"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /> Actualizar
          </button>
        </div>

        <section className="mt-8 overflow-hidden rounded-[28px] border border-white/10 bg-[#0a0d0b]/90 shadow-2xl shadow-black/40">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.07] px-5 py-5 sm:px-7">
            <div className="flex items-center gap-3">
              <span className={`h-3 w-3 rounded-full ${status?.online ? "bg-emerald-400 shadow-[0_0_18px_rgba(74,222,128,.9)]" : "bg-amber-300/70"}`} />
              <div>
                <p className="text-sm font-bold">{status?.online ? "Servidor online" : status?.configured ? "Servidor iniciando" : "Preparando infraestructura"}</p>
                <p className="mt-0.5 text-[11px] text-white/35">{status?.online ? `${playerSummary}${status.latencyMs != null ? ` · ${status.latencyMs} ms` : ""}` : "CLOUVA lo vuelve a consultar automáticamente"}</p>
              </div>
            </div>
            <Server className="h-6 w-6 text-emerald-300/70" />
          </div>

          <div className="grid gap-5 p-5 sm:p-7 lg:grid-cols-2">
            <div className="rounded-3xl border border-white/[0.07] bg-white/[0.025] p-5">
              <div className="flex items-center gap-2"><Server className="h-5 w-5 text-emerald-300" /><h2 className="font-bold">Minecraft Java</h2></div>
              <p className="mt-2 text-xs leading-5 text-white/40">PC · Minecraft Java Edition</p>
              <div className="mt-5"><CopyValue value={javaAddress} label="Dirección del servidor" /></div>
              {status?.version ? <p className="mt-3 text-[11px] text-white/30">Servidor: {status.version}</p> : null}
            </div>

            <div className="rounded-3xl border border-white/[0.07] bg-white/[0.025] p-5">
              <div className="flex items-center gap-2"><Smartphone className="h-5 w-5 text-sky-300" /><h2 className="font-bold">Minecraft Bedrock</h2></div>
              <p className="mt-2 text-xs leading-5 text-white/40">Celular / Bedrock · puerto 19132</p>
              <div className="mt-5 space-y-2">
                <CopyValue value={bedrockAddress} label="Servidor" />
                <CopyValue value={String(status?.bedrockPort ?? 19132)} label="Puerto" />
              </div>
            </div>
          </div>
        </section>

        <section className="mt-5 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-white/[0.07] bg-black/25 p-4">
            <ShieldCheck className="h-5 w-5 text-emerald-300" />
            <p className="mt-3 text-sm font-bold">Mundo persistente</p>
            <p className="mt-1 text-xs leading-5 text-white/35">El mapa vive en un disco separado de la web de CLOUVA.</p>
          </div>
          <div className="rounded-2xl border border-white/[0.07] bg-black/25 p-4">
            <RefreshCw className="h-5 w-5 text-violet-300" />
            <p className="mt-3 text-sm font-bold">Reinicio automático</p>
            <p className="mt-1 text-xs leading-5 text-white/35">Si la VM reinicia, Minecraft vuelve a levantar solo.</p>
          </div>
          <div className="rounded-2xl border border-white/[0.07] bg-black/25 p-4">
            <Users className="h-5 w-5 text-sky-300" />
            <p className="mt-3 text-sm font-bold">Mundo familiar</p>
            <p className="mt-1 text-xs leading-5 text-white/35">{status?.motd || "CLOUVA FAMILIA · Java + Bedrock"}</p>
          </div>
        </section>
      </div>
    </main>
  );
}
