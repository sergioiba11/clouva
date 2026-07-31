"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import type { StudioService } from "@/lib/players-data";

const CTA_LABEL: Record<StudioService["cta_type"], string> = {
  contratar: "Contratar",
  reservar: "Reservar",
  presupuesto: "Solicitar presupuesto",
};

function formatPrice(service: StudioService) {
  if (service.price_type === "consultar" || service.price == null) return "Consultar";
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: service.currency, maximumFractionDigits: 0 }).format(service.price);
}

export function StudioServicesCart({ studioId, studioSlug, services }: { studioId: string; studioSlug: string; services: StudioService[] }) {
  const router = useRouter();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fixedServices = services.filter((s) => s.price_type === "fixed");
  const quoteServices = services.filter((s) => s.price_type === "consultar");

  const setQuantity = (id: string, qty: number) => {
    setQuantities((current) => {
      const next = { ...current };
      if (qty <= 0) delete next[id];
      else next[id] = qty;
      return next;
    });
  };

  const selected = useMemo(
    () => fixedServices
      .filter((s) => (quantities[s.id] || 0) > 0)
      .map((s) => ({ service: s, quantity: quantities[s.id] })),
    [fixedServices, quantities],
  );
  const total = selected.reduce((sum, { service, quantity }) => sum + Number(service.price) * quantity, 0);
  const currency = selected[0]?.service.currency || "ARS";

  const checkout = async () => {
    if (selected.length === 0) return;
    setWorking(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/studios/${encodeURIComponent(studioId)}/service-orders`, {
        method: "POST",
        body: JSON.stringify({
          items: selected.map(({ service, quantity }) => ({ serviceId: service.id, quantity })),
        }),
      });
      const payload = await readApiJson<{ initPoint: string | null; orderId: string }>(response);
      if (payload.initPoint) window.location.assign(payload.initPoint);
    } catch (checkoutError) {
      if (checkoutError instanceof Error && /sesión requerida/i.test(checkoutError.message)) {
        router.push(`/login?next=/studios/${studioSlug}`);
        return;
      }
      setError(checkoutError instanceof Error ? checkoutError.message : "No se pudo iniciar el pago.");
    } finally {
      setWorking(false);
    }
  };

  if (services.length === 0) return null;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="grid gap-3 sm:grid-cols-2">
        {fixedServices.map((service) => {
          const qty = quantities[service.id] || 0;
          return (
            <article key={service.id} className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.025] p-5">
              {service.category ? <p className="text-xs uppercase tracking-[0.18em] text-violet-300/70">{service.category}</p> : null}
              <h3 className="mt-2 font-semibold">{service.name}</h3>
              {service.description ? <p className="mt-2 line-clamp-3 text-sm leading-6 text-white/55">{service.description}</p> : null}
              <div className="mt-4 flex items-center justify-between">
                <span className="font-semibold text-white/90">{formatPrice(service)}</span>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setQuantity(service.id, qty - 1)} disabled={qty === 0} className="h-8 w-8 rounded-lg border border-white/15 text-white/70 disabled:opacity-30">–</button>
                  <span className="w-5 text-center text-sm">{qty}</span>
                  <button type="button" onClick={() => setQuantity(service.id, qty + 1)} className="h-8 w-8 rounded-lg border border-white/15 text-white/70">+</button>
                </div>
              </div>
            </article>
          );
        })}
        {quoteServices.map((service) => (
          <article key={service.id} className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.025] p-5">
            {service.category ? <p className="text-xs uppercase tracking-[0.18em] text-violet-300/70">{service.category}</p> : null}
            <h3 className="mt-2 font-semibold">{service.name}</h3>
            {service.description ? <p className="mt-2 line-clamp-3 text-sm leading-6 text-white/55">{service.description}</p> : null}
            <div className="mt-4 flex items-center justify-between">
              <span className="font-semibold text-white/60">A consultar</span>
              <a href={`mailto:?subject=${encodeURIComponent(`Consulta: ${service.name}`)}`} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs">{CTA_LABEL[service.cta_type]}</a>
            </div>
          </article>
        ))}
      </div>

      {fixedServices.length > 0 ? (
        <aside className="h-fit rounded-2xl border border-violet-400/20 bg-[#0b0913] p-6">
          <p className="text-xs uppercase tracking-[0.2em] text-white/35">Tu selección</p>
          {selected.length === 0 ? (
            <p className="mt-4 text-sm text-white/45">Elegí uno o más servicios para ver el total.</p>
          ) : (
            <div className="mt-4 space-y-2 text-sm">
              {selected.map(({ service, quantity }) => (
                <div key={service.id} className="flex justify-between text-white/70">
                  <span>{service.name} × {quantity}</span>
                  <span>{new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(service.price) * quantity)}</span>
                </div>
              ))}
              <div className="mt-3 flex justify-between border-t border-white/10 pt-3 font-semibold">
                <span>Total</span>
                <span>{new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 }).format(total)}</span>
              </div>
            </div>
          )}
          {error ? <p className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-xs text-red-200">{error}</p> : null}
          <button disabled={selected.length === 0 || working} onClick={() => void checkout()} className="mt-5 w-full rounded-xl bg-violet-600 px-5 py-3 font-semibold disabled:opacity-40">{working ? "Procesando..." : "Pagar y contratar"}</button>
        </aside>
      ) : null}
    </div>
  );
}
