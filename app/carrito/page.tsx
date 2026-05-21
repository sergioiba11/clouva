"use client";
import Link from "next/link";
import { MainFooter, MainNav } from "@/components/layout";
import { useAuth } from "@/components/auth/auth-provider";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type CartItem = { id: string; quantity: number; products: { name: string; price: number }[] };

export default function CartPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<CartItem[]>([]);

  useEffect(() => {
    if (!user) return;
    supabase.from("cart_items").select("id,quantity,products(name,price)").eq("user_id", user.id).then(({ data }) => setItems((data as CartItem[]) ?? []));
  }, [user]);

  const total = useMemo(() => items.reduce((acc, item) => acc + item.quantity * (item.products?.[0]?.price ?? 0), 0), [items]);

  return (
    <main>
      <MainNav />
      <section className="mx-auto w-full max-w-4xl px-4 py-12 md:px-8">
        <h1 className="text-3xl">Cart</h1>
        <div className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <p className="text-white/70">Carrito persistente CLOUVA.</p>
          <div className="mt-4 space-y-2 text-sm">{items.map(i => <p key={i.id}>{i.products?.[0]?.name ?? "Producto"} x{i.quantity}</p>)}</div>
          <div className="mt-6 flex items-center justify-between border-t border-white/10 pt-6"><span>Total</span><span className="text-[#95d8ff]">${total.toLocaleString("es-AR")}</span></div>
          <Link href="/checkout" className="mt-6 inline-block rounded-full bg-white px-6 py-3 text-sm text-black">Continuar checkout</Link>
        </div>
      </section>
      <MainFooter />
    </main>
  );
}
