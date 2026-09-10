"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Eye,
  ImagePlus,
  Layers3,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { useAuth } from "@/components/auth-provider";

type CreativeMode = "from_scratch" | "reference" | "exact_design";
type CreationStage = "idle" | "creating" | "uploading" | "identity" | "error";

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
  collection: string;
  seller: string;
  creativeMode: CreativeMode;
  brief: string;
};

const CARD = "rounded-[1.65rem] border border-white/10 bg-white/[0.035]";
const INPUT = "w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-violet-400/60 disabled:cursor-not-allowed disabled:opacity-50";
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_REFERENCES = 12;

const METHODS: Array<{
  value: CreativeMode;
  title: string;
  description: string;
}> = [
  {
    value: "from_scratch",
    title: "Desde cero",
    description: "Describí una idea y CLOUVA desarrolla la dirección visual.",
  },
  {
    value: "reference",
    title: "Referencia / inspiración",
    description: "Partí de imágenes, portadas, prendas o universos visuales.",
  },
  {
    value: "exact_design",
    title: "Diseño exacto",
    description: "Usá un diseño existente como base principal.",
  },
];

const PLACEHOLDERS: Record<CreativeMode, string> = {
  from_scratch: "Ej: Colección futurista del sur argentino, hielo, montaña, tecnología y rap.",
  reference: "Ej: Quiero convertir la estética de este EP en una colección premium negra y violeta, con remeras, hoodies y accesorios. Mantener el ADN visual de la portada.",
  exact_design: "Ej: Quiero aplicar exactamente este símbolo en una remera negra, hoodie y gorra.",
};

const REFERENCE_COPY: Record<CreativeMode, { eyebrow: string; title: string; description: string }> = {
  from_scratch: {
    eyebrow: "Referencia opcional",
    title: "¿Tenés algo que te inspire?",
    description: "Podés agregar una imagen opcionalmente. Si no, CLOUVA parte solamente de tu idea.",
  },
  reference: {
    eyebrow: "Referencia visual",
    title: "Subí una o varias referencias",
    description: "CLOUVA tomará dirección visual, colores, composición, texturas y lenguaje gráfico sin asumir que debe copiar literalmente la imagen.",
  },
  exact_design: {
    eyebrow: "Diseño principal",
    title: "Subí el diseño que querés respetar",
    description: "Usaremos este material como fuente principal del diseño y el flujo existente de identidad preservará su intención visual.",
  },
};

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

function displayMode(mode: CreativeMode) {
  if (mode === "from_scratch") return "Desde cero";
  if (mode === "exact_design") return "Diseño exacto";
  return "Referencia / inspiración";
}

export function MerchCreatorStart() {
  const router = useRouter();
  const { session, user, loading: authLoading } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [context, setContext] = useState<SellerContext | null>(null);
  const [projects, setProjects] = useState<CreatorProject[]>([]);
  const [projectDraft, setProjectDraft] = useState<ProjectDraft>({
    name: "",
    collection: "Drop 01",
    seller: "user",
    creativeMode: "from_scratch",
    brief: "",
  });
  const [pendingReferences, setPendingReferences] = useState<PendingReference[]>([]);
  const [previewReference, setPreviewReference] = useState<PendingReference | null>(null);
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

  const sellerOptions = useMemo(() => {
    const options = [{ value: "user", label: "Mi cuenta" }];
    for (const player of context?.players ?? []) options.push({ value: `player:${player.id}`, label: `Player · ${player.name}` });
    for (const studio of context?.studios ?? []) options.push({ value: `studio:${studio.id}`, label: `Studio · ${studio.name}` });
    for (const spot of context?.spots ?? []) options.push({ value: `spot:${spot.id}`, label: `Business / Spot · ${spot.name}` });
    return options;
  }, [context]);

  const referenceCopy = REFERENCE_COPY[projectDraft.creativeMode];
  const uploadedCount = pendingReferences.filter((item) => item.status === "uploaded").length;
  const pendingCount = pendingReferences.length - uploadedCount;

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
        next.push({
          id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
          file,
          preview: await fileToDataUrl(file),
          status: "pending",
        });
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
    setPreviewReference((current) => current?.id === id ? null : current);
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
          body: JSON.stringify({
            projectId: currentProject.id,
            kind: referenceKind(projectDraft.creativeMode, Math.max(0, index)),
            label: item.file.name,
            dataUrl: item.preview,
          }),
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

  function openProject(projectId: string) {
    router.push(`/crear/merch?project=${encodeURIComponent(projectId)}`);
  }

  async function createOrContinueProject() {
    if (!projectDraft.name.trim() && !createdProject) return setError("Poné un nombre al proyecto.");
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      let project = createdProject;
      if (!project) {
        setStage("creating");
        const [kind, id] = projectDraft.seller.split(":");
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
            collection_name: projectDraft.collection,
            category: "Merch",
            creative_mode: projectDraft.creativeMode,
            brief: projectDraft.brief,
          }),
        });
        project = payload.project as CreatorProject;
        setCreatedProject(project);
        setProjects((current) => [project!, ...current.filter((candidate) => candidate.id !== project!.id)]);
      }

      if (pendingReferences.some((item) => item.status !== "uploaded")) {
        setStage("uploading");
        project = await uploadReferences(project);
      }

      setStage("identity");
      setMessage("Proyecto y referencias listos. Abriendo Identidad…");
      openProject(project.id);
    } catch (cause) {
      setStage("error");
      const reason = cause instanceof Error ? cause.message : "No se pudo preparar el proyecto.";
      if (createdProject || stage !== "creating") {
        setError(`El proyecto quedó guardado, pero no se completó la preparación. ${reason} Podés reintentar sin crear otro proyecto.`);
      } else {
        setError(reason);
      }
    } finally {
      setBusy(false);
    }
  }

  const buttonLabel = stage === "creating"
    ? "Creando proyecto…"
    : stage === "uploading"
      ? "Subiendo referencias…"
      : stage === "identity"
        ? "Preparando identidad…"
        : createdProject
          ? "Reintentar referencias →"
          : "Crear mi drop →";

  if (!user && !authLoading) {
    return <main className="grid min-h-screen place-items-center bg-[#05030a] px-6 text-white"><Link href="/login?next=/crear/merch" className="rounded-full border border-violet-400/40 px-5 py-3">Iniciar sesión</Link></main>;
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_50%_-10%,rgba(124,58,237,.20),transparent_32%),radial-gradient(circle_at_92%_18%,rgba(37,99,235,.12),transparent_24%),#05030a] px-4 py-7 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link href="/crear" className="inline-flex items-center gap-2 text-xs text-white/45 hover:text-white"><ArrowLeft size={14} /> Crear</Link>
            <p className="mt-5 text-[10px] font-bold uppercase tracking-[.28em] text-violet-300">CLOUVA Commerce Creator</p>
            <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">Crear Merch</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-white/50">Tengo una idea o imagen → la subo → le explico qué quiero → CLOUVA crea el universo → elijo productos → genero → publico.</p>
          </div>
          <Link href="/market" className="rounded-full border border-white/10 bg-white/[.04] px-4 py-2 text-sm text-white/70">Market</Link>
        </header>

        {error ? <div className="mt-5 rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}
        {message ? <div className="mt-5 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">{message}</div> : null}

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.25fr_.75fr]">
          <section className={`${CARD} overflow-hidden`}>
            <div className="border-b border-white/8 bg-gradient-to-r from-violet-500/[.09] to-transparent p-5 sm:p-7">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-violet-500/15 text-violet-200"><Layers3 size={19} /></span>
                <div>
                  <h2 className="text-xl font-semibold">Crear tu drop</h2>
                  <p className="mt-1 text-xs text-white/45">Convertí una idea, identidad o referencia en una colección lista para vender.</p>
                </div>
              </div>
            </div>

            <div className="space-y-7 p-5 sm:p-7">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[.22em] text-violet-300">1 · Proyecto</p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="text-xs text-white/50">Nombre<input disabled={Boolean(createdProject)} className={`${INPUT} mt-2`} value={projectDraft.name} onChange={(event) => setProjectDraft({ ...projectDraft, name: event.target.value })} placeholder="Buenos Genes" /></label>
                  <label className="text-xs text-white/50">Drop / cápsula<input disabled={Boolean(createdProject)} className={`${INPUT} mt-2`} value={projectDraft.collection} onChange={(event) => setProjectDraft({ ...projectDraft, collection: event.target.value })} placeholder="Drop 01" /></label>
                  <label className="text-xs text-white/50 sm:col-span-2">Vendedor<select disabled={Boolean(createdProject)} className={`${INPUT} mt-2`} value={projectDraft.seller} onChange={(event) => setProjectDraft({ ...projectDraft, seller: event.target.value })}>{sellerOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                </div>
              </div>

              <div>
                <p className="text-[10px] font-bold uppercase tracking-[.22em] text-violet-300">2 · Cómo querés crearlo</p>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  {METHODS.map((method) => {
                    const selected = projectDraft.creativeMode === method.value;
                    return <button key={method.value} type="button" disabled={Boolean(createdProject)} onClick={() => setProjectDraft({ ...projectDraft, creativeMode: method.value })} className={`min-h-32 rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${selected ? "border-violet-400/55 bg-violet-500/12 shadow-[0_0_35px_rgba(124,58,237,.10)]" : "border-white/10 bg-black/20 hover:border-white/20"}`}>
                      <div className="flex items-start justify-between gap-3"><strong className="text-sm">{method.title}</strong>{selected ? <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-violet-500 text-white"><Check size={13} /></span> : null}</div>
                      <p className="mt-3 text-xs leading-5 text-white/40">{method.description}</p>
                    </button>;
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-white/75">¿Qué querés crear?
                  <textarea disabled={Boolean(createdProject)} className={`${INPUT} mt-2 min-h-32 resize-y`} value={projectDraft.brief} onChange={(event) => setProjectDraft({ ...projectDraft, brief: event.target.value })} placeholder={PLACEHOLDERS[projectDraft.creativeMode]} />
                </label>
              </div>

              <div className={`rounded-3xl border p-4 sm:p-5 ${projectDraft.creativeMode === "from_scratch" ? "border-white/10 bg-black/15" : projectDraft.creativeMode === "exact_design" ? "border-amber-300/20 bg-amber-300/[.035]" : "border-violet-400/25 bg-violet-500/[.055]"}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="max-w-2xl">
                    <p className={`text-[10px] font-bold uppercase tracking-[.2em] ${projectDraft.creativeMode === "exact_design" ? "text-amber-200" : "text-violet-300"}`}>{referenceCopy.eyebrow}</p>
                    <h3 className="mt-1 text-lg font-semibold">{referenceCopy.title}</h3>
                    <p className="mt-2 text-xs leading-5 text-white/45">{referenceCopy.description}</p>
                  </div>
                  {pendingReferences.length ? <span className="rounded-full border border-white/10 bg-black/25 px-3 py-1.5 text-[10px] text-white/50">{uploadedCount}/{pendingReferences.length} guardadas</span> : null}
                </div>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
                  onDragOver={(event: DragEvent<HTMLButtonElement>) => { event.preventDefault(); setDragging(true); }}
                  onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
                  onDrop={(event: DragEvent<HTMLButtonElement>) => {
                    event.preventDefault();
                    setDragging(false);
                    void addReferenceFiles(Array.from(event.dataTransfer.files));
                  }}
                  className={`mt-5 flex min-h-40 w-full flex-col items-center justify-center rounded-2xl border border-dashed px-5 py-7 text-center transition ${dragging ? "border-violet-300 bg-violet-500/10" : "border-white/15 bg-black/20 hover:border-violet-400/45 hover:bg-violet-500/[.035]"}`}
                >
                  <span className="grid h-12 w-12 place-items-center rounded-2xl bg-violet-500/12 text-violet-200"><UploadCloud size={22} /></span>
                  <strong className="mt-3 text-sm">Subí tu referencia</strong>
                  <span className="mt-1 text-xs text-white/40">Arrastrá imágenes acá o elegilas desde tu dispositivo</span>
                  <span className="mt-4 rounded-xl border border-violet-400/25 bg-violet-500/10 px-4 py-2 text-xs font-semibold text-violet-200">+ Elegir imágenes</span>
                </button>
                <input ref={fileInputRef} type="file" multiple accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => { void addReferenceFiles(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }} />

                <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] text-white/30">
                  {["Portada / EP", "Logo", "Diseño", "Prenda", "Producto", "Ilustración", "Textura", "Foto", "Moodboard"].map((label) => <span key={label} className="rounded-full border border-white/8 px-2 py-1">{label}</span>)}
                </div>

                {pendingReferences.length ? <div className="mt-5 flex gap-3 overflow-x-auto pb-2 sm:grid sm:grid-cols-3 sm:overflow-visible lg:grid-cols-4">
                  {pendingReferences.map((item) => <div key={item.id} className={`relative w-36 shrink-0 overflow-hidden rounded-2xl border bg-black/30 sm:w-auto ${item.status === "error" ? "border-rose-400/35" : item.status === "uploaded" ? "border-emerald-400/25" : "border-white/10"}`}>
                    <button type="button" onClick={() => setPreviewReference(item)} className="group relative block aspect-square w-full overflow-hidden bg-black/40">
                      <Image src={item.preview} alt={item.file.name} fill unoptimized sizes="160px" className="object-cover transition duration-300 group-hover:scale-[1.03]" />
                      <span className="absolute inset-0 grid place-items-center bg-black/0 opacity-0 transition group-hover:bg-black/45 group-hover:opacity-100"><Eye size={19} /></span>
                    </button>
                    <div className="p-2.5">
                      <p className="truncate text-[10px] text-white/65" title={item.file.name}>{item.file.name}</p>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className={`text-[9px] uppercase tracking-wide ${item.status === "uploaded" ? "text-emerald-300" : item.status === "error" ? "text-rose-300" : item.status === "uploading" ? "text-violet-300" : "text-white/30"}`}>{item.status === "uploaded" ? "Guardada" : item.status === "error" ? "Error" : item.status === "uploading" ? "Subiendo" : "Lista"}</span>
                        <button type="button" disabled={item.status === "uploaded" || item.status === "uploading"} onClick={() => removePendingReference(item.id)} className="rounded-lg p-1.5 text-white/35 hover:bg-white/5 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-20" aria-label={`Eliminar ${item.file.name}`}><Trash2 size={13} /></button>
                      </div>
                      {item.error ? <p className="mt-1 line-clamp-2 text-[9px] leading-4 text-rose-300/80">{item.error}</p> : null}
                    </div>
                  </div>)}
                </div> : null}
              </div>

              <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap text-[10px] font-bold uppercase tracking-[.12em] text-white/45">
                  {["Idea", "Identidad", "Productos", "Imágenes", "Publicación"].map((step, index, all) => <span key={step} className="flex items-center gap-2"><span className={index === 0 ? "text-violet-300" : ""}>{step}</span>{index < all.length - 1 ? <ChevronRight size={12} className="text-white/20" /> : null}</span>)}
                </div>
                <p className="mt-3 text-xs leading-5 text-white/35">Después de crear el proyecto vas a elegir los productos y CLOUVA mantendrá el mismo universo visual entre todos.</p>
              </div>

              {createdProject ? <div className="rounded-2xl border border-amber-300/15 bg-amber-300/[.045] p-4 text-xs leading-5 text-amber-100/75"><strong>El proyecto ya existe.</strong> Si una referencia falló, el botón de abajo reintenta solamente lo pendiente: no crea un proyecto duplicado. También podés abrir el proyecto y completar la identidad desde ahí.</div> : null}

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <button onClick={() => void createOrContinueProject()} disabled={busy || authLoading} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-violet-500 px-5 py-3 text-sm font-bold shadow-[0_12px_35px_rgba(124,58,237,.18)] transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:min-w-52">
                  {busy ? <Loader2 className="animate-spin" size={17} /> : <Sparkles size={16} />}{buttonLabel}
                </button>
                {createdProject && !busy ? <button type="button" onClick={() => openProject(createdProject.id)} className="min-h-12 rounded-xl border border-white/10 px-5 py-3 text-xs font-semibold text-white/60 hover:text-white">Abrir proyecto</button> : null}
                {pendingReferences.length ? <span className="text-[10px] text-white/30 sm:ml-2">{pendingCount ? `${pendingCount} referencia${pendingCount === 1 ? "" : "s"} pendiente${pendingCount === 1 ? "" : "s"}` : "Referencias listas"}</span> : null}
              </div>
            </div>
          </section>

          <section className={`${CARD} h-fit p-5 sm:p-7`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">Mis proyectos</h2>
                <p className="mt-1 text-xs text-white/40">Persistentes: cerrá CLOUVA y seguí después.</p>
              </div>
              <button onClick={() => void load()} disabled={busy} className="rounded-xl border border-white/10 p-2 text-white/50 hover:text-white disabled:opacity-40" aria-label="Actualizar proyectos"><RefreshCw size={16} /></button>
            </div>
            <div className="mt-5 space-y-3">
              {projects.length ? projects.map((project) => <button key={project.id} onClick={() => openProject(project.id)} className="w-full rounded-2xl border border-white/10 bg-black/25 p-4 text-left transition hover:border-violet-400/35 hover:bg-violet-500/[.035]">
                <div className="flex items-center justify-between gap-3"><strong className="min-w-0 truncate text-sm">{project.name}</strong><span className="shrink-0 text-[9px] uppercase tracking-wider text-violet-300">{project.status}</span></div>
                <p className="mt-2 text-xs text-white/40">{project.collection_name || "Sin nombre de drop"}</p>
                <div className="mt-3 flex items-center justify-between gap-3 text-[10px] text-white/30"><span>{displayMode(project.creative_mode)}</span><span>{project.reference_assets?.length || 0} ref.</span></div>
              </button>) : <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center"><ImagePlus className="mx-auto h-7 w-7 text-white/15" /><p className="mt-3 text-sm text-white/35">Todavía no hay proyectos.</p></div>}
            </div>
          </section>
        </div>
      </div>

      {previewReference ? <div className="fixed inset-0 z-[100] grid place-items-center bg-black/85 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`Vista previa de ${previewReference.file.name}`}>
        <button type="button" onClick={() => setPreviewReference(null)} className="absolute right-4 top-4 rounded-full border border-white/10 bg-black/60 p-2 text-white/70 hover:text-white" aria-label="Cerrar vista previa"><X size={20} /></button>
        <div className="w-full max-w-4xl overflow-hidden rounded-3xl border border-white/10 bg-[#09070f] shadow-2xl">
          <div className="relative aspect-[4/3] max-h-[75vh] w-full bg-black"><Image src={previewReference.preview} alt={previewReference.file.name} fill unoptimized sizes="90vw" className="object-contain" /></div>
          <div className="flex items-center justify-between gap-3 p-4"><p className="min-w-0 truncate text-sm text-white/70">{previewReference.file.name}</p><span className="shrink-0 text-[10px] text-white/30">{Math.max(0.01, previewReference.file.size / 1024 / 1024).toFixed(2)} MB</span></div>
        </div>
      </div> : null}
    </main>
  );
}
