"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Compass, Settings2, Sparkles, Wrench } from "lucide-react";
import { OnboardingShell } from "@/components/onboarding/OnboardingShell";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

const OPTIONS = [
  {
    mode: "explore",
    title: "Explorar CLOUVA",
    detail: "Descubrí Players, Estudios, música, servicios, productos, ropa, mundos y experiencias.",
    destination: "/matrix",
    Icon: Compass,
  },
  {
    mode: "player",
    title: "Crear mi Player",
    detail: "Construí tu identidad pública como artista, productor, diseñador, manager o creador.",
    destination: "/onboarding/player-identity",
    Icon: Sparkles,
  },
  {
    mode: "services",
    title: "Ofrecer mis servicios",
    detail: "Publicá servicios profesionales, recibí consultas, reservas, pagos y proyectos.",
    destination: "/onboarding/player-identity?next=services",
    Icon: Wrench,
  },
  {
    mode: "studio_owner",
    title: "Crear mi Estudio",
    detail: "Activá el sistema operativo de tu Estudio, sello, colectivo, club o espacio creativo.",
    destination: "/studios/nuevo",
    Icon: Building2,
  },
  {
    mode: "studio_manager",
    title: "Administrar un Estudio",
    detail: "Accedé mediante una invitación como socio, manager, administrador o integrante del equipo.",
    destination: "/profile/memberships?mode=manage",
    Icon: Settings2,
  },
] as const;

export default function IdentityOnboardingPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [workingMode, setWorkingMode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, router, user]);

  const chooseMode = async (option: (typeof OPTIONS)[number]) => {
    setWorkingMode(option.mode);
    setError(null);
    try {
      const response = await authenticatedFetch("/api/profile/modes", {
        method: "POST",
        body: JSON.stringify({ mode: option.mode, metadata: { source: "onboarding" } }),
      });
      await readApiJson(response);
      router.push(option.destination);
    } catch (modeError) {
      setError(modeError instanceof Error ? modeError.message : "No se pudo continuar.");
      setWorkingMode(null);
    }
  };

  return (
    <OnboardingShell
      step={2}
      title="¿Qué querés hacer en CLOUVA?"
      description="Elegí por dónde empezar. Tu cuenta puede activar otros caminos después sin crear perfiles separados."
    >
      <div className="grid gap-3">
        {OPTIONS.map((option) => {
          const Icon = option.Icon;
          const working = workingMode === option.mode;
          return (
            <button
              key={option.mode}
              type="button"
              disabled={Boolean(workingMode) || loading}
              onClick={() => void chooseMode(option)}
              className="group flex items-start gap-4 rounded-2xl border border-white/10 bg-white/[0.025] p-4 text-left transition hover:border-violet-400/50 hover:bg-violet-500/10 disabled:opacity-55"
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-violet-400/25 bg-violet-500/10 text-violet-200">
                <Icon size={20} />
              </span>
              <span className="min-w-0">
                <span className="font-semibold">{working ? "Abriendo..." : option.title}</span>
                <span className="mt-1 block text-xs leading-5 text-white/45">{option.detail}</span>
              </span>
            </button>
          );
        })}
      </div>
      {error ? <p className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}
      <p className="mt-5 text-center text-xs leading-5 text-white/35">
        Esto define lo que querés hacer ahora, no una identidad permanente ni un permiso global.
      </p>
    </OnboardingShell>
  );
}
