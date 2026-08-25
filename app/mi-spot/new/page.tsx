"use client";

import { ArrowLeft, ArrowRight, Camera, Check, Crown, Loader2, Sparkles, Store, WandSparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { MainNav } from "@/components/layout";
import { QUICK_SPOT_INTENTS, type SpotBusinessAnalysis } from "@/lib/commerce/spot-business";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type AnalysisPayload = {
  analysis: SpotBusinessAnalysis;
  provider: "gemini";
  model: string;
  advisoryOnly: true;
};

type SpaceType = "studio" | "business" | "spot" | "club" | "brand" | "other";

const SPACE_TYPES: Array<{ value: SpaceType; label: string; detail: string }> = [
  { value: "studio", label: "Estudio", detail: "Equipo creativo, artistas, servicios y proyectos" },
  { value: "business", label: "Negocio", detail: "Comercio, servicios, stock, ventas y clientes" },
  { value: "spot", label: "Spot", detail: "Tienda, merch o punto comercial" },
  { value: "club", label: "Club", detail: "Comunidad, membresías, eventos y servicios" },
  { value: "brand", label: "Marca", detail: "Identidad, catálogo y presencia comercial" },
  { value: "other", label: "Otro", detail: "Un espacio flexible para tu proyecto" },
];

const INPUT = "w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-violet-400/45";

async function fileToDataUrl(file: File) {
  if (!file.type.startsWith("image/")) throw new Error("Elegí una imagen JPG, PNG o WEBP.");
  if (file.size > 4 * 1024 * 1024) throw new Error("Cada imagen puede pesar hasta 4 MB.");
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

export default function NewSpotPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [spaceType, setSpaceType] = useState<SpaceType>("business");
  const [name, setName] = useState("");
  const [intent, setIntent] = useState("");
  const [description, setDescription] = useState("");
  const [country, setCountry] = useState("AR");
  const [website, setWebsite] = useState("");
  const [social, setSocial] = useState("");
  const [images, setImages] = useState<Array<{ label: string; dataUrl: string }>>([]);
  const [analysis, setAnalysis] = useState<SpotBusinessAnalysis | null>(null);
  const [model, setModel] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [vipRequired, setVipRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login?next=/mi-spot/new");
  }, [authLoading, router, user]);

  async function addImages(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    try {
      const selected = Array.from(files).slice(0, Math.max(0, 3 - images.length));
      const prepared = await Promise.all(selected.map(async (file, index) => ({
        label: file.name.slice(0, 40) || `Referencia ${images.length + index + 1}`,
        dataUrl: await fileToDataUrl(file),
      })));
      setImages((current) => [...current, ...prepared].slice(0, 3));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudieron preparar las imágenes.");
    }
  }

  async function analyze() {
    if (!description.trim()) {
      setError("Contanos qué querés hacer en este espacio.");
      return;
    }
    setAnalyzing(true);
    setError(null);
    try {
      const response = await authenticatedFetch("/api/mi-spot/analyze", {
        method: "POST",
        body: JSON.stringify({ name, description, intent, country, website, social, images, spaceType }),
      });
      const payload = await readApiJson<AnalysisPayload>(response);
      setAnalysis(payload.analysis);
      setModel(payload.model);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gemini no pudo analizar el espacio.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function create() {
    if (!name.trim() || !description.trim()) {
      setError("Poné un nombre y contanos qué hace este espacio.");
      return;
    }
    setCreating(true);
    setVipRequired(false);
    setError(null);
    try {
      if (spaceType === "studio") {
        const response = await authenticatedFetch("/api/studios/create", {
          method: "POST",
          body: JSON.stringify({ name, slug: name, description }),
        });
        const payload = await readApiJson<{ studio: { id: string; slug: string }; next: string }>(response);
        router.push(payload.next || `/studios/${payload.studio.slug}/studio-os`);
        return;
      }

      const response = await authenticatedFetch("/api/mi-spot", {
        method: "POST",
        body: JSON.stringify({ name, description, intent, countryCode: country, spaceType, analysis }),
      });
      const payload = await readApiJson<{ spot: { id: string }; next: string }>(response);
      router.push(payload.next || `/mi-spot/${payload.spot.id}`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "No se pudo crear tu espacio.";
      setError(message);
      setVipRequired(message.toUpperCase().includes("VIP"));
      setCreating(false);
    }
  }

  const selectedType = SPACE_TYPES.find((option) => option.value === spaceType) ?? SPACE_TYPES[1];

  return (
    <main className="min-h-screen bg-[#05040a] text-white">
      <MainNav />
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-12">
        <Link href="/mi-spot" className="inline-flex items-center gap-2 text-sm text-white/45 transition hover:text-white"><ArrowLeft size={15} /> MIS ESPACIOS</Link>
        <div className="mt-5 grid gap-5 lg:grid-cols-[1.05fr_.95fr]">
          <section className="rounded-[28px] border border-white/[0.08] bg-[#0b0912] p-6 sm:p-7">
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-300/15 bg-violet-300/[0.07] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-200"><Store size={14} /> Nuevo espacio</div>
            <h1 className="mt-5 text-3xl font-semibold sm:text-4xl">Creá un espacio</h1>
            <p className="mt-2 text-sm leading-6 text-white/48">Tu Player es la identidad propietaria dentro de CLOUVA. Elegí qué tipo de espacio querés crear; la administración requiere CLOUVA VIP.</p>

            <div className="mt-7 space-y-4">
              <div><span className="mb-2 block text-xs font-medium text-white/55">¿Qué querés crear?</span><div className="grid gap-2 sm:grid-cols-2">{SPACE_TYPES.map((option) => <button key={option.value} type="button" onClick={() => { setSpaceType(option.value); setAnalysis(null); }} className={`rounded-2xl border p-3 text-left transition ${spaceType === option.value ? "border-violet-400/55 bg-violet-500/15" : "border-white/10 bg-white/[0.025] hover:border-white/20"}`}><b className="block text-sm">{option.label}</b><span className="mt-1 block text-[11px] leading-4 text-white/38">{option.detail}</span></button>)}</div></div>
              <label className="block"><span className="mb-2 block text-xs font-medium text-white/55">Nombre del {selectedType.label}</span><input className={INPUT} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej: El Iglú, Mercado Renata, S.I.Z. Zapala" /></label>
              {spaceType !== "studio" ? <div><span className="mb-2 block text-xs font-medium text-white/55">¿Qué querés hacer?</span><div className="flex flex-wrap gap-2">{QUICK_SPOT_INTENTS.map((option) => <button key={option} type="button" onClick={() => setIntent(option)} className={`rounded-xl border px-3 py-2 text-xs transition ${intent === option ? "border-violet-400/55 bg-violet-500/15 text-violet-100" : "border-white/10 bg-white/[0.03] text-white/45 hover:text-white"}`}>{option}</button>)}</div></div> : null}
              <label className="block"><span className="mb-2 block text-xs font-medium text-white/55">Contanos el espacio con tus palabras</span><textarea className={INPUT} rows={5} value={description} onChange={(event) => { setDescription(event.target.value); setAnalysis(null); }} placeholder="Qué hacés, qué vendés u ofrecés, a quién atendés y qué necesitás administrar." /></label>
              <div className="grid gap-3 sm:grid-cols-2"><label><span className="mb-2 block text-xs font-medium text-white/55">País</span><select className={INPUT} value={country} onChange={(event) => setCountry(event.target.value)}><option value="AR">Argentina</option><option value="UY">Uruguay</option><option value="CL">Chile</option><option value="MX">México</option><option value="US">Estados Unidos</option></select></label><label><span className="mb-2 block text-xs font-medium text-white/55">Website opcional</span><input className={INPUT} value={website} onChange={(event) => setWebsite(event.target.value)} placeholder="tu-espacio.com" /></label></div>
              <label className="block"><span className="mb-2 block text-xs font-medium text-white/55">Red social opcional</span><input className={INPUT} value={social} onChange={(event) => setSocial(event.target.value)} placeholder="@tu-espacio" /></label>
              <div><span className="mb-2 block text-xs font-medium text-white/55">Referencias visuales opcionales</span><label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-white/12 bg-white/[0.025] px-4 py-4 text-sm text-white/42 transition hover:border-violet-400/35 hover:text-white"><Camera size={17} /> Agregar logo, local o producto<input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(event) => void addImages(event.target.files)} /></label>{images.length ? <div className="mt-2 flex flex-wrap gap-2">{images.map((image, index) => <button key={`${image.label}-${index}`} type="button" onClick={() => setImages((current) => current.filter((_, currentIndex) => currentIndex !== index))} className="rounded-lg border border-white/10 px-2 py-1 text-[10px] text-white/45">{image.label} ×</button>)}</div> : null}</div>
            </div>

            {error ? <div className="mt-5 rounded-xl border border-rose-300/15 bg-rose-300/[0.06] p-3 text-sm text-rose-200"><p>{error}</p>{vipRequired?<Link href="/vip" className="mt-3 inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white"><Crown size={14}/>Activar CLOUVA VIP</Link>:null}</div> : null}
            {spaceType !== "studio" ? <button type="button" onClick={() => void analyze()} disabled={analyzing || !description.trim()} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 px-5 py-3.5 text-sm font-semibold transition hover:bg-violet-500 disabled:opacity-45">{analyzing ? <Loader2 size={17} className="animate-spin" /> : <WandSparkles size={17} />}{analyzing ? "Gemini está entendiendo tu espacio…" : "Preparar con Gemini"}</button> : null}
          </section>

          <aside className="rounded-[28px] border border-violet-400/15 bg-gradient-to-br from-[#171022] via-[#0e0a17] to-[#09080f] p-6 sm:p-7">
            <div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl border border-violet-300/15 bg-violet-300/[0.08] text-violet-300"><Sparkles size={20} /></span><div><p className="text-xs uppercase tracking-[0.15em] text-white/35">{selectedType.label}</p><h2 className="text-lg font-semibold">{spaceType === "studio" ? "Studio OS + Space Core" : "Gemini + tu decisión"}</h2></div></div>
            {spaceType === "studio" ? <div className="mt-8 rounded-2xl border border-white/[0.07] bg-black/20 p-5 text-sm leading-6 text-white/45">El Estudio se crea con el sistema de Studios existente y queda conectado automáticamente al Space Core. No se duplica El Iglú ni se reemplaza Studio OS.</div> : !analysis ? <div className="mt-8 rounded-2xl border border-white/[0.07] bg-black/20 p-5 text-sm leading-6 text-white/40">Gemini puede sugerir módulos, inventario y estilo. No decide propietario, beneficiario, permisos, precios, stock ni dinero real.</div> : (
              <div className="mt-7 space-y-5">
                <div><span className="text-[10px] uppercase tracking-[0.14em] text-white/30">Tipo detectado</span><h3 className="mt-1 text-xl font-semibold capitalize">{analysis.businessType.replaceAll("_", " ")}</h3><p className="mt-2 text-sm leading-5 text-white/45">{analysis.suggestedDescription}</p></div>
                <div><span className="text-[10px] uppercase tracking-[0.14em] text-white/30">Módulos</span><div className="mt-2 flex flex-wrap gap-2">{analysis.suggestedModules.map((module) => <span key={module} className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-white/62"><Check size={12} className="text-emerald-300" />{module}</span>)}</div></div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2"><Info label="Inventario" value={analysis.suggestedInventoryMode} /><Info label="Tono" value={analysis.suggestedBrandTone || "Personalizable"} /></div>
                {analysis.suggestedColorDirection ? <Info label="Dirección visual" value={analysis.suggestedColorDirection} /> : null}
                <p className="text-[11px] leading-5 text-white/28">Sugerido por {model || "Gemini"}. Nada se publica ni se cobra sin tu confirmación.</p>
              </div>
            )}
            <button type="button" onClick={() => void create()} disabled={creating || !name.trim() || !description.trim()} className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-violet-300/25 bg-violet-300/[0.08] px-5 py-3.5 text-sm font-semibold text-violet-100 transition hover:bg-violet-300/[0.12] disabled:opacity-40">{creating ? <Loader2 size={17} className="animate-spin" /> : <Store size={17} />}{creating ? "Creando espacio…" : `Crear ${selectedType.label}`}<ArrowRight size={16} /></button>
            <p className="mt-3 text-center text-[11px] leading-5 text-white/30">Crear y administrar espacios requiere CLOUVA VIP. Ser miembro o viewer no.</p>
          </aside>
        </div>
      </div>
    </main>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-white/[0.07] bg-black/20 p-4"><span className="text-[10px] uppercase tracking-[0.14em] text-white/30">{label}</span><p className="mt-1 text-sm text-white/65">{value}</p></div>;
}
