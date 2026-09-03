"use client";

import Link from "next/link";
import { CheckCircle2, LockKeyhole, MapPin, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MainFooter, MainNav } from "@/components/layout";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import { useCart } from "@/lib/cart-store";
import { supabase } from "@/lib/supabase";
import { money } from "@/lib/store-utils";

type ShippingMethod = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  delivery_method: "shipping" | "pickup";
  carrier: string | null;
  pricing_type: "flat" | "free" | "adapter";
  flat_price: number | null;
  currency: string;
};

type PrivateAddress = {
  id: string;
  recipient_name: string;
  recipient_phone: string | null;
  recipient_email: string | null;
  address_line_1: string;
  address_line_2: string | null;
  city: string;
  province: string;
  postal_code: string;
  country: string;
};

type PurchaseEligibility = {
  dateOfBirth: string | null;
  isAdult: boolean;
  hasAddress: boolean;
  defaultAddress: PrivateAddress | null;
};

export default function CheckoutPage() {
  const { session, user } = useAuth();
  const { items, subtotal, clear } = useCart();
  const [methods, setMethods] = useState<ShippingMethod[]>([]);
  const [methodId, setMethodId] = useState("");
  const [eligibility, setEligibility] = useState<PurchaseEligibility | null>(null);
  const [loadingMethods, setLoadingMethods] = useState(true);
  const [loadingIdentity, setLoadingIdentity] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoadingMethods(true);
      const { data, error: methodsError } = await supabase
        .from("commerce_shipping_methods")
        .select("id,code,name,description,delivery_method,carrier,pricing_type,flat_price,currency")
        .eq("owner_type", "clouva")
        .eq("active", true)
        .order("sort_order")
        .order("name");
      if (!active) return;
      if (methodsError) {
        setError(methodsError.message);
        setMethods([]);
      } else {
        const available = (data ?? []) as ShippingMethod[];
        setMethods(available);
        setMethodId((current) => current || available[0]?.id || "");
      }
      setLoadingMethods(false);
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    if (!session?.access_token) {
      setEligibility(null);
      setLoadingIdentity(false);
      return () => { active = false; };
    }
    setLoadingIdentity(true);
    void authenticatedFetch("/api/account/purchase-profile")
      .then((response) => readApiJson<{ eligibility: PurchaseEligibility }>(response))
      .then((payload) => { if (active) setEligibility(payload.eligibility); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "No se pudo cargar tu identidad de compra."); })
      .finally(() => { if (active) setLoadingIdentity(false); });
    return () => { active = false; };
  }, [session?.access_token]);

  const selectedMethod = useMemo(() => methods.find((method) => method.id === methodId) ?? null, [methodId, methods]);
  const currency = items[0]?.currency ?? selectedMethod?.currency ?? "ARS";
  const displayedShippingCost = selectedMethod?.pricing_type === "flat"
    ? Number(selectedMethod.flat_price || 0)
    : selectedMethod?.pricing_type === "free" ? 0 : null;
  const displayedTotal = subtotal() + (displayedShippingCost ?? 0);
  const canPurchase = Boolean(user && eligibility?.isAdult && eligibility?.hasAddress && eligibility.defaultAddress);
  const address = eligibility?.defaultAddress ?? null;

  async function submit() {
    setError("");
    if (!items.length) return setError("El carrito está vacío.");
    if (!session?.access_token) return setError("Iniciá sesión en CLOUVA para confirmar la compra.");
    if (!eligibility?.isAdult) return setError("Necesitás ser mayor de 18 años para comprar en CLOUVA.");
    if (!address) return setError("Agregá una dirección privada de entrega para continuar.");
    if (!selectedMethod) return setError("Elegí un método de entrega disponible.");

    setBusy(true);
    try {
      const response = await authenticatedFetch("/api/commerce/checkout", {
        method: "POST",
        body: JSON.stringify({
          items: items.map((item) => ({ productId: item.productId, variantId: item.variantId, quantity: item.quantity })),
          shipping: { methodId: selectedMethod.id },
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; initPoint?: string; action?: string };
      if (!response.ok || !payload.initPoint) {
        if (payload.action === "/cuenta/compras") setError(`${payload.error || "Revisá tus datos privados para comprar."} Podés actualizarlos abajo.`);
        else setError(payload.error || "No se pudo abrir Mercado Pago.");
        setBusy(false);
        return;
      }
      clear();
      window.location.assign(payload.initPoint);
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "No se pudo iniciar el pago.");
      setBusy(false);
    }
  }

  return (
    <main>
      <MainNav />
      <section className="mx-auto max-w-3xl px-4 py-10 md:px-8 md:py-14">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#95d8ff]/70">CLOUVA Store</p>
        <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">Finalizar compra</h1>
        <p className="mt-3 text-sm text-white/55">Entrega privada, identidad de cuenta y pago. Ninguno de estos datos se toma de tu Player público.</p>

        {!items.length ? (
          <div className="mt-8 rounded-[2rem] border border-white/10 bg-white/[0.03] p-6 text-white/60">Tu carrito está vacío.</div>
        ) : (
          <div className="mt-7 grid gap-4">
            <section className="rounded-[1.7rem] border border-white/10 bg-white/[0.03] p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 gap-3"><MapPin size={18} className="mt-0.5 shrink-0 text-[#95d8ff]/75"/><div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">Entrega</p><h2 className="mt-1 text-sm font-semibold">Dirección privada guardada</h2></div></div>
                {address ? <CheckCircle2 size={18} className="shrink-0 text-emerald-300"/> : null}
              </div>
              {loadingIdentity ? <div className="mt-4 h-16 animate-pulse rounded-xl bg-white/[0.04]"/> : address ? (
                <div className="mt-4 rounded-2xl border border-white/8 bg-black/20 p-4 text-sm text-white/62">
                  <p className="font-semibold text-white/82">{address.recipient_name}</p>
                  <p className="mt-1">{address.address_line_1}{address.address_line_2 ? ` · ${address.address_line_2}` : ""}</p>
                  <p>{address.city}, {address.province} · {address.postal_code} · {address.country}</p>
                  <Link href="/cuenta/compras" className="mt-3 inline-block text-xs font-semibold text-[#95d8ff]">Cambiar dirección</Link>
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-amber-300/15 bg-amber-300/[0.04] p-4"><p className="text-sm text-amber-100/85">Falta una dirección de entrega válida.</p><Link href="/cuenta/compras" className="mt-3 inline-flex rounded-full border border-amber-200/20 px-3 py-2 text-xs font-semibold text-amber-100">Agregar dirección</Link></div>
              )}
            </section>

            <section className="rounded-[1.7rem] border border-white/10 bg-white/[0.03] p-5">
              <div className="flex items-center justify-between gap-4"><div className="flex items-center gap-3"><ShieldCheck size={18} className="text-violet-300/75"/><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">Identidad</p><h2 className="mt-1 text-sm font-semibold">Mayoría de edad</h2></div></div>{eligibility?.isAdult ? <CheckCircle2 size={18} className="text-emerald-300"/> : null}</div>
              <p className="mt-3 text-sm text-white/50">{loadingIdentity ? "Verificando tu cuenta…" : eligibility?.isAdult ? "Cuenta habilitada para compras: 18+." : "Necesitás tener 18 años o más para comprar en CLOUVA."}</p>
              {!loadingIdentity && !eligibility?.isAdult ? <Link href="/cuenta/compras" className="mt-3 inline-flex rounded-full border border-violet-300/20 px-3 py-2 text-xs font-semibold text-violet-200">Completar identidad privada</Link> : null}
            </section>

            <section className="rounded-[1.7rem] border border-white/10 bg-white/[0.03] p-5">
              <div className="flex items-center gap-3"><LockKeyhole size={18} className="text-white/55"/><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">Pago</p><h2 className="mt-1 text-sm font-semibold">Método de entrega y Mercado Pago</h2></div></div>
              <label className="mt-4 block text-sm text-white/60" htmlFor="shipping-method">Método de entrega</label>
              <select id="shipping-method" value={methodId} onChange={(event) => setMethodId(event.target.value)} disabled={loadingMethods || !methods.length} className="mt-2 w-full rounded-2xl border border-white/10 bg-black px-4 py-3 outline-none transition focus:border-[#95d8ff]/60 disabled:opacity-50">
                {!methods.length ? <option value="">No hay métodos configurados</option> : null}
                {methods.map((method) => <option key={method.id} value={method.id}>{method.name}{method.pricing_type === "flat" ? ` · ${money(Number(method.flat_price || 0), method.currency)}` : ""}{method.pricing_type === "free" ? " · Gratis" : ""}</option>)}
              </select>
              {selectedMethod?.description ? <p className="mt-2 text-sm text-white/45">{selectedMethod.description}</p> : null}
              {selectedMethod?.carrier ? <p className="mt-1 text-xs text-white/35">Transportista: {selectedMethod.carrier}</p> : null}

              <div className="mt-5 grid gap-2 border-t border-white/10 pt-5">
                <div className="flex items-center justify-between text-white/60"><span>Productos</span><span>{money(subtotal(), currency)}</span></div>
                <div className="flex items-center justify-between text-white/60"><span>Entrega</span><span>{displayedShippingCost == null ? "Se calcula al confirmar" : displayedShippingCost === 0 ? "Gratis" : money(displayedShippingCost, currency)}</span></div>
                <div className="mt-2 flex items-center justify-between text-xl"><span>Total</span><strong>{displayedShippingCost == null ? `${money(subtotal(), currency)} + entrega` : money(displayedTotal, currency)}</strong></div>
              </div>

              {!user ? <Link href="/login?next=/checkout" className="mt-5 flex min-h-12 items-center justify-center rounded-full bg-white px-5 font-semibold text-black">Iniciar sesión para comprar</Link> : (
                <button type="button" disabled={busy || loadingMethods || loadingIdentity || !methods.length || !canPurchase} onClick={() => void submit()} className="mt-5 min-h-12 w-full rounded-full bg-white px-5 py-3 font-semibold text-black transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-35">
                  {busy ? "Abriendo Mercado Pago…" : canPurchase ? "Continuar a Mercado Pago" : "Completá los requisitos para continuar"}
                </button>
              )}
              {!loadingMethods && !methods.length ? <p className="mt-3 text-center text-sm text-amber-200">La tienda todavía no tiene un método de entrega activo.</p> : null}
              <p className="mt-3 text-center text-xs leading-5 text-white/35">El servidor vuelve a validar edad, dirección, productos, stock y entrega antes de crear el pago.</p>
            </section>

            {error ? <p className="rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}</p> : null}
          </div>
        )}
      </section>
      <MainFooter />
    </main>
  );
}
