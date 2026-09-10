"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  ArrowLeft,
  Box,
  Building2,
  Check,
  ChevronRight,
  Coffee,
  Eye,
  Gem,
  Headphones,
  ImagePlus,
  Layers3,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  Shirt,
  Sparkles,
  Trash2,
  UploadCloud,
  UserRound,
  X,
} from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import {
  CUSTOM_ACCESSORY_TYPES,
  DESIGN_USE_OPTIONS,
  MERCH_PRODUCT_TYPES,
  type CustomAccessoryType,
  type DesignUse,
  type MerchProductKey,
} from "@/lib/creator-commerce/merch-product-types";

type CreativeMode = "from_scratch" | "reference" | "exact_design";
type MerchScope = "personal" | "organization";
type CreationStage = "idle" | "creating" | "uploading" | "products" | "identity" | "error";

type SellerContext = {
  user: { id: string };
  players: Array<{ id: string; name: string; slug: string }>;
  studios: Array<{ id: string; name: string; slug: string }>;
  spots: Array<{
    id: string;
    name: string;
    slug: string;
    studio_id: string | null;
    owner_type: string;
    owner_user_id: string | null;
    currency: string;
  }>;
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
  creative_mode: CreativeMode;
  brief: string | null;
  status: string;
  reference_assets: CreatorAsset[];
  metadata: Record<string, unknown>;
  updated_at: string;
};

type PendingReference = {
  id: string;
  file: File;
  preview: string;
  status: "pending" | "uploading" | "uploaded" | "error";
  error?: string;
};

type ProjectDraft = {
  name: string;
  seller: string;
  creativeMode: CreativeMode;
  brief: string;
};

type CustomAccessoryDraft = {
  id: string;
  type: CustomAccessoryType;
  description: string;
  designUse: DesignUse;
  referenceId: string;
};

type ExistingConcept = {
  id: string;
  product_template: string;
  creative_config?: Record<string, unknown>;
};

type SellerOption = {
  value: string;
  label: string;
  kind: "user" | "player" | "studio" | "spot";
};

const CARD = "rounded-[1.4rem] border border-white/[0.09] bg-[#0a0910]/72 shadow-[0_18px_70px_rgba(0,0,0,.22)] backdrop-blur-sm";
const INPUT = "w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-violet-400/60 disabled:cursor-not-allowed disabled:opacity-50";
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_REFERENCES = 12;
const INITIAL_DROP_NAME = "Drop 01";

const METHODS: Array<{ value: CreativeMode; title: string; kicker: string; description: string }> = [
  { value: "from_scratch", title: "Desde cero", kicker: "Tengo una idea", description: "CLOUVA desarrolla el universo visual desde tu brief." },
  { value: "reference", title: "Referencia / inspiración", kicker: "Tengo referencias", description: "Usá portadas, fotos, prendas o diseños como inspiración." },
  { value: "exact_design", title: "Diseño exacto", kicker: "Tengo el diseño", description: "Usá este material como diseño principal del drop." },
];

const PLACEHOLDERS: Record<CreativeMode, string> = {
  from_scratch: "Ej: Colección futurista del sur argentino, hielo, montaña, tecnología y rap.",
  reference: "Ej: Quiero convertir la estética de este EP en una colección premium negra y violeta, con remeras, hoodies y accesorios. Mantener el ADN visual de la portada.",
  exact_design: "Ej: Quiero aplicar exactamente este símbolo en una remera negra, hoodie y gorra.",
};

const REFERENCE_COPY: Record<CreativeMode, { eyebrow: string; title: string; description: string }> = {
  from_scratch: {
    eyebrow: "02 · Referencias opcionales",
    title: "¿Tenés algo que te inspire?",
    description: "Podés sumar una imagen como guía. Si no, CLOUVA parte solamente de tu idea.",
  },
  reference: {
    eyebrow: "02 · Referencias",
    title: "Mostranos el universo visual",
    description: "CLOUVA toma dirección visual, colores, composición, texturas y lenguaje gráfico sin asumir que debe copiar literalmente la imagen.",
  },
  exact_design: {
    eyebrow: "02 · Diseño principal",
    title: "Subí el diseño principal",
    description: "Este material será la fuente principal del diseño y el flujo existente de identidad preservará su intención visual.",
  },
};

const PRODUCT_ICONS = {
  shirt: Shirt,
  package: Package,
  headphones: Headphones,
  coffee: Coffee,
  gem: Gem,
  box: Box,
} as const;

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
    reader.readAsDataURL(file);
  });
}

function referenceKind(mode: CreativeMode, index: number) {
  if (mode === "exact_design") return index === 0 ? "artwork_master" : "reference";
  return "inspiration_reference";
}

function referenceTypeLabel(mode: CreativeMode, index: number) {
  if (mode === "exact_design") return index === 0 ? "DISEÑO" : "REFERENCIA";
  if (mode === "reference") return index === 0 ? "REFERENCIA PRINCIPAL" : "INSPIRACIÓN";
  return "INSPIRACIÓN";
}

function displayMode(mode: CreativeMode) {
  if (mode === "from_scratch") return "Desde cero";
  if (mode === "exact_design") return "Diseño exacto";
  return "Referencia / inspiración";
}

function displayScope(scope: MerchScope) {
  return scope === "personal" ? "Artista / Marca personal" : "Estudio / Empresa";
}

function newAccessory(): CustomAccessoryDraft {
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `accessory-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: "Aros",
    description: "",
    designUse: "shape",
    referenceId: "",
  };
}

export function MerchCreatorStart() {
  const router = useRouter();
  const { session, user, loading: authLoading } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [context, setContext] = useState<SellerContext | null>(null);
  const [projects, setProjects] = useState<CreatorProject[]>([]);
  const [merchScope, setMerchScope] = useState<MerchScope>("personal");
  const [projectDraft, setProjectDraft] = useState<ProjectDraft>({
    name: "",
    seller: "user",
    creativeMode: "from_scratch",
    brief: "",
  });
  const [pendingReferences, setPendingReferences] = useState<PendingReference[]>([]);
  const [previewReference, setPreviewReference] = useState<PendingReference | null>(null);
  const [selectedProducts, setSelectedProducts] = useState<Set<MerchProductKey>>(new Set());
  const [customAccessories, setCustomAccessories] = useState<CustomAccessoryDraft[]>([]);
  const [show3dInfo, setShow3dInfo] = useState(false);
  const [createdProject, setCreatedProject] = useState<CreatorProject | null>(null);
  const [stage, setStage] = useState<CreationStage>("idle");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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
    setProjects((projectPayload.projects ?? []) as CreatorProject[]);
  }, [authFetch, session?.access_token]);

  useEffect(() => {
    if (authLoading || !user || !session?.access_token) return;
    void load().catch((cause) => setError(cause instanceof Error ? cause.message : "No se pudo cargar Crear Merch."));
  }, [authLoading, load, session?.access_token, user]);

  const personalSellerOptions = useMemo<SellerOption[]>(() => {
    const options: SellerOption[] = [{ value: "user", label: "Mi cuenta", kind: "user" }];
    for (const player of context?.players ?? []) options.push({ value: `player:${player.id}`, label: `Player · ${player.name}`, kind: "player" });
    return options;
  }, [context]);

  const organizationSellerOptions = useMemo<SellerOption[]>(() => {
    const options: SellerOption[] = [];
    for (const studio of context?.studios ?? []) options.push({ value: `studio:${studio.id}`, label: `Studio · ${studio.name}`, kind: "studio" });
    for (const spot of context?.spots ?? []) options.push({ value: `spot:${spot.id}`, label: `Business / Spot · ${spot.name}`, kind: "spot" });
    return options;
  }, [context]);

  const sellerOptions = merchScope === "personal" ? personalSellerOptions : organizationSellerOptions;
  const sellerLabel = sellerOptions.find((option) => option.value === projectDraft.seller)?.label ?? (merchScope === "personal" ? "Mi cuenta" : "Elegí una organización");
  const referenceCopy = REFERENCE_COPY[projectDraft.creativeMode];
  const uploadedCount = pendingReferences.filter((item) => item.status === "uploaded").length;
  const pendingCount = pendingReferences.length - uploadedCount;
  const selectedProductList = MERCH_PRODUCT_TYPES.filter((product) => selectedProducts.has(product.key));
  const selectedCount = selectedProductList.filter((product) => product.key !== "custom").length + (selectedProducts.has("custom") ? customAccessories.length : 0);

  function switchScope(nextScope: MerchScope) {
    if (createdProject || busy || nextScope === merchScope) return;
    setMerchScope(nextScope);
    setError(null);
    if (nextScope === "personal") {
      setProjectDraft((current) => ({ ...current, seller: "user" }));
      return;
    }
    const organizationOptions = organizationSellerOptions;
    setProjectDraft((current) => ({ ...current, seller: organizationOptions.length === 1 ? organizationOptions[0].value : "" }));
  }

  function collectionBlueprint() {
    return {
      version: 2,
      format: "product",
      merch_scope: merchScope,
      selected_product_keys: [...selectedProducts],
      custom_accessories: selectedProducts.has("custom")
        ? customAccessories.map((accessory) => ({
            id: accessory.id,
            type: accessory.type,
            description: accessory.description.trim(),
            design_use: accessory.designUse,
            reference_label: pendingReferences.find((item) => item.id === accessory.referenceId)?.file.name ?? null,
          }))
        : [],
      updated_at: new Date().toISOString(),
    };
  }

  async function addReferenceFiles(files: File[]) {
    if (!files.length) return;
    setError(null);
    const capacity = Math.max(0, MAX_REFERENCES - pendingReferences.length);
    if (!capacity) return setError(`Podés preparar hasta ${MAX_REFERENCES} referencias por vez.`);
    const selected = files.slice(0, capacity);
    const next: PendingReference[] = [];
    const rejected: string[] = [];

    for (const file of selected) {
      if (!ALLOWED_MIME.has(file.type)) {
        rejected.push(`${file.name}: usá JPG, PNG o WEBP`);
        continue;
      }
      if (!file.size || file.size > MAX_BYTES) {
        rejected.push(`${file.name}: máximo 8 MB`);
        continue;
      }
      try {
        next.push({ id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2)}`, file, preview: await fileToDataUrl(file), status: "pending" });
      } catch {
        rejected.push(`${file.name}: no se pudo leer`);
      }
    }

    if (next.length) setPendingReferences((current) => [...current, ...next]);
    if (rejected.length) setError(rejected.join(" · "));
    if (files.length > capacity) setError((current) => [current, `El límite es ${MAX_REFERENCES} referencias por preparación.`].filter(Boolean).join(" · "));
  }

  function removePendingReference(id: string) {
    setPendingReferences((current) => current.filter((item) => item.id !== id || item.status === "uploaded"));
    setCustomAccessories((current) => current.map((accessory) => accessory.referenceId === id ? { ...accessory, referenceId: "" } : accessory));
    setPreviewReference((current) => current?.id === id ? null : current);
  }

  function toggleProduct(key: MerchProductKey) {
    if (createdProject || busy) return;
    setSelectedProducts((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    if (key === "custom" && !selectedProducts.has("custom") && customAccessories.length === 0) setCustomAccessories([newAccessory()]);
  }

  function updateAccessory(id: string, patch: Partial<CustomAccessoryDraft>) {
    setCustomAccessories((current) => current.map((accessory) => accessory.id === id ? { ...accessory, ...patch } : accessory));
  }

  async function uploadReferences(project: CreatorProject) {
    let currentProject = project;
    const assets = [...(currentProject.reference_assets ?? [])];
    const referencesToUpload = pendingReferences.filter((item) => item.status !== "uploaded");

    for (const item of referencesToUpload) {
      const index = pendingReferences.findIndex((candidate) => candidate.id === item.id);
      setPendingReferences((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: "uploading", error: undefined } : candidate));
      try {
        const uploaded = await authFetch("/api/creator-commerce/project-assets", {
          method: "POST",
          body: JSON.stringify({ projectId: currentProject.id, kind: referenceKind(projectDraft.creativeMode, Math.max(0, index)), label: item.file.name, dataUrl: item.preview }),
        });
        assets.push(uploaded.asset as CreatorAsset);
        const patched = await authFetch(`/api/creator-commerce/projects/${currentProject.id}`, {
          method: "PATCH",
          body: JSON.stringify({ reference_assets: assets }),
        });
        currentProject = patched.project as CreatorProject;
        setCreatedProject(currentProject);
        setProjects((current) => current.map((candidate) => candidate.id === currentProject.id ? currentProject : candidate));
        setPendingReferences((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: "uploaded", error: undefined } : candidate));
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : "No se pudo subir esta referencia.";
        setPendingReferences((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: "error", error: reason } : candidate));
        throw new Error(`${item.file.name}: ${reason}`);
      }
    }
    return currentProject;
  }

  async function saveCollectionBlueprint(project: CreatorProject) {
    const payload = await authFetch(`/api/creator-commerce/projects/${project.id}`, {
      method: "PATCH",
      body: JSON.stringify({ metadata: { ...(project.metadata ?? {}), merch_preflight: collectionBlueprint() } }),
    });
    const currentProject = payload.project as CreatorProject;
    setCreatedProject(currentProject);
    setProjects((current) => current.map((candidate) => candidate.id === currentProject.id ? currentProject : candidate));
    return currentProject;
  }

  async function createSelectedConcepts(project: CreatorProject) {
    if (!selectedProducts.size) return;
    const current = await authFetch(`/api/creator-commerce/projects/${project.id}/concepts`);
    const existing = (current.concepts ?? []) as ExistingConcept[];
    const existingKeys = new Set(existing.map((concept) => typeof concept.creative_config?.preflight_key === "string" ? concept.creative_config.preflight_key : "").filter(Boolean));
    const rows: Array<Record<string, unknown>> = [];

    for (const product of MERCH_PRODUCT_TYPES) {
      if (product.key === "custom" || !selectedProducts.has(product.key)) continue;
      const preflightKey = `product:${product.key}`;
      if (existingKeys.has(preflightKey)) continue;
      rows.push({
        name: `${product.label} · ${project.name}`,
        product_template: product.key,
        creative_config: {
          color: "Negro",
          placement: "",
          material: "",
          notes: project.brief || "",
          product_group: product.group,
          collection_intent: "standard_customized_product",
          preflight_key: preflightKey,
        },
        design_overrides: {},
      });
    }

    if (selectedProducts.has("custom")) {
      for (const accessory of customAccessories) {
        const preflightKey = `accessory:${accessory.id}`;
        if (existingKeys.has(preflightKey)) continue;
        const pendingReference = pendingReferences.find((item) => item.id === accessory.referenceId);
        const storedReference = pendingReference ? (project.reference_assets ?? []).find((asset) => asset.label === pendingReference.file.name) : undefined;
        rows.push({
          name: `${accessory.type === "Otro" ? "Accesorio personalizado" : accessory.type} · ${project.name}`,
          product_template: "custom",
          creative_config: {
            color: "",
            placement: "",
            material: "",
            notes: accessory.description.trim() || project.brief || "",
            product_kind: "custom_accessory",
            accessory_type: accessory.type,
            design_use: accessory.designUse,
            shape_reference_label: pendingReference?.file.name ?? null,
            shape_reference_url: storedReference?.url ?? null,
            collection_intent: accessory.designUse === "graphic" ? "graphic_on_product" : accessory.designUse === "shape" ? "custom_physical_shape" : "custom_shape_and_finish",
            preflight_key: preflightKey,
          },
          design_overrides: { notes: accessory.description.trim(), design_use: accessory.designUse },
        });
      }
    }

    if (!rows.length) return;
    await authFetch(`/api/creator-commerce/projects/${project.id}/concepts`, { method: "POST", body: JSON.stringify({ concepts: rows }) });
  }

  function openProject(projectId: string) {
    router.push(`/crear/merch?project=${encodeURIComponent(projectId)}`);
  }

  async function createOrContinueProject() {
    if (!projectDraft.name.trim() && !createdProject) return setError("Poné un nombre al proyecto.");
    if (!createdProject && merchScope === "organization" && !projectDraft.seller) return setError("Elegí el estudio o empresa que representa este merch.");

    setBusy(true);
    setError(null);
    setMessage(null);
    let project = createdProject;
    let projectPersisted = Boolean(project);

    try {
      if (!project) {
        setStage("creating");
        const [kind, id] = projectDraft.seller.split(":");
        const validPersonalSeller = merchScope === "personal" && (kind === "user" || kind === "player");
        const validOrganizationSeller = merchScope === "organization" && (kind === "studio" || kind === "spot");
        if (!validPersonalSeller && !validOrganizationSeller) throw new Error("La identidad elegida no corresponde al tipo de merch seleccionado.");

        const selectedSpot = kind === "spot" ? context?.spots.find((spot) => spot.id === id) : null;
        const selectedStudio = selectedSpot?.studio_id || (kind === "studio" ? id : null);
        const ownerType = selectedSpot ? (selectedStudio ? "studio" : "user") : kind === "player" || kind === "studio" ? kind : "user";
        const payload = await authFetch("/api/creator-commerce/projects", {
          method: "POST",
          body: JSON.stringify({
            name: projectDraft.name,
            owner_type: ownerType,
            player_id: kind === "player" ? id : null,
            studio_id: selectedStudio,
            spot_id: selectedSpot?.id ?? null,
            collection_name: INITIAL_DROP_NAME,
            category: "Merch",
            creative_mode: projectDraft.creativeMode,
            brief: projectDraft.brief,
            metadata: { merch_preflight: collectionBlueprint() },
          }),
        });
        project = payload.project as CreatorProject;
        projectPersisted = true;
        setCreatedProject(project);
        setProjects((current) => [project!, ...current.filter((candidate) => candidate.id !== project!.id)]);
      }

      if (pendingReferences.some((item) => item.status !== "uploaded")) {
        setStage("uploading");
        project = await uploadReferences(project);
      }

      setStage("products");
      project = await saveCollectionBlueprint(project);
      await createSelectedConcepts(project);
      setStage("identity");
      setMessage("Drop preparado. Abriendo Identidad…");
      openProject(project.id);
    } catch (cause) {
      setStage("error");
      const reason = cause instanceof Error ? cause.message : "No se pudo preparar el proyecto.";
      setError(projectPersisted ? `El proyecto quedó guardado, pero no se completó la preparación. ${reason} Podés reintentar sin crear otro proyecto.` : reason);
    } finally {
      setBusy(false);
    }
  }

  const buttonLabel = stage === "creating"
    ? "Creando proyecto…"
    : stage === "uploading"
      ? "Subiendo referencias…"
      : stage === "products"
        ? "Preparando colección…"
        : stage === "identity"
          ? "Preparando identidad…"
          : createdProject
            ? "Reintentar preparación →"
            : "Crear mi drop →";

  if (!user && !authLoading) {
    return <main className="grid min-h-screen place-items-center bg-[#05030a] px-6 text-white"><Link href="/login?next=/crear/merch" className="rounded-full border border-violet-400/40 px-5 py-3">Iniciar sesión</Link></main>;
  }

  return (
    <main className="min-h-screen bg-transparent px-3 py-5 text-white sm:px-5 lg:px-6">
      <div className="mx-auto w-full max-w-[1480px]">
        <header className="flex flex-wrap items-end justify-between gap-5 border-b border-white/[0.07] pb-5">
          <div>
            <Link href="/crear" className="inline-flex items-center gap-2 text-xs text-white/40 transition hover:text-white"><ArrowLeft size={14} /> Crear</Link>
            <p className="mt-4 text-[10px] font-bold uppercase tracking-[.28em] text-violet-300">CLOUVA Commerce Creator</p>
            <h1 className="mt-1.5 text-3xl font-semibold tracking-tight sm:text-4xl">Crear Merch</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-white/45">Convertí una idea, identidad o universo visual en una colección lista para generar y vender.</p>
          </div>
          <Link href="/market" className="rounded-full border border-white/10 bg-white/[.035] px-4 py-2 text-xs font-semibold text-white/60 transition hover:border-white/20 hover:text-white">Market</Link>
          <div className="w-full overflow-x-auto pb-1">
            <div className="flex min-w-max items-center gap-2 text-[9px] font-bold uppercase tracking-[.13em] text-white/28">
              {["Idea", "Referencias", "Productos", "Identidad", "Generar"].map((step, index, all) => (
                <span key={step} className="flex items-center gap-2"><span className={index <= 2 ? "text-violet-300/80" : ""}>{step}</span>{index < all.length - 1 ? <ChevronRight size={11} className="text-white/15" /> : null}</span>
              ))}
            </div>
          </div>
        </header>

        {error ? <div className="mt-5 rounded-xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}
        {message ? <div className="mt-5 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">{message}</div> : null}

        <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-5">
            <section className={CARD}>
              <div className="p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-violet-400/15 bg-violet-500/10 text-violet-200"><Layers3 size={18} /></span>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[.22em] text-violet-300">01 · Tu drop</p>
                    <h2 className="mt-1 text-lg font-semibold">Armá la base de la colección</h2>
                    <p className="mt-1 text-xs text-white/38">Primero elegí a quién representa el merch. CLOUVA resuelve por debajo la identidad, organización y vendedor real.</p>
                  </div>
                </div>

                <div className="mt-5">
                  <p className="text-[10px] font-bold uppercase tracking-[.18em] text-white/35">¿Para quién es este merch?</p>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <button type="button" disabled={Boolean(createdProject)} onClick={() => switchScope("personal")} className={`relative min-h-32 rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-55 ${merchScope === "personal" ? "border-violet-400/70 bg-violet-500/[.10] shadow-[0_0_28px_rgba(124,58,237,.10)]" : "border-white/[0.08] bg-black/20 hover:border-white/18"}`}>
                      {merchScope === "personal" ? <span className="absolute right-3 top-3 grid h-5 w-5 place-items-center rounded-full bg-violet-500 text-white"><Check size={12} /></span> : null}
                      <span className={`grid h-10 w-10 place-items-center rounded-xl border ${merchScope === "personal" ? "border-violet-400/25 bg-violet-500/15 text-violet-200" : "border-white/[0.08] bg-white/[0.025] text-white/35"}`}><UserRound size={19} /></span>
                      <strong className="mt-3 block pr-7 text-sm">Artista / Marca personal</strong>
                      <p className="mt-1.5 max-w-lg text-[11px] leading-4 text-white/38">Merch oficial de tu identidad, artista, proyecto creativo o marca personal.</p>
                    </button>
                    <button type="button" disabled={Boolean(createdProject)} onClick={() => switchScope("organization")} className={`relative min-h-32 rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-55 ${merchScope === "organization" ? "border-violet-400/70 bg-violet-500/[.10] shadow-[0_0_28px_rgba(124,58,237,.10)]" : "border-white/[0.08] bg-black/20 hover:border-white/18"}`}>
                      {merchScope === "organization" ? <span className="absolute right-3 top-3 grid h-5 w-5 place-items-center rounded-full bg-violet-500 text-white"><Check size={12} /></span> : null}
                      <span className={`grid h-10 w-10 place-items-center rounded-xl border ${merchScope === "organization" ? "border-violet-400/25 bg-violet-500/15 text-violet-200" : "border-white/[0.08] bg-white/[0.025] text-white/35"}`}><Building2 size={19} /></span>
                      <strong className="mt-3 block pr-7 text-sm">Estudio / Empresa</strong>
                      <p className="mt-1.5 max-w-lg text-[11px] leading-4 text-white/38">Merch de un estudio, sello, colectivo, negocio o empresa.</p>
                    </button>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_180px]">
                  <label className="text-[11px] text-white/45">Nombre del proyecto<input disabled={Boolean(createdProject)} className={`${INPUT} mt-1.5`} value={projectDraft.name} onChange={(event) => setProjectDraft({ ...projectDraft, name: event.target.value })} placeholder={merchScope === "personal" ? "CLOUVA Oficial / Vida de Flows" : "Iglú Records Merch / 223 Official"} /></label>

                  {merchScope === "organization" && organizationSellerOptions.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/10 bg-black/20 px-3 py-3 text-[11px] leading-5 text-white/38"><strong className="block text-white/65">Sin organización disponible</strong>Todavía no tenés un estudio o empresa disponible para crear merch.</div>
                  ) : (
                    <label className="text-[11px] text-white/45">{merchScope === "personal" ? "Identidad oficial" : "Estudio / Empresa"}<select disabled={Boolean(createdProject)} className={`${INPUT} mt-1.5`} value={projectDraft.seller} onChange={(event) => setProjectDraft({ ...projectDraft, seller: event.target.value })}>{merchScope === "organization" && organizationSellerOptions.length > 1 ? <option value="">Elegí un estudio o empresa</option> : null}{sellerOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><span className="mt-1.5 block text-[9px] text-white/25">{merchScope === "personal" ? "Elegí qué identidad representa este merch." : "Elegí qué organización va a crear y vender este merch."}</span></label>
                  )}

                  <div className="text-[11px] text-white/45">Drop<div className="mt-1.5 flex min-h-[42px] items-center justify-between rounded-xl border border-violet-400/20 bg-violet-500/[.055] px-3"><strong className="text-sm text-white/80">{INITIAL_DROP_NAME}</strong><span className="rounded-full border border-violet-400/20 bg-violet-500/10 px-2 py-1 text-[8px] font-bold uppercase tracking-[.12em] text-violet-200">Automático</span></div><span className="mt-1.5 block text-[9px] text-white/25">Primer drop de este proyecto.</span></div>
                </div>

                <div className="mt-5 border-t border-white/[0.07] pt-5">
                  <p className="text-[10px] font-bold uppercase tracking-[.18em] text-white/35">¿Cómo querés crearlo?</p>
                  <div className="mt-3 grid gap-2.5 md:grid-cols-3">
                    {METHODS.map((method) => {
                      const selected = projectDraft.creativeMode === method.value;
                      return (
                        <button key={method.value} type="button" disabled={Boolean(createdProject)} onClick={() => setProjectDraft({ ...projectDraft, creativeMode: method.value })} className={`relative min-h-28 rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-55 ${selected ? "border-violet-400/70 bg-violet-500/[.10] shadow-[0_0_28px_rgba(124,58,237,.10)]" : "border-white/[0.08] bg-black/20 hover:border-white/18"}`}>
                          {selected ? <span className="absolute right-3 top-3 grid h-5 w-5 place-items-center rounded-full bg-violet-500 text-white"><Check size={12} /></span> : null}
                          <p className="text-[9px] font-bold uppercase tracking-[.14em] text-violet-300/75">{method.kicker}</p>
                          <strong className="mt-1.5 block pr-7 text-sm">{method.title}</strong>
                          <p className="mt-2 text-[11px] leading-4 text-white/38">{method.description}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <label className="mt-5 block text-xs font-semibold text-white/72">¿Qué querés crear?<textarea disabled={Boolean(createdProject)} className={`${INPUT} mt-2 min-h-28 resize-y text-sm leading-6`} value={projectDraft.brief} onChange={(event) => setProjectDraft({ ...projectDraft, brief: event.target.value })} placeholder={PLACEHOLDERS[projectDraft.creativeMode]} /><span className="mt-2 block text-[10px] font-normal text-white/28">Mientras más contexto le des a CLOUVA, mejor puede mantener el universo de la colección.</span></label>
              </div>
            </section>

            <section className={CARD}>
              <div className="p-4 sm:p-5">
                <p className="text-[10px] font-bold uppercase tracking-[.22em] text-violet-300">{referenceCopy.eyebrow}</p>
                <div className="mt-1 flex flex-wrap items-start justify-between gap-3"><div className="max-w-3xl"><h2 className="text-lg font-semibold">{referenceCopy.title}</h2><p className="mt-1.5 text-xs leading-5 text-white/38">{referenceCopy.description}</p></div>{pendingReferences.length ? <span className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-[9px] text-white/40">{uploadedCount}/{pendingReferences.length} guardadas</span> : null}</div>

                {pendingReferences.length === 0 ? (
                  <button type="button" onClick={() => fileInputRef.current?.click()} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event: DragEvent<HTMLButtonElement>) => { event.preventDefault(); setDragging(true); }} onDragLeave={(event) => { event.preventDefault(); setDragging(false); }} onDrop={(event: DragEvent<HTMLButtonElement>) => { event.preventDefault(); setDragging(false); void addReferenceFiles(Array.from(event.dataTransfer.files)); }} className={`mt-4 flex min-h-36 w-full flex-col items-center justify-center rounded-2xl border border-dashed px-5 py-6 text-center transition ${dragging ? "border-violet-300 bg-violet-500/10" : "border-white/15 bg-black/20 hover:border-violet-400/45 hover:bg-violet-500/[.035]"}`}>
                    <UploadCloud size={25} className="text-violet-300" /><strong className="mt-3 text-sm">Subí tu referencia</strong><span className="mt-1 text-xs text-white/35">Arrastrá imágenes acá o elegilas desde tu dispositivo</span><span className="mt-4 rounded-lg bg-violet-500 px-4 py-2 text-xs font-bold text-white">+ Elegir imágenes</span>
                  </button>
                ) : (
                  <div className="mt-4"><div className="flex items-center justify-between gap-3"><button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex items-center gap-2 rounded-xl border border-violet-400/25 bg-violet-500/[.08] px-3 py-2 text-xs font-semibold text-violet-200 transition hover:bg-violet-500/[.14]"><Plus size={14} /> Agregar referencia</button><span className="text-[10px] text-white/25">JPG · PNG · WEBP · hasta 8 MB</span></div><div className="mt-3 flex gap-3 overflow-x-auto pb-2 sm:grid sm:grid-cols-3 sm:overflow-visible lg:grid-cols-4 xl:grid-cols-5">{pendingReferences.map((item, index) => <div key={item.id} className={`relative w-36 shrink-0 overflow-hidden rounded-2xl border bg-black/30 sm:w-auto ${item.status === "error" ? "border-rose-400/35" : item.status === "uploaded" ? "border-emerald-400/25" : "border-white/10"}`}><button type="button" onClick={() => setPreviewReference(item)} className="group relative block aspect-[4/3] w-full overflow-hidden bg-black/40"><Image src={item.preview} alt={item.file.name} fill unoptimized sizes="180px" className="object-cover transition duration-300 group-hover:scale-[1.03]" /><span className="absolute left-2 top-2 rounded-md bg-black/75 px-1.5 py-1 text-[8px] font-bold tracking-wide text-white/70 backdrop-blur">{referenceTypeLabel(projectDraft.creativeMode, index)}</span><span className="absolute inset-0 grid place-items-center bg-black/0 opacity-0 transition group-hover:bg-black/45 group-hover:opacity-100"><Eye size={18} /></span></button><div className="flex items-center gap-2 p-2.5"><p className="min-w-0 flex-1 truncate text-[10px] text-white/55" title={item.file.name}>{item.file.name}</p><button type="button" disabled={item.status === "uploaded" || item.status === "uploading"} onClick={() => removePendingReference(item.id)} className="rounded-md p-1 text-white/30 hover:bg-white/5 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-20" aria-label={`Eliminar ${item.file.name}`}><Trash2 size={12} /></button></div></div>)}</div></div>
                )}
                <input ref={fileInputRef} type="file" multiple accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => { void addReferenceFiles(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }} />
              </div>
            </section>

            <section className={CARD}>
              <div className="p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.22em] text-violet-300">03 · Productos</p><h2 className="mt-1 text-lg font-semibold">Elegí qué artículos forman el merch</h2><p className="mt-1.5 text-xs text-white/38">La selección define la colección. Todavía no genera imágenes ni publica nada.</p></div><span className="rounded-full border border-white/10 bg-black/25 px-3 py-1.5 text-[10px] font-semibold text-white/55">{selectedCount} seleccionado{selectedCount === 1 ? "" : "s"}</span></div>
                <div className="mt-4 flex items-center gap-2"><span className="text-[10px] font-bold uppercase tracking-[.16em] text-white/30">Formato</span><span className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-violet-400/35 bg-violet-500/[.10] px-3 py-2 text-xs font-semibold text-violet-100"><Check size={13} /> Producto</span><button type="button" onClick={() => setShow3dInfo(true)} className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 py-2 text-xs font-semibold text-white/28 transition hover:border-white/15 hover:text-white/45">3D <span className="rounded bg-white/[0.05] px-1.5 py-0.5 text-[8px] uppercase tracking-wider">Próximamente</span></button></div>
                <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">{MERCH_PRODUCT_TYPES.map((product) => { const selected = selectedProducts.has(product.key); const Icon = PRODUCT_ICONS[product.icon]; return <button key={product.key} type="button" disabled={Boolean(createdProject) || busy} onClick={() => toggleProduct(product.key)} className={`group relative min-h-36 overflow-hidden rounded-2xl border p-3.5 text-left transition disabled:cursor-not-allowed disabled:opacity-55 ${selected ? "border-violet-400/70 bg-violet-500/[.11] shadow-[0_0_25px_rgba(124,58,237,.09)]" : "border-white/[0.08] bg-black/20 hover:border-white/18 hover:bg-white/[.035]"}`}><span className={`grid h-11 w-11 place-items-center rounded-xl border transition ${selected ? "border-violet-400/25 bg-violet-500/15 text-violet-200" : "border-white/[0.07] bg-white/[.025] text-white/35 group-hover:text-white/55"}`}><Icon size={20} /></span><span className={`absolute right-3 top-3 grid h-5 w-5 place-items-center rounded-full border ${selected ? "border-violet-400 bg-violet-500 text-white" : "border-white/15 bg-black/35 text-transparent"}`}><Check size={11} /></span><span className="mt-3 block text-[9px] font-bold uppercase tracking-[.12em] text-white/25">{product.group}</span><strong className="mt-1 block text-xs leading-4 text-white/78">{product.label}</strong><span className="mt-1.5 line-clamp-2 block text-[9px] leading-4 text-white/28">{product.description}</span></button>; })}</div>

                {selectedProducts.has("custom") ? <div className="mt-4 rounded-2xl border border-violet-400/20 bg-violet-500/[.045] p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">Accesorios personalizados</h3><p className="mt-1 text-[10px] text-white/35">Acá el diseño puede ser la gráfica, la forma física del objeto o ambas.</p></div><button type="button" disabled={Boolean(createdProject) || busy} onClick={() => setCustomAccessories((current) => [...current, newAccessory()])} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-[10px] font-semibold text-white/55 hover:text-white disabled:opacity-40"><Plus size={12} /> Otro accesorio</button></div><div className="mt-4 space-y-3">{customAccessories.map((accessory, index) => <div key={accessory.id} className="rounded-xl border border-white/[0.08] bg-black/25 p-3.5"><div className="flex items-center justify-between gap-3"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-violet-300/75">Accesorio {index + 1}</p>{customAccessories.length > 1 ? <button type="button" disabled={Boolean(createdProject) || busy} onClick={() => setCustomAccessories((current) => current.filter((item) => item.id !== accessory.id))} className="rounded-md p-1.5 text-white/25 hover:bg-white/5 hover:text-rose-300 disabled:opacity-30" aria-label="Eliminar accesorio"><Trash2 size={13} /></button> : null}</div><div className="mt-3 grid gap-3 md:grid-cols-2"><label className="text-[10px] text-white/40">Tipo de accesorio<select disabled={Boolean(createdProject)} className={`${INPUT} mt-1.5`} value={accessory.type} onChange={(event) => updateAccessory(accessory.id, { type: event.target.value as CustomAccessoryType })}>{CUSTOM_ACCESSORY_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label><label className="text-[10px] text-white/40">Referencia para forma / silueta<select disabled={Boolean(createdProject)} className={`${INPUT} mt-1.5`} value={accessory.referenceId} onChange={(event) => updateAccessory(accessory.id, { referenceId: event.target.value })}><option value="">Sin referencia específica</option>{pendingReferences.map((item) => <option key={item.id} value={item.id}>{item.file.name}</option>)}</select></label></div><div className="mt-3"><p className="text-[10px] text-white/40">Uso del diseño</p><div className="mt-1.5 grid gap-2 sm:grid-cols-3">{DESIGN_USE_OPTIONS.map((option) => { const active = accessory.designUse === option.value; return <button key={option.value} type="button" disabled={Boolean(createdProject)} onClick={() => updateAccessory(accessory.id, { designUse: option.value })} className={`rounded-xl border p-2.5 text-left transition disabled:opacity-50 ${active ? "border-violet-400/55 bg-violet-500/[.10]" : "border-white/[0.08] bg-black/20"}`}><span className="flex items-center justify-between gap-2 text-[11px] font-semibold"><span>{option.label}</span>{active ? <Check size={12} className="text-violet-300" /> : null}</span><span className="mt-1 block text-[9px] leading-4 text-white/30">{option.description}</span></button>; })}</div></div><label className="mt-3 block text-[10px] text-white/40">¿Cómo debería ser?<textarea disabled={Boolean(createdProject)} className={`${INPUT} mt-1.5 min-h-20 resize-y text-xs leading-5`} value={accessory.description} onChange={(event) => updateAccessory(accessory.id, { description: event.target.value })} placeholder="Ej: Quiero un aro metálico cuya forma completa sea el símbolo CLOUVA." /></label></div>)}</div></div> : null}
              </div>
            </section>

            {createdProject ? <div className="rounded-xl border border-amber-300/15 bg-amber-300/[.045] p-4 text-xs leading-5 text-amber-100/70"><strong>El proyecto ya existe.</strong> Si una referencia o la preparación de productos falló, el botón reintenta solamente lo pendiente y evita duplicar conceptos creados desde este preflight.</div> : null}

            <div className="xl:hidden"><div className="rounded-xl border border-white/[0.08] bg-black/30 px-4 py-3 text-xs text-white/50"><strong className="text-white/75">{projectDraft.name || "Nuevo drop"}</strong> · {displayScope(merchScope)} · {selectedCount} producto{selectedCount === 1 ? "" : "s"} · {pendingReferences.length} referencia{pendingReferences.length === 1 ? "" : "s"}</div><button onClick={() => void createOrContinueProject()} disabled={busy || authLoading || (merchScope === "organization" && !projectDraft.seller)} className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-violet-500 px-5 py-3 text-sm font-bold shadow-[0_12px_35px_rgba(124,58,237,.18)] transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-50">{busy ? <Loader2 className="animate-spin" size={17} /> : <Sparkles size={16} />}{buttonLabel}</button></div>
          </div>

          <aside className="hidden space-y-4 xl:sticky xl:top-20 xl:block">
            <section className={CARD}><div className="p-5"><p className="text-[9px] font-bold uppercase tracking-[.22em] text-violet-300">Tu drop</p><h2 className="mt-2 truncate text-xl font-semibold">{projectDraft.name || "Nuevo drop"}</h2><p className="mt-1 text-[10px] font-bold uppercase tracking-[.13em] text-white/32">{displayScope(merchScope)}</p>
              <div className="mt-4 space-y-2"><div className="rounded-xl border border-white/[0.07] bg-black/25 p-3"><p className="text-[9px] uppercase tracking-wider text-white/25">{merchScope === "personal" ? "Identidad" : "Organización"}</p><p className="mt-1 truncate text-[11px] font-semibold text-white/65">{sellerLabel}</p></div><div className="grid grid-cols-2 gap-2"><div className="rounded-xl border border-white/[0.07] bg-black/25 p-3"><p className="text-[9px] uppercase tracking-wider text-white/25">Drop</p><p className="mt-1 text-[11px] font-semibold text-white/65">{INITIAL_DROP_NAME}</p></div><div className="rounded-xl border border-white/[0.07] bg-black/25 p-3"><p className="text-[9px] uppercase tracking-wider text-white/25">Método</p><p className="mt-1 text-[11px] font-semibold text-white/65">{displayMode(projectDraft.creativeMode)}</p></div></div></div>
              <div className="mt-4 flex items-center justify-between text-[10px]"><span className="text-white/32">Referencias</span><strong className="text-white/70">{pendingReferences.length}</strong></div>{pendingReferences.length ? <div className="mt-2 flex gap-2 overflow-hidden">{pendingReferences.slice(0, 4).map((item) => <div key={item.id} className="relative aspect-square w-12 overflow-hidden rounded-lg border border-white/10 bg-black"><Image src={item.preview} alt="" fill unoptimized sizes="48px" className="object-cover" /></div>)}</div> : <p className="mt-2 text-[10px] text-white/20">Sin referencias cargadas.</p>}
              <div className="mt-5 border-t border-white/[0.07] pt-4"><div className="flex items-center justify-between"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-white/40">Productos</p><span className="text-[10px] text-violet-300">{selectedCount}</span></div><div className="mt-2 space-y-1.5">{selectedCount ? <>{selectedProductList.filter((product) => product.key !== "custom").slice(0, 7).map((product) => <div key={product.key} className="flex items-center gap-2 text-[11px] text-white/52"><Check size={11} className="text-violet-300" /> {product.label}</div>)}{selectedProducts.has("custom") ? customAccessories.slice(0, 4).map((accessory) => <div key={accessory.id} className="flex items-center gap-2 text-[11px] text-white/52"><Check size={11} className="text-violet-300" /> {accessory.type === "Otro" ? "Accesorio personalizado" : accessory.type} · {accessory.designUse === "shape" ? "forma" : accessory.designUse === "graphic" ? "gráfico" : "ambos"}</div>) : null}</> : <p className="text-[10px] leading-4 text-white/24">Todavía no elegiste productos. Podés crear el drop igual y decidirlos después.</p>}</div></div>
              <button onClick={() => void createOrContinueProject()} disabled={busy || authLoading || (merchScope === "organization" && !projectDraft.seller)} className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-violet-500 px-5 py-3 text-sm font-bold shadow-[0_12px_35px_rgba(124,58,237,.18)] transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-50">{busy ? <Loader2 className="animate-spin" size={17} /> : <Sparkles size={16} />}{buttonLabel}</button>{pendingReferences.length ? <p className="mt-2 text-center text-[9px] text-white/25">{pendingCount ? `${pendingCount} referencia${pendingCount === 1 ? "" : "s"} pendiente${pendingCount === 1 ? "" : "s"}` : "Referencias listas"}</p> : null}
            </div></section>

            <section className={`${CARD} p-4`}><div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">Mis proyectos</h3><p className="mt-0.5 text-[9px] text-white/28">Continuá un drop existente.</p></div><button onClick={() => void load()} disabled={busy} className="rounded-lg border border-white/10 p-2 text-white/35 hover:text-white disabled:opacity-40" aria-label="Actualizar proyectos"><RefreshCw size={14} /></button></div><div className="mt-3 space-y-2">{projects.length ? projects.slice(0, 4).map((project) => <button key={project.id} onClick={() => openProject(project.id)} className="w-full rounded-xl border border-white/[0.07] bg-black/25 p-3 text-left transition hover:border-violet-400/30"><div className="flex items-center justify-between gap-2"><strong className="min-w-0 truncate text-[11px] text-white/70">{project.name}</strong><span className="shrink-0 text-[8px] uppercase text-violet-300/70">{project.status}</span></div><p className="mt-1 text-[9px] text-white/25">{project.collection_name || "Sin nombre de drop"} · {project.reference_assets?.length || 0} ref.</p></button>) : <div className="rounded-xl border border-dashed border-white/[0.08] p-5 text-center"><ImagePlus className="mx-auto h-5 w-5 text-white/12" /><p className="mt-2 text-[10px] text-white/25">Todavía no hay proyectos.</p></div>}</div></section>
          </aside>
        </div>
      </div>

      {previewReference ? <div className="fixed inset-0 z-[100] grid place-items-center bg-black/85 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`Vista previa de ${previewReference.file.name}`}><button type="button" onClick={() => setPreviewReference(null)} className="absolute right-4 top-4 rounded-full border border-white/10 bg-black/60 p-2 text-white/70 hover:text-white" aria-label="Cerrar vista previa"><X size={20} /></button><div className="w-full max-w-4xl overflow-hidden rounded-3xl border border-white/10 bg-[#09070f] shadow-2xl"><div className="relative aspect-[4/3] max-h-[75vh] w-full bg-black"><Image src={previewReference.preview} alt={previewReference.file.name} fill unoptimized sizes="90vw" className="object-contain" /></div><div className="flex items-center justify-between gap-3 p-4"><p className="min-w-0 truncate text-sm text-white/70">{previewReference.file.name}</p><span className="shrink-0 text-[10px] text-white/30">{Math.max(0.01, previewReference.file.size / 1024 / 1024).toFixed(2)} MB</span></div></div></div> : null}

      {show3dInfo ? <div className="fixed inset-0 z-[110] grid place-items-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="3D próximamente"><div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#0c0b12] p-5 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><p className="text-[9px] font-bold uppercase tracking-[.2em] text-white/28">Formato futuro</p><h2 className="mt-1 text-xl font-semibold">3D próximamente</h2></div><button type="button" onClick={() => setShow3dInfo(false)} className="rounded-full border border-white/10 p-2 text-white/40 hover:text-white" aria-label="Cerrar"><X size={16} /></button></div><p className="mt-3 text-sm leading-6 text-white/42">Vas a poder convertir productos y accesorios personalizados en objetos 3D listos para visualizar, vestir o producir.</p><div className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3 text-[10px] leading-5 text-white/28">Esta opción todavía no genera GLB, no llama servicios 3D y no modifica Creator Studio.</div></div></div> : null}
    </main>
  );
}
