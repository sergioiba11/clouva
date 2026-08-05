"use client";

import Link from "next/link";
import { useCart } from "@/lib/cart-store";
import { money } from "@/lib/store-utils";

export function CartView() {
  const { items, remove, update, subtotal } = useCart();

  if (!items.length) {
    return <div className="rounded-[2rem] border border-white/10 p-8 text-white/60">Tu carrito está vacío.</div>;
  }

  const currency = items[0]?.currency ?? "ARS";

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.lineId} className="flex gap-4 rounded-[2rem] border border-white/10 p-4">
            <img
              src={item.image ?? "/placeholder.png"}
              alt={item.name}
              className="h-24 w-20 rounded-2xl bg-white/5 object-cover"
            />
            <div className="flex-1">
              <h3>{item.name}</h3>
              <p className="text-sm text-white/45">
                {[item.variantTitle, item.size, item.color].filter(Boolean).join(" · ") || "Edición base"}
              </p>
              {item.sku ? <p className="mt-1 text-xs text-white/35">SKU {item.sku}</p> : null}
              <p className="mt-2 text-[#95d8ff]">{money(item.price, item.currency)}</p>
            </div>
            <input
              value={item.quantity}
              min={1}
              max={item.stock ?? 50}
              type="number"
              onChange={(event) => update(item.lineId, Number(event.target.value))}
              className="h-10 w-16 rounded-xl bg-white/10 text-center"
            />
            <button type="button" onClick={() => remove(item.lineId)} className="text-white/45">
              Eliminar
            </button>
          </div>
        ))}
      </div>

      <aside className="h-fit rounded-[2rem] border border-white/10 p-6">
        <h2 className="text-xl">Resumen</h2>
        <div className="mt-4 flex justify-between text-white/60">
          <span>Subtotal</span>
          <span>{money(subtotal(), currency)}</span>
        </div>
        <div className="mt-2 flex justify-between text-lg">
          <span>Total de productos</span>
          <span>{money(subtotal(), currency)}</span>
        </div>
        <p className="mt-3 text-xs text-white/40">El envío se define en el siguiente paso.</p>
        <Link
          href="/checkout"
          className="mt-6 block rounded-full bg-white px-5 py-3 text-center font-semibold text-black"
        >
          Finalizar compra
        </Link>
      </aside>
    </div>
  );
}
