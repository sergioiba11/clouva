"use client";

import { Building2, Globe2, Loader2, MapPin, Store } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { OnboardingShell } from "@/components/onboarding/OnboardingShell";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type BusinessKind = "digital_business" | "physical_business" | "studio";

type Option = {
  kind: BusinessKind;
  title: string;
  detail: string;
  examples: string;
  modules: string;
  Icon: typeof Globe2;
};

const OPTIONS: Option[] = [
  {
    kind: "digital_business",
    title: "Negocio digital",
    detail: "Para vender productos o servicios online.",
    examples: "Merch · ropa · e-commerce · tienda propia · ventas online",
    modules: "Catálogo · variantes · marketplace · pedidos · pagos · envíos · analytics",
    Icon: Globe2,
  },
  {
    kind: "physical_business",
    title: "Negocio físico",
    detail: "Para administrar un comercio, local o inventario físico.",
    examples: "Local · comercio · depósito · punto de venta",
    modules: "Stock · inventario · scanner · QR · EAN/UPC · etiquetas · caja",
    Icon: Store,
  },
  {
    kind: "studio",
    title: "Estudio",
    detail: "Para espacios que venden servicios, producciones o experiencias.",
    examples: "Música · tattoo · foto · audiovisual · producción · salas",
    modules: "Studio OS · servicios · reservas · equipo · membresías · commerce",
    Icon: Building2,
  },
];

const INPUT = "w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-violet-400/50";

function isKind(value: string | null): value is BusinessKind {
  return value === "digital_business" || value === "physical_business" || value === "studio";
}

function NewBusinessForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const initialKind = isKind(searchParams.get("type")) ? searchParams.get("type") as BusinessKind : null;
  const [kind, setKind] = useState<BusinessKind | null>(initialKind);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [countryCode, setCountryCode] = useState("AR");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login?next=/businesses/new");
  }, [authLoading, router, user]);

  const selected = useMemo(() => OPTIONS.find((option) => option.kind === kind) ?? null, [kind]);

  async function create() {
    if (!kind) return;
    setSaving(true);
    setError(null);
    try {
      const response = await authenticatedFetch("/api/businesses", {
        method: "POST",
        body: JSON.stringify({
          kind,
          name,
          category,
          subcategory,
          description,
          location,
          countryCode,
        }),
      });
      const payload = await readApiJson<{ next: string }>(response);
      router.push(payload.next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo crear el negocio.");
      setSaving(false);
    }
  }

  return (
    <OnboardingShell
      step={3}
      title={kind ? `Crear ${selected?.title.toLowerCase()}` : "¿Qué querés crear?"}
      description={kind
        ? "El tipo define el punto de partida. Los módulos pueden activarse después sin cambiar la identidad del espacio."
        : "Elegí la naturaleza principal del negocio. CLOUVA usa el mismo Space Core para que productos, equipo, permisos y módulos no se dupliquen."}
    >
      {!kind ? (
        <div className="grid gap-3">
          {OPTIONS.map((option) => {
            const Icon = option.Icon;
            return (
              <button
                key={option.kind}
                type="button"
                onClick={() => setKind(option.kind)}
                className="group flex items-start gap-4 rounded-2xl border border-white/10 bg-white/[0.025] p-4 text-left transition hover:border-violet-400/50 hover:bg-violet-500/10"
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-violet-400/25 bg-violet-500/10 text-violet-200"><Icon size={20} /></span>
                <span className="min-w-0">
                  <span className="font-semibold">{option.title}</span>
                  <span className="mt-1 block text-xs leading-5 text-white/50">{option.detail}</span>
                  <span className="mt-2 block text-[11px] leading-5 text-white/30">{option.examples}</span>
                  <span className="block text-[11px] leading-5 text-violet-200/55">{option.modules}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="space-y-4">
          <button type="button" onClick={() => setKind(null)} className="text-xs font-medium text-violet-200/70 hover:text-violet-100">← Cambiar tipo</button>

          <label className="block"><span className="mb-2 block text-xs font-medium text-white/55">Nombre</span><input className={INPUT} value={name} onChange={(event) => setName(event.target.value)} maxLength={160} placeholder={kind === "studio" ? "Ej: El Iglú" : "Ej: Vida de Flows Store"} /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label><span className="mb-2 block text-xs font-medium text-white/55">Categoría</span><input className={INPUT} value={category} onChange={(event) => setCategory(event.target.value)} maxLength={120} placeholder={kind === "studio" ? "Música" : "Ropa"} /></label>
            <label><span className="mb-2 block text-xs font-medium text-white/55">Subcategoría</span><input className={INPUT} value={subcategory} onChange={(event) => setSubcategory(event.target.value)} maxLength={120} placeholder="Opcional" /></label>
          </div>
          <label className="block"><span className="mb-2 block text-xs font-medium text-white/55">Descripción</span><textarea className={INPUT} rows={5} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={4000} placeholder="Qué hacés, qué vendés u ofrecés y qué querés administrar desde CLOUVA." /></label>

          {kind !== "digital_business" ? (
            <label className="block">
              <span className="mb-2 flex items-center gap-2 text-xs font-medium text-white/55"><MapPin size={13} /> Ubicación {kind === "physical_business" ? "" : "opcional"}</span>
              <input className={INPUT} value={location} onChange={(event) => setLocation(event.target.value)} maxLength={200} placeholder="Ciudad, barrio o dirección" />
            </label>
          ) : null}

          <label className="block"><span className="mb-2 block text-xs font-medium text-white/55">País</span><select className={INPUT} value={countryCode} onChange={(event) => setCountryCode(event.target.value)}><option value="AR">Argentina</option><option value="UY">Uruguay</option><option value="CL">Chile</option><option value="MX">México</option><option value="US">Estados Unidos</option></select></label>

          {error ? <p className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}

          <button
            type="button"
            onClick={() => void create()}
            disabled={saving || !name.trim() || !category.trim() || !description.trim() || (kind === "physical_business" && !location.trim())}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 px-5 py-3.5 text-sm font-semibold transition hover:bg-violet-500 disabled:opacity-45"
          >
            {saving ? <Loader2 size={17} className="animate-spin" /> : null}
            {saving ? "Creando…" : "Crear negocio"}
          </button>
        </div>
      )}
    </OnboardingShell>
  );
}

export default function NewBusinessPage() {
  return <Suspense fallback={<main className="min-h-screen bg-[#05040a]" aria-hidden="true" />}><NewBusinessForm /></Suspense>;
}
