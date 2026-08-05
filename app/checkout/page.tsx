"use client";

import { useEffect, useMemo, useState } from "react";
import { MainFooter, MainNav } from "@/components/layout";
import { useAuth } from "@/components/auth-provider";
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

type ShippingForm = {
  methodId: string;
  recipientName: string;
  recipientPhone: string;
  recipientEmail: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
};

const INITIAL_FORM: ShippingForm = {
  methodId: "",
  recipientName: "",
  recipientPhone: "",
  recipientEmail: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  province: "",
  postalCode: "",
  country: "AR",
};

export default function CheckoutPage() {
  const { session, user, profile } = useAuth();
  const { items, subtotal, clear } = useCart();
  const [methods, setMethods] = useState<ShippingMethod[]>([]);
  const [shipping, setShipping] = useState<ShippingForm>(INITIAL_FORM);
  const [loadingMethods, setLoadingMethods] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const displayName = profile?.full_name || profile?.display_name || "";
    setShipping((current) => ({
      ...current,
      recipientName: current.recipientName || displayName,
      recipientEmail: current.recipientEmail || user?.email || "",
    }));
  }, [profile?.display_name, profile?.full_name, user?.email]);

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
        setShipping((current) => ({
          ...current,
          methodId: current.methodId || available[0]?.id || "",
        }));
      }
      setLoadingMethods(false);
    })();

    return () => {
      active = false;
    };
  }, []);

  const selectedMethod = useMemo(
    () => methods.find((method) => method.id === shipping.methodId) ?? null,
    [methods, shipping.methodId],
  );
  const currency = items[0]?.currency ?? selectedMethod?.currency ?? "ARS";
  const displayedShippingCost =
    selectedMethod?.pricing_type === "flat"
      ? Number(selectedMethod.flat_price || 0)
      : selectedMethod?.pricing_type === "free"
        ? 0
        : null;
  const displayedTotal = subtotal() + (displayedShippingCost ?? 0);
  const needsAddress = selectedMethod?.delivery_method === "shipping";

  function updateField<K extends keyof ShippingForm>(key: K, value: ShippingForm[K]) {
    setShipping((current) => ({ ...current, [key]: value }));
  }

  async function submit() {
    setError("");
    if (!items.length) {
      setError("El carrito está vacío.");
      return;
    }
    if (!session?.access_token) {
      setError("Iniciá sesión en CLOUVA para confirmar la compra.");
      return;
    }
    if (!selectedMethod) {
      setError("Elegí un método de entrega disponible.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/commerce/checkout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          items: items.map((item) => ({
            productId: item.productId,
            variantId: item.variantId,
            quantity: item.quantity,
          })),
          shipping,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        initPoint?: string;
      };
      if (!response.ok || !payload.initPoint) {
        throw new Error(payload.error || "No se pudo abrir Mercado Pago.");
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
      <section className="mx-auto max-w-3xl px-4 py-14 md:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#95d8ff]/70">CLOUVA Store</p>
        <h1 className="mt-3 text-4xl font-semibold">Finalizar compra</h1>
        <p className="mt-3 text-white/55">Elegí la entrega, completá los datos y pagá una sola vez desde Mercado Pago.</p>

        {!items.length ? (
          <div className="mt-8 rounded-[2rem] border border-white/10 bg-white/[0.03] p-6 text-white/60">
            Tu carrito está vacío.
          </div>
        ) : (
          <div className="mt-8 grid gap-5 rounded-[2rem] border border-white/10 bg-white/[0.03] p-6">
            <div>
              <label className="text-sm text-white/60" htmlFor="shipping-method">
                Método de entrega
              </label>
              <select
                id="shipping-method"
                value={shipping.methodId}
                onChange={(event) => updateField("methodId", event.target.value)}
                disabled={loadingMethods || !methods.length}
                className="mt-2 w-full rounded-2xl border border-white/10 bg-black px-4 py-3 outline-none transition focus:border-[#95d8ff]/60 disabled:opacity-50"
              >
                {!methods.length ? <option value="">No hay métodos configurados</option> : null}
                {methods.map((method) => (
                  <option key={method.id} value={method.id}>
                    {method.name}
                    {method.pricing_type === "flat" ? ` · ${money(Number(method.flat_price || 0), method.currency)}` : ""}
                    {method.pricing_type === "free" ? " · Gratis" : ""}
                  </option>
                ))}
              </select>
              {selectedMethod?.description ? <p className="mt-2 text-sm text-white/45">{selectedMethod.description}</p> : null}
              {selectedMethod?.carrier ? <p className="mt-1 text-xs text-white/35">Transportista: {selectedMethod.carrier}</p> : null}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <input
                type="text"
                autoComplete="name"
                placeholder="Nombre y apellido"
                value={shipping.recipientName}
                onChange={(event) => updateField("recipientName", event.target.value)}
                className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 outline-none transition focus:border-[#95d8ff]/60"
              />
              <input
                type="tel"
                autoComplete="tel"
                placeholder="Teléfono"
                value={shipping.recipientPhone}
                onChange={(event) => updateField("recipientPhone", event.target.value)}
                className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 outline-none transition focus:border-[#95d8ff]/60"
              />
              <input
                type="email"
                autoComplete="email"
                placeholder="Email"
                value={shipping.recipientEmail}
                onChange={(event) => updateField("recipientEmail", event.target.value)}
                className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 outline-none transition focus:border-[#95d8ff]/60 md:col-span-2"
              />
            </div>

            {needsAddress ? (
              <div className="grid gap-3 md:grid-cols-2">
                <input
                  type="text"
                  autoComplete="address-line1"
                  placeholder="Calle y número"
                  value={shipping.addressLine1}
                  onChange={(event) => updateField("addressLine1", event.target.value)}
                  className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 outline-none transition focus:border-[#95d8ff]/60 md:col-span-2"
                />
                <input
                  type="text"
                  autoComplete="address-line2"
                  placeholder="Piso / departamento (opcional)"
                  value={shipping.addressLine2}
                  onChange={(event) => updateField("addressLine2", event.target.value)}
                  className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 outline-none transition focus:border-[#95d8ff]/60 md:col-span-2"
                />
                <input
                  type="text"
                  autoComplete="address-level2"
                  placeholder="Localidad"
                  value={shipping.city}
                  onChange={(event) => updateField("city", event.target.value)}
                  className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 outline-none transition focus:border-[#95d8ff]/60"
                />
                <input
                  type="text"
                  autoComplete="address-level1"
                  placeholder="Provincia"
                  value={shipping.province}
                  onChange={(event) => updateField("province", event.target.value)}
                  className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 outline-none transition focus:border-[#95d8ff]/60"
                />
                <input
                  type="text"
                  autoComplete="postal-code"
                  placeholder="Código postal"
                  value={shipping.postalCode}
                  onChange={(event) => updateField("postalCode", event.target.value)}
                  className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 outline-none transition focus:border-[#95d8ff]/60"
                />
                <input
                  type="text"
                  autoComplete="country"
                  placeholder="País"
                  value={shipping.country}
                  maxLength={2}
                  onChange={(event) => updateField("country", event.target.value.toUpperCase())}
                  className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 uppercase outline-none transition focus:border-[#95d8ff]/60"
                />
              </div>
            ) : selectedMethod ? (
              <div className="rounded-2xl border border-[#95d8ff]/15 bg-[#95d8ff]/5 p-4 text-sm text-white/60">
                Elegiste retiro. La información del punto y la preparación quedarán visibles en el pedido.
              </div>
            ) : null}

            <div className="grid gap-2 border-t border-white/10 pt-5">
              <div className="flex items-center justify-between text-white/60">
                <span>Productos</span>
                <span>{money(subtotal(), currency)}</span>
              </div>
              <div className="flex items-center justify-between text-white/60">
                <span>Entrega</span>
                <span>
                  {displayedShippingCost == null
                    ? "Se calcula al confirmar"
                    : displayedShippingCost === 0
                      ? "Gratis"
                      : money(displayedShippingCost, currency)}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between text-xl">
                <span>Total</span>
                <strong>{displayedShippingCost == null ? `${money(subtotal(), currency)} + entrega` : money(displayedTotal, currency)}</strong>
              </div>
            </div>

            <button
              type="button"
              disabled={busy || loadingMethods || !methods.length}
              onClick={() => void submit()}
              className="rounded-full bg-white px-5 py-3 font-semibold text-black transition hover:scale-[1.01] disabled:cursor-wait disabled:opacity-50"
            >
              {busy ? "Abriendo Mercado Pago…" : "Pagar con Mercado Pago"}
            </button>
            {!loadingMethods && !methods.length ? (
              <p className="text-center text-sm text-amber-200">
                La tienda todavía no tiene un método de entrega activo. Configuralo desde la administración antes de vender.
              </p>
            ) : null}
            <p className="text-center text-xs text-white/40">
              El servidor vuelve a calcular productos, variantes y entrega antes de crear el pago.
            </p>
            {error ? <p className="rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}</p> : null}
          </div>
        )}
      </section>
      <MainFooter />
    </main>
  );
}
