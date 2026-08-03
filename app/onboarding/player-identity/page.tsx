"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { OnboardingShell } from "@/components/onboarding/OnboardingShell";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

const OPTIONS = [
  ["Artista", "Identidad artística y obra propia"],
  ["Productor", "Producción musical y sonora"],
  ["Creador", "Contenido y proyectos"],
  ["Manager", "Gestión artística y profesional"],
  ["Diseñador", "Imagen, moda y dirección visual"],
  ["Modelo", "Imagen, campañas y experiencias"],
] as const;

export default function PlayerIdentityOnboardingPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, router, user]);

  const toggle = (value: string) => {
    setSelected((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  };

  const continueOnboarding = async () => {
    if (selected.length === 0) {
      setError("Elegí al menos una identidad profesional.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await authenticatedFetch("/api/players/me", {
        method: "POST",
        body: JSON.stringify({ professional_categories: selected }),
      });
      await readApiJson(response);
      sessionStorage.setItem("clouva.professional_categories", JSON.stringify(selected));
      router.push("/onboarding/instagram");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo crear tu Player.");
      setSaving(false);
    }
  };

  return (
    <OnboardingShell
      step={2}
      title="Construí la identidad de tu Player"
      description="Acá sí podés elegir más de una identidad profesional y cambiarla cuando quieras."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {OPTIONS.map(([label, detail]) => {
          const active = selected.includes(label);
          return (
            <button
              key={label}
              type="button"
              onClick={() => toggle(label)}
              className={`rounded-2xl border p-4 text-left transition ${active ? "border-violet-400 bg-violet-500/15" : "border-white/10 bg-white/[0.025] hover:border-white/25"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div><p className="font-semibold">{label}</p><p className="mt-1 text-xs text-white/40">{detail}</p></div>
                <span className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] ${active ? "border-violet-300 bg-violet-500" : "border-white/20"}`}>{active ? "✓" : ""}</span>
              </div>
            </button>
          );
        })}
      </div>
      {error ? <p className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}
      <button disabled={saving || loading} onClick={() => void continueOnboarding()} className="mt-6 w-full rounded-xl bg-violet-600 px-5 py-3.5 font-semibold transition hover:bg-violet-500 disabled:opacity-60">
        {saving ? "Creando tu Player..." : "Continuar con mi Player"}
      </button>
    </OnboardingShell>
  );
}
