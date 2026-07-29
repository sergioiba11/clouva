"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type VipState = {
  enabled: boolean;
  environment: "test" | "production";
  price: null | {
    id: string;
    currency: string;
    amount: number;
    billing_interval: "month" | "year";
    interval_count: number;
    product: { code: string; name: string; description: string | null };
  };
  subscription: null | {
    id: string;
    status: string;
    provider_status: string | null;
    current_period_end: string | null;
    next_payment_at: string | null;
    cancel_at_period_end: boolean;
    cancelled_at: string | null;
    init_point: string | null;
  };
  entitlement: null | {
    tier: string;
    status: string;
    valid_until: string | null;
    expires_at: string | null;
  };
};

const VIP_BENEFITS = [
  "Personalización avanzada del Player",
  "Galería ampliada y secciones avanzadas",
  "Portadas premium",
  "Administración de Estudios autorizados",
  "Gestión de Players y solicitudes",
  "Herramientas premium de contenido",
];

export default function VipPage() {
  const router = useRouter();
  const { user, session, loading: authLoading } = useAuth();
  const [state, setState] = useState<VipState | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const response = session
        ? await authenticatedFetch("/api/billing/vip")
        : await fetch("/api/billing/vip", { cache: "no-store" });
      setState(await readApiJson<VipState>(response));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar CLOUVA VIP.");
    }
  };
  useEffect(() => { if (!authLoading) void load(); }, [authLoading, session?.access_token]);

  const priceLabel = useMemo(() => {
    if (!state?.price) return null;
    return new Intl.NumberFormat("es-AR", { style: "currency", currency: state.price.currency, maximumFractionDigits: 2 }).format(Number(state.price.amount));
  }, [state?.price]);

  const vipActive = state?.entitlement?.tier === "vip" && state.entitlement.status === "active";
  const subscriptionActive = state?.subscription && ["created", "pending", "authorized", "active", "past_due", "paused"].includes(state.subscription.status);

  const subscribe = async () => {
    if (!user) {
      router.push("/login?next=/vip");
      return;
    }
    setWorking(true);
    setError(null);
    try {
      if (state?.subscription?.init_point && ["created", "pending"].includes(state.subscription.status)) {
        window.location.assign(state.subscription.init_point);
        return;
      }
      const response = await authenticatedFetch("/api/billing/mercadopago/vip/subscribe", {
        method: "POST",
        headers: { "x-idempotency-key": crypto.randomUUID() },
      });
      const payload = await readApiJson<{ subscriptionId: string; status: string; initPoint: string | null }>(response);
      if (!payload.initPoint) throw new Error("Mercado Pago no devolvió el checkout.");
      window.location.assign(payload.initPoint);
    } catch (subscribeError) {
      setError(subscribeError instanceof Error ? subscribeError.message : "No se pudo iniciar la suscripción.");
      setWorking(false);
    }
  };

  const cancel = async () => {
    if (!state?.subscription?.id) return;
    if (!window.confirm("¿Cancelar la renovación de CLOUVA VIP?")) return;
    setWorking(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/billing/subscriptions/${encodeURIComponent(state.subscription.id)}/cancel`, { method: "POST" });
      await readApiJson(response);
      await load();
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "No se pudo cancelar la suscripción.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#05040a] px-4 py-8 text-white sm:px-6 sm:py-14">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(245,158,11,.16),transparent_34%),radial-gradient(circle_at_15%_70%,rgba(124,58,237,.22),transparent_38%)]" />
      <div className="relative mx-auto max-w-5xl">
        <header className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-400/30 bg-amber-400/10 text-3xl text-amber-300">♛</div>
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.3em] text-amber-300/80">Membresía</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight sm:text-6xl"><span className="text-amber-300">CLOUVA</span> VIP</h1>
          <p className="mx-auto mt-4 max-w-2xl text-white/55">Más herramientas para construir y administrar tu identidad.</p>
        </header>

        <section className="mt-10 grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="grid gap-5 sm:grid-cols-2">
            <article className="rounded-[2rem] border border-white/10 bg-white/[0.025] p-6">
              <p className="text-sm font-semibold text-white/50">FREE</p>
              <h2 className="mt-3 text-2xl font-semibold">Perfil público</h2>
              <ul className="mt-6 space-y-3 text-sm text-white/55"><li>✓ Player público básico</li><li>✓ URL compartible</li><li>✓ Links y presentación</li><li>✓ Vinculación con Estudios</li><li>— Sin administración premium</li></ul>
            </article>
            <article className="rounded-[2rem] border border-amber-400/35 bg-gradient-to-b from-amber-400/10 to-violet-500/5 p-6 shadow-xl shadow-amber-950/10">
              <p className="text-sm font-semibold text-amber-300">VIP</p>
              <h2 className="mt-3 text-2xl font-semibold">Identidad avanzada</h2>
              <ul className="mt-6 space-y-3 text-sm text-white/75">{VIP_BENEFITS.map((benefit) => <li key={benefit} className="flex gap-2"><span className="text-amber-300">✓</span>{benefit}</li>)}</ul>
            </article>
          </div>

          <aside className="rounded-[2rem] border border-amber-400/25 bg-[#0b0913] p-6 sm:p-8">
            <p className="text-xs uppercase tracking-[0.2em] text-white/35">Plan recurrente</p>
            {state?.price ? <><div className="mt-4 flex items-end justify-between gap-3"><span className="text-4xl font-bold">{priceLabel}</span><span className="pb-1 text-sm text-white/45">/{state.price.billing_interval === "month" ? "mes" : "año"}</span></div><p className="mt-2 text-sm text-white/45">Renovación automática mediante Mercado Pago.</p></> : <p className="mt-4 rounded-xl border border-white/10 p-4 text-sm text-white/45">El precio todavía no fue activado por CLOUVA.</p>}

            {state?.environment === "test" ? <p className="mt-4 rounded-xl border border-violet-400/20 bg-violet-500/10 px-3 py-2 text-xs text-violet-200">Modo de prueba: no utiliza dinero real.</p> : null}
            {vipActive ? <div className="mt-5 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-4"><p className="font-semibold text-emerald-200">CLOUVA VIP activo</p><p className="mt-1 text-xs text-white/45">Vigente hasta {new Date(state?.entitlement?.valid_until || state?.entitlement?.expires_at || "").toLocaleDateString("es-AR")}</p></div> : null}
            {state?.subscription && !vipActive ? <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.025] p-4"><p className="font-semibold">Estado: {state.subscription.status}</p><p className="mt-1 text-xs text-white/45">La pantalla de retorno no activa VIP. Esperamos la verificación del Webhook.</p></div> : null}

            {error ? <p className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}

            {!subscriptionActive ? <button disabled={working || !state?.enabled || !state?.price} onClick={() => void subscribe()} className="mt-6 w-full rounded-xl bg-gradient-to-r from-amber-400 to-yellow-300 px-5 py-3.5 font-bold text-black transition hover:brightness-105 disabled:opacity-50">{working ? "Procesando..." : "Activar CLOUVA VIP"}</button> : null}
            {state?.subscription?.init_point && !vipActive && ["created", "pending"].includes(state.subscription.status) ? <button disabled={working} onClick={() => void subscribe()} className="mt-3 w-full rounded-xl bg-violet-600 px-5 py-3 font-semibold">Continuar en Mercado Pago</button> : null}
            {subscriptionActive ? <button disabled={working} onClick={() => void cancel()} className="mt-3 w-full rounded-xl border border-red-400/20 px-5 py-3 text-sm text-red-300">Cancelar renovación</button> : null}
            <p className="mt-4 text-center text-xs text-white/30">El frontend nunca concede VIP. Los beneficios se activan después de verificar el pago en el servidor.</p>
          </aside>
        </section>

        <section className="mt-8 rounded-[2rem] border border-violet-400/15 bg-violet-500/5 p-6 text-center"><p className="text-xs uppercase tracking-[0.2em] text-violet-300/70">Próximamente</p><p className="mt-2 text-white/60">PJ de CLOUVA · Universos · Experiencias inmersivas</p></section>
      </div>
    </main>
  );
}
