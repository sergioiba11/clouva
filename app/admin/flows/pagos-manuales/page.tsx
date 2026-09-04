"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type Player = { id:string; display_name:string; slug:string; username:string|null; owner_user_id:string };

export default function ManualFlowPaymentsPage(){
  const [players,setPlayers]=useState<Player[]>([]);
  const [buyerPlayerId,setBuyerPlayerId]=useState("");
  const [recipientPlayerId,setRecipientPlayerId]=useState("");
  const [quantity,setQuantity]=useState(1);
  const [amount,setAmount]=useState(1);
  const [currency,setCurrency]=useState("USD");
  const [reference,setReference]=useState("");
  const [note,setNote]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState<string|null>(null);

  useEffect(()=>{void (async()=>{
    try{const response=await authenticatedFetch("/api/admin/flows/manual-payment");const payload=await readApiJson<{players:Player[]}>(response);setPlayers(payload.players);}catch(cause){setMessage(cause instanceof Error?cause.message:"No se pudieron cargar los Players.");}
  })();},[]);

  async function submit(event:React.FormEvent){
    event.preventDefault();setBusy(true);setMessage(null);
    try{
      const response=await authenticatedFetch("/api/admin/flows/manual-payment",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({buyerPlayerId:buyerPlayerId||null,recipientPlayerId,quantity,amount,currency,reference,note})});
      const payload=await readApiJson<{operationId:string;duplicate:boolean;issued:{issued?:number;alreadyIssued?:boolean}}>(response);
      setMessage(`Pago registrado. Operación ${payload.operationId}. FLOWS emitidos: ${payload.issued?.issued ?? quantity}${payload.duplicate?" · referencia ya existente, sin duplicar emisión":""}.`);
      if(!payload.duplicate)setReference("");
    }catch(cause){setMessage(cause instanceof Error?cause.message:"No se pudo registrar el pago manual.");}
    finally{setBusy(false);}
  }

  return <div className="mx-auto max-w-3xl space-y-6 p-6 text-white">
    <div><Link href="/admin/flows" className="text-sm text-white/50 hover:text-white">← Volver a FLOWS</Link><h1 className="mt-3 text-3xl font-semibold">Pagos manuales de FLOWS</h1><p className="mt-2 text-sm text-white/45">Registra un pago físico real y emite los FLOWS usando el mismo circuito idempotente de la billetera.</p></div>
    <form onSubmit={submit} className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
      <label className="block text-sm">Comprador original<select value={buyerPlayerId} onChange={e=>setBuyerPlayerId(e.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5"><option value="">Sin Player comprador</option>{players.map(p=><option key={p.id} value={p.id}>{p.display_name} · @{p.slug}</option>)}</select></label>
      <label className="block text-sm">Player receptor<select required value={recipientPlayerId} onChange={e=>setRecipientPlayerId(e.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5"><option value="">Seleccionar</option>{players.map(p=><option key={p.id} value={p.id}>{p.display_name} · @{p.slug}</option>)}</select></label>
      <div className="grid gap-4 sm:grid-cols-3"><label className="text-sm">FLOWS<input type="number" min={1} max={1000} value={quantity} onChange={e=>setQuantity(Math.max(1,Math.trunc(Number(e.target.value)||1)))} className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5"/></label><label className="text-sm">Importe<input type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(Number(e.target.value)||0)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5"/></label><label className="text-sm">Moneda<input value={currency} onChange={e=>setCurrency(e.target.value.toUpperCase())} className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5"/></label></div>
      <label className="block text-sm">Referencia única del pago<input required value={reference} onChange={e=>setReference(e.target.value)} placeholder="Ej: bless-clouva-usd-fisico-001" className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5"/><span className="mt-1 block text-xs text-white/35">La misma referencia nunca puede emitir dos veces.</span></label>
      <label className="block text-sm">Nota<input value={note} onChange={e=>setNote(e.target.value)} placeholder="Ej: Bless pagó USD 1 físico por el primer FLOW de Clouva" className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5"/></label>
      <button disabled={busy||!recipientPlayerId||!reference||amount<=0} className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black disabled:opacity-40">{busy?"Registrando…":"Registrar pago y emitir FLOWS"}</button>
      {message?<p className="rounded-xl border border-white/10 bg-black/30 p-3 text-sm text-white/70">{message}</p>:null}
    </form>
  </div>;
}
