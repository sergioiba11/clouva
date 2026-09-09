"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Box,
  Check,
  CheckCircle2,
  ChevronRight,
  ImagePlus,
  Layers3,
  Loader2,
  PackagePlus,
  Plus,
  RefreshCw,
  Save,
  Send,
  Shirt,
  Sparkles,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { useAuth } from "@/components/auth-provider";

type SellerContext = {
  user: { id: string };
  players: Array<{ id: string; name: string; slug: string }>;
  studios: Array<{ id: string; name: string; slug: string }>;
  spots: Array<{ id: string; name: string; slug: string; studio_id: string | null; owner_type: string; owner_user_id: string | null; currency: string }>;
};

type CreatorAsset = {
  kind?: string;
  label?: string;
  url: string;
  storagePath?: string;
  mimeType?: string;
  status?: string;
};

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
  status: "draft" | "generating" | "review" | "approved" | "commerce_ready" | string;
  design_system: Record<string, unknown>;
  reference_assets: CreatorAsset[];
  generated_assets: CreatorAsset[];
  approved_assets: CreatorAsset[];
  commerce_product_id: string | null;
  metadata: Record<string, unknown>;
  updated_at: string;
};

type CommerceProductSummary = {
  id: string;
  slug: string;
  status: string;
  name: string;
  price: number | string;
  currency: string;
  stock: number | null;
  cover_url: string | null;
};

type ListingCopy = {
  title: string;
  shortDescription: string;
  description: string;
  features: string[];
  tags: string[];
  caption: string;
  status: "draft" | "approved";
  provider?: string;
  model?: string;
  generated_at?: string;
};

type ProductConcept = {
  id: string;
  project_id: string;
  name: string;
  product_template: string;
  role: "primary" | "secondary";
  position: number;
  status: "draft" | "pending" | "generating" | "review" | "approved" | "commerce_ready" | "published" | "failed";
  creative_config: Record<string, unknown>;
  design_overrides: Record<string, unknown>;
  reference_assets: CreatorAsset[];
  generated_assets: CreatorAsset[];
  approved_assets: CreatorAsset[];
  commerce_draft: Record<string, unknown>;
  variants_draft: Array<Record<string, unknown>>;
  listing_copy: Record<string, unknown>;
  clothing_item_id: string | null;
  creator_3d_asset_id: string | null;
  production_status: string;
  production_data: Record<string, unknown>;
  metadata: Record<string, unknown>;
  commerce_product: CommerceProductSummary | null;
};

type Capture = { label: "Frente" | "Atrás" | "Detalle"; dataUrl: string; name: string };
type GeneratedPayload = {
  sourcePhotos: Array<{ label: string; displayLabel: string; url: string; storagePath: string; mimeType?: string }>;
  generatedImages: Array<{ kind: string; url: string; storagePath: string; mimeType?: string }>;
  coverImage: string | null;
};
type ConceptDraft = {
  name: string;
  color: string;
  placement: string;
  material: string;
  notes: string;
  overrideNotes: string;
  price: string;
  currency: string;
  stock: string;
  variants: string;
};
type DesignSystem = {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  typographyDirection: string;
  graphicLanguage: string;
  textures: string;
  mood: string;
  compositionRules: string;
  prohibitedElements: string;
  campaignStyle: string;
};
type CampaignKind = "collection_cover" | "campaign_group" | "campaign_story" | "campaign_social_square";

const INPUT = "w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none transition focus:border-violet-400/60";
const CARD = "rounded-[1.5rem] border border-white/10 bg-white/[0.035]";
const GARMENT_TEMPLATES = new Set(["shirt", "hoodie", "sweatshirt", "jacket"]);
const PRODUCT_TEMPLATES = [
  { key: "shirt", label: "Remera", group: "Ropa", variants: "S,M,L,XL" },
  { key: "hoodie", label: "Hoodie", group: "Ropa", variants: "S,M,L,XL" },
  { key: "sweatshirt", label: "Buzo", group: "Ropa", variants: "S,M,L,XL" },
  { key: "jacket", label: "Campera", group: "Ropa", variants: "S,M,L,XL" },
  { key: "cap", label: "Gorra", group: "Ropa", variants: "Único" },
  { key: "tote_bag", label: "Tote bag", group: "Accesorios", variants: "Único" },
  { key: "backpack", label: "Mochila", group: "Accesorios", variants: "Único" },
  { key: "phone_case", label: "Funda", group: "Accesorios", variants: "Único" },
  { key: "sticker_pack", label: "Sticker pack", group: "Accesorios", variants: "Pack" },
  { key: "poster", label: "Poster", group: "Print", variants: "A3,A2" },
  { key: "print", label: "Lámina", group: "Print", variants: "A3,A2" },
  { key: "custom", label: "Personalizado", group: "Otro", variants: "Único" },
] as const;
const STEPS = ["Proyecto", "Identidad", "Productos", "Generación", "Revisión", "Commerce", "Publicación"];
const CAMPAIGN_KINDS: Array<{ key: CampaignKind; label: string }> = [
  { key: "collection_cover", label: "Portada" },
  { key: "campaign_group", label: "Imagen grupal" },
  { key: "campaign_story", label: "Story" },
  { key: "campaign_social_square", label: "Social square" },
];
const DEFAULT_DESIGN: DesignSystem = {
  primaryColor: "#7c3aed",
  secondaryColor: "#111111",
  accentColor: "#2563eb",
  backgroundColor: "#05030a",
  typographyDirection: "",
  graphicLanguage: "",
  textures: "",
  mood: "premium, urbano, futurista",
  compositionRules: "",
  prohibitedElements: "",
  campaignStyle: "urbano",
};

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
    reader.readAsDataURL(file);
  });
}
function stringValue(value: unknown, fallback = "") { return typeof value === "string" ? value : fallback; }
function numberString(value: unknown, fallback: string) { return typeof value === "number" || typeof value === "string" ? String(value) : fallback; }
function templateInfo(key: string) { return PRODUCT_TEMPLATES.find((item) => item.key === key) ?? PRODUCT_TEMPLATES[PRODUCT_TEMPLATES.length - 1]; }
function skuPart(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 18) || "CLU"; }
function asStrings(value: unknown) { return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : []; }
function listingFrom(value: Record<string, unknown> | undefined): ListingCopy {
  const item = value ?? {};
  return {
    title: stringValue(item.title),
    shortDescription: stringValue(item.shortDescription),
    description: stringValue(item.description),
    features: asStrings(item.features),
    tags: asStrings(item.tags),
    caption: stringValue(item.caption),
    status: item.status === "approved" ? "approved" : "draft",
    provider: stringValue(item.provider) || undefined,
    model: stringValue(item.model) || undefined,
    generated_at: stringValue(item.generated_at) || undefined,
  };
}
function defaultConceptDraft(concept: ProductConcept): ConceptDraft {
  const creative = concept.creative_config ?? {};
  const commerce = concept.commerce_draft ?? {};
  const variantLabels = Array.isArray(concept.variants_draft) && concept.variants_draft.length
    ? concept.variants_draft.map((item) => stringValue(item.size ?? item.title)).filter(Boolean).join(",")
    : templateInfo(concept.product_template).variants;
  return {
    name: concept.name,
    color: stringValue(creative.color, "Negro"),
    placement: stringValue(creative.placement),
    material: stringValue(creative.material),
    notes: stringValue(creative.notes),
    overrideNotes: stringValue(concept.design_overrides?.notes),
    price: numberString(commerce.price, ""),
    currency: stringValue(commerce.currency, "ARS"),
    stock: numberString(commerce.stock, "1"),
    variants: stringValue(commerce.variant_labels, variantLabels),
  };
}
function designFrom(project: CreatorProject): DesignSystem {
  const value = project.design_system ?? {};
  return {
    primaryColor: stringValue(value.primaryColor, DEFAULT_DESIGN.primaryColor),
    secondaryColor: stringValue(value.secondaryColor, DEFAULT_DESIGN.secondaryColor),
    accentColor: stringValue(value.accentColor, DEFAULT_DESIGN.accentColor),
    backgroundColor: stringValue(value.backgroundColor, DEFAULT_DESIGN.backgroundColor),
    typographyDirection: stringValue(value.typographyDirection),
    graphicLanguage: stringValue(value.graphicLanguage),
    textures: stringValue(value.textures),
    mood: stringValue(value.mood, DEFAULT_DESIGN.mood),
    compositionRules: stringValue(value.compositionRules),
    prohibitedElements: stringValue(value.prohibitedElements),
    campaignStyle: stringValue(value.campaignStyle, DEFAULT_DESIGN.campaignStyle),
  };
}
function toggleInSet(current: Set<string>, id: string) {
  const next = new Set(current);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

export function MerchCreatorClient() {
  const { session, user, loading: authLoading } = useAuth();
  const [context, setContext] = useState<SellerContext | null>(null);
  const [projects, setProjects] = useState<CreatorProject[]>([]);
  const [active, setActive] = useState<CreatorProject | null>(null);
  const [concepts, setConcepts] = useState<ProductConcept[]>([]);
  const [selectedConceptId, setSelectedConceptId] = useState<string | null>(null);
  const [captures, setCaptures] = useState<Record<string, Capture[]>>({});
  const [approved, setApproved] = useState<Record<string, string[]>>({});
  const [conceptDrafts, setConceptDrafts] = useState<Record<string, ConceptDraft>>({});
  const [listingDrafts, setListingDrafts] = useState<Record<string, ListingCopy>>({});
  const [selectedTemplates, setSelectedTemplates] = useState<Set<string>>(new Set(["shirt", "hoodie", "cap", "poster"]));
  const [prepareSelection, setPrepareSelection] = useState<Set<string>>(new Set());
  const [publishSelection, setPublishSelection] = useState<Set<string>>(new Set());
  const [campaignSelection, setCampaignSelection] = useState<Set<CampaignKind>>(new Set(CAMPAIGN_KINDS.map((item) => item.key)));
  const [busyConcepts, setBusyConcepts] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [campaignBusy, setCampaignBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [queryHandled, setQueryHandled] = useState(false);
  const [identityProposal, setIdentityProposal] = useState<DesignSystem | null>(null);
  const [projectDraft, setProjectDraft] = useState({ name: "", collection: "Drop 01", seller: "user", creativeMode: "from_scratch", brief: "" });
  const [design, setDesign] = useState<DesignSystem>(DEFAULT_DESIGN);

  const authFetch = useCallback(async (url: string, init?: RequestInit) => {
    if (!session?.access_token) throw new Error("Iniciá sesión para usar Commerce Creator.");
    const response = await fetch(url, {
      ...init,
      headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}`, ...(init?.headers ?? {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "La operación no pudo completarse.");
    return payload;
  }, [session?.access_token]);

  const sellerOptions = useMemo(() => {
    const options = [{ value: "user", label: "Mi cuenta" }];
    for (const player of context?.players ?? []) options.push({ value: `player:${player.id}`, label: `Player · ${player.name}` });
    for (const studio of context?.studios ?? []) options.push({ value: `studio:${studio.id}`, label: `Studio · ${studio.name}` });
    for (const spot of context?.spots ?? []) options.push({ value: `spot:${spot.id}`, label: `Business / Spot · ${spot.name}` });
    return options;
  }, [context]);
  const selectedConcept = useMemo(() => concepts.find((concept) => concept.id === selectedConceptId) ?? concepts[0] ?? null, [concepts, selectedConceptId]);
  const campaignAssets = useMemo(() => new Map((active?.generated_assets ?? []).filter((asset) => CAMPAIGN_KINDS.some((kind) => kind.key === asset.kind)).map((asset) => [asset.kind as CampaignKind, asset])), [active?.generated_assets]);

  const updateProjectStatus = useCallback((status: unknown) => {
    if (typeof status !== "string") return;
    setActive((current) => current ? { ...current, status } : current);
    setProjects((current) => current.map((project) => active && project.id === active.id ? { ...project, status } : project));
  }, [active]);

  const loadConcepts = useCallback(async (projectId: string) => {
    const payload = await authFetch(`/api/creator-commerce/projects/${projectId}/concepts`);
    const next = (payload.concepts ?? []) as ProductConcept[];
    setConcepts(next);
    setApproved(Object.fromEntries(next.map((concept) => [concept.id, (concept.approved_assets ?? []).map((asset) => asset.url).filter(Boolean)])));
    setConceptDrafts(Object.fromEntries(next.map((concept) => [concept.id, defaultConceptDraft(concept)])));
    setListingDrafts(Object.fromEntries(next.map((concept) => [concept.id, listingFrom(concept.listing_copy)])));
    setSelectedConceptId((current) => current && next.some((concept) => concept.id === current) ? current : next[0]?.id ?? null);
    setPrepareSelection((current) => {
      const eligible = new Set(next.filter((concept) => ["approved", "commerce_ready", "published"].includes(concept.status)).map((concept) => concept.id));
      const kept = [...current].filter((id) => eligible.has(id));
      return new Set(kept.length ? kept : eligible);
    });
    setPublishSelection((current) => {
      const eligible = new Set(next.filter((concept) => Boolean(concept.commerce_product?.id)).map((concept) => concept.id));
      const kept = [...current].filter((id) => eligible.has(id));
      return new Set(kept.length ? kept : eligible);
    });
    return next;
  }, [authFetch]);

  const refreshProject = useCallback(async (projectId: string) => {
    const payload = await authFetch(`/api/creator-commerce/projects/${projectId}`);
    const project = payload.project as CreatorProject;
    setActive(project);
    setProjects((current) => current.map((item) => item.id === project.id ? project : item));
    return project;
  }, [authFetch]);

  const openProject = useCallback(async (project: CreatorProject) => {
    setActive(project); setDesign(designFrom(project)); setIdentityProposal(null); setError(null); setMessage(null);
    await loadConcepts(project.id);
  }, [loadConcepts]);

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setError(null);
    const [contextPayload, projectPayload] = await Promise.all([authFetch("/api/creator-commerce/context"), authFetch("/api/creator-commerce/projects")]);
    setContext(contextPayload as SellerContext);
    const nextProjects = (projectPayload.projects ?? []) as CreatorProject[];
    setProjects(nextProjects);
    if (!queryHandled && typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const projectId = params.get("project");
      const conceptId = params.get("concept");
      const clothingItemId = params.get("clothingItemId");
      const project = nextProjects.find((item) => item.id === projectId);
      if (project) {
        setActive(project); setDesign(designFrom(project));
        if (conceptId && clothingItemId) {
          const patched = await authFetch(`/api/creator-commerce/projects/${project.id}/concepts/${conceptId}`, { method: "PATCH", body: JSON.stringify({ clothing_item_id: clothingItemId }) });
          updateProjectStatus(patched.projectStatus);
          setMessage("Gemelo 3D asociado al producto correcto del drop.");
        }
        const nextConcepts = await loadConcepts(project.id);
        if (conceptId && nextConcepts.some((item) => item.id === conceptId)) setSelectedConceptId(conceptId);
        await refreshProject(project.id);
        window.history.replaceState({}, "", "/crear/merch");
      }
      setQueryHandled(true);
    }
  }, [authFetch, loadConcepts, queryHandled, refreshProject, session?.access_token, updateProjectStatus]);

  useEffect(() => {
    if (authLoading || !user || !session?.access_token) return;
    void load().catch((cause) => setError(cause instanceof Error ? cause.message : "No se pudo cargar Crear Merch."));
  }, [authLoading, load, session?.access_token, user]);

  async function createProject() {
    if (!projectDraft.name.trim()) return setError("Poné un nombre al proyecto.");
    setBusy(true); setError(null); setMessage(null);
    try {
      const [kind, id] = projectDraft.seller.split(":");
      const selectedSpot = kind === "spot" ? context?.spots.find((spot) => spot.id === id) : null;
      const selectedStudio = selectedSpot?.studio_id || (kind === "studio" ? id : null);
      const ownerType = selectedSpot ? (selectedStudio ? "studio" : "user") : kind === "player" || kind === "studio" ? kind : "user";
      const payload = await authFetch("/api/creator-commerce/projects", { method: "POST", body: JSON.stringify({
        name: projectDraft.name, owner_type: ownerType, player_id: kind === "player" ? id : null, studio_id: selectedStudio,
        spot_id: selectedSpot?.id ?? null, collection_name: projectDraft.collection, category: "Merch",
        creative_mode: projectDraft.creativeMode, brief: projectDraft.brief, design_system: design,
      }) });
      const project = payload.project as CreatorProject;
      setProjects((current) => [project, ...current]);
      await openProject(project);
      setMessage("Proyecto creado. Definí la identidad y agregá los productos del drop.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo crear el proyecto."); }
    finally { setBusy(false); }
  }

  async function generateIdentity() {
    if (!active) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const payload = await authFetch(`/api/creator-commerce/projects/${active.id}/generate-identity`, { method: "POST", body: JSON.stringify({}) });
      setIdentityProposal(payload.designSystem as DesignSystem);
      setMessage("Gemini propuso una identidad. Revisala: todavía NO está guardada.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo generar la identidad."); }
    finally { setBusy(false); }
  }

  function applyIdentityProposal() {
    if (!identityProposal) return;
    setDesign(identityProposal);
    setIdentityProposal(null);
    setMessage("Propuesta aplicada al editor. Tocá Guardar identidad para confirmarla.");
  }

  async function saveDesignSystem() {
    if (!active) return;
    setBusy(true); setError(null);
    try {
      const payload = await authFetch(`/api/creator-commerce/projects/${active.id}`, { method: "PATCH", body: JSON.stringify({ design_system: design }) });
      const project = payload.project as CreatorProject;
      setActive(project); setProjects((current) => current.map((item) => item.id === project.id ? project : item));
      setMessage("Identidad del drop guardada. Todos los productos la heredan.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar la identidad."); }
    finally { setBusy(false); }
  }

  async function uploadProjectAsset(kind: string, file: File | undefined) {
    if (!active || !file) return;
    if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(file.type)) return setError("Usá JPG, PNG o WEBP.");
    if (file.size > 8 * 1024 * 1024) return setError("El asset puede pesar hasta 8 MB.");
    setBusy(true); setError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      const uploaded = await authFetch("/api/creator-commerce/project-assets", { method: "POST", body: JSON.stringify({ projectId: active.id, kind, label: file.name, dataUrl }) });
      const nextAssets = [...(active.reference_assets ?? []), uploaded.asset as CreatorAsset];
      const payload = await authFetch(`/api/creator-commerce/projects/${active.id}`, { method: "PATCH", body: JSON.stringify({ reference_assets: nextAssets }) });
      const project = payload.project as CreatorProject;
      setActive(project); setProjects((current) => current.map((item) => item.id === project.id ? project : item));
      setMessage("Asset de identidad guardado en el proyecto.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo subir el asset."); }
    finally { setBusy(false); }
  }

  async function addSelectedProducts() {
    if (!active || !selectedTemplates.size) return setError("Elegí al menos un producto.");
    setBusy(true); setError(null); setMessage(null);
    try {
      const rows = [...selectedTemplates].map((key, index) => {
        const template = templateInfo(key);
        return { name: `${template.label} ${active.name}`, product_template: key, position: concepts.length + index, creative_config: { color: "Negro", placement: "", material: "", notes: active.brief || "" } };
      });
      const result = await authFetch(`/api/creator-commerce/projects/${active.id}/concepts`, { method: "POST", body: JSON.stringify({ concepts: rows }) });
      updateProjectStatus(result.projectStatus);
      const next = await loadConcepts(active.id);
      setSelectedConceptId(next[concepts.length]?.id ?? next[0]?.id ?? null);
      setMessage(`${rows.length} producto${rows.length === 1 ? "" : "s"} agregado${rows.length === 1 ? "" : "s"}. Todavía son conceptos creativos, no Commerce.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudieron agregar los productos."); }
    finally { setBusy(false); }
  }

  async function deleteConcept(concept: ProductConcept) {
    if (!active) return;
    setBusy(true); setError(null);
    try {
      const result = await authFetch(`/api/creator-commerce/projects/${active.id}/concepts/${concept.id}`, { method: "DELETE" });
      updateProjectStatus(result.projectStatus); await loadConcepts(active.id); setMessage("Producto creativo eliminado del drop.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo eliminar el producto."); }
    finally { setBusy(false); }
  }

  function updateConceptDraft(conceptId: string, patch: Partial<ConceptDraft>) {
    setConceptDrafts((current) => ({ ...current, [conceptId]: { ...(current[conceptId] ?? defaultConceptDraft(concepts.find((item) => item.id === conceptId)!)), ...patch } }));
  }
  function buildVariants(concept: ProductConcept, draftValue: ConceptDraft) {
    const labels = draftValue.variants.split(",").map((value) => value.trim()).filter(Boolean);
    const normalized = labels.length ? labels : ["Único"];
    const totalStock = Math.max(0, Math.floor(Number(draftValue.stock) || 0));
    const base = Math.floor(totalStock / normalized.length); let remainder = totalStock % normalized.length;
    return normalized.map((label) => ({
      sku: `${skuPart(active?.name || "CLOUVA")}-${skuPart(concept.name)}-${skuPart(draftValue.color)}-${skuPart(label)}`,
      title: `${label} · ${draftValue.color}`, size: label, color: draftValue.color,
      stock: base + (remainder-- > 0 ? 1 : 0), active: true,
      metadata: { creator_project_id: active?.id, creator_concept_id: concept.id },
    }));
  }

  async function saveConceptDetails(concept: ProductConcept) {
    if (!active) return;
    const draftValue = conceptDrafts[concept.id] ?? defaultConceptDraft(concept);
    setBusyConcepts((current) => new Set(current).add(concept.id)); setError(null);
    try {
      const payload = await authFetch(`/api/creator-commerce/projects/${active.id}/concepts/${concept.id}`, { method: "PATCH", body: JSON.stringify({
        name: draftValue.name,
        creative_config: { ...concept.creative_config, color: draftValue.color, placement: draftValue.placement, material: draftValue.material, notes: draftValue.notes, description: draftValue.notes || active.brief || "" },
        design_overrides: { ...concept.design_overrides, notes: draftValue.overrideNotes },
        commerce_draft: { ...concept.commerce_draft, price: draftValue.price === "" ? null : Number(draftValue.price), currency: draftValue.currency, stock: Number(draftValue.stock || 0), variant_labels: draftValue.variants },
        variants_draft: buildVariants(concept, draftValue),
      }) });
      updateProjectStatus(payload.projectStatus);
      setConcepts((current) => current.map((item) => item.id === concept.id ? { ...item, ...payload.concept, commerce_product: item.commerce_product } : item));
      setMessage(`${draftValue.name} guardado.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar el producto."); }
    finally { setBusyConcepts((current) => { const next = new Set(current); next.delete(concept.id); return next; }); }
  }

  async function addConceptCapture(conceptId: string, label: Capture["label"], file: File | undefined) {
    if (!file) return;
    if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(file.type)) return setError("Usá JPG, PNG o WEBP.");
    if (file.size > 5 * 1024 * 1024) return setError("Cada referencia puede pesar hasta 5 MB.");
    try {
      const dataUrl = await fileToDataUrl(file);
      setCaptures((current) => {
        const list = current[conceptId] ?? [];
        const next = label === "Detalle" ? [...list, { label, dataUrl, name: file.name }] : [...list.filter((capture) => capture.label !== label), { label, dataUrl, name: file.name }];
        return { ...current, [conceptId]: next };
      });
      setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo cargar la referencia."); }
  }

  async function generateConcept(concept: ProductConcept, quiet = false) {
    if (!active) return false;
    const draftValue = conceptDrafts[concept.id] ?? defaultConceptDraft(concept);
    const conceptCaptures = captures[concept.id] ?? [];
    setBusyConcepts((current) => new Set(current).add(concept.id)); if (!quiet) { setError(null); setMessage(null); }
    try {
      const starting = await authFetch(`/api/creator-commerce/projects/${active.id}/concepts/${concept.id}`, { method: "PATCH", body: JSON.stringify({ status: "generating" }) });
      updateProjectStatus(starting.projectStatus);
      const payload = await authFetch("/api/creator-commerce/product-images", { method: "POST", body: JSON.stringify({
        projectId: active.id, conceptId: concept.id, creativeMode: active.creative_mode, includeLifestyle: true, includeHero: true,
        campaignStyle: design.campaignStyle, captures: conceptCaptures.map(({ label, dataUrl }) => ({ label, dataUrl })),
        productDraft: { name: draftValue.name, category: active.category, description: [active.brief, draftValue.notes].filter(Boolean).join("\n"), color: draftValue.color, productTemplate: concept.product_template, placement: draftValue.placement, material: draftValue.material },
      }) }) as GeneratedPayload;
      const references = payload.sourcePhotos.map((asset) => ({ ...asset, kind: "product_reference", status: "reference" }));
      const generated = payload.generatedImages.map((asset) => ({ ...asset, status: "generated" }));
      const saved = await authFetch(`/api/creator-commerce/projects/${active.id}/concepts/${concept.id}`, { method: "PATCH", body: JSON.stringify({ reference_assets: references, generated_assets: generated, approved_assets: [], status: "review" }) });
      updateProjectStatus(saved.projectStatus);
      setConcepts((current) => current.map((item) => item.id === concept.id ? { ...item, ...saved.concept, commerce_product: item.commerce_product } : item));
      setApproved((current) => ({ ...current, [concept.id]: [] }));
      if (!quiet) setMessage(`${concept.name}: generación lista para revisar.`);
      return true;
    } catch (cause) {
      const failed = await authFetch(`/api/creator-commerce/projects/${active.id}/concepts/${concept.id}`, { method: "PATCH", body: JSON.stringify({ status: "failed", metadata: { ...concept.metadata, last_generation_error: cause instanceof Error ? cause.message : "Error de generación" } }) }).catch(() => null);
      updateProjectStatus(failed?.projectStatus);
      setConcepts((current) => current.map((item) => item.id === concept.id ? { ...item, status: "failed" } : item));
      if (!quiet) setError(cause instanceof Error ? cause.message : `No se pudo generar ${concept.name}.`);
      return false;
    } finally { setBusyConcepts((current) => { const next = new Set(current); next.delete(concept.id); return next; }); }
  }

  async function generateDrop() {
    if (!active || !concepts.length) return setError("Agregá productos al drop primero.");
    setBusy(true); setError(null); setMessage("Generando el drop producto por producto…");
    let success = 0; let failed = 0;
    for (const concept of concepts) { if (await generateConcept(concept, true)) success += 1; else failed += 1; }
    await loadConcepts(active.id); await refreshProject(active.id); setBusy(false);
    setMessage(`Drop generado: ${success} listo${success === 1 ? "" : "s"}${failed ? ` · ${failed} falló${failed === 1 ? "" : "n"} y puede${failed === 1 ? "" : "n"} reintentarse.` : "."}`);
  }

  function toggleApproved(conceptId: string, url: string) {
    setApproved((current) => { const list = current[conceptId] ?? []; return { ...current, [conceptId]: list.includes(url) ? list.filter((item) => item !== url) : [...list, url] }; });
  }

  async function approveConcept(concept: ProductConcept) {
    if (!active) return;
    const urls = approved[concept.id] ?? [];
    if (!urls.length) return setError("Elegí al menos una imagen para aprobar.");
    const assets = concept.generated_assets.filter((asset) => urls.includes(asset.url)).map((asset) => ({ ...asset, status: "approved" }));
    setBusyConcepts((current) => new Set(current).add(concept.id)); setError(null);
    try {
      const payload = await authFetch(`/api/creator-commerce/projects/${active.id}/concepts/${concept.id}`, { method: "PATCH", body: JSON.stringify({ approved_assets: assets, status: "approved" }) });
      updateProjectStatus(payload.projectStatus);
      setConcepts((current) => current.map((item) => item.id === concept.id ? { ...item, ...payload.concept, commerce_product: item.commerce_product } : item));
      setPrepareSelection((current) => new Set(current).add(concept.id));
      setMessage(`${concept.name} aprobado para Commerce.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo aprobar el producto."); }
    finally { setBusyConcepts((current) => { const next = new Set(current); next.delete(concept.id); return next; }); }
  }

  async function prepareConcept(concept: ProductConcept, quiet = false) {
    if (!active) return false;
    const draftValue = conceptDrafts[concept.id] ?? defaultConceptDraft(concept);
    if (!draftValue.price || Number(draftValue.price) < 0) { if (!quiet) setError(`${concept.name}: definí un precio válido.`); return false; }
    const approvedAssets = (approved[concept.id]?.length ? concept.generated_assets.filter((asset) => approved[concept.id].includes(asset.url)) : concept.approved_assets);
    if (!approvedAssets.length) { if (!quiet) setError(`${concept.name}: aprobá al menos una imagen primero.`); return false; }
    const front = approvedAssets.find((asset) => asset.kind === "front_catalog") ?? approvedAssets[0];
    setBusyConcepts((current) => new Set(current).add(concept.id));
    try {
      const payload = await authFetch(`/api/creator-commerce/projects/${active.id}/concepts/${concept.id}/prepare-product`, { method: "POST", body: JSON.stringify({
        name: draftValue.name, description: draftValue.notes || active.brief, price: Number(draftValue.price), currency: draftValue.currency,
        stock: Number(draftValue.stock || 0), approved_images: approvedAssets.map((asset) => asset.url), cover_url: front?.url ?? null,
        listing_kind: "owned_design", variants: buildVariants(concept, draftValue), metadata: { creator_collection: active.collection_name },
      }) });
      updateProjectStatus(payload.projectStatus);
      setConcepts((current) => current.map((item) => item.id === concept.id ? { ...item, ...payload.concept, commerce_product: payload.product } : item));
      setPublishSelection((current) => new Set(current).add(concept.id));
      if (!quiet) setMessage(`${concept.name}: producto Commerce preparado. El productId queda fijo.`);
      return true;
    } catch (cause) { if (!quiet) setError(cause instanceof Error ? cause.message : `No se pudo preparar ${concept.name}.`); return false; }
    finally { setBusyConcepts((current) => { const next = new Set(current); next.delete(concept.id); return next; }); }
  }

  async function prepareDrop() {
    if (!active) return;
    const targets = concepts.filter((concept) => prepareSelection.has(concept.id) && ["approved", "commerce_ready", "published"].includes(concept.status));
    if (!targets.length) return setError("Marcá al menos un producto aprobado para preparar.");
    setBusy(true); setError(null); let success = 0; let failed = 0;
    for (const concept of targets) { if (await prepareConcept(concept, true)) success += 1; else failed += 1; }
    await loadConcepts(active.id); await refreshProject(active.id); setBusy(false);
    setMessage(`Commerce: ${success} producto${success === 1 ? "" : "s"} preparado${success === 1 ? "" : "s"}${failed ? ` · ${failed} pendiente${failed === 1 ? "" : "s"}.` : "."}`);
  }

  async function generateListingCopy(concept: ProductConcept) {
    if (!active || !concept.commerce_product?.id) return setError("Prepará el producto en Commerce antes de generar su publicación.");
    setBusyConcepts((current) => new Set(current).add(concept.id)); setError(null);
    try {
      const payload = await authFetch(`/api/creator-commerce/projects/${active.id}/concepts/${concept.id}/listing-copy`, { method: "POST", body: JSON.stringify({}) });
      const copy = listingFrom(payload.listingCopy as Record<string, unknown>);
      setListingDrafts((current) => ({ ...current, [concept.id]: copy }));
      setConcepts((current) => current.map((item) => item.id === concept.id ? { ...item, listing_copy: payload.listingCopy } : item));
      setMessage("Copy generado como borrador. Editalo y aprobalo antes de usarlo en Market.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo generar el copy."); }
    finally { setBusyConcepts((current) => { const next = new Set(current); next.delete(concept.id); return next; }); }
  }

  function updateListing(conceptId: string, patch: Partial<ListingCopy>) {
    setListingDrafts((current) => ({ ...current, [conceptId]: { ...(current[conceptId] ?? listingFrom({})), ...patch } }));
  }

  async function saveListingCopy(concept: ProductConcept, approveCopy: boolean) {
    if (!active) return;
    const draft = listingDrafts[concept.id] ?? listingFrom(concept.listing_copy);
    if (!draft.title.trim() || !draft.description.trim()) return setError("El copy necesita título y descripción.");
    setBusyConcepts((current) => new Set(current).add(concept.id)); setError(null);
    try {
      const listingCopy: ListingCopy = { ...draft, status: approveCopy ? "approved" : "draft" };
      const payload = await authFetch(`/api/creator-commerce/projects/${active.id}/concepts/${concept.id}`, { method: "PATCH", body: JSON.stringify({ listing_copy: listingCopy }) });
      updateProjectStatus(payload.projectStatus);
      setListingDrafts((current) => ({ ...current, [concept.id]: listingCopy }));
      setConcepts((current) => current.map((item) => item.id === concept.id ? { ...item, listing_copy: listingCopy } : item));
      setMessage(approveCopy ? "Copy aprobado para publicación." : "Copy guardado como borrador.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar el copy."); }
    finally { setBusyConcepts((current) => { const next = new Set(current); next.delete(concept.id); return next; }); }
  }

  async function publishConcept(concept: ProductConcept, quiet = false) {
    if (!active || !concept.commerce_product?.id) { if (!quiet) setError(`${concept.name}: primero prepará el producto en Commerce.`); return false; }
    setBusyConcepts((current) => new Set(current).add(concept.id));
    try {
      const product = concept.commerce_product;
      const listing = listingDrafts[concept.id] ?? listingFrom(concept.listing_copy);
      const useApprovedCopy = listing.status === "approved";
      const manualDescription = stringValue(concept.creative_config?.notes, active.brief || "");
      await authFetch(`/api/commerce/products/${product.id}/publications`, { method: "PUT", body: JSON.stringify({
        targetType: "marketplace", placement: "merch", channel: "clouva_market", destinationKey: "default", publicationMode: "automatic",
        status: "published", isVisible: true, channelTitle: useApprovedCopy ? listing.title : concept.name,
        channelDescription: useApprovedCopy ? listing.description : manualDescription,
        priceSnapshot: Number(product.price), currencySnapshot: product.currency, stockSnapshot: product.stock,
        metadata: { creator_project_id: active.id, creator_concept_id: concept.id, collection_name: active.collection_name, listing_copy_approved: useApprovedCopy },
      }) });
      const saved = await authFetch(`/api/creator-commerce/projects/${active.id}/concepts/${concept.id}`, { method: "PATCH", body: JSON.stringify({ status: "published" }) });
      updateProjectStatus(saved.projectStatus);
      setConcepts((current) => current.map((item) => item.id === concept.id ? { ...item, status: "published", commerce_product: { ...product, status: "published" } } : item));
      if (!quiet) setMessage(`${concept.name} publicado en CLOUVA Market.`);
      return true;
    } catch (cause) { if (!quiet) setError(cause instanceof Error ? cause.message : `No se pudo publicar ${concept.name}.`); return false; }
    finally { setBusyConcepts((current) => { const next = new Set(current); next.delete(concept.id); return next; }); }
  }

  async function publishDrop() {
    if (!active) return;
    const targets = concepts.filter((concept) => publishSelection.has(concept.id) && concept.commerce_product?.id);
    if (!targets.length) return setError("Marcá al menos un producto Commerce para publicar.");
    setBusy(true); setError(null); let success = 0; let failed = 0;
    for (const concept of targets) { if (await publishConcept(concept, true)) success += 1; else failed += 1; }
    await loadConcepts(active.id); await refreshProject(active.id); setBusy(false);
    setMessage(`Publicación: ${success} producto${success === 1 ? "" : "s"} en Market${failed ? ` · ${failed} requiere${failed === 1 ? "" : "n"} revisión.` : "."}`);
  }

  async function generateCampaign(kinds: CampaignKind[]) {
    if (!active || !kinds.length) return setError("Elegí al menos un asset de campaña.");
    setCampaignBusy(true); setError(null); setMessage("Generando campaña del drop…");
    let success = 0; const failures: string[] = [];
    for (const kind of kinds) {
      try {
        const payload = await authFetch(`/api/creator-commerce/projects/${active.id}/campaign`, { method: "POST", body: JSON.stringify({ campaignStyle: design.campaignStyle, target: kind }) });
        success += Array.isArray(payload.assets) ? payload.assets.length : 0;
        for (const failure of Array.isArray(payload.failures) ? payload.failures : []) failures.push(`${failure.kind}: ${failure.error}`);
      } catch (cause) { failures.push(`${kind}: ${cause instanceof Error ? cause.message : "error"}`); }
    }
    await refreshProject(active.id); setCampaignBusy(false);
    setMessage(`Campaña: ${success} asset${success === 1 ? "" : "s"} generado${success === 1 ? "" : "s"}${failures.length ? ` · ${failures.length} pendiente${failures.length === 1 ? "" : "s"}.` : "."}`);
    if (!success && failures.length) setError(failures.join(" · "));
  }

  if (!user && !authLoading) return <main className="grid min-h-screen place-items-center bg-[#05030a] px-6 text-white"><Link href="/login?next=/crear/merch" className="rounded-full border border-violet-400/40 px-5 py-3">Iniciar sesión</Link></main>;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_50%_-10%,rgba(124,58,237,.20),transparent_32%),radial-gradient(circle_at_92%_18%,rgba(37,99,235,.12),transparent_24%),#05030a] px-4 py-7 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div><Link href="/crear" className="inline-flex items-center gap-2 text-xs text-white/45 hover:text-white"><ArrowLeft size={14} /> Crear</Link><p className="mt-5 text-[10px] font-bold uppercase tracking-[.28em] text-violet-300">CLOUVA Commerce Creator</p><h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">Crear Merch</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-white/50">Idea → identidad → colección → productos → Commerce → Market. Un drop comparte universo; cada artículo conserva su propio productId.</p></div>
          <div className="flex gap-2"><Link href="/market" className="rounded-full border border-white/10 bg-white/[.04] px-4 py-2 text-sm text-white/70">Market</Link>{active ? <button onClick={() => { setActive(null); setConcepts([]); setSelectedConceptId(null); }} className="rounded-full border border-white/10 px-4 py-2 text-sm text-white/55">Mis proyectos</button> : null}</div>
        </header>
        {active ? <div className="mt-6 flex gap-2 overflow-x-auto pb-2">{STEPS.map((step, index) => <span key={step} className="shrink-0 rounded-full border border-white/10 bg-white/[.035] px-3 py-1.5 text-[11px] text-white/55"><strong className="mr-1 text-violet-300">{index + 1}</strong>{step}</span>)}</div> : null}
        {error ? <div className="mt-5 rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}
        {message ? <div className="mt-5 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">{message}</div> : null}

        {!active ? <div className="mt-8 grid gap-6 lg:grid-cols-[1.05fr_.95fr]">
          <section className={`${CARD} p-5 sm:p-7`}>
            <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-2xl bg-violet-500/15 text-violet-200"><Layers3 size={18} /></span><div><h2 className="font-semibold">Nuevo drop</h2><p className="text-xs text-white/40">El proyecto es la identidad madre, no un producto.</p></div></div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="text-xs text-white/50">Proyecto<input className={`${INPUT} mt-2`} value={projectDraft.name} onChange={(event) => setProjectDraft({ ...projectDraft, name: event.target.value })} placeholder="Buenos Genes" /></label>
              <label className="text-xs text-white/50">Drop / cápsula<input className={`${INPUT} mt-2`} value={projectDraft.collection} onChange={(event) => setProjectDraft({ ...projectDraft, collection: event.target.value })} placeholder="Drop 01" /></label>
              <label className="text-xs text-white/50">Vendedor<select className={`${INPUT} mt-2`} value={projectDraft.seller} onChange={(event) => setProjectDraft({ ...projectDraft, seller: event.target.value })}>{sellerOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label className="text-xs text-white/50">Método<select className={`${INPUT} mt-2`} value={projectDraft.creativeMode} onChange={(event) => setProjectDraft({ ...projectDraft, creativeMode: event.target.value })}><option value="from_scratch">Desde cero</option><option value="exact_design">Diseño exacto</option><option value="reference">Referencia / inspiración</option></select></label>
            </div>
            <label className="mt-4 block text-xs text-white/50">Descripción / brief<textarea className={`${INPUT} mt-2 min-h-32 resize-y`} value={projectDraft.brief} onChange={(event) => setProjectDraft({ ...projectDraft, brief: event.target.value })} placeholder="Colección callejera premium, negro, violeta, cromado, genética, ADN, lujo futurista…" /></label>
            <button onClick={() => void createProject()} disabled={busy} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-violet-500 px-5 py-3 text-sm font-bold disabled:opacity-50">{busy ? <Loader2 className="animate-spin" size={17} /> : <Plus size={17} />} Crear proyecto</button>
          </section>
          <section className={`${CARD} p-5 sm:p-7`}><div className="flex items-center justify-between"><div><h2 className="font-semibold">Mis proyectos</h2><p className="mt-1 text-xs text-white/40">Persistentes: cerrá CLOUVA y seguí después.</p></div><button onClick={() => void load()} className="rounded-xl border border-white/10 p-2 text-white/50"><RefreshCw size={16} /></button></div><div className="mt-5 space-y-3">{projects.length ? projects.map((project) => <button key={project.id} onClick={() => void openProject(project)} className="w-full rounded-2xl border border-white/10 bg-black/25 p-4 text-left hover:border-violet-400/35"><div className="flex items-center justify-between gap-3"><strong>{project.name}</strong><span className="text-[10px] uppercase tracking-wider text-violet-300">{project.status}</span></div><p className="mt-2 text-xs text-white/40">{project.collection_name || "Sin nombre de drop"} · {project.creative_mode.replaceAll("_", " ")}</p></button>) : <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-white/35">Todavía no hay proyectos.</div>}</div></section>
        </div> : <div className="mt-7 space-y-6">
          <section className={`${CARD} p-5 sm:p-7`}><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[.25em] text-violet-300">Proyecto / Drop</p><h2 className="mt-2 text-2xl font-semibold">{active.name} <span className="text-white/30">·</span> {active.collection_name || "Drop"}</h2><p className="mt-2 max-w-3xl text-sm text-white/45">{active.brief || "Sin brief."}</p></div><div className="text-right"><span className="rounded-full border border-violet-400/20 bg-violet-500/10 px-3 py-1.5 text-xs text-violet-200">{concepts.length} producto{concepts.length === 1 ? "" : "s"}</span><p className="mt-2 text-[10px] uppercase tracking-wider text-white/35">Project · {active.status}</p></div></div></section>

          <section className={`${CARD} p-5 sm:p-7`}>
            <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-blue-300">02 · Identidad</p><h3 className="mt-1 text-xl font-semibold">Design System del drop</h3><p className="mt-1 text-xs text-white/40">Gemini propone. Vos editás y confirmás.</p></div><div className="flex flex-wrap gap-2"><button onClick={() => void generateIdentity()} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-blue-400/25 bg-blue-500/10 px-4 py-2.5 text-sm font-semibold text-blue-200"><Sparkles size={15} /> Generar identidad</button><button onClick={() => void saveDesignSystem()} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-violet-400/25 bg-violet-500/10 px-4 py-2.5 text-sm font-semibold text-violet-200"><Save size={15} /> Guardar identidad</button></div></div>
            {identityProposal ? <div className="mt-4 rounded-2xl border border-blue-400/25 bg-blue-500/[.07] p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><strong className="text-sm text-blue-100">Propuesta IA — todavía no guardada</strong><p className="mt-1 text-xs text-white/40">{identityProposal.mood} · {identityProposal.graphicLanguage}</p></div><button onClick={applyIdentityProposal} className="rounded-xl bg-blue-500 px-4 py-2 text-xs font-bold">Aplicar al editor</button></div><div className="mt-3 flex gap-2">{[identityProposal.primaryColor, identityProposal.secondaryColor, identityProposal.accentColor, identityProposal.backgroundColor].map((color) => <span key={color} className="h-8 w-8 rounded-full border border-white/20" style={{ backgroundColor: color }} title={color} />)}</div></div> : null}
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-xs text-white/50">Primario<input className={`${INPUT} mt-2`} value={design.primaryColor} onChange={(event) => setDesign({ ...design, primaryColor: event.target.value })} /></label><label className="text-xs text-white/50">Secundario<input className={`${INPUT} mt-2`} value={design.secondaryColor} onChange={(event) => setDesign({ ...design, secondaryColor: event.target.value })} /></label><label className="text-xs text-white/50">Acento<input className={`${INPUT} mt-2`} value={design.accentColor} onChange={(event) => setDesign({ ...design, accentColor: event.target.value })} /></label><label className="text-xs text-white/50">Fondo<input className={`${INPUT} mt-2`} value={design.backgroundColor} onChange={(event) => setDesign({ ...design, backgroundColor: event.target.value })} /></label>
              <label className="text-xs text-white/50 sm:col-span-2">Dirección tipográfica<input className={`${INPUT} mt-2`} value={design.typographyDirection} onChange={(event) => setDesign({ ...design, typographyDirection: event.target.value })} /></label><label className="text-xs text-white/50 sm:col-span-2">Lenguaje gráfico<input className={`${INPUT} mt-2`} value={design.graphicLanguage} onChange={(event) => setDesign({ ...design, graphicLanguage: event.target.value })} /></label><label className="text-xs text-white/50">Texturas<input className={`${INPUT} mt-2`} value={design.textures} onChange={(event) => setDesign({ ...design, textures: event.target.value })} /></label><label className="text-xs text-white/50">Mood<input className={`${INPUT} mt-2`} value={design.mood} onChange={(event) => setDesign({ ...design, mood: event.target.value })} /></label><label className="text-xs text-white/50">Campaña<select className={`${INPUT} mt-2`} value={design.campaignStyle} onChange={(event) => setDesign({ ...design, campaignStyle: event.target.value })}><option>urbano</option><option>estudio</option><option>calle</option><option>editorial</option><option>minimal</option><option>premium</option><option>futurista</option></select></label><label className="text-xs text-white/50">No usar<input className={`${INPUT} mt-2`} value={design.prohibitedElements} onChange={(event) => setDesign({ ...design, prohibitedElements: event.target.value })} /></label><label className="text-xs text-white/50 sm:col-span-2">Reglas de composición<input className={`${INPUT} mt-2`} value={design.compositionRules} onChange={(event) => setDesign({ ...design, compositionRules: event.target.value })} /></label>
            </div>
            <div className="mt-5 grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">{[
              ["artwork_master", "Artwork Master"], ["logo", "Logo"], ["cover", "Portada"], ["moodboard", "Moodboard"], ["inspiration_reference", "Inspiración"],
            ].map(([kind, label]) => <label key={kind} className="cursor-pointer rounded-2xl border border-dashed border-white/12 bg-black/20 p-4 text-center text-xs text-white/55 hover:border-violet-400/40"><UploadCloud className="mx-auto mb-2 h-5 w-5 text-violet-300" />{label}<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => void uploadProjectAsset(kind, event.target.files?.[0])} /></label>)}</div>
            {active.creative_mode === "exact_design" ? <p className="mt-4 rounded-xl border border-amber-400/15 bg-amber-400/[.06] p-3 text-xs text-amber-100/75"><strong>Diseño exacto:</strong> Artwork Master es la fuente. CLOUVA puede adaptarlo al soporte, pero no debe reinterpretar logo, ilustración, texto, colores ni símbolos.</p> : null}
            {active.reference_assets?.length ? <div className="mt-4 flex gap-3 overflow-x-auto pb-1">{active.reference_assets.map((asset, index) => <div key={`${asset.url}-${index}`} className="w-28 shrink-0 overflow-hidden rounded-xl border border-white/10"><img src={asset.url} alt={asset.label || asset.kind || "Referencia"} className="aspect-square w-full object-cover" /><p className="truncate px-2 py-1.5 text-[10px] text-white/45">{asset.kind || "ref"}</p></div>)}</div> : null}
          </section>

          <section className={`${CARD} p-5 sm:p-7`}><div className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-violet-300">03 · Productos</p><h3 className="mt-1 text-xl font-semibold">Productos del drop</h3><p className="mt-1 text-xs text-white/40">Acá sólo creás Product Concepts. Commerce todavía no existe.</p></div><button onClick={() => void addSelectedProducts()} disabled={busy || !selectedTemplates.size} className="inline-flex items-center gap-2 rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-bold disabled:opacity-40"><PackagePlus size={16} /> Agregar seleccionados</button></div><div className="mt-5 grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">{PRODUCT_TEMPLATES.map((template) => { const checked = selectedTemplates.has(template.key); return <button key={template.key} onClick={() => setSelectedTemplates((current) => toggleInSet(current, template.key))} className={`rounded-2xl border p-3 text-left transition ${checked ? "border-violet-400/55 bg-violet-500/12" : "border-white/10 bg-black/20"}`}><div className="flex items-center justify-between"><span className="text-[10px] text-white/35">{template.group}</span>{checked ? <Check size={14} className="text-violet-300" /> : null}</div><strong className="mt-2 block text-sm">{template.label}</strong></button>; })}</div></section>

          {concepts.length ? <>
            <section className={`${CARD} p-5 sm:p-7`}><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-blue-300">04 · Generación / 05 · Review</p><h3 className="mt-1 text-xl font-semibold">Review Board</h3><p className="mt-1 text-xs text-white/40">Mirá la colección junta; cada artículo mantiene assets, estado, Commerce y 3D propios.</p></div><button onClick={() => void generateDrop()} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-blue-400/25 bg-blue-500/10 px-4 py-2.5 text-sm font-semibold text-blue-200 disabled:opacity-40">{busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} Generar drop</button></div>
              <div className="mt-5 flex gap-3 overflow-x-auto pb-3 lg:grid lg:grid-cols-4 lg:overflow-visible">{concepts.map((concept) => { const cover = concept.approved_assets?.[0]?.url || concept.generated_assets?.find((asset) => asset.kind === "front_catalog")?.url || concept.generated_assets?.[0]?.url; const selected = selectedConcept?.id === concept.id; return <button key={concept.id} onClick={() => setSelectedConceptId(concept.id)} className={`min-w-[220px] overflow-hidden rounded-2xl border text-left transition lg:min-w-0 ${selected ? "border-violet-400/60 bg-violet-500/10" : "border-white/10 bg-black/25"}`}><div className="aspect-square bg-white/[.025]">{cover ? <img src={cover} alt={concept.name} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-white/20"><Shirt size={34} /></div>}</div><div className="p-3"><div className="flex items-start justify-between gap-2"><strong className="text-sm">{concept.name}</strong><span className="text-[9px] uppercase tracking-wide text-violet-300">{concept.status}</span></div><p className="mt-2 text-[11px] text-white/35">{templateInfo(concept.product_template).label}{concept.commerce_product ? ` · Commerce ${concept.commerce_product.id.slice(0, 7)}` : " · concepto"}{concept.clothing_item_id ? " · 3D" : ""}</p></div></button>; })}</div>
            </section>

            {selectedConcept ? (() => {
              const concept = selectedConcept; const draftValue = conceptDrafts[concept.id] ?? defaultConceptDraft(concept); const conceptCaptures = captures[concept.id] ?? []; const selectedApproved = approved[concept.id] ?? []; const conceptBusy = busyConcepts.has(concept.id); const listing = listingDrafts[concept.id] ?? listingFrom(concept.listing_copy);
              return <section className={`${CARD} p-5 sm:p-7`}>
                <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-violet-300">Producto seleccionado</p><h3 className="mt-1 text-2xl font-semibold">{concept.name}</h3><p className="mt-1 text-xs text-white/40">Hereda el Design System; los overrides sólo afectan este artículo.</p></div><div className="flex gap-2">{!concept.commerce_product ? <button onClick={() => void deleteConcept(concept)} disabled={conceptBusy} className="rounded-xl border border-rose-400/20 p-2.5 text-rose-300"><Trash2 size={16} /></button> : null}<span className="rounded-full border border-white/10 px-3 py-2 text-xs text-white/50">{concept.role}</span></div></div>
                <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_.9fr]">
                  <div><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-white/50">Nombre<input className={`${INPUT} mt-2`} value={draftValue.name} onChange={(event) => updateConceptDraft(concept.id, { name: event.target.value })} /></label><label className="text-xs text-white/50">Color base<input className={`${INPUT} mt-2`} value={draftValue.color} onChange={(event) => updateConceptDraft(concept.id, { color: event.target.value })} /></label><label className="text-xs text-white/50">Placement<input className={`${INPUT} mt-2`} value={draftValue.placement} onChange={(event) => updateConceptDraft(concept.id, { placement: event.target.value })} placeholder="Logo chico frente, gráfica grande atrás…" /></label><label className="text-xs text-white/50">Material<input className={`${INPUT} mt-2`} value={draftValue.material} onChange={(event) => updateConceptDraft(concept.id, { material: event.target.value })} /></label><label className="text-xs text-white/50 sm:col-span-2">Notas<textarea className={`${INPUT} mt-2 min-h-20`} value={draftValue.notes} onChange={(event) => updateConceptDraft(concept.id, { notes: event.target.value })} /></label><label className="text-xs text-white/50 sm:col-span-2">Override del Design System<textarea className={`${INPUT} mt-2 min-h-20`} value={draftValue.overrideNotes} onChange={(event) => updateConceptDraft(concept.id, { overrideNotes: event.target.value })} placeholder="Ej: usar sólo el símbolo, sin texto." /></label></div><button onClick={() => void saveConceptDetails(concept)} disabled={conceptBusy} className="mt-3 inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm text-white/65"><Save size={15} /> Guardar producto</button>
                    <div className="mt-6"><div className="flex items-center gap-2"><ImagePlus size={17} className="text-violet-300" /><h4 className="font-semibold">Product Reference opcional</h4></div><p className="mt-1 text-xs text-white/35">Artwork Master vive en el Project. Estas vistas sólo indican producto, placement o forma. Si no hay asset del Project, el backend puede pedir Frente para Diseño exacto/Referencia.</p><div className="mt-3 grid grid-cols-3 gap-2">{(["Frente", "Atrás", "Detalle"] as const).map((label) => <label key={label} className="cursor-pointer rounded-xl border border-dashed border-white/12 bg-black/20 p-3 text-center text-xs text-white/50"><UploadCloud className="mx-auto mb-1 h-4 w-4 text-violet-300" />{label}<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => void addConceptCapture(concept.id, label, event.target.files?.[0])} /></label>)}</div>{conceptCaptures.length ? <div className="mt-2 flex flex-wrap gap-2">{conceptCaptures.map((capture, index) => <span key={`${capture.label}-${index}`} className="rounded-full border border-white/10 px-2 py-1 text-[10px] text-white/45">{capture.label}: {capture.name}</span>)}</div> : null}</div>
                    <button onClick={() => void generateConcept(concept)} disabled={conceptBusy} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-bold disabled:opacity-40">{conceptBusy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} {concept.status === "failed" ? "Reintentar generación" : "Generar este producto"}</button>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-black/20 p-4"><div className="flex items-center gap-2"><CheckCircle2 size={17} className="text-emerald-300" /><h4 className="font-semibold">Revisión</h4></div><div className="mt-3 grid grid-cols-2 gap-2">{concept.generated_assets?.map((asset) => { const checked = selectedApproved.includes(asset.url); return <button key={asset.url} onClick={() => toggleApproved(concept.id, asset.url)} className={`overflow-hidden rounded-xl border text-left ${checked ? "border-emerald-400/60" : "border-white/10"}`}><img src={asset.url} alt={asset.kind || "Generado"} className="aspect-square w-full object-cover" /><span className="block px-2 py-1.5 text-[10px] text-white/50">{asset.kind}{checked ? " · seleccionado" : ""}</span></button>; })}</div>{!concept.generated_assets?.length ? <div className="mt-3 rounded-xl border border-dashed border-white/10 p-8 text-center text-xs text-white/30">Todavía no hay imágenes para revisar.</div> : null}<button onClick={() => void approveConcept(concept)} disabled={conceptBusy || !selectedApproved.length} className="mt-3 w-full rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2.5 text-sm font-semibold text-emerald-200 disabled:opacity-40">Aprobar selección</button></div>
                </div>

                <div className="mt-6 rounded-2xl border border-white/8 bg-black/20 p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-emerald-300">06 · Commerce</p><h4 className="mt-1 font-semibold">Precio, stock y variantes</h4></div>{concept.commerce_product ? <span className="font-mono text-[10px] text-emerald-300">{concept.commerce_product.id}</span> : null}</div><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className="text-xs text-white/50">Precio<input className={`${INPUT} mt-2`} inputMode="decimal" value={draftValue.price} onChange={(event) => updateConceptDraft(concept.id, { price: event.target.value })} /></label><label className="text-xs text-white/50">Moneda<select className={`${INPUT} mt-2`} value={draftValue.currency} onChange={(event) => updateConceptDraft(concept.id, { currency: event.target.value })}><option>ARS</option><option>USD</option></select></label><label className="text-xs text-white/50">Stock total<input className={`${INPUT} mt-2`} inputMode="numeric" value={draftValue.stock} onChange={(event) => updateConceptDraft(concept.id, { stock: event.target.value })} /></label><label className="text-xs text-white/50">Variantes<input className={`${INPUT} mt-2`} value={draftValue.variants} onChange={(event) => updateConceptDraft(concept.id, { variants: event.target.value })} /></label></div><div className="mt-4 flex flex-wrap gap-2"><button onClick={() => void prepareConcept(concept)} disabled={conceptBusy || !["approved", "commerce_ready", "published"].includes(concept.status)} className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-black disabled:opacity-40"><PackagePlus size={16} /> {concept.commerce_product ? "Actualizar producto" : "Preparar producto"}</button>{GARMENT_TEMPLATES.has(concept.product_template) ? <Link href={`/mi-flow/crear-prenda?creatorProjectId=${encodeURIComponent(active.id)}&creatorConceptId=${encodeURIComponent(concept.id)}`} className="inline-flex items-center gap-2 rounded-xl border border-violet-400/25 bg-violet-500/10 px-4 py-2.5 text-sm font-semibold text-violet-200"><Box size={16} /> Crear gemelo 3D</Link> : null}{concept.clothing_item_id ? <span className="rounded-xl border border-blue-400/20 bg-blue-400/10 px-3 py-2.5 text-xs text-blue-200">3D vinculado · {concept.clothing_item_id.slice(0, 8)}</span> : null}{concept.commerce_product?.slug ? <Link href={`/producto/${concept.commerce_product.slug}`} className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm text-white/60">Ver ficha <ChevronRight size={14} /></Link> : null}</div></div>

                <div className="mt-5 rounded-2xl border border-white/8 bg-black/20 p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-blue-300">07 · Copy / Publicación</p><h4 className="mt-1 font-semibold">Market listing</h4><p className="mt-1 text-xs text-white/40">El copy IA nunca se publica hasta que lo apruebes.</p></div><button onClick={() => void generateListingCopy(concept)} disabled={conceptBusy || !concept.commerce_product?.id} className="inline-flex items-center gap-2 rounded-xl border border-blue-400/20 bg-blue-500/10 px-3 py-2 text-xs font-semibold text-blue-200 disabled:opacity-40"><Sparkles size={14} /> Generar publicación</button></div>
                  {(listing.title || concept.commerce_product) ? <div className="mt-4 grid gap-3"><label className="text-xs text-white/50">Título<input className={`${INPUT} mt-2`} value={listing.title} onChange={(event) => updateListing(concept.id, { title: event.target.value, status: "draft" })} /></label><label className="text-xs text-white/50">Descripción corta<textarea className={`${INPUT} mt-2 min-h-16`} value={listing.shortDescription} onChange={(event) => updateListing(concept.id, { shortDescription: event.target.value, status: "draft" })} /></label><label className="text-xs text-white/50">Descripción completa<textarea className={`${INPUT} mt-2 min-h-28`} value={listing.description} onChange={(event) => updateListing(concept.id, { description: event.target.value, status: "draft" })} /></label><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-white/50">Características<input className={`${INPUT} mt-2`} value={listing.features.join(", ")} onChange={(event) => updateListing(concept.id, { features: event.target.value.split(",").map((item) => item.trim()).filter(Boolean), status: "draft" })} /></label><label className="text-xs text-white/50">Tags<input className={`${INPUT} mt-2`} value={listing.tags.join(", ")} onChange={(event) => updateListing(concept.id, { tags: event.target.value.split(",").map((item) => item.trim()).filter(Boolean), status: "draft" })} /></label></div><label className="text-xs text-white/50">Caption social<textarea className={`${INPUT} mt-2 min-h-20`} value={listing.caption} onChange={(event) => updateListing(concept.id, { caption: event.target.value, status: "draft" })} /></label><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full border px-3 py-1 text-[10px] uppercase ${listing.status === "approved" ? "border-emerald-400/30 text-emerald-300" : "border-amber-400/25 text-amber-200"}`}>{listing.status}</span><button onClick={() => void saveListingCopy(concept, false)} disabled={conceptBusy} className="rounded-xl border border-white/10 px-3 py-2 text-xs">Guardar borrador</button><button onClick={() => void saveListingCopy(concept, true)} disabled={conceptBusy} className="rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-200">Aprobar copy</button></div></div> : null}
                  <div className="mt-4 flex justify-end"><button onClick={() => void publishConcept(concept)} disabled={conceptBusy || !concept.commerce_product?.id} className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-2.5 text-sm font-semibold text-emerald-200 disabled:opacity-40"><Send size={16} /> {concept.status === "published" ? "Actualizar publicación" : "Publicar en Market"}</button></div>
                </div>
              </section>;
            })() : null}

            <section className={`${CARD} p-5 sm:p-7`}><div><p className="text-[10px] font-bold uppercase tracking-[.22em] text-violet-300">Acciones del drop</p><h3 className="mt-1 text-xl font-semibold">Preparar y publicar sólo lo marcado</h3></div><div className="mt-4 grid gap-3 lg:grid-cols-2"><div className="rounded-2xl border border-white/8 bg-black/20 p-4"><div className="flex items-center justify-between"><strong className="text-sm">Preparar productos</strong><button onClick={() => setPrepareSelection(new Set(concepts.filter((concept) => ["approved", "commerce_ready", "published"].includes(concept.status)).map((concept) => concept.id)))} className="text-[10px] text-violet-300">Marcar elegibles</button></div><div className="mt-3 space-y-2">{concepts.map((concept) => <label key={concept.id} className={`flex items-center gap-3 rounded-xl border p-3 ${["approved", "commerce_ready", "published"].includes(concept.status) ? "border-white/10" : "border-white/5 opacity-40"}`}><input type="checkbox" checked={prepareSelection.has(concept.id)} disabled={!["approved", "commerce_ready", "published"].includes(concept.status)} onChange={() => setPrepareSelection((current) => toggleInSet(current, concept.id))} /><span className="min-w-0 flex-1 truncate text-sm">{concept.name}</span><span className="text-[9px] uppercase text-white/35">{concept.status}</span></label>)}</div><button onClick={() => void prepareDrop()} disabled={busy || !prepareSelection.size} className="mt-3 w-full rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-black disabled:opacity-40">Preparar seleccionados</button></div>
              <div className="rounded-2xl border border-white/8 bg-black/20 p-4"><div className="flex items-center justify-between"><strong className="text-sm">Publicar drop</strong><button onClick={() => setPublishSelection(new Set(concepts.filter((concept) => concept.commerce_product?.id).map((concept) => concept.id)))} className="text-[10px] text-emerald-300">Marcar Commerce</button></div><div className="mt-3 space-y-2">{concepts.map((concept) => <label key={concept.id} className={`flex items-center gap-3 rounded-xl border p-3 ${concept.commerce_product ? "border-white/10" : "border-white/5 opacity-40"}`}><input type="checkbox" checked={publishSelection.has(concept.id)} disabled={!concept.commerce_product} onChange={() => setPublishSelection((current) => toggleInSet(current, concept.id))} /><span className="min-w-0 flex-1 truncate text-sm">{concept.name}</span><span className="text-[9px] uppercase text-white/35">{concept.status}</span></label>)}</div><button onClick={() => void publishDrop()} disabled={busy || !publishSelection.size} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold disabled:opacity-40"><Send size={15} /> Publicar seleccionados</button></div></div></section>

            <section className={`${CARD} p-5 sm:p-7`}><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-fuchsia-300">Campaña del drop</p><h3 className="mt-1 text-xl font-semibold">Assets de colección</h3><p className="mt-1 text-xs text-white/40">Pertenecen al Project, no a una ficha individual.</p></div><button onClick={() => void generateCampaign([...campaignSelection])} disabled={campaignBusy || !campaignSelection.size} className="inline-flex items-center gap-2 rounded-xl border border-fuchsia-400/25 bg-fuchsia-500/10 px-4 py-2.5 text-sm font-semibold text-fuchsia-200 disabled:opacity-40">{campaignBusy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Generar campaña</button></div><div className="mt-4 grid gap-3 grid-cols-2 lg:grid-cols-4">{CAMPAIGN_KINDS.map((item) => { const asset = campaignAssets.get(item.key); const selected = campaignSelection.has(item.key); return <div key={item.key} className={`overflow-hidden rounded-2xl border ${selected ? "border-fuchsia-400/30" : "border-white/10"}`}><button onClick={() => setCampaignSelection((current) => { const next = new Set(current); if (next.has(item.key)) next.delete(item.key); else next.add(item.key); return next; })} className="block w-full text-left"><div className="aspect-square bg-black/25">{asset?.url ? <img src={asset.url} alt={item.label} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-white/20"><ImagePlus size={28} /></div>}</div><div className="flex items-center justify-between p-3"><span className="text-xs font-semibold">{item.label}</span>{selected ? <Check size={14} className="text-fuchsia-300" /> : null}</div></button><button onClick={() => void generateCampaign([item.key])} disabled={campaignBusy} className="w-full border-t border-white/8 px-3 py-2 text-[10px] text-white/45 hover:text-white">{asset ? "Regenerar sólo este" : "Generar sólo este"}</button></div>; })}</div></section>
          </> : <section className={`${CARD} p-10 text-center`}><Shirt className="mx-auto h-8 w-8 text-white/20" /><h3 className="mt-3 font-semibold">El drop todavía está vacío</h3><p className="mt-2 text-sm text-white/35">Seleccioná Remera, Hoodie, Gorra, Poster u otros productos y agregalos al proyecto.</p></section>}

          {concepts.length ? <div className="sticky bottom-3 z-20 mx-auto flex max-w-xl items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black/80 p-2 shadow-2xl backdrop-blur-xl"><button onClick={() => void generateDrop()} disabled={busy} className="flex-1 rounded-xl border border-violet-400/20 px-3 py-2 text-xs font-semibold text-violet-200">Generar</button><button onClick={() => void prepareDrop()} disabled={busy || !prepareSelection.size} className="flex-1 rounded-xl bg-white px-3 py-2 text-xs font-bold text-black disabled:opacity-40">Commerce</button><button onClick={() => void publishDrop()} disabled={busy || !publishSelection.size} className="flex-1 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-bold disabled:opacity-40">Publicar</button></div> : null}
        </div>}
      </div>
    </main>
  );
}
