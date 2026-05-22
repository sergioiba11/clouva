"use client";
import { useEffect, useState } from "react";

const statuses=["pendiente_pago","pagado","preparando","enviado","entregado","cancelado"];

export default function Page(){
 const [orders,setOrders]=useState<any[]>([]);
 const load=async()=>{const {supabase}=await import("@/lib/supabase");const {data}=await supabase.from("orders").select("id,total_cents,payment_status,shipping_status,customer_id").order("id",{ascending:false});setOrders(data??[])};
 useEffect(()=>{void load();},[]);
 const update=async(id:string,status:string)=>{const {supabase}=await import("@/lib/supabase");
   const patch=status==="pendiente_pago"||status==="pagado"?{payment_status:status==="pendiente_pago"?"pendiente":"pagado"}:{shipping_status:status};
   await supabase.from("orders").update(patch).eq("id",id);
   await supabase.from("order_status_history").insert({order_id:id,status});
   void load();
 };
 return <div className="panel p-6"><h1 className="text-2xl font-bold">Pedidos reales</h1><div className="mt-4 space-y-3">{orders.map(o=><div key={o.id} className="rounded-xl border border-white/10 p-3"><div className="text-xs text-white/60">{o.id}</div><div>${(o.total_cents/100).toLocaleString("es-AR")}</div><div className="text-sm">Pago: {o.payment_status} · Envío: {o.shipping_status}</div><select onChange={e=>update(o.id,e.target.value)} className="mt-2 rounded border border-white/20 bg-transparent p-1"><option>Cambiar estado</option>{statuses.map(s=><option key={s} value={s}>{s}</option>)}</select></div>)}</div></div>
}
