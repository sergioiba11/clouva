"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { Camera, Home, Leaf, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import { useAuth } from "@/components/auth-provider";

type AccessState = "loading" | "login" | "birth-date" | "denied" | "granted" | "error";

const navItems = [
  { href: "/player/plus18/cocos", label: "Mis cocos", icon: Leaf },
  { href: "/player/plus18/escanear", label: "Escanear", icon: Camera },
  { href: "/", label: "CLOUVA", icon: Home },
] as const;

export function PlayerPlus18Nav() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-amber-200/10 bg-[#04130d]/90 px-4 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-2 backdrop-blur-2xl md:left-1/2 md:max-w-xl md:-translate-x-1/2 md:rounded-t-3xl md:border-x">
      <div className="mx-auto grid max-w-xl grid-cols-3 gap-1">
        {navItems.map((item) => {
          const active = item.href === "/"
            ? pathname === "/"
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-2xl text-[11px] font-medium transition ${
                active ? "bg-amber-300/10 text-amber-300" : "text-white/55 hover:bg-white/5 hover:text-white"
              }`}
            >
              <Icon className="h-5 w-5" strokeWidth={active ? 2.2 : 1.7} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function GateCard({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-[#03120c] px-5 py-12 text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_8%,rgba(247,166,52,0.18),transparent_30%),radial-gradient(circle_at_8%_70%,rgba(57,132,72,0.22),transparent_35%),linear-gradient(180deg,#072116_0%,#03120c_65%)]" />
      <div className="relative w-full max-w-md rounded-[30px] border border-amber-100/15 bg-black/25 p-6 shadow-2xl backdrop-blur-2xl">
        {children}
      </div>
    </main>
  );
}

export default function PlayerPlus18Shell({ children }: { children: React.ReactNode }) {
  const { session, user, loading } = useAuth();
  const [access, setAccess] = useState<AccessState>("loading");
  const [error, setError] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user || !session?.access_token) {
      setAccess("login");
      return;
    }

    let cancelled = false;
    setAccess("loading");
    void fetch("/api/player/plus18/access", {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
          needsBirthDate?: boolean;
          isAdult?: boolean;
        };
        if (!response.ok) throw new Error(data.error || "No se pudo validar tu acceso.");
        if (cancelled) return;
        if (data.needsBirthDate) setAccess("birth-date");
        else setAccess(data.isAdult ? "granted" : "denied");
      })
      .catch((reason) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : "No se pudo validar tu acceso.");
        setAccess("error");
      });

    return () => {
      cancelled = true;
    };
  }, [loading, session?.access_token, user]);

  async function submitBirthDate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session?.access_token || !dateOfBirth) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/player/plus18/access", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ dateOfBirth }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; isAdult?: boolean };
      if (!response.ok) throw new Error(data.error || "No se pudo guardar la fecha.");
      setAccess(data.isAdult ? "granted" : "denied");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar la fecha.");
    } finally {
      setSaving(false);
    }
  }

  if (loading || access === "loading") {
    return (
      <GateCard>
        <div className="flex items-center gap-3 text-white/75">
          <Sparkles className="h-5 w-5 animate-pulse text-amber-300" />
          <span>Abriendo Player +18…</span>
        </div>
      </GateCard>
    );
  }

  if (access === "login") {
    return (
      <GateCard>
        <LockKeyhole className="mb-4 h-9 w-9 text-amber-300" />
        <p className="text-xs uppercase tracking-[0.28em] text-amber-200/70">Player +18</p>
        <h1 className="mt-2 text-3xl font-semibold">Entrá con tu Player</h1>
        <p className="mt-3 text-sm leading-6 text-white/60">Tus cocos, favoritos, scans y actividad quedan asociados a tu cuenta real de CLOUVA.</p>
        <Link href="/" className="mt-6 inline-flex rounded-2xl bg-amber-300 px-5 py-3 text-sm font-semibold text-[#152014]">Ir a CLOUVA</Link>
      </GateCard>
    );
  }

  if (access === "birth-date") {
    return (
      <GateCard>
        <ShieldCheck className="mb-4 h-9 w-9 text-amber-300" />
        <p className="text-xs uppercase tracking-[0.28em] text-amber-200/70">Acceso +18</p>
        <h1 className="mt-2 text-3xl font-semibold">Confirmá tu edad</h1>
        <p className="mt-3 text-sm leading-6 text-white/60">La fecha se guarda en los datos privados de tu cuenta y se usa para bloquear este módulo a menores de 18 años.</p>
        <form onSubmit={submitBirthDate} className="mt-6 space-y-3">
          <label className="block text-sm text-white/70" htmlFor="plus18-birth-date">Fecha de nacimiento</label>
          <input
            id="plus18-birth-date"
            type="date"
            required
            value={dateOfBirth}
            onChange={(event) => setDateOfBirth(event.target.value)}
            className="w-full rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-white outline-none focus:border-amber-300/70"
          />
          {error ? <p className="text-sm text-rose-300">{error}</p> : null}
          <button disabled={saving} className="w-full rounded-2xl bg-amber-300 px-5 py-3 font-semibold text-[#152014] disabled:opacity-50">
            {saving ? "Guardando…" : "Confirmar +18"}
          </button>
        </form>
      </GateCard>
    );
  }

  if (access === "denied") {
    return (
      <GateCard>
        <LockKeyhole className="mb-4 h-9 w-9 text-white/50" />
        <h1 className="text-2xl font-semibold">Player +18 bloqueado</h1>
        <p className="mt-3 text-sm leading-6 text-white/60">Este espacio está disponible únicamente para mayores de 18 años.</p>
        <Link href="/" className="mt-6 inline-flex rounded-2xl border border-white/15 px-5 py-3 text-sm text-white">Volver a CLOUVA</Link>
      </GateCard>
    );
  }

  if (access === "error") {
    return (
      <GateCard>
        <h1 className="text-2xl font-semibold">No pudimos abrir Player +18</h1>
        <p className="mt-3 text-sm text-rose-200">{error}</p>
        <button onClick={() => window.location.reload()} className="mt-6 rounded-2xl bg-white/10 px-5 py-3 text-sm">Reintentar</button>
      </GateCard>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#02110b] pb-24 text-white selection:bg-amber-300/30">
      {children}
      <PlayerPlus18Nav />
    </div>
  );
}
