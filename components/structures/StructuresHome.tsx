"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Loader2, MapPin, Plus, Sparkles, X } from "lucide-react";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type StructureProject = {
  id: string;
  name: string;
  slug: string;
  structure_type: string;
  description: string | null;
  location_name: string | null;
  status: string;
  image_count: number;
  updated_at: string;
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  uploading: "Subiendo",
  analyzing: "Analizando",
  spatializing: "Ubicando",
  review: "Revisar",
  ready: "Listo",
  rendering: "Renderizando",
  completed: "Completo",
};

export function StructuresHome() {
  const [projects, setProjects] = useState<StructureProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    structureType: "building",
    locationName: "",
    description: "",
    historicalNotes: "",
    reconstructionRules: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await authenticatedFetch("/api/structures");
      const payload = await readApiJson<{ projects: StructureProject[] }>(response);
      setProjects(payload.projects);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudieron cargar las estructuras.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const totalImages = useMemo(
    () => projects.reduce((sum, project) => sum + Number(project.image_count || 0), 0),
    [projects],
  );

  async function createProject() {
    if (!form.name.trim() || creating) return;
    setCreating(true);
    setMessage(null);
    try {
      const response = await authenticatedFetch("/api/structures", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          reconstructionRules: form.reconstructionRules
            .split("\n")
            .map((rule) => rule.trim())
            .filter(Boolean),
        }),
      });
      const payload = await readApiJson<{ structure: StructureProject }>(response);
      window.location.href = `/structures/${payload.structure.id}`;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo crear la estructura.");
      setCreating(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#05030a] px-4 pb-20 pt-10 text-white sm:px-6 lg:px-8">
      <section className="mx-auto w-full max-w-7xl">
        <header className="flex flex-col gap-6 border-b border-white/10 pb-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-violet-300">
              <Building2 className="h-4 w-4" />
              CLOUVA · Structures
            </div>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">Reconstruí lugares reales.</h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-white/55 sm:text-base">
              Fotos, capturas, cámaras, plano y reglas se convierten en una base espacial ordenada. Después CLOUVA Cloud usa esa evidencia para generar vistas coherentes del mismo lugar.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-black transition hover:bg-violet-100"
          >
            <Plus className="h-4 w-4" />
            Nueva estructura
          </button>
        </header>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
            <p className="text-xs uppercase tracking-[0.2em] text-white/35">Proyectos</p>
            <p className="mt-2 text-3xl font-semibold">{projects.length}</p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
            <p className="text-xs uppercase tracking-[0.2em] text-white/35">Evidencias</p>
            <p className="mt-2 text-3xl font-semibold">{totalImages}</p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-violet-500/10 to-transparent p-5">
            <p className="text-xs uppercase tracking-[0.2em] text-violet-300/70">Flujo</p>
            <p className="mt-2 text-sm font-medium text-white/80">Evidencia → Espacio → ZIP → CLOUD</p>
          </div>
        </div>

        {message ? (
          <div className="mt-6 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-100">
            {message}
          </div>
        ) : null}

        {loading ? (
          <div className="grid min-h-[280px] place-items-center">
            <Loader2 className="h-7 w-7 animate-spin text-violet-300" />
          </div>
        ) : projects.length ? (
          <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/structures/${project.id}`}
                className="group rounded-[1.8rem] border border-white/10 bg-white/[0.035] p-6 transition hover:-translate-y-0.5 hover:border-violet-400/35 hover:bg-violet-500/[0.055]"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-2xl border border-violet-400/20 bg-violet-500/10 text-violet-200">
                    <Building2 className="h-5 w-5" />
                  </span>
                  <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-white/45">
                    {STATUS_LABELS[project.status] ?? project.status}
                  </span>
                </div>
                <h2 className="mt-5 text-xl font-semibold">{project.name}</h2>
                {project.location_name ? (
                  <div className="mt-2 flex items-center gap-1.5 text-sm text-white/45">
                    <MapPin className="h-3.5 w-3.5" />
                    {project.location_name}
                  </div>
                ) : null}
                <p className="mt-4 line-clamp-2 min-h-10 text-sm leading-5 text-white/45">
                  {project.description || "Base espacial lista para recibir evidencia visual."}
                </p>
                <div className="mt-6 flex items-center justify-between border-t border-white/10 pt-4 text-xs">
                  <span className="text-white/40">{project.image_count} imágenes</span>
                  <span className="font-medium text-violet-300 transition group-hover:text-violet-200">Abrir →</span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="mt-8 grid min-h-[300px] w-full place-items-center rounded-[2rem] border border-dashed border-white/15 bg-white/[0.02] p-8 text-center transition hover:border-violet-400/40 hover:bg-violet-500/[0.04]"
          >
            <div>
              <Sparkles className="mx-auto h-7 w-7 text-violet-300" />
              <p className="mt-4 text-lg font-semibold">Creá la primera estructura</p>
              <p className="mt-2 text-sm text-white/45">Después podés subir fotos, capturas o un ZIP completo.</p>
            </div>
          </button>
        )}
      </section>

      {createOpen ? (
        <div className="fixed inset-0 z-[160] grid place-items-center bg-black/80 p-4 backdrop-blur-md" onMouseDown={() => setCreateOpen(false)}>
          <div
            className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-[2rem] border border-white/10 bg-[#0a0710] p-5 shadow-2xl shadow-violet-950/40 sm:p-7"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-violet-300">Nueva estructura</p>
                <h2 className="mt-2 text-2xl font-semibold">Crear base espacial</h2>
              </div>
              <button type="button" onClick={() => setCreateOpen(false)} className="rounded-full border border-white/10 p-2 text-white/50 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="sm:col-span-2">
                <span className="mb-2 block text-xs text-white/45">Nombre</span>
                <input
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Escuela 12"
                  className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 outline-none transition focus:border-violet-400/50"
                />
              </label>
              <label>
                <span className="mb-2 block text-xs text-white/45">Tipo</span>
                <select
                  value={form.structureType}
                  onChange={(event) => setForm((current) => ({ ...current, structureType: event.target.value }))}
                  className="w-full rounded-2xl border border-white/10 bg-[#0d0914] px-4 py-3 outline-none focus:border-violet-400/50"
                >
                  <option value="building">Edificio</option>
                  <option value="house">Casa</option>
                  <option value="school">Escuela</option>
                  <option value="studio">Estudio</option>
                  <option value="venue">Espacio / venue</option>
                  <option value="neighborhood">Sector urbano</option>
                </select>
              </label>
              <label>
                <span className="mb-2 block text-xs text-white/45">Ubicación</span>
                <input
                  value={form.locationName}
                  onChange={(event) => setForm((current) => ({ ...current, locationName: event.target.value }))}
                  placeholder="Zapala, Neuquén"
                  className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 outline-none focus:border-violet-400/50"
                />
              </label>
              <label className="sm:col-span-2">
                <span className="mb-2 block text-xs text-white/45">Descripción</span>
                <textarea
                  value={form.description}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                  rows={3}
                  placeholder="Qué lugar estamos reconstruyendo."
                  className="w-full resize-none rounded-2xl border border-white/10 bg-black/30 px-4 py-3 outline-none focus:border-violet-400/50"
                />
              </label>
              <label className="sm:col-span-2">
                <span className="mb-2 block text-xs text-white/45">Notas históricas</span>
                <textarea
                  value={form.historicalNotes}
                  onChange={(event) => setForm((current) => ({ ...current, historicalNotes: event.target.value }))}
                  rows={3}
                  placeholder="Época, cambios conocidos, contexto."
                  className="w-full resize-none rounded-2xl border border-white/10 bg-black/30 px-4 py-3 outline-none focus:border-violet-400/50"
                />
              </label>
              <label className="sm:col-span-2">
                <span className="mb-2 block text-xs text-white/45">Reglas de reconstrucción · una por línea</span>
                <textarea
                  value={form.reconstructionRules}
                  onChange={(event) => setForm((current) => ({ ...current, reconstructionRules: event.target.value }))}
                  rows={4}
                  placeholder={"No incluir las rejas blancas modernas.\nMantener las rejas amarillas correspondientes a la época."}
                  className="w-full resize-none rounded-2xl border border-white/10 bg-black/30 px-4 py-3 outline-none focus:border-violet-400/50"
                />
              </label>
            </div>

            <button
              type="button"
              onClick={() => void createProject()}
              disabled={creating || !form.name.trim()}
              className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-white font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40"
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Crear estructura
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
