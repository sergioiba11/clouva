"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type JoinResult = {
  joined: boolean;
  membershipStatus?: "pending" | "active";
  publicRole?: string;
  needsPlayer?: boolean;
  redirectTo?: string;
};

export function StudioMembershipCheckoutAction({
  studioSlug,
  plan,
}: {
  studioSlug: string;
  plan: { id: string; slug: string; isFree: boolean };
}) {
  const router = useRouter();
  const { user, role, loading } = useAuth();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return null;

  if (!user) {
    // The existing login redirect preserves `plan` for subscribe intent. The
    // checkout itself decides whether the selected plan is free or paid, so no
    // payment starts before the user confirms it there.
    const query = new URLSearchParams({ studio: studioSlug, intent: "subscribe", plan: plan.slug });
    return (
      <a href={`/login?${query.toString()}`} className="block w-full rounded-xl bg-violet-600 px-5 py-3 text-center font-semibold transition hover:bg-violet-500">
        {plan.isFree ? "Iniciar sesión para unirme" : "Iniciar sesión para continuar"}
      </a>
    );
  }

  const finishJoin = (payload: JoinResult) => {
    const destination = payload.redirectTo || `/studios/${studioSlug}?joined=1`;
    router.push(destination);
    router.refresh();
  };

  const confirm = async () => {
    setWorking(true);
    setError(null);
    try {
      if (plan.isFree) {
        const response = await authenticatedFetch(`/api/studios/${encodeURIComponent(studioSlug)}/membership/join`, {
          method: "POST",
          body: JSON.stringify({ planId: plan.id }),
        });
        finishJoin(await readApiJson<JoinResult>(response));
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

  const adminJoin = async () => {
    setWorking(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/studios/${encodeURIComponent(studioSlug)}/membership/admin-join`, {
        method: "POST",
        body: JSON.stringify({ planId: plan.id }),
      });
      finishJoin(await readApiJson<JoinResult>(response));
    } catch (adminJoinError) {
      setError(adminJoinError instanceof Error ? adminJoinError.message : "No se pudo omitir la suscripción.");
      setWorking(false);
    }
  };

  return (
    <div>
      <button type="button" disabled={working} onClick={() => void confirm()} className="w-full rounded-xl bg-violet-600 px-5 py-3 font-semibold transition hover:bg-violet-500 disabled:opacity-60">
        {working ? "Procesando..." : plan.isFree ? "Unirme gratis" : "Confirmar y pagar"}
      </button>
      {!plan.isFree && role === "admin" ? (
        <button type="button" disabled={working} onClick={() => void adminJoin()} className="mt-2 w-full rounded-xl border border-amber-400/30 px-5 py-2.5 text-xs font-semibold text-amber-200 transition hover:bg-amber-400/10 disabled:opacity-60">
          Omitir suscripción y unirme (admin)
        </button>
      ) : null}
      {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
    </div>
  );
}
