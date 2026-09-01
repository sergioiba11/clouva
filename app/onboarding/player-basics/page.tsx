"use client";

import { AtSign, Loader2, UserRound } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { OnboardingShell } from "@/components/onboarding/OnboardingShell";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type BasicsPayload = {
  complete: boolean;
  player: { display_name?: string | null; username?: string | null } | null;
};

function safeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/onboarding/player-basics")) {
    return "/onboarding/identity";
  }
  return value;
}

function PlayerBasicsForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = safeNext(searchParams.get("next"));

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace(`/login?next=${encodeURIComponent(`/onboarding/player-basics?next=${next}`)}`);
      return;
    }

    let alive = true;
    void (async () => {
      try {
        const response = await authenticatedFetch("/api/onboarding/player-basics");
        const payload = await readApiJson<BasicsPayload>(response);
        if (!alive) return;
        if (payload.complete) {
          router.replace(next);
          return;
        }
        setDisplayName(payload.player?.display_name?.trim() || "");
        setUsername(payload.player?.username?.trim() || "");
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : "No se pudo cargar tu identidad.");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => { alive = false; };
  }, [authLoading, next, router, user]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const response = await authenticatedFetch("/api/onboarding/player-basics", {
        method: "POST",
        body: JSON.stringify({ displayName, username }),
      });
      await readApiJson(response);
      router.replace(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar tu identidad.");
      setSaving(false);
    }
  }

  return (
    <OnboardingShell
      step={1}
      title="Tu identidad"
      description="Antes de entrar a CLOUVA, definí tu nombre público y tu @ único. Este es tu Player base; después podés personalizarlo y crear o administrar espacios."
    >
      {loading ? (
        <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-white/45">
          <Loader2 size={17} className="animate-spin" /> Cargando tu Player…
        </div>
      ) : (
        <div className="space-y-4">
          <label className="block">
            <span className="mb-2 flex items-center gap-2 text-xs font-medium text-white/55"><UserRound size={14} /> Nombre</span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={160}
              autoComplete="name"
              placeholder="Tu nombre público"
              className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3.5 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-violet-400/50"
            />
          </label>

          <label className="block">
            <span className="mb-2 flex items-center gap-2 text-xs font-medium text-white/55"><AtSign size={14} /> @</span>
            <div className="flex items-center rounded-2xl border border-white/10 bg-black/25 px-4 transition focus-within:border-violet-400/50">
              <span className="text-sm text-violet-300">@</span>
              <input
                value={username.replace(/^@+/, "")}
                onChange={(event) => setUsername(event.target.value.toLowerCase().replace(/^@+/, ""))}
                maxLength={30}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="tunombre"
                className="min-w-0 flex-1 bg-transparent px-1 py-3.5 text-sm text-white outline-none placeholder:text-white/25"
              />
            </div>
            <span className="mt-2 block text-[11px] leading-5 text-white/30">3–30 caracteres: letras, números, punto, guion o guion bajo.</span>
          </label>

          {error ? <p className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}

          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !displayName.trim() || !username.trim()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 px-5 py-3.5 text-sm font-semibold transition hover:bg-violet-500 disabled:opacity-45"
          >
            {saving ? <Loader2 size={17} className="animate-spin" /> : null}
            {saving ? "Guardando…" : "Continuar"}
          </button>
        </div>
      )}
    </OnboardingShell>
  );
}

export default function PlayerBasicsPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#05040a]" aria-hidden="true" />}>
      <PlayerBasicsForm />
    </Suspense>
  );
}
