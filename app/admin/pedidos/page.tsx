"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function AdminOrders(){
  const [orders, setOrders] = useState<Array<{id:string;status:string;total:number}>>([]);
  useEffect(()=>{supabase.from("orders").select("id,status,total").then(({data})=>setOrders((data as any[])??[]));},[]);
  return <div className="panel p-6"><h2 className="text-xl">Pedidos</h2><ul className="mt-4 space-y-2">{orders.map(o=><li key={o.id}>#{o.id.slice(0,8)} · {o.status} · ${o.total}</li>)}</ul></div>;
}
