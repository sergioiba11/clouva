"use client";

import { MainFooter, MainNav } from "@/components/layout";
import { useAuth } from "@/components/auth-provider";
import { loadCart, saveCart, totalCents } from "@/lib/cart";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function CheckoutClient() {
  const { user } = useAuth(); const router=useRouter();
  const [address,setAddress]=useState(""); const [pay,setPay]=useState("transferencia"); const [methods,setMethods]=useState<any[]>([]);
  const [msg,setMsg]=useState("");
  useEffect(()=>{void(async()=>{const {supabase}=await import("@/lib/supabase");const {data}=await supabase.from("payment_methods").select("*").eq("active",true);setMethods(data??[]);if(data?.[0]?.code)setPay(data[0].code);})();},[]);
  const submit=async()=>{if(!user){setMsg("Iniciá sesión");return;}const items=loadCart();if(!items.length){setMsg("Carrito vacío");return;}const {supabase}=await import("@/lib/supabase");
    const {data:customer}=await supabase.from("customers").upsert({profile_id:user.id,email:user.email},{onConflict:"email"}).select("id").single();
    const {data:order,error}=await supabase.from("orders").insert({customer_id:customer?.id,total_cents:totalCents(items),payment_status:"pendiente",shipping_status:"pendiente",payment_method:pay,address}).select("id").single();
    if(error||!order){setMsg(error?.message??"Error");return;}
    await supabase.from("order_items").insert(items.map(i=>({order_id:order.id,product_id:i.productId,qty:i.qty,unit_price_cents:i.priceCents})));
    await supabase.from("order_status_history").insert({order_id:order.id,status:"pendiente_pago"});
    saveCart([]); router.push(`/pedido/${order.id}`);
  };
  const total=totalCents(loadCart());
  return <main><MainNav/><section className="mx-auto w-full max-w-4xl px-4 py-12 md:px-8"><h1 className="text-3xl">Checkout</h1><div className="mt-6 space-y-4 rounded-3xl border border-white/10 bg-white/[0.03] p-6 text-sm"><textarea value={address} onChange={e=>setAddress(e.target.value)} placeholder="Dirección" className="w-full rounded border border-white/20 bg-transparent p-2"/><select value={pay} onChange={e=>setPay(e.target.value)} className="w-full rounded border border-white/20 bg-transparent p-2">{methods.map(m=><option key={m.id} value={m.code}>{m.alias||m.code}</option>)}</select><p>Total: ${(total/100).toLocaleString("es-AR")}</p><button onClick={submit} className="rounded-full bg-white px-6 py-2 text-black">Crear pedido</button>{msg?<p>{msg}</p>:null}</div></section><MainFooter/></main>
}
