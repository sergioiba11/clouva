"use client";

import { CircleDollarSign, History, Loader2, RefreshCw, WalletCards } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { CloverIcon } from "@/components/clover-icon";
import { DiamondIcon } from "@/components/diamond-icon";
import { MainNav } from "@/components/layout";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type CreditEntry = { id:string; transaction_type:string; amount:number; balance_after:number; source:string|null; created_at:string };
type MoneySummary = { currency:string; generatedMinor:number; pendingMinor:number; availableMinor:number; withdrawnMinor:number };
type MoneyEntry = { id:string; currency:string; net_amount_minor:number; status:string; source_type:string; created_at:string };
type SummaryPayload = {
  wallets:{ flows:number; diamonds:number };
  walletActivity:{ flows:CreditEntry[]; diamonds:CreditEntry[] };
  money:{ personal:MoneySummary[]; personalActivity:MoneyEntry[] };
};

const CARD = "rounded-[24px] border border-white/[0.08] bg-[#0c0a13]/95";

function moneyMinor(value:number,currency:string){return new Intl.NumberFormat("es-AR",{style:"currency",currency,maximumFractionDigits:2}).format(value/100)}
function when(value:string){return new Date(value).toLocaleString("es-AR",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}

export default function MiFlowWalletPage(){
  const {user,loading:authLoading}=useAuth();
  const [data,setData]=useState<SummaryPayload|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);

  const load=useCallback(async()=>{
    if(!user)return;
    setLoading(true);setError(null);
    try{const response=await authenticatedFetch("/api/mi-flow/summary");setData(await readApiJson<SummaryPayload>(response));}
    catch(cause){setError(cause instanceof Error?cause.message:"No se pudo cargar la billetera.");}
    finally{setLoading(false);}
  },[user]);

  useEffect(()=>{if(authLoading)return;if(!user){setLoading(false);return}void load();},[authLoading,load,user]);
  useEffect(()=>{if(!data||typeof window==="undefined")return;const asset=new URLSearchParams(window.location.search).get("asset");if(asset!=="flows"&&asset!=="diamonds")return;requestAnimationFrame(()=>document.getElementById(asset)?.scrollIntoView({behavior:"smooth",block:"center"}));},[data]);
  const activity=useMemo(()=>data?.money.personalActivity??[],[data]);

  return <main className="min-h-screen bg-[#07060d] text-white">
    <MainNav/>
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-8 md:px-8">
      <section className="rounded-[30px] border border-violet-400/15 bg-gradient-to-br from-[#171022] via-[#0f0b18] to-[#09080f] p-6 md:p-8">
        <div className="inline-flex items-center gap-2 rounded-full border border-violet-300/15 bg-violet-400/[0.07] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-200"><WalletCards size={14}/> Billetera CLOUVA</div>
        <div className="mt-5 flex items-end justify-between gap-4"><div><h1 className="text-4xl font-semibold tracking-tight md:text-5xl">Tu dinero</h1><p className="mt-2 text-sm text-white/50">Ganancias, FLOWS, Diamantes y movimientos. El panel operativo principal sigue en MI FLOW.</p></div><button type="button" onClick={()=>void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs text-white/60"><RefreshCw size={14} className={loading?"animate-spin":""}/>Actualizar</button></div>
      </section>
      {error?<p className="rounded-2xl border border-rose-300/15 bg-rose-300/[0.06] p-4 text-sm text-rose-200">{error}</p>:null}
      {loading?<div className={`${CARD} grid min-h-36 place-items-center text-sm text-white/45`}><span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin"/>Cargando billetera…</span></div>:null}
      {!loading&&data?<>
        <section className="grid gap-4 lg:grid-cols-2">
          <article id="flows" className={`${CARD} scroll-mt-24 p-6`}><div className="flex items-center justify-between"><div><p className="text-xs uppercase tracking-[0.16em] text-white/35">Moneda CLOUVA</p><h2 className="mt-1 flex items-center gap-2 text-xl font-semibold"><CloverIcon className="text-[#8f7cff]" size={22}/> FLOWS</h2></div><strong className="text-3xl">{data.wallets.flows}</strong></div><CreditRows rows={data.walletActivity.flows}/></article>
          <article id="diamonds" className={`${CARD} scroll-mt-24 p-6`}><div className="flex items-center justify-between"><div><p className="text-xs uppercase tracking-[0.16em] text-white/35">Crédito premium</p><h2 className="mt-1 flex items-center gap-2 text-xl font-semibold"><DiamondIcon className="text-cyan-300" size={22}/> Diamantes</h2></div><strong className="text-3xl">{data.wallets.diamonds}</strong></div><CreditRows rows={data.walletActivity.diamonds}/></article>
        </section>
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{data.money.personal.flatMap(summary=>[
          <Metric key={`${summary.currency}-generated`} icon={<CircleDollarSign size={17}/>} label={`${summary.currency} generado`} value={moneyMinor(summary.generatedMinor,summary.currency)}/>,
          <Metric key={`${summary.currency}-pending`} label="Pendiente" value={moneyMinor(summary.pendingMinor,summary.currency)}/>,
          <Metric key={`${summary.currency}-available`} label="Disponible" value={moneyMinor(summary.availableMinor,summary.currency)}/>,
          <Metric key={`${summary.currency}-withdrawn`} label="Retirado" value={moneyMinor(summary.withdrawnMinor,summary.currency)}/>,
        ])}</section>
        <section className={`${CARD} overflow-hidden`}><div className="border-b border-white/[0.07] px-5 py-4"><h2 className="flex items-center gap-2 font-semibold"><History size={17}/>Movimientos de dinero</h2></div>{activity.length?<div className="divide-y divide-white/[0.06]">{activity.slice(0,20).map(row=><div key={row.id} className="flex items-center justify-between px-5 py-4 text-sm"><div><p>{row.source_type.replaceAll("_"," ")}</p><p className="mt-1 text-xs text-white/35">{when(row.created_at)} · {row.status}</p></div><strong>{moneyMinor(row.net_amount_minor,row.currency)}</strong></div>)}</div>:<p className="px-5 py-8 text-sm text-white/40">Todavía no hay movimientos acreditados.</p>}</section>
      </>:null}
    </div>
  </main>;
}

function CreditRows({rows}:{rows:CreditEntry[]}){return <div className="mt-5 divide-y divide-white/[0.06] border-t border-white/[0.07]">{rows.length?rows.slice(0,5).map(row=><div key={row.id} className="flex items-center justify-between py-3 text-sm"><div><p>{row.source||row.transaction_type}</p><p className="mt-0.5 text-xs text-white/30">{when(row.created_at)}</p></div><div className="text-right"><b>{row.amount>=0?"+":""}{row.amount}</b><p className="text-xs text-white/30">saldo {row.balance_after}</p></div></div>):<p className="py-4 text-sm text-white/35">Sin movimientos todavía.</p>}</div>}
function Metric({icon,label,value}:{icon?:React.ReactNode;label:string;value:string}){return <div className={`${CARD} p-4`}><span className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-white/35">{icon}{label}</span><strong className="mt-2 block text-xl">{value}</strong></div>}
