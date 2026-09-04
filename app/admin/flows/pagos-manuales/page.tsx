"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type Player={id:string;display_name:string;slug:string;username:string|null;owner_user_id:string};
type Pricing={flowUsdValue:number;currency:string};
type CashResult={operationId:string;duplicate:boolean;amount:number;currency:string;receiptNumber:string;issued:{issued?:number;alreadyIssued?:boolean}};
const money=(value:number,currency:string)=>new Intl.NumberFormat("es-AR",{style:"currency",currency,maximumFractionDigits:2}).format(value);
const key=()=>typeof crypto!=="undefined"&&"randomUUID" in crypto?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function CashFlowPaymentsPage(){
  const [players,setPlayers]=useState<Player[]>([]),[pricing,setPricing]=useState<Pricing>({flowUsdValue:1,currency:"USD"});
  const [payerPlayerId,setPayer]=useState(""),[recipientPlayerId,setRecipient]=useState(""),[quantity,setQuantity]=useState(1);
  const [reference,setReference]=useState(""),[note,setNote]=useState(""),[cashReceived,setCashReceived]=useState(false),[idempotencyKey,setKey]=useState(()=>key());
  const [busy,setBusy]=useState(false),[message,setMessage]=useState<string|null>(null);
  useEffect(()=>{void(async()=>{try{const r=await authenticatedFetch("/api/admin/flows/cash-payment");const p=await readApiJson<{players:Player[];pricing:Pricing}>(r);setPlayers(p.players);setPricing(p.pricing)}catch(e){setMessage(e instanceof Error?e.message:"No se pudieron cargar los Players.")}})()},[]);
  const total=useMemo(()=>quantity*pricing.flowUsdValue,[quantity,pricing.flowUsdValue]);
  async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setMessage(null);try{const r=await authenticatedFetch("/api/admin/flows/cash-payment",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({payerPlayerId,recipientPlayerId,quantity,reference,note,cashReceived,idempotencyKey})});const p=await readApiJson<CashResult>(r);setMessage(`Pago confirmado · ${money(Number(p.amount),p.currency)} · ${p.receiptNumber} · FLOWS emitidos: ${p.issued?.issued??quantity}${p.duplicate?" · sin duplicar emisión":""}.`);if(!p.duplicate){setReference("");setNote("");setCashReceived(false);setKey(key())}}catch(e){setMessage(e instanceof Error?e.message:"No se pudo registrar el pago.")}finally{setBusy(false)}}
  return <div className="mx-auto max-w-3xl space-y-6 p-6 text-white"><div><Link href="/admin/flows" className="text-sm text-white/50">← Volver a FLOWS</Link><h1 className="mt-3 text-3xl font-semibold">Registrar pago en efectivo</h1><p className="mt-2 text-sm text-white/45">Registra dinero físico realmente recibido por CLOUVA. La emisión ocurre en backend y queda unida a esta operación.</p></div>
  <form onSubmit={submit} className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
    <label className="block text-sm">Player pagador<select required value={payerPlayerId} onChange={e=>{setPayer(e.target.value);if(!recipientPlayerId)setRecipient(e.target.value)}} className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5"><option value="">Seleccionar</option>{players.map(p=><option key={p.id} value={p.id}>{p.display_name} · @{p.slug}</option>)}</select></label>
    <label className="block text-sm">Player que recibe los FLOWS<select required value={recipientPlayerId} onChange={e=>setRecipient(e.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5"><option value="">Seleccionar</option>{players.map(p=><option key={p.id} value={p.id}>{p.display_name} · @{p.slug}</option>)}</select></label>
    <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">Cantidad<input type="number" min={1} max={1000} value={quantity} onChange={e=>setQuantity(Math.max(1,Math.min(1000,Math.trunc(Number(e.target.value)||1))))} className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5"/></label><div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5"><p className="text-xs text-white/40">Efectivo a recibir</p><p className="mt-1 text-xl font-semibold">{money(total,pricing.currency)}</p><p className="text-[11px] text-white/30">1 FLOW = {money(pricing.flowUsdValue,pricing.currency)}</p></div></div>
    <label className="block text-sm">Referencia<input value={reference} onChange={e=>setReference(e.target.value)} placeholder="Ej: caja-iglu-0001" className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5"/></label>
    <label className="block text-sm">Nota<input value={note} onChange={e=>setNote(e.target.value)} placeholder="Ej: Bless entregó USD 1 en efectivo" className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5"/></label>
    <label className="flex gap-3 rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.05] p-4 text-sm"><input type="checkbox" checked={cashReceived} onChange={e=>setCashReceived(e.target.checked)} className="mt-0.5"/><span><b>Confirmo que CLOUVA recibió físicamente {money(total,pricing.currency)}.</b><span className="mt-1 block text-xs text-white/45">Sin esta confirmación no se emite ningún FLOW.</span></span></label>
    <button disabled={busy||!payerPlayerId||!recipientPlayerId||!cashReceived} className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black disabled:opacity-40">{busy?"Registrando…":"Registrar pago"}</button>{message?<p className="rounded-xl border border-white/10 bg-black/30 p-3 text-sm text-white/70">{message}</p>:null}
  </form><p className="text-xs leading-5 text-white/35">El comprobante generado acá es interno. El comprobante fiscal oficial queda separado para la futura integración fiscal/ARCA.</p></div>;
}
