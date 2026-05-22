"use client";
import { MainNav, MainFooter } from "@/components/layout";
import { useEffect, useState } from "react";

export default function Page({params}:{params:Promise<{id:string}>}){
 const [id,setId]=useState(""); const [order,setOrder]=useState<any>(null);
 useEffect(()=>{params.then(p=>setId(p.id));},[params]);
 useEffect(()=>{if(!id)return;void(async()=>{const {supabase}=await import("@/lib/supabase");const {data}=await supabase.from("orders").select("id,total_cents,payment_status,shipping_status").eq("id",id).maybeSingle();setOrder(data);})();},[id]);
 return <main><MainNav/><section className="mx-auto max-w-3xl p-8">{!order?<p>Cargando pedido...</p>:<div className="panel p-6"><h1 className="text-2xl">Pedido {order.id}</h1><p className="mt-2">Total ${(order.total_cents/100).toLocaleString("es-AR")}</p><p>Pago: {order.payment_status}</p><p>Estado: {order.shipping_status}</p></div>}</section><MainFooter/></main>
}
