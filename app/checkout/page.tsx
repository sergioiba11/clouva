"use client";

import { useEffect, useState } from "react";
import { MainFooter, MainNav } from "@/components/layout";
import { useAuth } from "@/components/auth-provider";
import { useCart } from "@/lib/cart-store";
import { money } from "@/lib/store-utils";

type CustomerForm = {
  name: string;
  phone: string;
  email: string;
  address: string;
};

export default function CheckoutPage() {
  const { session, user } = useAuth();
  const { items, subtotal, clear } = useCart();
  const [customer, setCustomer] = useState<CustomerForm>({
    name: "",
    phone: "",
    email: "",
    address: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (user?.email) {
      setCustomer((current) => ({ ...current, email: current.email || user.email || "" }));
    }
  }, [user?.email]);

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

    setBusy(true);
    try {
      const response = await fetch("/api/commerce/checkout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          customer,
          items: items.map((item) => ({
            productId: item.productId,
            variantId: item.variantId,
            quantity: item.quantity,
          })),
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

  const currency = items[0]?.currency ?? "ARS";

  return (
    <main>
      <MainNav />
      <section className="mx-auto max-w-3xl px-4 py-14 md:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#95d8ff]/70">CLOUVA Store</p>
        <h1 className="mt-3 text-4xl font-semibold">Finalizar compra</h1>
        <p className="mt-3 text-white/55">Completá los datos de entrega y pagá una sola vez desde Mercado Pago.</p>

        {!items.length ? (
          <div className="mt-8 rounded-[2rem] border border-white/10 bg-white/[0.03] p-6 text-white/60">
            Tu carrito está vacío.
          </div>
        ) : (
          <div className="mt-8 grid gap-4 rounded-[2rem] border border-white/10 bg-white/[0.03] p-6">
            {(
              [
                ["name", "Nombre y apellido"],
                ["phone", "Teléfono"],
                ["email", "Email"],
                ["address", "Dirección de entrega"],
              ] as Array<[keyof CustomerForm, string]>
            ).map(([key, label]) => (
              <input
                key={key}
                type={key === "email" ? "email" : key === "phone" ? "tel" : "text"}
                autoComplete={
                  key === "name" ? "name" : key === "phone" ? "tel" : key === "email" ? "email" : "street-address"
                }
                placeholder={label}
                value={customer[key]}
                onChange={(event) => setCustomer((current) => ({ ...current, [key]: event.target.value }))}
                className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 outline-none transition focus:border-[#95d8ff]/60"
              />
            ))}

            <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-5 text-xl">
              <span>Total de productos</span>
              <strong>{money(subtotal(), currency)}</strong>
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={() => void submit()}
              className="rounded-full bg-white px-5 py-3 font-semibold text-black transition hover:scale-[1.01] disabled:cursor-wait disabled:opacity-50"
            >
              {busy ? "Abriendo Mercado Pago…" : "Continuar con Mercado Pago"}
            </button>
            <p className="text-center text-xs text-white/40">Pago único. No activa ninguna suscripción mensual.</p>
            {error ? <p className="rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}</p> : null}
          </div>
        )}
      </section>
      <MainFooter />
    </main>
  );
}
