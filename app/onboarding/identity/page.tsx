"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BriefcaseBusiness, Compass, Settings2, Sparkles, Store } from "lucide-react";
import { OnboardingShell } from "@/components/onboarding/OnboardingShell";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

const OPTIONS = [
  {
    key: "explore",
    mode: "explore",
    title: "Explorar CLOUVA",
    detail: "Descubrí Players, negocios, Estudios, música, productos, servicios, mundos y experiencias.",
    destination: "/matrix",
    persistMode: true,
    disabled: false,
    Icon: Compass,
  },
  {
    key: "player",
    mode: "player",
    title: "Personalizar mi Player",
    detail: "Personalizá tu identidad dentro de CLOUVA: qué hacés, tu perfil, contenido y presencia pública.",
    destination: "/onboarding/player-identity",
    persistMode: true,
    disabled: false,
    Icon: Sparkles,
  },
  {
    key: "create_business",
    mode: null,
    title: "Crear negocio",
    detail: "Creá tu tienda, negocio, espacio físico o Estudio y administralo desde CLOUVA.",
    destination: "/businesses/new",
    persistMode: false,
    disabled: false,
    Icon: Store,
  },
  {
    key: "manage_business",
    mode: null,
    title: "Administrar un negocio",
    detail: "Solicitá acceso a un negocio o espacio existente como socio, manager, administrador o integrante del equipo.",
    destination: "/businesses/manage",
    persistMode: false,
    disabled: false,
    Icon: Settings2,
  },
  {
    key: "skills",
    mode: null,
    title: "Ofrecer mis habilidades",
    detail: "Encontrá oportunidades y ofrecé tus habilidades a negocios y proyectos dentro de CLOUVA.",
    destination: null,
    persistMode: false,
    disabled: true,
    Icon: BriefcaseBusiness,
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
    if (option.disabled || !option.destination) return;
    setWorkingMode(option.key);
    setError(null);
    try {
      if (option.persistMode && option.mode) {
        const response = await authenticatedFetch("/api/profile/modes", {
          method: "POST",
          body: JSON.stringify({ mode: option.mode, metadata: { source: "onboarding" } }),
        });
        await readApiJson(response);
      }
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
      description="Elegí por dónde empezar. Después podés activar otros caminos desde tu cuenta."
    >
      <div className="grid gap-3">
        {OPTIONS.map((option) => {
          const Icon = option.Icon;
          const working = workingMode === option.key;
          return (
            <button
              key={option.key}
              type="button"
              disabled={option.disabled || Boolean(workingMode) || loading}
              onClick={() => void chooseMode(option)}
              className={option.disabled
                ? "flex cursor-default items-start gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.015] p-4 text-left opacity-45"
                : "group flex items-start gap-4 rounded-2xl border border-white/10 bg-white/[0.025] p-4 text-left transition hover:border-violet-400/50 hover:bg-violet-500/10 disabled:opacity-55"}
            >
              <span className={option.disabled
                ? "grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.025] text-white/35"
                : "grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-violet-400/25 bg-violet-500/10 text-violet-200"}
              >
                <Icon size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 font-semibold">
                  {working ? "Abriendo..." : option.title}
                  {option.disabled ? <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-white/45">Próximamente</span> : null}
                </span>
                <span className="mt-1 block text-xs leading-5 text-white/45">{option.detail}</span>
              </span>
            </button>
          );
        })}
      </div>
      {error ? <p className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}
      <p className="mt-5 text-center text-xs leading-5 text-white/35">
        Tu Player es la identidad base. Elegir un camino no otorga permisos administrativos: esos permisos nacen de relaciones reales con cada negocio o espacio.
      </p>
    </OnboardingShell>
  );
}
