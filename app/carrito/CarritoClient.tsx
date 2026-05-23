"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MainFooter, MainNav } from "@/components/layout";
import { loadCart, saveCart, totalCents, type CartItem } from "@/lib/cart";

export default function CarritoClient() {
  const [items, setItems] = useState<CartItem[]>([]);

  useEffect(() => setItems(loadCart()), []);

  const update = (next: CartItem[]) => {
    setItems(next);
    saveCart(next);
  };

  return (
    <main>
      <MainNav />
      <section className="mx-auto w-full max-w-4xl px-4 py-12 md:px-8">
        <h1 className="text-3xl">Carrito</h1>
        <div className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          {items.length === 0 ? (
            <p className="text-white/70">Carrito vacío.</p>
          ) : (
            items.map((it, i) => (
              <div key={i} className="mb-3 flex items-center justify-between">
                <div>
                  {it.name} <span className="text-xs text-white/60">{it.variant}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => update(items.map((x, ix) => (ix === i ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))}>-</button>
                  <span>{it.qty}</span>
                  <button onClick={() => update(items.map((x, ix) => (ix === i ? { ...x, qty: x.qty + 1 } : x)))}>+</button>
                  <button onClick={() => update(items.filter((_, ix) => ix !== i))} className="text-red-300">Eliminar</button>
                </div>
              </div>
            ))
          )}
          <div className="mt-6 flex items-center justify-between border-t border-white/10 pt-6">
            <span>Total</span>
            <span className="text-[#95d8ff]">${(totalCents(items) / 100).toLocaleString("es-AR")}</span>
          </div>
          <Link href="/checkout" className="mt-6 inline-block rounded-full bg-white px-6 py-3 text-sm text-black">Continuar a finalizar compra</Link>
        </div>
      </section>
      <MainFooter />
    </main>
  );
}
