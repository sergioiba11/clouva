"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

export function StudioMembershipCheckoutAction({
  studioSlug,
  plan,
}: {
  studioSlug: string;
  plan: { id: string; slug: string; isFree: boolean };
}) {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return null;

  if (!user) {
    // Contextual auth: /login carries studio + intent (+ plan for paid ones)
    // and resolvePostLoginDestination() in login-content.tsx sends the user
    // straight back here after signup/login instead of the default role home.
    const query = new URLSearchParams({ studio: studioSlug, intent: plan.isFree ? "join" : "subscribe" });
    if (!plan.isFree) query.set("plan", plan.slug);
    return (
      <a
        href={`/login?${query.toString()}`}
        className="block w-full rounded-xl bg-violet-600 px-5 py-3 text-center font-semibold transition hover:bg-violet-500"
      >
        {plan.isFree ? "Iniciar sesión para unirme" : "Iniciar sesión para continuar"}
      </a>
    );
  }

  const confirm = async () => {
    setWorking(true);
    setError(null);
    try {
      if (plan.isFree) {
        const response = await authenticatedFetch(`/api/studios/${encodeURIComponent(studioSlug)}/membership/join`, { method: "POST" });
        await readApiJson(response);
        router.push(`/studios/${studioSlug}?joined=1`);
        return;
      }
      const response = await authenticatedFetch(`/api/studios/${encodeURIComponent(studioSlug)}/membership/subscribe`, {
        method: "POST",
        headers: { "x-idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ planId: plan.id }),
      });
      const payload = await readApiJson<{ initPoint: string | null }>(response);
      if (!payload.initPoint) throw new Error("Mercado Pago no devolvió el checkout.");
      window.location.assign(payload.initPoint);
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "No se pudo completar la acción.");
      setWorking(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        disabled={working}
        onClick={() => void confirm()}
        className="w-full rounded-xl bg-violet-600 px-5 py-3 font-semibold transition hover:bg-violet-500 disabled:opacity-60"
      >
        {working ? "Procesando..." : plan.isFree ? "Unirme gratis" : "Confirmar y pagar"}
      </button>
      {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
    </div>
  );
}
