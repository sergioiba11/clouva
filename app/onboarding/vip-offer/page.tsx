"use client";

import { useRouter } from "next/navigation";
import { Crown, Sparkles } from "lucide-react";
import { OnboardingShell } from "@/components/onboarding/OnboardingShell";

export default function VipOfferPage() {
  const router = useRouter();

  return (
    <OnboardingShell step={5} title="Tu perfil ya está publicado." description="Esto es lo que se activa con CLOUVA VIP.">
      <div className="rounded-[1.75rem] border border-amber-400/25 bg-gradient-to-b from-amber-400/10 to-violet-500/5 p-6">
        <div className="flex items-center gap-2 text-amber-300"><Crown className="h-5 w-5" /><p className="text-sm font-semibold uppercase tracking-[0.2em]">CLOUVA VIP</p></div>
        <ul className="mt-5 space-y-3 text-sm text-white/80">
          <li className="flex items-start gap-2.5"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" /> Identidad visual profesional: logo, portada y paleta generados con IA para tu página</li>
          <li className="flex items-start gap-2.5"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" /> Biografía y copy optimizados con IA</li>
          <li className="flex items-start gap-2.5"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" /> Acceso para crear y administrar tu propio Estudio (con su propio logo e identidad visual)</li>
          <li className="flex items-start gap-2.5"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" /> 800 Flows por mes para usar dentro de CLOUVA</li>
          <li className="flex items-start gap-2.5"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" /> Badge VIP, links ilimitados y soporte prioritario</li>
        </ul>
      </div>

      <button onClick={() => router.push("/vip")} className="mt-6 w-full rounded-xl bg-gradient-to-r from-amber-400 to-yellow-300 px-5 py-3.5 font-bold text-black transition hover:brightness-105">Ver planes y activar VIP</button>
      <button onClick={() => router.replace("/")} className="mt-3 w-full rounded-xl border border-white/15 px-4 py-3 text-sm text-white/60">Seguir con el plan Free</button>
    </OnboardingShell>
  );
}
