"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Ban,
  CloudRain,
  Crown,
  Gamepad2,
  Loader2,
  LockKeyhole,
  Megaphone,
  Moon,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Server,
  Shield,
  ShieldCheck,
  Sparkles,
  Square,
  Sun,
  UserMinus,
  UserPlus,
  Users,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { canAccessAdmin } from "@/lib/auth";

type PublicStatus = {
  configured: boolean;
  online: boolean;
  host: string | null;
  publicJavaHost?: string | null;
  javaPort: number;
  latencyMs?: number;
  version?: string | null;
  motd?: string | null;
  players?: {
    online: number;
    max: number;
    sample: string[];
  };
};

type ControlStatus = {
  ok: boolean;
  server?: {
    name: string;
    status: string;
    ip: string | null;
    machineType: string | null;
  };
  error?: string;
};

type Notice = {
  tone: "ok" | "error" | "info";
  text: string;
};

const ASSET_ROOT =
  "https://storage.googleapis.com/clouva-generated-media/admin-assets/brand/clouva-logo/shared/other";
const RATCRAFT_LOGO = ASSET_ROOT + "/ratcraft_logo_principal.png";

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function ToolButton({
  children,
  onClick,
  disabled,
  danger,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs font-black uppercase tracking-[.08em] transition",
        danger
          ? "border-rose-400/25 bg-rose-500/10 text-rose-100 hover:border-rose-300/50 hover:bg-rose-500/20"
          : active
            ? "border-fuchsia-300/55 bg-fuchsia-500/25 text-white shadow-[0_0_24px_rgba(217,70,239,.16)]"
            : "border-white/10 bg-white/[.035] text-white/80 hover:border-fuchsia-300/35 hover:bg-fuchsia-500/10 hover:text-white",
        disabled && "cursor-not-allowed opacity-40",
      )}
    >
      {children}
    </button>
  );
}

function Panel({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[24px] border border-fuchsia-300/15 bg-[#0b0614]/82 p-4 shadow-[0_20px_70px_rgba(0,0,0,.28)] backdrop-blur-xl sm:p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-fuchsia-300/20 bg-fuchsia-500/10 text-fuchsia-100">
          {icon}
        </span>
        <div>
          <h2 className="text-base font-black tracking-tight text-white sm:text-lg">{title}</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-white/45">{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

export default function MinecraftConfigPage() {
  const { user, session, role, loading, hydrationReady, profileReady } = useAuth();
  const router = useRouter();

  const [publicStatus, setPublicStatus] = useState<PublicStatus | null>(null);
  const [controlStatus, setControlStatus] = useState<ControlStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const [player, setPlayer] = useState("ninotimi");
  const [target, setTarget] = useState("Clouva");
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("");
  const [gameMode, setGameMode] = useState("survival");
  const [difficulty, setDifficulty] = useState("easy");

  const isAdmin = canAccessAdmin(role);

  useEffect(() => {
    if (loading || !hydrationReady || !profileReady) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (!isAdmin) router.replace("/minecraft");
  }, [hydrationReady, isAdmin, loading, profileReady, router, user]);

  const authHeaders = useMemo(
    () =>
      session?.access_token
        ? { Authorization: "Bearer " + session.access_token }
        : {},
    [session?.access_token],
  );

  const load = useCallback(async () => {
    if (!session?.access_token || !isAdmin) return;
    try {
      const [statusResponse, controlResponse] = await Promise.all([
        fetch("/api/minecraft/status", { cache: "no-store" }),
        fetch("/api/minecraft/control", {
          cache: "no-store",
          headers: { Authorization: "Bearer " + session.access_token },
        }),
      ]);

      const statusJson = (await statusResponse.json()) as PublicStatus;
      const controlJson = (await controlResponse.json()) as ControlStatus;
      setPublicStatus(statusJson);
      setControlStatus(controlJson);
    } catch {
      setNotice({ tone: "error", text: "No pude actualizar el estado de Ratcraft." });
    }
  }, [isAdmin, session?.access_token]);

  useEffect(() => {
    if (!isAdmin || !session?.access_token) return;
    void load();
    const timer = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(timer);
  }, [isAdmin, load, session?.access_token]);

  const execute = useCallback(
    async (
      action: string,
      args: Record<string, unknown> = {},
      options?: { confirm?: string; success?: string },
    ) => {
      if (!session?.access_token) return;
      if (options?.confirm && !window.confirm(options.confirm)) return;

      setBusy(action);
      setNotice(null);
      try {
        const response = await fetch("/api/minecraft/control", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + session.access_token,
          },
          body: JSON.stringify({ action, args }),
        });

        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          queued?: boolean;
          state?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error || "La herramienta falló.");
        }

        setNotice({
          tone: "ok",
          text:
            options?.success ||
            (payload.queued
              ? "Comando enviado al agente privado de Ratcraft."
              : "Operación aplicada."),
        });

        window.setTimeout(() => void load(), action === "start" ? 4_000 : 1_500);
      } catch (error) {
        setNotice({
          tone: "error",
          text: error instanceof Error ? error.message : "No se pudo ejecutar la acción.",
        });
      } finally {
        setBusy(null);
      }
    },
    [load, session?.access_token],
  );

  const onlinePlayers = publicStatus?.players?.sample ?? [];
  const vmRunning = controlStatus?.server?.status === "RUNNING";
  const mcOnline = Boolean(publicStatus?.online);

  if (loading || !hydrationReady || !profileReady || !user || !isAdmin) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#07010d] text-white">
        <div className="flex items-center gap-3 text-sm font-bold text-white/55">
          <Loader2 className="h-5 w-5 animate-spin" /> Abriendo Ratcraft Config...
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#07010d] text-white">
      <div
        className="pointer-events-none fixed inset-0 opacity-70"
        style={{
          background:
            "radial-gradient(circle at 18% 0%, rgba(168,85,247,.16), transparent 34%), radial-gradient(circle at 86% 18%, rgba(217,70,239,.10), transparent 31%), linear-gradient(180deg,#07010d,#05030a)",
        }}
      />
      <div
        className="pointer-events-none fixed inset-0 opacity-[.12]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(232,121,249,.18) 1px, transparent 1px), linear-gradient(90deg, rgba(232,121,249,.18) 1px, transparent 1px)",
          backgroundSize: "36px 36px",
        }}
      />

      <div className="relative mx-auto w-full max-w-[1500px] px-3 pb-16 pt-3 sm:px-5 sm:pt-5">
        <header className="sticky top-3 z-30 flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-fuchsia-300/15 bg-[#090313]/90 px-3 py-3 shadow-[0_20px_70px_rgba(0,0,0,.35)] backdrop-blur-2xl sm:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/minecraft"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[.035] text-white/70 transition hover:border-fuchsia-300/35 hover:text-white"
              aria-label="Volver a Ratcraft"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <img src={RATCRAFT_LOGO} alt="Ratcraft" className="h-10 w-auto object-contain sm:h-12" />
            <div className="hidden sm:block">
              <div className="text-sm font-black uppercase tracking-[.14em]">Config</div>
              <div className="text-[10px] font-bold uppercase tracking-[.18em] text-fuchsia-200/45">
                Panel Admin
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs font-black">
              <span
                className={cn(
                  "h-2.5 w-2.5 rounded-full",
                  mcOnline
                    ? "bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,.85)]"
                    : vmRunning
                      ? "bg-amber-300 shadow-[0_0_14px_rgba(252,211,77,.7)]"
                      : "bg-white/25",
                )}
              />
              {mcOnline ? "Minecraft online" : vmRunning ? "VM iniciando" : "Apagado"}
            </div>
            <button
              type="button"
              onClick={() => void load()}
              className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[.035] text-white/65 transition hover:border-fuchsia-300/35 hover:text-white"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </header>

        <section className="mt-4 overflow-hidden rounded-[28px] border border-fuchsia-300/15 bg-[linear-gradient(135deg,rgba(126,34,206,.16),rgba(10,4,18,.84)_45%,rgba(217,70,239,.08))] p-5 sm:p-6">
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-fuchsia-300/20 bg-fuchsia-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[.18em] text-fuchsia-100">
                <ShieldCheck className="h-3.5 w-3.5" /> CLOUVA → Ratcraft
              </div>
              <h1 className="mt-3 text-3xl font-black tracking-[-.04em] sm:text-4xl">
                Herramientas del server
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/50">
                Administración real de la VM y del servidor Paper. Los comandos de juego viajan por metadata privada de Google Cloud y se ejecutan dentro de la VM.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                <div className="text-[9px] font-black uppercase tracking-[.16em] text-white/35">VM</div>
                <div className="mt-1 text-sm font-black">{controlStatus?.server?.status ?? "..."}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                <div className="text-[9px] font-black uppercase tracking-[.16em] text-white/35">Players</div>
                <div className="mt-1 text-sm font-black">
                  {publicStatus?.players?.online ?? 0}/{publicStatus?.players?.max ?? 12}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                <div className="text-[9px] font-black uppercase tracking-[.16em] text-white/35">Ping</div>
                <div className="mt-1 text-sm font-black">{publicStatus?.latencyMs ?? "—"} ms</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                <div className="text-[9px] font-black uppercase tracking-[.16em] text-white/35">IP</div>
                <div className="mt-1 truncate font-mono text-xs font-black">
                  {controlStatus?.server?.ip ?? "—"}
                </div>
              </div>
            </div>
          </div>
        </section>

        {notice ? (
          <div
            className={cn(
              "mt-3 rounded-2xl border px-4 py-3 text-sm font-bold",
              notice.tone === "ok" &&
                "border-emerald-300/20 bg-emerald-400/10 text-emerald-100",
              notice.tone === "error" &&
                "border-rose-300/20 bg-rose-400/10 text-rose-100",
              notice.tone === "info" &&
                "border-sky-300/20 bg-sky-400/10 text-sky-100",
            )}
          >
            {notice.text}
          </div>
        ) : null}

        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <Panel
            title="Servidor"
            subtitle="Prender, apagar, reiniciar y guardar el mundo."
            icon={<Server className="h-5 w-5" />}
          >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <ToolButton
                onClick={() =>
                  void execute("start", {}, { success: "Ratcraft está arrancando." })
                }
                disabled={busy !== null || vmRunning}
                active={!vmRunning}
              >
                {busy === "start" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Prender
              </ToolButton>
              <ToolButton
                onClick={() =>
                  void execute(
                    "stop",
                    {},
                    {
                      confirm: "¿Apagar Ratcraft? Se guarda el mundo antes.",
                      success: "Ratcraft se está apagando.",
                    },
                  )
                }
                disabled={busy !== null || !vmRunning}
                danger
              >
                <Square className="h-4 w-4" /> Apagar
              </ToolButton>
              <ToolButton
                onClick={() =>
                  void execute(
                    "restart",
                    {},
                    {
                      confirm: "¿Reiniciar Ratcraft? Se guarda el mundo antes.",
                      success: "Ratcraft se está reiniciando.",
                    },
                  )
                }
                disabled={busy !== null || !vmRunning}
              >
                <RotateCcw className="h-4 w-4" /> Reiniciar
              </ToolButton>
              <ToolButton
                onClick={() => void execute("save_all", {}, { success: "Mundo guardado." })}
                disabled={busy !== null || !mcOnline}
              >
                <Save className="h-4 w-4" /> Guardar
              </ToolButton>
            </div>

            <div className="mt-3 rounded-2xl border border-white/8 bg-black/20 p-3">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-white/50">
                <span>
                  Versión <b className="text-white/85">{publicStatus?.version ?? "—"}</b>
                </span>
                <span>
                  Máquina <b className="text-white/85">{controlStatus?.server?.machineType ?? "—"}</b>
                </span>
                <span>
                  Dirección <b className="font-mono text-white/85">clouva.com.ar</b>
                </span>
              </div>
            </div>
          </Panel>

          <Panel
            title="Jugador"
            subtitle="Elegí un nick y administralo desde CLOUVA."
            icon={<Users className="h-5 w-5" />}
          >
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-[.16em] text-white/35">
                  Nick
                </label>
                <input
                  value={player}
                  onChange={(event) => setPlayer(event.target.value)}
                  list="minecraft-online-players"
                  placeholder="ninotimi"
                  className="h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 font-mono text-sm font-bold text-white outline-none transition focus:border-fuchsia-300/45"
                />
                <datalist id="minecraft-online-players">
                  {onlinePlayers.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </div>
              <div className="flex items-end">
                <div className="flex h-11 items-center rounded-xl border border-white/10 bg-black/20 px-3 text-xs font-bold text-white/45">
                  {onlinePlayers.includes(player) ? "● Online" : "Jugador"}
                </div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <ToolButton
                onClick={() =>
                  void execute("whitelist_add", { player }, { success: player + " agregado a whitelist." })
                }
                disabled={!player || busy !== null}
              >
                <UserPlus className="h-4 w-4" /> Whitelist +
              </ToolButton>
              <ToolButton
                onClick={() =>
                  void execute(
                    "whitelist_remove",
                    { player },
                    {
                      confirm: "¿Sacar a " + player + " de la whitelist?",
                      success: player + " removido de whitelist.",
                    },
                  )
                }
                disabled={!player || busy !== null}
                danger
              >
                <UserMinus className="h-4 w-4" /> Whitelist −
              </ToolButton>
              <ToolButton
                onClick={() => void execute("op", { player }, { success: player + " ahora es admin/OP." })}
                disabled={!player || busy !== null}
              >
                <Crown className="h-4 w-4" /> Dar admin
              </ToolButton>
              <ToolButton
                onClick={() =>
                  void execute(
                    "deop",
                    { player },
                    {
                      confirm: "¿Quitar admin/OP a " + player + "?",
                      success: "OP removido a " + player + ".",
                    },
                  )
                }
                disabled={!player || busy !== null}
              >
                <Shield className="h-4 w-4" /> Quitar admin
              </ToolButton>
              <ToolButton
                onClick={() =>
                  void execute(
                    "kick",
                    { player, reason },
                    {
                      confirm: "¿Expulsar a " + player + "?",
                      success: player + " expulsado.",
                    },
                  )
                }
                disabled={!player || busy !== null}
                danger
              >
                <Zap className="h-4 w-4" /> Kick
              </ToolButton>
              <ToolButton
                onClick={() =>
                  void execute(
                    "ban",
                    { player, reason },
                    {
                      confirm: "¿BANEAR a " + player + "?",
                      success: player + " baneado.",
                    },
                  )
                }
                disabled={!player || busy !== null}
                danger
              >
                <Ban className="h-4 w-4" /> Ban
              </ToolButton>
            </div>

            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Motivo opcional para kick / ban"
                className="h-11 rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-fuchsia-300/45"
              />
              <ToolButton
                onClick={() => void execute("pardon", { player }, { success: player + " desbaneado." })}
                disabled={!player || busy !== null}
              >
                Desbanear
              </ToolButton>
            </div>
          </Panel>

          <Panel
            title="Modo de juego"
            subtitle="Cambiar el modo del jugador seleccionado."
            icon={<Gamepad2 className="h-5 w-5" />}
          >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {["survival", "creative", "adventure", "spectator"].map((mode) => (
                <ToolButton
                  key={mode}
                  active={gameMode === mode}
                  onClick={() => {
                    setGameMode(mode);
                    void execute("gamemode", { player, mode }, { success: player + " → " + mode + "." });
                  }}
                  disabled={!player || busy !== null}
                >
                  {mode}
                </ToolButton>
              ))}
            </div>

            <div className="mt-4">
              <div className="mb-1.5 text-[10px] font-black uppercase tracking-[.16em] text-white/35">
                Teletransportar
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <input
                  value={player}
                  onChange={(event) => setPlayer(event.target.value)}
                  placeholder="Jugador"
                  className="h-11 rounded-xl border border-white/10 bg-black/30 px-3 font-mono text-sm font-bold outline-none focus:border-fuchsia-300/45"
                />
                <input
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                  placeholder="Destino / jugador"
                  className="h-11 rounded-xl border border-white/10 bg-black/30 px-3 font-mono text-sm font-bold outline-none focus:border-fuchsia-300/45"
                />
                <ToolButton
                  onClick={() =>
                    void execute("teleport", { player, target }, { success: player + " → " + target + "." })
                  }
                  disabled={!player || !target || busy !== null}
                >
                  TP
                </ToolButton>
              </div>
            </div>
          </Panel>

          <Panel
            title="Mundo"
            subtitle="Hora, clima y dificultad global."
            icon={<Sparkles className="h-5 w-5" />}
          >
            <div>
              <div className="mb-2 text-[10px] font-black uppercase tracking-[.16em] text-white/35">
                Hora
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <ToolButton onClick={() => void execute("time", { value: "day" })} disabled={busy !== null}>
                  <Sun className="h-4 w-4" /> Día
                </ToolButton>
                <ToolButton onClick={() => void execute("time", { value: "night" })} disabled={busy !== null}>
                  <Moon className="h-4 w-4" /> Noche
                </ToolButton>
                <ToolButton onClick={() => void execute("time", { value: "noon" })} disabled={busy !== null}>
                  Mediodía
                </ToolButton>
                <ToolButton onClick={() => void execute("time", { value: "midnight" })} disabled={busy !== null}>
                  Medianoche
                </ToolButton>
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-2 text-[10px] font-black uppercase tracking-[.16em] text-white/35">
                Clima
              </div>
              <div className="grid grid-cols-3 gap-2">
                <ToolButton onClick={() => void execute("weather", { value: "clear" })} disabled={busy !== null}>
                  Despejado
                </ToolButton>
                <ToolButton onClick={() => void execute("weather", { value: "rain" })} disabled={busy !== null}>
                  <CloudRain className="h-4 w-4" /> Lluvia
                </ToolButton>
                <ToolButton onClick={() => void execute("weather", { value: "thunder" })} disabled={busy !== null}>
                  Tormenta
                </ToolButton>
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-2 text-[10px] font-black uppercase tracking-[.16em] text-white/35">
                Dificultad
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {["peaceful", "easy", "normal", "hard"].map((value) => (
                  <ToolButton
                    key={value}
                    active={difficulty === value}
                    onClick={() => {
                      setDifficulty(value);
                      void execute("difficulty", { value }, { success: "Dificultad → " + value + "." });
                    }}
                    disabled={busy !== null}
                  >
                    {value}
                  </ToolButton>
                ))}
              </div>
            </div>
          </Panel>

          <Panel
            title="Mensaje global"
            subtitle="Mandar un anuncio al chat completo de Ratcraft."
            icon={<Megaphone className="h-5 w-5" />}
          >
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <input
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Ej: vengan todos al lobby"
                maxLength={180}
                className="h-11 rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-fuchsia-300/45"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && message.trim()) {
                    void execute("say", { message }, { success: "Mensaje enviado al server." });
                    setMessage("");
                  }
                }}
              />
              <ToolButton
                onClick={() => {
                  void execute("say", { message }, { success: "Mensaje enviado al server." });
                  setMessage("");
                }}
                disabled={!message.trim() || busy !== null}
              >
                <Megaphone className="h-4 w-4" /> Enviar
              </ToolButton>
            </div>
          </Panel>

          <Panel
            title="Seguridad Ratcraft"
            subtitle="Estado base que se reaplica cuando el server inicia."
            icon={<LockKeyhole className="h-5 w-5" />}
          >
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                ["Whitelist", "ACTIVA"],
                ["Clouva", "AUTORIZADO"],
                ["ninotimi", "AUTORIZADO + ADMIN"],
                ["seba_1230", "AUTORIZADO"],
              ].map(([name, value]) => (
                <div
                  key={name}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-black/20 px-3 py-2.5"
                >
                  <span className="font-mono text-xs font-bold text-white/65">{name}</span>
                  <span className="text-[9px] font-black uppercase tracking-[.12em] text-emerald-300">
                    {value}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-2 rounded-xl border border-rose-300/12 bg-rose-400/[.06] px-3 py-2.5 text-xs text-rose-100/70">
              GTrein permanece en la lista de baneados por nombre.
            </div>
          </Panel>
        </div>

        <footer className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/8 bg-black/20 px-4 py-3 text-[10px] font-bold uppercase tracking-[.14em] text-white/35">
          <span>RATCRAFT CONTROL · CLOUVA</span>
          <div className="flex gap-3">
            <Link href="/minecraft" className="transition hover:text-white">
              Inicio
            </Link>
            <Link href="/minecraft#mapa" className="transition hover:text-white">
              Mapa
            </Link>
          </div>
        </footer>
      </div>
    </main>
  );
}
