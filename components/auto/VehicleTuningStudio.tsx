"use client";

import { Gauge, Lightbulb, Loader2, Palette, Plus, Rotate3D, Save, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { VehicleModelViewer } from "@/components/auto/VehicleModelViewer";
import {
  DEFAULT_VEHICLE_SHOW,
  DEFAULT_VEHICLE_TUNING,
  normalizeVehicleShow,
  normalizeVehicleTuning,
  type VehicleShowConfig,
  type VehicleTuningConfig,
} from "@/lib/auto/visual-config";

export type VehicleVisualBuild = {
  id: string;
  name: string;
  is_active: boolean;
  visibility: "private" | "public";
  tuning_config: Record<string, unknown>;
  show_config: Record<string, unknown>;
  audio_media_id: string | null;
  updated_at: string;
};

type SaveBuildInput = {
  buildId?: string | null;
  name: string;
  tuningConfig: VehicleTuningConfig;
  showConfig: VehicleShowConfig;
  audioMediaId?: string | null;
  activate?: boolean;
};

type Props = {
  vehicleName: string;
  modelUrl?: string | null;
  partMeshMap?: Record<string, unknown> | null;
  builds: VehicleVisualBuild[];
  saving: boolean;
  onSave: (input: SaveBuildInput) => Promise<void>;
};

function percent(value: number, min: number, max: number) {
  return Math.round(((value - min) / (max - min)) * 100);
}

export function VehicleTuningStudio({ vehicleName, modelUrl, partMeshMap, builds, saving, onSave }: Props) {
  const active = useMemo(() => builds.find((build) => build.is_active) ?? builds[0] ?? null, [builds]);
  const [selectedBuildId, setSelectedBuildId] = useState<string | null>(active?.id ?? null);
  const selectedBuild = useMemo(
    () => builds.find((build) => build.id === selectedBuildId) ?? active,
    [active, builds, selectedBuildId],
  );
  const [name, setName] = useState(selectedBuild?.name ?? "Street");
  const [tuning, setTuning] = useState<VehicleTuningConfig>(() => normalizeVehicleTuning(selectedBuild?.tuning_config));
  const [show, setShow] = useState<VehicleShowConfig>(() => normalizeVehicleShow(selectedBuild?.show_config));

  useEffect(() => {
    if (!builds.length) return;
    if (selectedBuildId && builds.some((build) => build.id === selectedBuildId)) return;
    setSelectedBuildId(active?.id ?? builds[0]?.id ?? null);
  }, [active?.id, builds, selectedBuildId]);

  useEffect(() => {
    if (!selectedBuild) return;
    setName(selectedBuild.name);
    setTuning(normalizeVehicleTuning(selectedBuild.tuning_config));
    setShow(normalizeVehicleShow(selectedBuild.show_config));
  }, [selectedBuild?.id, selectedBuild?.updated_at]);

  function chooseBuild(build: VehicleVisualBuild) {
    setSelectedBuildId(build.id);
    setName(build.name);
    setTuning(normalizeVehicleTuning(build.tuning_config));
    setShow(normalizeVehicleShow(build.show_config));
  }

  function newBuild() {
    setSelectedBuildId(null);
    setName(builds.length ? `Build ${builds.length + 1}` : "Street");
    setTuning(selectedBuild ? normalizeVehicleTuning(selectedBuild.tuning_config) : DEFAULT_VEHICLE_TUNING);
    setShow(selectedBuild ? normalizeVehicleShow(selectedBuild.show_config) : DEFAULT_VEHICLE_SHOW);
  }

  function applyPreset(preset: "street" | "low" | "show") {
    if (preset === "street") {
      setTuning((current) => ({ ...current, rideHeight: -0.06, wheelScale: 1.03, neonEnabled: false, autoRotate: false }));
      return;
    }
    if (preset === "low") {
      setTuning((current) => ({ ...current, rideHeight: -0.23, wheelScale: 1.12, neonEnabled: true, neonIntensity: 1.15 }));
      return;
    }
    setTuning((current) => ({ ...current, rideHeight: -0.12, wheelScale: 1.08, neonEnabled: true, neonIntensity: 1.9, autoRotate: true }));
  }

  async function save() {
    await onSave({
      buildId: selectedBuildId,
      name: name.trim() || "Build",
      tuningConfig: tuning,
      showConfig: show,
      audioMediaId: selectedBuild?.audio_media_id ?? null,
      activate: true,
    });
  }

  return (
    <section className="mt-3">
      <div className="rounded-[28px] border border-violet-300/15 bg-[radial-gradient(circle_at_82%_0%,rgba(113,78,255,.19),transparent_38%),#0b0912] p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 text-violet-200">
              <Palette size={17} />
              <span className="text-[10px] font-semibold uppercase tracking-[.17em]">Tuning Lab</span>
            </div>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">{vehicleName}</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-white/42">
              Armá versiones reales del auto y guardalas como builds. El mismo build alimenta el modo Show.
            </p>
          </div>
          <button type="button" onClick={newBuild} className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs">
            <Plus size={14} /> Nuevo
          </button>
        </div>

        {builds.length ? (
          <div className="mt-5 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
            {builds.map((build) => (
              <button
                key={build.id}
                type="button"
                onClick={() => chooseBuild(build)}
                className={`shrink-0 rounded-full border px-3 py-2 text-xs transition ${selectedBuildId === build.id ? "border-violet-300/35 bg-violet-400/15 text-violet-100" : "border-white/[0.08] bg-white/[0.03] text-white/42"}`}
              >
                {build.name}{build.is_active ? " · ACTIVO" : ""}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="relative mt-4 h-[42dvh] min-h-[340px] max-h-[590px] overflow-hidden rounded-[30px] border border-white/[0.08] bg-[#08070c]">
        <VehicleModelViewer modelUrl={modelUrl} partMeshMap={partMeshMap} tuningConfig={tuning} showConfig={show} />
        <div className="pointer-events-none absolute left-4 top-4 rounded-2xl border border-white/10 bg-black/55 px-3 py-2 backdrop-blur-md">
          <p className="text-[9px] uppercase tracking-[.16em] text-white/35">Build preview</p>
          <p className="mt-0.5 text-xs font-semibold">{name || "Build"}</p>
        </div>
        <div className="pointer-events-none absolute bottom-4 left-4 rounded-2xl border border-white/10 bg-black/55 px-3 py-2 backdrop-blur-md">
          <p className="text-[9px] uppercase tracking-[.16em] text-white/35">Altura / rueda</p>
          <p className="mt-0.5 text-xs font-semibold">{percent(tuning.rideHeight, -0.3, 0.35)}% · {Math.round(tuning.wheelScale * 100)}%</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <article className="rounded-[26px] border border-white/[0.07] bg-[#0b0912] p-4">
          <div className="flex items-center gap-2"><Palette size={15} className="text-violet-300" /><p className="text-xs font-semibold">Look exterior</p></div>
          <label className="mt-4 flex items-center justify-between gap-4 rounded-2xl border border-white/[0.07] bg-black/20 p-3">
            <span><span className="block text-xs font-medium">Color carrocería</span><span className="mt-1 block text-[10px] uppercase tracking-[.12em] text-white/30">{tuning.bodyColor}</span></span>
            <input type="color" value={tuning.bodyColor} onChange={(event) => setTuning((current) => ({ ...current, bodyColor: event.target.value }))} className="h-10 w-14 cursor-pointer rounded-lg border-0 bg-transparent" />
          </label>

          <label className="mt-3 block">
            <span className="flex items-center justify-between text-[11px] text-white/48"><span>Altura</span><strong className="text-white/75">{Math.round(tuning.rideHeight * 100)} cm visual</strong></span>
            <input type="range" min={-0.3} max={0.35} step={0.01} value={tuning.rideHeight} onChange={(event) => setTuning((current) => ({ ...current, rideHeight: Number(event.target.value) }))} className="mt-2 w-full accent-violet-400" />
          </label>

          <label className="mt-3 block">
            <span className="flex items-center justify-between text-[11px] text-white/48"><span>Tamaño de rueda</span><strong className="text-white/75">{Math.round(tuning.wheelScale * 100)}%</strong></span>
            <input type="range" min={0.78} max={1.35} step={0.01} value={tuning.wheelScale} onChange={(event) => setTuning((current) => ({ ...current, wheelScale: Number(event.target.value) }))} className="mt-2 w-full accent-violet-400" />
          </label>

          <label className="mt-3 block">
            <span className="flex items-center justify-between text-[11px] text-white/48"><span>Polarizado</span><strong className="text-white/75">{Math.round(tuning.windowTint * 100)}%</strong></span>
            <input type="range" min={0} max={0.92} step={0.01} value={tuning.windowTint} onChange={(event) => setTuning((current) => ({ ...current, windowTint: Number(event.target.value) }))} className="mt-2 w-full accent-violet-400" />
          </label>
        </article>

        <article className="rounded-[26px] border border-white/[0.07] bg-[#0b0912] p-4">
          <div className="flex items-center gap-2"><Sparkles size={15} className="text-violet-300" /><p className="text-xs font-semibold">Luces y presencia</p></div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setTuning((current) => ({ ...current, headlights: !current.headlights }))} className={`rounded-2xl border p-3 text-left ${tuning.headlights ? "border-violet-300/30 bg-violet-400/10" : "border-white/[0.07] bg-black/20"}`}>
              <Lightbulb size={16} className={tuning.headlights ? "text-violet-200" : "text-white/28"} />
              <span className="mt-2 block text-xs font-medium">Ópticas</span><span className="mt-1 block text-[10px] text-white/32">{tuning.headlights ? "Encendidas" : "Apagadas"}</span>
            </button>
            <button type="button" onClick={() => setTuning((current) => ({ ...current, neonEnabled: !current.neonEnabled }))} className={`rounded-2xl border p-3 text-left ${tuning.neonEnabled ? "border-violet-300/30 bg-violet-400/10" : "border-white/[0.07] bg-black/20"}`}>
              <Sparkles size={16} className={tuning.neonEnabled ? "text-violet-200" : "text-white/28"} />
              <span className="mt-2 block text-xs font-medium">Underglow</span><span className="mt-1 block text-[10px] text-white/32">{tuning.neonEnabled ? "Activo" : "Apagado"}</span>
            </button>
          </div>

          <label className="mt-3 flex items-center justify-between gap-4 rounded-2xl border border-white/[0.07] bg-black/20 p-3">
            <span><span className="block text-xs font-medium">Color neon</span><span className="mt-1 block text-[10px] uppercase tracking-[.12em] text-white/30">{tuning.neonColor}</span></span>
            <input type="color" value={tuning.neonColor} onChange={(event) => setTuning((current) => ({ ...current, neonColor: event.target.value }))} className="h-10 w-14 cursor-pointer rounded-lg border-0 bg-transparent" />
          </label>

          <label className="mt-3 block">
            <span className="flex items-center justify-between text-[11px] text-white/48"><span>Intensidad neon</span><strong className="text-white/75">{Math.round(tuning.neonIntensity * 100)}%</strong></span>
            <input type="range" min={0} max={3} step={0.05} value={tuning.neonIntensity} onChange={(event) => setTuning((current) => ({ ...current, neonIntensity: Number(event.target.value) }))} className="mt-2 w-full accent-violet-400" />
          </label>

          <button type="button" onClick={() => setTuning((current) => ({ ...current, autoRotate: !current.autoRotate }))} className={`mt-3 inline-flex w-full items-center justify-between rounded-2xl border px-3 py-3 text-xs ${tuning.autoRotate ? "border-violet-300/25 bg-violet-400/10 text-violet-100" : "border-white/[0.07] bg-black/20 text-white/50"}`}>
            <span className="inline-flex items-center gap-2"><Rotate3D size={15} /> Rotación automática</span><strong>{tuning.autoRotate ? "ON" : "OFF"}</strong>
          </button>
        </article>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <button type="button" onClick={() => applyPreset("street")} className="rounded-2xl border border-white/[0.07] bg-[#0b0912] px-3 py-3 text-xs"><Gauge size={14} className="mx-auto mb-1.5 text-white/45" /> Street</button>
        <button type="button" onClick={() => applyPreset("low")} className="rounded-2xl border border-white/[0.07] bg-[#0b0912] px-3 py-3 text-xs"><Sparkles size={14} className="mx-auto mb-1.5 text-white/45" /> Low</button>
        <button type="button" onClick={() => applyPreset("show")} className="rounded-2xl border border-white/[0.07] bg-[#0b0912] px-3 py-3 text-xs"><Rotate3D size={14} className="mx-auto mb-1.5 text-white/45" /> Show</button>
      </div>

      <div className="mt-4 rounded-[24px] border border-white/[0.07] bg-[#0b0912] p-4">
        <label className="text-[10px] uppercase tracking-[.14em] text-white/35">Nombre del build</label>
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="Ej. Dani Night Build" className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-sm outline-none focus:border-violet-300/35" />
        <button type="button" disabled={saving} onClick={() => void save()} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-500 px-5 py-3.5 font-semibold disabled:opacity-50">
          {saving ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />} Guardar y usar este build
        </button>
      </div>
    </section>
  );
}
