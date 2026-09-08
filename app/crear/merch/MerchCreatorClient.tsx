"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Box, CheckCircle2, ImagePlus, Loader2, PackagePlus, RefreshCw, Send, Shirt, Sparkles } from "lucide-react";
import { useAuth } from "@/components/auth-provider";

type SellerContext = {
  user: { id: string };
  players: Array<{ id: string; name: string; slug: string }>;
  studios: Array<{ id: string; name: string; slug: string }>;
  spots: Array<{ id: string; name: string; slug: string; studio_id: string | null; owner_type: string; owner_user_id: string | null; currency: string }>;
};

type CreatorAsset = { kind?: string; label?: string; url: string; storagePath?: string; status?: string };
type CreatorProject = {
  id: string;
  owner_type: "player" | "studio" | "user" | "clouva";
  player_id: string | null;
  studio_id: string | null;
  spot_id: string | null;
  name: string;
  collection_name: string | null;
  category: string | null;
  product_template: string | null;
  creative_mode: "from_scratch" | "exact_design" | "reference";
  brief: string | null;
  status: string;
  reference_assets: CreatorAsset[];
  generated_assets: CreatorAsset[];
  approved_assets: CreatorAsset[];
  commerce_draft: Record<string, unknown>;
  variants_draft: Array<Record<string, unknown>>;
  commerce_product_id: string | null;
  clothing_item_id: string | null;
  creator_3d_asset_id: string | null;
  updated_at: string;
};

type Capture = { label: "Frente" | "Atrás" | "Detalle"; dataUrl: string; name: string };

type GeneratedPayload = {
  sourcePhotos: Array<{ label: string; displayLabel: string; url: string; storagePath: string }>;
  generatedImages: Array<{ kind: string; url: string; storagePath: string }>;
  coverImage: string | null;
};

type PreparedProduct = { id: string; slug: string; status: string; name: string };

const INPUT = "w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none transition focus:border-violet-400/60";
const CARD = "rounded-[1.5rem] border border-white/10 bg-white/[0.035]";

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
    reader.readAsDataURL(file);
  });
}

function assetUrl(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "url" in value && typeof (value as { url?: unknown }).url === "string") return String((value as { url: string }).url);
  return "";
}

function skuPart(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 18) || "CLU";
}

export function MerchCreatorClient() {
  const { session, user, loading: authLoading } = useAuth();
  const [context, setContext] = useState<SellerContext | null>(null);
  const [projects, setProjects] = useState<CreatorProject[]>([]);
  const [active, setActive] = useState<CreatorProject | null>(null);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [approved, setApproved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [preparedProduct, setPreparedProduct] = useState<PreparedProduct | null>(null);

  const [draft, setDraft] = useState({
    name: "",
    seller: "user",
    collection: "",
    category: "Merch",
    productTemplate: "shirt",
    creativeMode: "from_scratch",
    brief: "",
  });
  const [commerce, setCommerce] = useState({ price: "", currency: "ARS", stock: "1", sizes: "S,M,L,XL", color: "Negro" });

  const authFetch = useCallback(async (url: string, init?: RequestInit) => {
    if (!session?.access_token) throw new Error("Iniciá sesión para usar Commerce Creator.");
    const response = await fetch(url, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.access_token}`,
        ...(init?.headers ?? {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "La operación no pudo completarse.");
    return payload;
  }, [session?.access_token]);

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setError(null);
    const [contextPayload, projectPayload] = await Promise.all([
      authFetch("/api/creator-commerce/context"),
      authFetch("/api/creator-commerce/projects"),
    ]);
    setContext(contextPayload as SellerContext);
    setProjects(projectPayload.projects ?? []);
  }, [authFetch, session?.access_token]);

  useEffect(() => {
    if (authLoading || !user || !session?.access_token) return;
    void load().catch((cause) => setError(cause instanceof Error ? cause.message : "No se pudo cargar Crear Merch."));
  }, [authLoading, load, session?.access_token, user]);

  const sellerOptions = useMemo(() => {
    const options = [{ value: "user", label: "Mi cuenta" }];
    for (const player of context?.players ?? []) options.push({ value: `player:${player.id}`, label: `Player · ${player.name}` });
    for (const studio of context?.studios ?? []) options.push({ value: `studio:${studio.id}`, label: `Studio · ${studio.name}` });
    for (const spot of context?.spots ?? []) options.push({ value: `spot:${spot.id}`, label: `Business / Spot · ${spot.name}` });
    return options;
  }, [context]);

  async function createProject() {
    if (!draft.name.trim()) return setError("Poné un nombre al proyecto.");
    setBusy(true); setError(null); setMessage(null);
    try {
      const [kind, id] = draft.seller.split(":");
      const selectedSpot = kind === "spot" ? context?.spots.find((spot) => spot.id === id) : null;
      const selectedStudio = selectedSpot?.studio_id || (kind === "studio" ? id : null);
      const ownerType = selectedSpot ? (selectedStudio ? "studio" : "user") : kind === "player" || kind === "studio" ? kind : "user";
      const payload = await authFetch("/api/creator-commerce/projects", {
        method: "POST",
        body: JSON.stringify({
          name: draft.name,
          owner_type: ownerType,
          player_id: kind === "player" ? id : null,
          studio_id: selectedStudio,
          spot_id: selectedSpot?.id ?? null,
          collection_name: draft.collection,
          category: draft.category,
          product_template: draft.productTemplate,
          creative_mode: draft.creativeMode,
          brief: draft.brief,
        }),
      });
      const project = payload.project as CreatorProject;
      setProjects((current) => [project, ...current]);
      openProject(project);
      setMessage("Proyecto creado. Ahora sumá referencias o generá el producto.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo crear el proyecto."); }
    finally { setBusy(false); }
  }

  function openProject(project: CreatorProject) {
    setActive(project);
    setCaptures([]);
    setApproved((project.approved_assets ?? []).map(assetUrl).filter(Boolean));
    setPreparedProduct(project.commerce_product_id ? { id: project.commerce_product_id, slug: "", status: "draft", name: project.name } : null);
    const commerceDraft = project.commerce_draft ?? {};
    setCommerce((current) => ({
      ...current,
      price: commerceDraft.price == null ? current.price : String(commerceDraft.price),
      currency: typeof commerceDraft.currency === "string" ? commerceDraft.currency : current.currency,
      stock: commerceDraft.stock == null ? current.stock : String(commerceDraft.stock),
    }));
    setError(null); setMessage(null);
  }

  async function addCapture(label: Capture["label"], file: File | undefined) {
    if (!file) return;
    if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(file.type)) return setError("Usá JPG, PNG o WEBP.");
    if (file.size > 5 * 1024 * 1024) return setError("Cada referencia puede pesar hasta 5 MB.");
    try {
      const dataUrl = await fileToDataUrl(file);
      setCaptures((current) => label === "Detalle"
        ? [...current, { label, dataUrl, name: file.name }]
        : [...current.filter((capture) => capture.label !== label), { label, dataUrl, name: file.name }]);
      setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo cargar la imagen."); }
  }

  async function generateImages() {
    if (!active) return;
    if (!captures.some((capture) => capture.label === "Frente")) return setError("Subí una referencia de Frente.");
    setBusy(true); setError(null); setMessage(null);
    try {
      await authFetch(`/api/creator-commerce/projects/${active.id}`, { method: "PATCH", body: JSON.stringify({ status: "generating" }) });
      const payload = await authFetch("/api/creator-commerce/product-images", {
        method: "POST",
        body: JSON.stringify({
          projectId: active.id,
          creativeMode: active.creative_mode,
          includeLifestyle: true,
          captures: captures.map(({ label, dataUrl }) => ({ label, dataUrl })),
          productDraft: { name: active.name, category: active.category, description: active.brief, color: commerce.color },
        }),
      }) as GeneratedPayload;
      const references = payload.sourcePhotos.map((asset) => ({ ...asset, kind: "source", status: "reference" }));
      const generated = payload.generatedImages.map((asset) => ({ ...asset, status: "generated" }));
      const approvedNow = payload.coverImage ? [payload.coverImage] : generated.slice(0, 1).map((asset) => asset.url);
      const saved = await authFetch(`/api/creator-commerce/projects/${active.id}`, {
        method: "PATCH",
        body: JSON.stringify({ reference_assets: references, generated_assets: generated, approved_assets: approvedNow.map((url) => ({ url, status: "approved" })), status: "review" }),
      });
      setActive(saved.project as CreatorProject);
      setProjects((current) => current.map((project) => project.id === active.id ? saved.project : project));
      setApproved(approvedNow);
      setMessage(`Listo: ${generated.length} imágenes generadas. Elegí cuáles serán públicas.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudieron generar las imágenes."); }
    finally { setBusy(false); }
  }

  async function saveApproved() {
    if (!active) return;
    if (!approved.length) return setError("Elegí al menos una imagen aprobada.");
    setBusy(true); setError(null);
    try {
      const payload = await authFetch(`/api/creator-commerce/projects/${active.id}`, {
        method: "PATCH",
        body: JSON.stringify({ approved_assets: approved.map((url) => ({ url, status: "approved" })), status: "approved" }),
      });
      setActive(payload.project as CreatorProject);
      setProjects((current) => current.map((project) => project.id === active.id ? payload.project : project));
      setMessage("Imágenes aprobadas. Las referencias privadas siguen separadas de la publicación.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudieron aprobar las imágenes."); }
    finally { setBusy(false); }
  }

  function buildVariants() {
    const sizes = commerce.sizes.split(",").map((size) => size.trim()).filter(Boolean);
    if (!sizes.length) return [];
    const totalStock = Math.max(0, Math.floor(Number(commerce.stock) || 0));
    const base = Math.floor(totalStock / sizes.length);
    let remainder = totalStock % sizes.length;
    return sizes.map((size) => {
      const stock = base + (remainder-- > 0 ? 1 : 0);
      return {
        sku: `${skuPart(active?.name || "CLOUVA")}-${skuPart(commerce.color)}-${skuPart(size)}`,
        title: `${size} · ${commerce.color}`,
        size,
        color: commerce.color,
        stock,
        active: true,
        metadata: { creator_project_id: active?.id },
      };
    });
  }

  async function prepareProduct() {
    if (!active) return;
    if (!commerce.price || Number(commerce.price) < 0) return setError("Definí un precio válido.");
    setBusy(true); setError(null); setMessage(null);
    try {
      const payload = await authFetch(`/api/creator-commerce/projects/${active.id}/prepare-product`, {
        method: "POST",
        body: JSON.stringify({
          name: active.name,
          description: active.brief,
          price: Number(commerce.price),
          currency: commerce.currency,
          stock: Number(commerce.stock || 0),
          approved_images: approved,
          cover_url: approved[0] || null,
          listing_kind: "owned_design",
          variants: buildVariants(),
        }),
      });
      setActive(payload.project as CreatorProject);
      setProjects((current) => current.map((project) => project.id === active.id ? payload.project : project));
      setPreparedProduct(payload.product as PreparedProduct);
      setMessage(`Producto preparado: ${payload.product.name}. El productId queda fijo desde ahora.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo preparar el producto."); }
    finally { setBusy(false); }
  }

  async function publishMarket() {
    const productId = active?.commerce_product_id || preparedProduct?.id;
    if (!active || !productId) return setError("Primero prepará el producto comercial.");
    setBusy(true); setError(null); setMessage(null);
    try {
      await authFetch(`/api/commerce/products/${productId}/publications`, {
        method: "PUT",
        body: JSON.stringify({
          targetType: "marketplace",
          placement: "merch",
          channel: "clouva_market",
          destinationKey: "default",
          publicationMode: "automatic",
          status: "published",
          isVisible: true,
          channelTitle: active.name,
          channelDescription: active.brief || "",
          priceSnapshot: Number(commerce.price),
          currencySnapshot: commerce.currency,
          stockSnapshot: Number(commerce.stock || 0),
          metadata: { creator_project_id: active.id },
        }),
      });
      setMessage("Publicado en CLOUVA Market usando el mismo producto canónico.");
      setPreparedProduct((current) => current ? { ...current, status: "published" } : current);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo publicar en Market."); }
    finally { setBusy(false); }
  }

  if (!user && !authLoading) {
    return <main className="grid min-h-screen place-items-center bg-[#05030a] px-6 text-white"><Link href="/login?next=/crear/merch" className="rounded-full border border-violet-400/40 px-5 py-3">Iniciar sesión</Link></main>;
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_50%_-10%,rgba(124,58,237,.18),transparent_32%),#05030a] px-4 py-7 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href="/crear" className="inline-flex items-center gap-2 text-xs text-white/45 hover:text-white"><ArrowLeft size={14} /> Crear</Link>
            <p className="mt-5 text-[10px] font-bold uppercase tracking-[.28em] text-violet-300">CLOUVA Commerce Creator</p>
            <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">Crear Merch</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/50">Idea → referencias → imágenes → producto canónico → Market. El Creator crea; Commerce vende.</p>
          </div>
          <Link href="/market" className="rounded-full border border-white/10 bg-white/[.04] px-4 py-2 text-sm text-white/70">Ver Market</Link>
        </div>

        {error ? <div className="mt-6 rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}
        {message ? <div className="mt-6 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">{message}</div> : null}

        {!active ? (
          <div className="mt-8 grid gap-6 lg:grid-cols-[1.05fr_.95fr]">
            <section className={`${CARD} p-5 sm:p-7`}>
              <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-2xl bg-violet-500/15 text-violet-200"><Sparkles size={18} /></span><div><h2 className="font-semibold">Nuevo proyecto</h2><p className="text-xs text-white/40">La madre del drop y sus productos.</p></div></div>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <label className="text-xs text-white/50">Nombre<input className={`${INPUT} mt-2`} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Vida de Flows Drop 01" /></label>
                <label className="text-xs text-white/50">Vendedor<select className={`${INPUT} mt-2`} value={draft.seller} onChange={(e) => setDraft({ ...draft, seller: e.target.value })}>{sellerOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                <label className="text-xs text-white/50">Colección<input className={`${INPUT} mt-2`} value={draft.collection} onChange={(e) => setDraft({ ...draft, collection: e.target.value })} placeholder="Drop 01" /></label>
                <label className="text-xs text-white/50">Producto<select className={`${INPUT} mt-2`} value={draft.productTemplate} onChange={(e) => setDraft({ ...draft, productTemplate: e.target.value })}><option value="shirt">Remera</option><option value="hoodie">Hoodie</option><option value="cap">Gorra</option><option value="poster">Poster</option><option value="custom">Objeto personalizado</option></select></label>
                <label className="text-xs text-white/50">Método<select className={`${INPUT} mt-2`} value={draft.creativeMode} onChange={(e) => setDraft({ ...draft, creativeMode: e.target.value })}><option value="from_scratch">Desde cero</option><option value="exact_design">Diseño exacto</option><option value="reference">Referencia / inspiración</option></select></label>
                <label className="text-xs text-white/50">Categoría<input className={`${INPUT} mt-2`} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} /></label>
              </div>
              <label className="mt-4 block text-xs text-white/50">Contame la idea<textarea className={`${INPUT} mt-2 min-h-32 resize-y`} value={draft.brief} onChange={(e) => setDraft({ ...draft, brief: e.target.value })} placeholder="Remera negra oversize, identidad violeta y azul, arte adelante y detalle atrás..." /></label>
              <button onClick={() => void createProject()} disabled={busy} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-violet-500 px-5 py-3 text-sm font-bold disabled:opacity-50">{busy ? <Loader2 className="animate-spin" size={17} /> : <PackagePlus size={17} />} Crear proyecto</button>
            </section>

            <section className={`${CARD} p-5 sm:p-7`}>
              <div className="flex items-center justify-between"><div><h2 className="font-semibold">Mis proyectos</h2><p className="mt-1 text-xs text-white/40">Salí y volvé cuando quieras.</p></div><button onClick={() => void load()} className="rounded-xl border border-white/10 p-2 text-white/50"><RefreshCw size={16} /></button></div>
              <div className="mt-5 space-y-3">{projects.length ? projects.map((project) => <button key={project.id} onClick={() => openProject(project)} className="w-full rounded-2xl border border-white/10 bg-black/25 p-4 text-left hover:border-violet-400/35"><div className="flex items-center justify-between gap-3"><strong>{project.name}</strong><span className="text-[10px] uppercase tracking-wider text-violet-300">{project.status}</span></div><p className="mt-2 text-xs text-white/40">{project.category || "Merch"} · {project.product_template || "Producto"}</p>{project.commerce_product_id ? <p className="mt-2 text-[11px] text-emerald-300">Producto conectado · {project.commerce_product_id.slice(0, 8)}</p> : null}</button>) : <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-white/35">Todavía no hay proyectos.</div>}</div>
            </section>
          </div>
        ) : (
          <div className="mt-8 space-y-6">
            <section className={`${CARD} p-5 sm:p-7`}>
              <div className="flex flex-wrap items-start justify-between gap-4"><div><button onClick={() => setActive(null)} className="text-xs text-white/40 hover:text-white">← Mis proyectos</button><h2 className="mt-3 text-2xl font-semibold">{active.name}</h2><p className="mt-2 text-sm text-white/45">{active.brief || "Sin brief todavía."}</p></div><span className="rounded-full border border-violet-400/20 bg-violet-500/10 px-3 py-1.5 text-xs text-violet-200">{active.creative_mode.replaceAll("_", " ")}</span></div>
            </section>

            <div className="grid gap-6 xl:grid-cols-2">
              <section className={`${CARD} p-5 sm:p-7`}>
                <div className="flex items-center gap-3"><ImagePlus size={19} className="text-violet-300" /><div><h3 className="font-semibold">Referencias</h3><p className="text-xs text-white/40">Frente obligatorio. Atrás y detalles suman fidelidad.</p></div></div>
                <div className="mt-5 grid gap-3 sm:grid-cols-3">{(["Frente", "Atrás", "Detalle"] as const).map((label) => <label key={label} className="cursor-pointer rounded-2xl border border-dashed border-white/15 bg-black/25 p-4 text-center text-sm hover:border-violet-400/40"><strong>{label}</strong><span className="mt-2 block text-xs text-white/35">Subir imagen</span><input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void addCapture(label, e.target.files?.[0])} /></label>)}</div>
                {captures.length ? <div className="mt-4 flex flex-wrap gap-2">{captures.map((capture, index) => <span key={`${capture.label}-${index}`} className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/55">{capture.label}: {capture.name}</span>)}</div> : null}
                <button onClick={() => void generateImages()} disabled={busy || !captures.length} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-bold disabled:opacity-40">{busy ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />} Generar imágenes</button>
              </section>

              <section className={`${CARD} p-5 sm:p-7`}>
                <div className="flex items-center gap-3"><CheckCircle2 size={19} className="text-emerald-300" /><div><h3 className="font-semibold">Aprobados para Commerce</h3><p className="text-xs text-white/40">Solo lo que marques acá puede volverse público.</p></div></div>
                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">{(active.generated_assets ?? []).map((asset) => { const selected = approved.includes(asset.url); return <button key={asset.url} onClick={() => setApproved((current) => selected ? current.filter((url) => url !== asset.url) : [...current, asset.url])} className={`overflow-hidden rounded-2xl border text-left ${selected ? "border-emerald-400/60" : "border-white/10"}`}><img src={asset.url} alt={asset.kind || "Generado"} className="aspect-square w-full object-cover" /><span className="block px-3 py-2 text-[11px] text-white/55">{asset.kind || "generated"}{selected ? " · aprobado" : ""}</span></button>; })}</div>
                {!active.generated_assets?.length ? <div className="mt-5 rounded-2xl border border-dashed border-white/10 p-8 text-center text-xs text-white/35">Generá imágenes para revisarlas acá.</div> : null}
                <button onClick={() => void saveApproved()} disabled={busy || !approved.length} className="mt-5 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-2.5 text-sm font-semibold text-emerald-200 disabled:opacity-40">Guardar selección pública</button>
              </section>
            </div>

            <section className={`${CARD} p-5 sm:p-7`}>
              <div className="flex items-center gap-3"><Shirt size={19} className="text-violet-300" /><div><h3 className="font-semibold">Producto comercial</h3><p className="text-xs text-white/40">Esto termina en commerce_products. No se crea un merch_product paralelo.</p></div></div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5"><label className="text-xs text-white/50">Precio<input className={`${INPUT} mt-2`} inputMode="decimal" value={commerce.price} onChange={(e) => setCommerce({ ...commerce, price: e.target.value })} placeholder="25000" /></label><label className="text-xs text-white/50">Moneda<select className={`${INPUT} mt-2`} value={commerce.currency} onChange={(e) => setCommerce({ ...commerce, currency: e.target.value })}><option>ARS</option><option>USD</option></select></label><label className="text-xs text-white/50">Stock total<input className={`${INPUT} mt-2`} inputMode="numeric" value={commerce.stock} onChange={(e) => setCommerce({ ...commerce, stock: e.target.value })} /></label><label className="text-xs text-white/50">Talles<input className={`${INPUT} mt-2`} value={commerce.sizes} onChange={(e) => setCommerce({ ...commerce, sizes: e.target.value })} placeholder="S,M,L,XL" /></label><label className="text-xs text-white/50">Color<input className={`${INPUT} mt-2`} value={commerce.color} onChange={(e) => setCommerce({ ...commerce, color: e.target.value })} /></label></div>
              <div className="mt-5 flex flex-wrap gap-3"><button onClick={() => void prepareProduct()} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-black disabled:opacity-50"><PackagePlus size={16} /> {active.commerce_product_id ? "Actualizar producto" : "Preparar producto"}</button><Link href={`/mi-flow/crear-prenda?creatorProjectId=${encodeURIComponent(active.id)}`} className="inline-flex items-center gap-2 rounded-xl border border-violet-400/25 bg-violet-500/10 px-4 py-2.5 text-sm font-semibold text-violet-200"><Box size={16} /> Crear gemelo 3D</Link><button onClick={() => void publishMarket()} disabled={busy || !active.commerce_product_id} className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-2.5 text-sm font-semibold text-emerald-200 disabled:opacity-40"><Send size={16} /> Publicar en Market</button>{preparedProduct?.slug ? <Link href={`/producto/${preparedProduct.slug}`} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-white/60">Ver ficha</Link> : null}</div>
              {active.commerce_product_id ? <p className="mt-4 text-xs text-white/35">productId canónico: <span className="font-mono text-white/60">{active.commerce_product_id}</span></p> : null}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
