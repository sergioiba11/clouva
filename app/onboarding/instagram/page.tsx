"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { OnboardingShell } from "@/components/onboarding/OnboardingShell";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

const IMPORTS = ["Foto de perfil", "Nombre público", "Usuario", "Biografía disponible", "Imágenes y videos autorizados", "Link al Instagram original"];

export default function InstagramOnboardingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading } = useAuth();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(searchParams.get("error"));

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, router, user]);

  const connect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const response = await authenticatedFetch("/api/integrations/instagram/connect", {
        method: "POST",
        body: JSON.stringify({ returnPath: "/onboarding/instagram/select" }),
      });
      const payload = await readApiJson<{ authorizeUrl: string }>(response);
      window.location.assign(payload.authorizeUrl);
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "No se pudo conectar Instagram.");
      setConnecting(false);
    }
  };

  return (
    <OnboardingShell
      step={3}
      title="Convertí tu Instagram en tu perfil CLOUVA."
      description="Importamos una base editable para tu presentación. Nada se publica sin tu confirmación."
    >
      <div className="flex items-center justify-center gap-3 rounded-2xl border border-white/10 bg-black/25 p-5">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 via-rose-500 to-amber-400 text-xl font-bold">IG</div>
        <span className="text-white/30">→</span>
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-violet-400/30 bg-violet-500/15 font-bold text-violet-200">C</div>
        <span className="text-white/30">→</span>
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-xl">◉</div>
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        {IMPORTS.map((item) => <div key={item} className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5 text-sm text-white/65"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-500/20 text-xs text-violet-300">✓</span>{item}</div>)}
      </div>

      {error ? <p className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}

      <div className="mt-6 space-y-3">
        <button disabled={connecting || loading} onClick={() => void connect()} className="w-full rounded-xl bg-gradient-to-r from-fuchsia-600 via-violet-600 to-indigo-600 px-5 py-3.5 font-semibold transition hover:brightness-110 disabled:opacity-60">{connecting ? "Abriendo Instagram..." : "Conectar Instagram"}</button>
        <button onClick={() => router.push("/profile/edit")} className="w-full rounded-xl border border-white/15 px-5 py-3 font-medium transition hover:border-violet-400/60">Hacerlo manualmente</button>
        <button onClick={() => router.push("/onboarding/profile-preview")} className="w-full px-5 py-2 text-sm text-white/40 transition hover:text-white">Ahora no</button>
      </div>
    </OnboardingShell>
  );
}
