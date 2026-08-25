"use client";

import { Building2, CircleDollarSign, Crown, History, Loader2, RefreshCw, WalletCards } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { CloverIcon } from "@/components/clover-icon";
import { DiamondIcon } from "@/components/diamond-icon";
import { MainNav } from "@/components/layout";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type CreditEntry = { id:string; transaction_type:string; amount:number; balance_after:number; source:string|null; created_at:string };
type MoneySummary = { currency:string; generatedMinor:number; pendingMinor:number; availableMinor:number; withdrawnMinor:number; refundedMinor?:number };
type MoneyEntry = { id:string; currency:string; net_amount_minor:number; status:string; source_type:string; created_at:string };
type SpaceMoney = {
  id:string;
  name:string;
  slug:string;
  type:string;
  role:string;
  summary:MoneySummary[];
  activity:MoneyEntry[];
  adminHref:string;
  moneyRelation:"separate"|"personal_breakdown";
};
type SummaryPayload = {
  player:{id:string;display_name:string;slug:string}|null;
  plan:{isVip:boolean;canAdministerSpaces:boolean};
  wallets:{ flows:number; diamonds:number };
  walletActivity:{ flows:CreditEntry[]; diamonds:CreditEntry[] };
  money:{ personal:MoneySummary[]; personalActivity:MoneyEntry[]; managed:MoneySummary[]; managedActivity:MoneyEntry[] };
  spaces:SpaceMoney[];
};

const CARD = "rounded-[24px] border border-white/[0.08] bg-[#0c0a13]/95";

function moneyMinor(value:number,currency:string){return new Intl.NumberFormat("es-AR",{style:"currency",currency,maximumFractionDigits:2}).format(value/100)}
function when(value:string){return new Date(value).toLocaleString("es-AR",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}
function spaceTypeLabel(type:string){return ({studio:"Estudio",business:"Negocio",spot:"Spot",club:"Club",brand:"Marca",other:"Espacio"} as Record<string,string>)[type]||"Espacio"}

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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-300/15 bg-violet-400/[0.07] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-200"><WalletCards size={14}/> MI FLOW · Billetera CLOUVA</div>
          {data?.plan.isVip?<span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/20 bg-amber-300/[0.07] px-3 py-1 text-[11px] font-semibold text-amber-200"><Crown size={13}/> VIP</span>:null}
        </div>
        <div className="mt-5 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div><h1 className="text-4xl font-semibold tracking-tight md:text-5xl">Tu dinero</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-white/50">{data?.player?.display_name?`Billetera de ${data.player.display_name}. `:""}Tu saldo personal, FLOWS, Diamantes y las cuentas de espacios que administrás, siempre separados.</p></div>
          <button type="button" onClick={()=>void load()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs text-white/60"><RefreshCw size={14} className={loading?"animate-spin":""}/>Actualizar</button>
        </div>
      </section>
      {error?<p className="rounded-2xl border border-rose-300/15 bg-rose-300/[0.06] p-4 text-sm text-rose-200">{error}</p>:null}
      {loading?<div className={`${CARD} grid min-h-36 place-items-center text-sm text-white/45`}><span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin"/>Cargando MI FLOW…</span></div>:null}
      {!loading&&data?<>
        <section>
          <div className="mb-3"><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-300/70">Mi dinero</p><h2 className="mt-1 text-2xl font-semibold">Saldo del Player</h2></div>
          {data.money.personal.length?<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{data.money.personal.flatMap(summary=>[
            <Metric key={`${summary.currency}-generated`} icon={<CircleDollarSign size={17}/>} label={`${summary.currency} generado`} value={moneyMinor(summary.generatedMinor,summary.currency)}/>,
            <Metric key={`${summary.currency}-pending`} label="Pendiente" value={moneyMinor(summary.pendingMinor,summary.currency)}/>,
            <Metric key={`${summary.currency}-available`} label="Disponible" value={moneyMinor(summary.availableMinor,summary.currency)}/>,
            <Metric key={`${summary.currency}-withdrawn`} label="Retirado" value={moneyMinor(summary.withdrawnMinor,summary.currency)}/>,
          ])}</div>:<div className={`${CARD} p-6 text-sm text-white/40`}>Todavía no tenés movimientos de dinero personal.</div>}
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <article id="flows" className={`${CARD} scroll-mt-24 p-6`}><div className="flex items-center justify-between"><div><p className="text-xs uppercase tracking-[0.16em] text-white/35">Moneda CLOUVA</p><h2 className="mt-1 flex items-center gap-2 text-xl font-semibold"><CloverIcon className="text-[#8f7cff]" size={22}/> FLOWS</h2></div><strong className="text-3xl">{data.wallets.flows}</strong></div><CreditRows rows={data.walletActivity.flows}/></article>
          <article id="diamonds" className={`${CARD} scroll-mt-24 p-6`}><div className="flex items-center justify-between"><div><p className="text-xs uppercase tracking-[0.16em] text-white/35">Crédito premium</p><h2 className="mt-1 flex items-center gap-2 text-xl font-semibold"><DiamondIcon className="text-cyan-300" size={22}/> Diamantes</h2></div><strong className="text-3xl">{data.wallets.diamonds}</strong></div><CreditRows rows={data.walletActivity.diamonds}/></article>
        </section>

        <section className={`${CARD} overflow-hidden`}>
          <div className="border-b border-white/[0.07] px-5 py-4"><h2 className="flex items-center gap-2 font-semibold"><History size={17}/>Movimientos de mi dinero</h2></div>
          {activity.length?<div className="divide-y divide-white/[0.06]">{activity.slice(0,20).map(row=><div key={row.id} className="flex items-center justify-between gap-4 px-5 py-4 text-sm"><div><p className="capitalize">{row.source_type.replaceAll("_"," ")}</p><p className="mt-1 text-xs text-white/35">{when(row.created_at)} · {row.status}</p></div><strong>{moneyMinor(row.net_amount_minor,row.currency)}</strong></div>)}</div>:<p className="px-5 py-8 text-sm text-white/40">Todavía no hay movimientos acreditados.</p>}
        </section>

        <section>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-300/70">Espacios</p><h2 className="mt-1 text-2xl font-semibold">Cuentas que administrás</h2></div>
            <Link href="/mi-spot" className="text-xs font-semibold text-violet-300 hover:text-violet-200">Ver mis espacios →</Link>
          </div>
          {!data.plan.canAdministerSpaces?<div className={`${CARD} flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between`}><div><p className="flex items-center gap-2 font-semibold"><Crown size={17} className="text-amber-300"/>Administración con CLOUVA VIP</p><p className="mt-2 max-w-xl text-sm leading-6 text-white/45">Tu Player puede usar CLOUVA gratis. Para crear o administrar Estudios, Negocios, Spots, Clubes o Marcas necesitás VIP.</p></div><Link href="/vip" className="shrink-0 rounded-xl bg-violet-600 px-4 py-2.5 text-center text-sm font-semibold">Ver VIP</Link></div>:data.spaces.length?<div className="grid gap-4 md:grid-cols-2">{data.spaces.map(space=><SpaceMoneyCard key={space.id} space={space}/>)}</div>:<div className={`${CARD} p-6 text-sm text-white/40`}>No tenés espacios con acceso financiero todavía.</div>}
        </section>
      </>:null}
    </div>
  </main>;
}

function CreditRows({rows}:{rows:CreditEntry[]}){return <div className="mt-5 divide-y divide-white/[0.06] border-t border-white/[0.07]">{rows.length?rows.slice(0,5).map(row=><div key={row.id} className="flex items-center justify-between py-3 text-sm"><div><p>{row.source||row.transaction_type}</p><p className="mt-0.5 text-xs text-white/30">{when(row.created_at)}</p></div><div className="text-right"><b>{row.amount>=0?"+":""}{row.amount}</b><p className="text-xs text-white/30">saldo {row.balance_after}</p></div></div>):<p className="py-4 text-sm text-white/35">Sin movimientos todavía.</p>}</div>}
function Metric({icon,label,value}:{icon?:React.ReactNode;label:string;value:string}){return <div className={`${CARD} p-4`}><span className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-white/35">{icon}{label}</span><strong className="mt-2 block text-xl">{value}</strong></div>}
function SpaceMoneyCard({space}:{space:SpaceMoney}){return <article className={`${CARD} p-5`}><div className="flex items-start justify-between gap-3"><div className="flex gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-violet-300"><Building2 size={18}/></span><div><p className="font-semibold">{space.name}</p><p className="mt-0.5 text-xs text-white/35">{spaceTypeLabel(space.type)} · {space.role}</p></div></div><span className={`rounded-full border px-2.5 py-1 text-[10px] ${space.moneyRelation==="separate"?"border-emerald-300/15 bg-emerald-300/[0.06] text-emerald-200":"border-violet-300/15 bg-violet-300/[0.06] text-violet-200"}`}>{space.moneyRelation==="separate"?"Cuenta separada":"Incluido en mi Player"}</span></div><div className="mt-4 grid gap-2 sm:grid-cols-2">{space.summary.length?space.summary.flatMap(summary=>[<div key={`${space.id}-${summary.currency}-available`} className="rounded-xl bg-white/[0.035] p-3"><p className="text-[10px] uppercase tracking-wider text-white/30">{summary.currency} disponible</p><b className="mt-1 block">{moneyMinor(summary.availableMinor,summary.currency)}</b></div>,<div key={`${space.id}-${summary.currency}-pending`} className="rounded-xl bg-white/[0.035] p-3"><p className="text-[10px] uppercase tracking-wider text-white/30">Pendiente</p><b className="mt-1 block">{moneyMinor(summary.pendingMinor,summary.currency)}</b></div>]):<div className="rounded-xl bg-white/[0.035] p-3 text-xs text-white/35 sm:col-span-2">Sin movimientos todavía.</div>}</div><p className="mt-3 text-[11px] leading-5 text-white/35">{space.moneyRelation==="separate"?"Este saldo no forma parte de tu dinero personal.":"Este bloque es un desglose del dinero de tu Player; no se suma una segunda vez."}</p><Link href={space.adminHref} className="mt-4 inline-flex rounded-xl border border-white/10 px-3.5 py-2 text-xs font-semibold text-white/70 hover:border-violet-400/30 hover:text-white">Administrar espacio</Link></article>}
