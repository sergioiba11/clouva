"use client";

import { ArrowLeft, Loader2, RefreshCw, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { CloverIcon } from "@/components/clover-icon";
import { MainNav } from "@/components/layout";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type PlayerRef = { id:string; display_name:string; slug:string } | null;
type OperationRef = { id:string; provider:string; payment_method:string; amount:number; currency:string; confirmed_at:string|null; created_at:string } | null;
type FlowAsset = {
  id:string;
  flow_number:number;
  status:"pending_payment"|"available"|"activated"|"transferred";
  issued_at:string;
  activated_at:string|null;
  owner:PlayerRef;
  originalBuyer:PlayerRef;
  operation:OperationRef;
};

const STATUS:Record<FlowAsset["status"],string> = {
  pending_payment:"Pendiente de pago",
  available:"Disponible",
  activated:"Activado",
  transferred:"Transferido",
};

function when(value:string){return new Date(value).toLocaleString("es-AR",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"})}

export default function FlowWalletAssetsPage(){
  const {user,loading:authLoading}=useAuth();
  const [assets,setAssets]=useState<FlowAsset[]>([]);
  const [loading,setLoading]=useState(true);
  const [buying,setBuying]=useState(false);
  const [quantity,setQuantity]=useState(1);
  const [error,setError]=useState<string|null>(null);

  const load=useCallback(async()=>{
    if(!user)return;
    setLoading(true);setError(null);
    try{
      const response=await authenticatedFetch("/api/flows/assets");
      const payload=await readApiJson<{assets:FlowAsset[]}>(response);
      setAssets(payload.assets);
    }catch(cause){setError(cause instanceof Error?cause.message:"No se pudieron cargar tus FLOWS.");}
    finally{setLoading(false);}
  },[user]);

  useEffect(()=>{if(authLoading)return;if(!user){setLoading(false);return}void load();},[authLoading,load,user]);

  async function buy(){
    setBuying(true);setError(null);
    try{
      const response=await authenticatedFetch("/api/flows/purchase",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({quantity})});
      const payload=await readApiJson<{initPoint:string}>(response);
      window.location.assign(payload.initPoint);
    }catch(cause){setError(cause instanceof Error?cause.message:"No se pudo iniciar la compra.");setBuying(false);}
  }

  return <main className="min-h-screen bg-[#07060d] text-white">
    <MainNav/>
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-8 md:px-8">
      <Link href="/mi-flow/billetera" className="inline-flex items-center gap-2 text-sm text-white/50 hover:text-white"><ArrowLeft size={15}/>Volver a Billetera</Link>

      <section className="rounded-[30px] border border-cyan-300/15 bg-gradient-to-br from-[#111b21] via-[#0b1118] to-[#08090d] p-6 md:p-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-200/60">Billetera · Activos CLOUVA</p>
            <h1 className="mt-2 flex items-center gap-3 text-4xl font-semibold"><CloverIcon className="text-cyan-200" size={34}/>Mis FLOWS</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-white/45">Cada FLOW es un activo individual, con número único, comprador original, propietario y origen de emisión.</p>
          </div>
          <button type="button" onClick={()=>void load()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs text-white/60"><RefreshCw size={14} className={loading?"animate-spin":""}/>Actualizar</button>
        </div>
      </section>

      <section className="rounded-[24px] border border-white/[0.08] bg-[#0c0a13]/95 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="mr-auto"><p className="font-semibold">Comprar FLOWS</p><p className="mt-1 text-xs text-white/40">1 FLOW = USD 1. La acreditación ocurre únicamente después de la confirmación del pago.</p></div>
          <label className="text-xs text-white/45">Cantidad<input value={quantity} onChange={event=>setQuantity(Math.max(1,Math.min(50,Math.trunc(Number(event.target.value)||1))))} type="number" min={1} max={50} className="ml-2 w-20 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-white outline-none"/></label>
          <button type="button" onClick={()=>void buy()} disabled={buying} className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black disabled:opacity-50">{buying?<Loader2 size={15} className="animate-spin"/>:<ShoppingBag size={15}/>}Comprar · USD {quantity}</button>
        </div>
      </section>

      {error?<div className="rounded-2xl border border-rose-300/15 bg-rose-300/[0.06] p-4 text-sm text-rose-200">{error}</div>:null}
      {loading?<div className="grid min-h-32 place-items-center rounded-[24px] border border-white/[0.08] bg-[#0c0a13]/95 text-sm text-white/45"><Loader2 size={17} className="animate-spin"/></div>:null}

      {!loading&&!assets.length?<div className="rounded-[24px] border border-white/[0.08] bg-[#0c0a13]/95 p-7 text-sm text-white/45">Todavía no tenés FLOWS emitidos en esta billetera.</div>:null}

      <section className="grid gap-4 md:grid-cols-2">{assets.map(asset=>{
        const source=asset.operation?.provider==="manual"?"Pago físico/manual":"Compra CLOUVA";
        return <article key={asset.id} className="rounded-[24px] border border-cyan-300/10 bg-[#0c0f14] p-5">
          <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[0.18em] text-white/30">Activo CLOUVA</p><h2 className="mt-1 text-2xl font-semibold">FLOW #{String(asset.flow_number).padStart(6,"0")}</h2></div><span className="rounded-full border border-cyan-200/15 bg-cyan-200/[0.06] px-3 py-1 text-xs text-cyan-100">{STATUS[asset.status]}</span></div>
          <dl className="mt-5 grid gap-3 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-white/35">Comprado por</dt><dd>{asset.originalBuyer?`@${asset.originalBuyer.slug}`:"CLOUVA / sin Player"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-white/35">Propietario</dt><dd>{asset.owner?`@${asset.owner.slug}`:"Mi cuenta"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-white/35">Fecha</dt><dd className="text-right">{when(asset.issued_at)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-white/35">Origen</dt><dd>{source}</dd></div>
          </dl>
        </article>;
      })}</section>
    </div>
  </main>;
}
