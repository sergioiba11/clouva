"use client";

import {
  Activity,
  ArrowLeft,
  Camera,
  Check,
  ExternalLink,
  Loader2,
  Megaphone,
  PackageSearch,
  Search,
  Sparkles,
  Truck,
  X,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { MainNav } from "@/components/layout";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type RequestType = "sourcing" | "procurement" | "listing" | "logistics" | "operations";
type BusinessRequest = {
  id: string;
  request_type: string;
  status: string;
  title: string;
  input_text: string | null;
  reference_image_url?: string | null;
  intent: {
    objective?: string;
    item?: string;
    category?: string;
    descriptors?: string[];
    visibleText?: string[];
    quantity?: number | null;
    targetPrice?: string | null;
    destination?: string | null;
    constraints?: string[];
    unknowns?: string[];
    searchQueries?: string[];
  };
  plan: Array<{ key?: string; label?: string; detail?: string; status?: string }>;
  sourcing_result: {
    research?: string;
    sources?: Array<{ index: number; title: string; url: string }>;
    searches?: string[];
    searchedAt?: string;
  };
  decision_context: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
type Candidate = {
  id: string;
  request_id: string;
  rank: number;
  status: "candidate" | "selected" | "rejected";
  supplier_name: string | null;
  offer_title: string;
  source_title: string | null;
  source_url: string | null;
  price_amount: number | null;
  currency: string | null;
  moq: number | null;
  shipping_summary: string | null;
  match_reason: string | null;
  risks: string[];
};
type Payload = {
  spot: {
    id: string;
    name: string;
    business_type: string | null;
    business_categories: string[];
    brand_tone: string | null;
    country_code: string | null;
    currency: string | null;
    timezone: string | null;
    accent_color: string | null;
  };
  role: string;
  requests: BusinessRequest[];
  candidates: Candidate[];
};

const MODES: Array<{ id: RequestType; label: string; icon: typeof Search }> = [
  { id: "sourcing", label: "Encontrar", icon: PackageSearch },
  { id: "procurement", label: "Comprar", icon: Search },
  { id: "listing", label: "Publicar", icon: Megaphone },
  { id: "logistics", label: "Envíos", icon: Truck },
  { id: "operations", label: "Resolver", icon: Activity },
];

const STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  analyzed: "Entendido",
  searching: "Buscando",
  candidates_ready: "Opciones listas",
  candidate_selected: "Opción elegida",
  in_progress: "En marcha",
  completed: "Completado",
  cancelled: "Cancelado",
};

function money(value: number | null, currency: string | null) {
  if (value === null) return null;
  try {
    return new Intl.NumberFormat("es-AR", { style: "currency", currency: currency || "USD", maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency || "$"} ${value}`;
  }
}

export default function BusinessPlayerPage() {
  const params = useParams<{ spotId: string }>();
  const spotId = String(params.spotId || "");
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState<Payload | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [requestType, setRequestType] = useState<RequestType>("sourcing");
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [searchingId, setSearchingId] = useState<string | null>(null);
  const [busyCandidate, setBusyCandidate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (preferId?: string) => {
    if (!user || !spotId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/mi-spot/${encodeURIComponent(spotId)}/business`);
      const payload = await readApiJson<Payload>(response);
      setData(payload);
      setActiveId((current) => preferId || current || payload.requests[0]?.id || null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar Business Player.");
    } finally {
      setLoading(false);
    }
  }, [spotId, user]);

  useEffect(() => {
    if (authLoading || !user) return;
    void load();
  }, [authLoading, load, user]);

  useEffect(() => () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
  }, [imagePreview]);

  const active = useMemo(() => data?.requests.find((item) => item.id === activeId) ?? null, [activeId, data]);
  const activeCandidates = useMemo(() => (data?.candidates ?? []).filter((candidate) => candidate.request_id === activeId), [activeId, data]);
  const accent = data?.spot.accent_color && /^#[0-9a-f]{3,8}$/i.test(data.spot.accent_color) ? data.spot.accent_color : "#8f5cff";

  function chooseImage(file: File | null) {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImage(file);
    setImagePreview(file ? URL.createObjectURL(file) : null);
  }

  async function createRequest() {
    if (!text.trim() && !image) return;
    setCreating(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("text", text.trim());
      body.set("requestType", requestType);
      if (image) body.set("image", image);
      const response = await authenticatedFetch(`/api/mi-spot/${encodeURIComponent(spotId)}/business`, { method: "POST", body });
      const payload = await readApiJson<{ request: BusinessRequest }>(response);
      setText("");
      chooseImage(null);
      await load(payload.request.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo crear la operación.");
    } finally {
      setCreating(false);
    }
  }

  async function runSourcing(requestId: string) {
    setSearchingId(requestId);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/mi-spot/${encodeURIComponent(spotId)}/business/${encodeURIComponent(requestId)}/source`, { method: "POST" });
      await readApiJson(response);
      await load(requestId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo buscar opciones.");
    } finally {
      setSearchingId(null);
    }
  }

  async function decide(candidateId: string, decision: "selected" | "rejected") {
    if (!active) return;
    setBusyCandidate(candidateId);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/mi-spot/${encodeURIComponent(spotId)}/business/${encodeURIComponent(active.id)}/source`, {
        method: "PATCH",
        body: JSON.stringify({ candidateId, decision }),
      });
      await readApiJson(response);
      await load(active.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar la decisión.");
    } finally {
      setBusyCandidate(null);
    }
  }

  return (
    <main className="min-h-screen bg-[#05040a] text-white">
      <MainNav />
      <div className="mx-auto max-w-7xl px-4 py-7 sm:px-8 sm:py-10">
        <Link href={`/mi-spot/${spotId}`} className="inline-flex items-center gap-2 text-sm text-white/42 transition hover:text-white"><ArrowLeft size={15} /> Volver al Spot</Link>

        <section className="relative mt-5 overflow-hidden rounded-[30px] border bg-[#0b0912] p-5 sm:p-8" style={{ borderColor: `${accent}36` }}>
          <div className="pointer-events-none absolute -right-24 -top-32 h-80 w-80 rounded-full blur-3xl" style={{ backgroundColor: `${accent}25` }} />
          <div className="relative max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.17em] text-white/50"><Sparkles size={12} style={{ color: accent }} /> Business Player</div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-5xl">{data?.spot.name || "Tu negocio"}, manejado desde una idea.</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/48 sm:text-base">Mandale una foto o escribí lo que necesitás. CLOUVA entiende el pedido, usa el contexto real de este Spot, lo convierte en una operación y te ayuda a llevarla hasta la decisión.</p>
          </div>
        </section>

        {error ? <p className="mt-4 rounded-2xl border border-rose-300/15 bg-rose-300/[0.06] p-4 text-sm text-rose-200">{error}</p> : null}

        <section className="mt-5 rounded-[26px] border border-white/[0.08] bg-[#0b0912] p-4 sm:p-5">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {MODES.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => setRequestType(id)} className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-xs transition ${requestType === id ? "text-white" : "border border-white/[0.07] bg-white/[0.025] text-white/42"}`} style={requestType === id ? { backgroundColor: accent } : undefined}><Icon size={14} /> {label}</button>)}
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-[1fr_180px]">
            <textarea value={text} onChange={(event) => setText(event.target.value)} rows={4} placeholder="Ej: Gamita me pidió conseguir estas remeras. Buscame opciones mayoristas que pueda traer al Spot y decime qué falta confirmar." className="min-h-28 resize-none rounded-2xl border border-white/[0.08] bg-black/25 px-4 py-3 text-sm leading-6 outline-none placeholder:text-white/22 focus:border-white/20" />
            <label className="relative grid min-h-28 cursor-pointer place-items-center overflow-hidden rounded-2xl border border-dashed border-white/15 bg-black/20 text-center transition hover:border-white/30">
              {imagePreview ? <><img src={imagePreview} alt="Referencia" className="absolute inset-0 h-full w-full object-cover" /><span className="absolute inset-0 bg-black/35" /><span className="relative rounded-full bg-black/60 px-3 py-1.5 text-[11px]">Cambiar foto</span></> : <span className="flex flex-col items-center gap-2 px-4 text-xs text-white/35"><Camera size={20} /> Foto / captura del pedido</span>}
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(event) => chooseImage(event.target.files?.[0] ?? null)} />
            </label>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-[11px] leading-5 text-white/26">La foto se usa como referencia privada del Spot. Texto y logos visibles se toman como pistas, no como autenticidad confirmada.</p>
            <button type="button" disabled={creating || (!text.trim() && !image)} onClick={() => void createRequest()} className="inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-35" style={{ backgroundColor: accent }}>{creating ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Entender pedido</button>
          </div>
        </section>

        {loading ? <div className="mt-6 grid min-h-44 place-items-center rounded-3xl border border-white/[0.08] bg-[#0b0912]"><span className="inline-flex items-center gap-2 text-sm text-white/40"><Loader2 size={16} className="animate-spin" /> Cargando operaciones…</span></div> : null}

        {!loading && data ? <section className="mt-5 grid gap-4 lg:grid-cols-[320px_1fr]">
          <aside className="rounded-[24px] border border-white/[0.08] bg-[#0b0912] p-3">
            <div className="flex items-center justify-between px-2 py-2"><div><p className="text-[10px] uppercase tracking-[0.15em] text-white/28">Operaciones</p><p className="mt-1 text-sm font-semibold">{data.requests.length} activas / históricas</p></div></div>
            <div className="mt-1 space-y-2">{data.requests.length ? data.requests.map((item) => <button key={item.id} type="button" onClick={() => setActiveId(item.id)} className={`w-full rounded-2xl border p-3 text-left transition ${activeId === item.id ? "border-white/18 bg-white/[0.055]" : "border-white/[0.06] bg-black/15 hover:border-white/12"}`}><div className="flex items-start gap-3">{item.reference_image_url ? <img src={item.reference_image_url} alt="" className="h-12 w-12 rounded-xl object-cover" /> : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/[0.04] text-white/30"><PackageSearch size={18} /></span>}<span className="min-w-0 flex-1"><strong className="block truncate text-sm">{item.title}</strong><span className="mt-1 block truncate text-xs text-white/34">{item.intent?.item || item.input_text || item.request_type}</span><span className="mt-2 inline-flex rounded-lg border border-white/[0.07] px-2 py-1 text-[10px] text-white/40">{STATUS_LABELS[item.status] || item.status}</span></span></div></button>) : <div className="rounded-2xl border border-white/[0.06] p-4 text-sm leading-6 text-white/32">Todavía no hay operaciones. Arriba podés crear la primera desde texto o una foto.</div>}</div>
          </aside>

          <div className="min-w-0">
            {active ? <ActiveOperation request={active} candidates={activeCandidates} accent={accent} searching={searchingId === active.id} busyCandidate={busyCandidate} onSearch={() => void runSourcing(active.id)} onDecision={(candidateId, decision) => void decide(candidateId, decision)} /> : <div className="grid min-h-72 place-items-center rounded-[24px] border border-white/[0.08] bg-[#0b0912] p-8 text-center"><div><Sparkles size={24} className="mx-auto text-white/25" /><p className="mt-3 text-sm text-white/35">Elegí o creá una operación.</p></div></div>}
          </div>
        </section> : null}
      </div>
    </main>
  );
}

function ActiveOperation({ request, candidates, accent, searching, busyCandidate, onSearch, onDecision }: {
  request: BusinessRequest;
  candidates: Candidate[];
  accent: string;
  searching: boolean;
  busyCandidate: string | null;
  onSearch: () => void;
  onDecision: (candidateId: string, decision: "selected" | "rejected") => void;
}) {
  const canSource = ["sourcing", "procurement", "vehicle", "operations"].includes(request.request_type) && !["candidate_selected", "completed"].includes(request.status);
  const sources = request.sourcing_result?.sources ?? [];
  return <div className="space-y-4">
    <article className="rounded-[24px] border border-white/[0.08] bg-[#0b0912] p-5 sm:p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-4">{request.reference_image_url ? <img src={request.reference_image_url} alt="Referencia" className="h-24 w-24 shrink-0 rounded-2xl object-cover sm:h-28 sm:w-28" /> : null}<div className="min-w-0"><p className="text-[10px] uppercase tracking-[0.15em] text-white/28">{request.request_type.replaceAll("_", " ")}</p><h2 className="mt-1 text-2xl font-semibold">{request.title}</h2><p className="mt-2 text-sm leading-6 text-white/45">{request.intent?.objective || request.input_text}</p><div className="mt-3 flex flex-wrap gap-2">{[request.intent?.category, ...(request.intent?.descriptors ?? [])].filter(Boolean).slice(0, 8).map((value) => <span key={String(value)} className="rounded-lg border border-white/[0.08] bg-white/[0.025] px-2 py-1 text-[11px] text-white/42">{value}</span>)}</div></div></div>
        {canSource ? <button type="button" onClick={onSearch} disabled={searching} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-45" style={{ backgroundColor: accent }}>{searching ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} {request.status === "candidates_ready" ? "Buscar de nuevo" : "Buscar ahora"}</button> : <span className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-emerald-300/15 bg-emerald-300/[0.055] px-3 py-2 text-xs text-emerald-100/75"><Check size={14} /> {STATUS_LABELS[request.status] || request.status}</span>}
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Info label="Cantidad" value={request.intent?.quantity ? String(request.intent.quantity) : "A confirmar"} />
        <Info label="Objetivo de precio" value={request.intent?.targetPrice || "A confirmar"} />
        <Info label="Destino" value={request.intent?.destination || "Usar contexto del Spot / confirmar"} />
      </div>

      {request.plan?.length ? <div className="mt-6"><p className="text-[10px] uppercase tracking-[0.15em] text-white/28">Plan de ejecución</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{request.plan.map((step, index) => <div key={`${step.key || index}`} className="rounded-2xl border border-white/[0.07] bg-black/15 p-3"><div className="flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-lg bg-white/[0.04] text-[10px] text-white/38">{index + 1}</span><strong className="text-xs">{step.label}</strong></div>{step.detail ? <p className="mt-2 text-xs leading-5 text-white/35">{step.detail}</p> : null}</div>)}</div></div> : null}

      {(request.intent?.unknowns ?? []).length ? <div className="mt-5 rounded-2xl border border-amber-300/10 bg-amber-300/[0.035] p-4"><p className="text-[10px] uppercase tracking-[0.13em] text-amber-100/55">Falta confirmar</p><div className="mt-2 flex flex-wrap gap-2">{request.intent.unknowns!.map((item) => <span key={item} className="rounded-lg bg-black/20 px-2 py-1 text-[11px] text-white/40">{item}</span>)}</div></div> : null}
    </article>

    {searching ? <article className="rounded-[24px] border border-white/[0.08] bg-[#0b0912] p-8 text-center"><Loader2 size={22} className="mx-auto animate-spin" style={{ color: accent }} /><h3 className="mt-3 text-sm font-semibold">Buscando opciones reales</h3><p className="mt-1 text-xs text-white/35">CLOUVA está consultando web actual y después normaliza las opciones para compararlas.</p></article> : null}

    {!searching && candidates.length ? <article className="rounded-[24px] border border-white/[0.08] bg-[#0b0912] p-5 sm:p-6"><div className="flex items-end justify-between gap-4"><div><p className="text-[10px] uppercase tracking-[0.15em] text-white/28">Sourcing grounded</p><h3 className="mt-1 text-xl font-semibold">Opciones encontradas</h3></div><span className="text-xs text-white/30">{candidates.length} candidatos</span></div><div className="mt-4 space-y-3">{candidates.map((candidate) => <div key={candidate.id} className={`rounded-2xl border p-4 ${candidate.status === "selected" ? "border-emerald-300/20 bg-emerald-300/[0.045]" : candidate.status === "rejected" ? "border-white/[0.05] bg-black/10 opacity-50" : "border-white/[0.08] bg-black/15"}`}><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-lg bg-white/[0.04] px-2 py-1 text-[10px] text-white/35">#{candidate.rank}</span>{candidate.supplier_name ? <span className="text-xs font-semibold" style={{ color: accent }}>{candidate.supplier_name}</span> : null}{candidate.status === "selected" ? <span className="inline-flex items-center gap-1 text-[10px] text-emerald-200"><Check size={11} /> Elegido</span> : null}</div><h4 className="mt-2 text-sm font-semibold">{candidate.offer_title}</h4>{candidate.match_reason ? <p className="mt-2 text-xs leading-5 text-white/42">{candidate.match_reason}</p> : null}<div className="mt-3 flex flex-wrap gap-2">{money(candidate.price_amount, candidate.currency) ? <span className="rounded-lg border border-white/[0.07] px-2 py-1 text-[11px] text-white/55">{money(candidate.price_amount, candidate.currency)}</span> : null}{candidate.moq !== null ? <span className="rounded-lg border border-white/[0.07] px-2 py-1 text-[11px] text-white/55">MOQ {candidate.moq}</span> : null}{candidate.shipping_summary ? <span className="rounded-lg border border-white/[0.07] px-2 py-1 text-[11px] text-white/45">{candidate.shipping_summary}</span> : null}</div>{candidate.risks?.length ? <p className="mt-3 text-[11px] leading-5 text-amber-100/45">Confirmar: {candidate.risks.join(" · ")}</p> : null}{candidate.source_url ? <a href={candidate.source_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-xs text-white/42 hover:text-white"><ExternalLink size={12} /> {candidate.source_title || "Abrir fuente"}</a> : null}</div>{candidate.status === "candidate" ? <div className="flex shrink-0 gap-2"><button type="button" disabled={Boolean(busyCandidate)} onClick={() => onDecision(candidate.id, "rejected")} className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs text-white/42 disabled:opacity-40"><X size={13} /> No sirve</button><button type="button" disabled={Boolean(busyCandidate)} onClick={() => onDecision(candidate.id, "selected")} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold disabled:opacity-40" style={{ backgroundColor: accent }}>{busyCandidate === candidate.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Elegir</button></div> : null}</div></div>)}</div></article> : null}

    {!searching && sources.length ? <article className="rounded-[24px] border border-white/[0.08] bg-[#0b0912] p-5 sm:p-6"><p className="text-[10px] uppercase tracking-[0.15em] text-white/28">Fuentes web consultadas</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{sources.slice(0, 8).map((source) => <a key={`${source.index}-${source.url}`} href={source.url} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-black/15 px-3 py-2.5 text-xs text-white/42 transition hover:text-white"><span className="truncate">{source.title}</span><ExternalLink size={12} className="shrink-0" /></a>)}</div></article> : null}
  </div>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-white/[0.07] bg-black/15 p-3"><span className="block text-[9px] uppercase tracking-[0.13em] text-white/25">{label}</span><strong className="mt-1 block text-xs font-medium text-white/58">{value}</strong></div>;
}
