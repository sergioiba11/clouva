"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PremiumCard } from "@/components/os-ui";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type StudioOsPriceState = {
  environment: "test" | "production";
  product: { id: string; code: string; name: string; description: string | null; is_active: boolean } | null;
  price: {
    id: string;
    amount: number;
    currency: string;
    billing_interval: "month" | "year";
    interval_count: number;
    provider_plan_id: string | null;
    is_active: boolean;
    created_at: string;
  } | null;
};

const money = (amount: number, currency: string) => new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency,
  maximumFractionDigits: 0,
}).format(amount);

export default function StudioOsAdminPage() {
  const [state, setState] = useState<StudioOsPriceState | null>(null);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("ARS");
  const [billingInterval, setBillingInterval] = useState<"month" | "year">("month");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await authenticatedFetch("/api/admin/studio-os-price");
      const payload = await readApiJson<StudioOsPriceState>(response);
      setState(payload);
      if (payload.price) {
        setAmount(String(payload.price.amount));
        setCurrency(payload.price.currency);
        setBillingInterval(payload.price.billing_interval);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar Studio OS.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await authenticatedFetch("/api/admin/studio-os-price", {
        method: "POST",
        body: JSON.stringify({ amount: Number(amount), currency, billingInterval }),
      });
      const payload = await readApiJson<StudioOsPriceState>(response);
      setState(payload);
      setMessage("Precio de Studio OS configurado y aprovisionado en Mercado Pago.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo configurar el precio.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <PremiumCard className="p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-violet-300">Producto del Estudio</p>
            <h1 className="mt-2 text-2xl font-bold">CLOUVA Studio OS</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/50">
              Este es el precio que paga el dueño por activar el sistema operativo de su Estudio. No modifica el plan Free/VIP personal ni las membresías que después venda cada Estudio.
            </p>
          </div>
          <Link href="/admin/estudios" className="rounded-xl border border-white/15 px-4 py-2 text-sm">Volver a Estudios</Link>
        </div>
      </PremiumCard>

      {error ? <p className="rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}</p> : null}
      {message ? <p className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm text-emerald-200">{message}</p> : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <PremiumCard className="p-6">
          <h2 className="text-lg font-semibold">Configurar suscripción</h2>
          <p className="mt-2 text-sm text-white/45">No se publica ningún precio inventado. El valor queda activo recién cuando Mercado Pago devuelve el plan aprovisionado.</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <label className="text-sm text-white/60">
              Precio
              <input value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))} placeholder="Ej: 15000" className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-violet-400/50" />
            </label>
            <label className="text-sm text-white/60">
              Moneda
              <input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase().slice(0, 3))} className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-violet-400/50" />
            </label>
            <label className="text-sm text-white/60">
              Frecuencia
              <select value={billingInterval} onChange={(event) => setBillingInterval(event.target.value as "month" | "year")} className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-violet-400/50">
                <option value="month">Mensual</option>
                <option value="year">Anual</option>
              </select>
            </label>
          </div>
          <button disabled={saving || !amount} onClick={() => void save()} className="mt-6 w-full rounded-xl bg-violet-600 px-5 py-3.5 font-semibold transition hover:bg-violet-500 disabled:opacity-50">
            {saving ? "Aprovisionando en Mercado Pago…" : state?.price ? "Publicar nuevo precio" : "Activar precio de Studio OS"}
          </button>
          <p className="mt-3 text-xs leading-5 text-white/35">Publicar un nuevo precio desactiva el anterior para nuevas altas. Las suscripciones existentes conservan su contrato actual.</p>
        </PremiumCard>

        <PremiumCard className="p-6">
          <h2 className="text-lg font-semibold">Estado actual</h2>
          {loading ? <p className="mt-4 text-sm text-white/45">Cargando…</p> : state?.price ? (
            <div className="mt-5 space-y-3 text-sm">
              <p className="text-3xl font-bold">{money(Number(state.price.amount), state.price.currency)}</p>
              <p className="text-white/55">por {state.price.billing_interval === "year" ? "año" : "mes"}</p>
              <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-xs text-white/50">
                <p>Entorno: <span className="text-white">{state.environment}</span></p>
                <p className="mt-2">Producto: <span className="text-white">{state.product?.is_active ? "Activo" : "Inactivo"}</span></p>
                <p className="mt-2">Mercado Pago: <span className="text-white">{state.price.provider_plan_id ? "Aprovisionado" : "Pendiente"}</span></p>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm leading-6 text-amber-200/75">Todavía no hay precio activo. Los Estudios pueden guardar su borrador, pero no activarse hasta que definas este valor.</p>
          )}
        </PremiumCard>
      </div>
    </div>
  );
}
