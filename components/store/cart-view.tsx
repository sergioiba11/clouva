"use client";
import Link from "next/link";
import { useCart } from "@/lib/cart-store";
import { money } from "@/lib/store-utils";

export function CartView() {
  const { items, remove, update, subtotal } = useCart();
  if (!items.length) return <div className="rounded-[2rem] border border-white/10 p-8 text-white/60">Tu carrito está vacío.</div>;
  return <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
    <div className="space-y-3">{items.map((item) => <div key={item.id} className="flex gap-4 rounded-[2rem] border border-white/10 p-4"><img src={item.image ?? "/placeholder.png"} alt="" className="h-24 w-20 rounded-2xl object-cover bg-white/5"/><div className="flex-1"><h3>{item.name}</h3><p className="text-sm text-white/45">{[item.size, item.color].filter(Boolean).join(" · ")}</p><p className="mt-2 text-[#95d8ff]">{money(item.price)}</p></div><input value={item.quantity} min={1} type="number" onChange={(event) => update(item.id, Number(event.target.value))} className="h-10 w-16 rounded-xl bg-white/10 text-center"/><button onClick={() => remove(item.id)} className="text-white/45">Eliminar</button></div>)}</div>
    <aside className="h-fit rounded-[2rem] border border-white/10 p-6"><h2 className="text-xl">Resumen</h2><div className="mt-4 flex justify-between text-white/60"><span>Subtotal</span><span>{money(subtotal())}</span></div><div className="mt-2 flex justify-between text-lg"><span>Total</span><span>{money(subtotal())}</span></div><Link href="/checkout" className="mt-6 block rounded-full bg-white px-5 py-3 text-center font-semibold text-black">Finalizar compra</Link></aside>
  </div>;
}
