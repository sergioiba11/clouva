"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Order } from "@/lib/store-data";
import { money } from "@/lib/store-utils";
const statuses = ["pendiente","confirmado","enviado","entregado","cancelado"] as const;
export default function AdminOrders(){const [orders,setOrders]=useState<Order[]>([]); const load=async()=>{const {data}=await supabase.from('orders').select('*').order('created_at',{ascending:false}); setOrders(data??[])}; useEffect(()=>{void load()},[]); return <div><h1 className="text-3xl font-semibold">Gestión de pedidos</h1><div className="mt-6 space-y-3">{orders.map(o=><div key={o.id} className="grid gap-3 rounded-3xl border border-white/10 p-4 md:grid-cols-5"><span>#{o.order_number ?? o.id.slice(0,8)}</span><span>{o.customer_name}</span><span>{new Date(o.created_at).toLocaleDateString('es-AR')}</span><span>{money(o.total)}</span><select value={o.status} onChange={async(e)=>{await supabase.from('orders').update({status:e.target.value as any}).eq('id',o.id); await load();}} className="rounded-xl bg-black p-2">{statuses.map(s=><option key={s}>{s}</option>)}</select></div>)}</div></div>}
