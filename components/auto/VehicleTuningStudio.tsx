"use client";

import { Gauge, Lightbulb, Loader2, Palette, Plus, Rotate3D, Save, Sparkles, Upload } from "lucide-react";
import { type ChangeEvent, useEffect, useMemo, useState } from "react";
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
  vehicleId: string;
  vehicleName: string;
  modelUrl?: string | null;
  partMeshMap?: Record<string, unknown> | null;
  builds: VehicleVisualBuild[];
  saving: boolean;
  uploadingDecal: boolean;
  onUploadDecal: (file: File) => Promise<{ id: string }>;
  onSave: (input: SaveBuildInput) => Promise<void>;
};

function percent(value: number, min: number, max: number) {
  return Math.round(((value - min) / (max - min)) * 100);
}

const NFS_VINYLS: Array<{ value: VehicleTuningConfig["decalPreset"]; label: string; image: string }> = [
  { value: "nfs_audiobahn", label: "AudioBahn", image: "/models/vehicles/fiat-uno-vinyls/audiobahn.png" },
  { value: "nfs_scorpion", label: "Scorpion", image: "/models/vehicles/fiat-uno-vinyls/scorpion.png" },
  { value: "nfs_japanrobo", label: "Japan Robo", image: "/models/vehicles/fiat-uno-vinyls/japanrobo.png" },
  { value: "nfs_lightning45", label: "Lightning", image: "/models/vehicles/fiat-uno-vinyls/lightning45.png" },
  { value: "nfs_wild59", label: "Wild 059", image: "/models/vehicles/fiat-uno-vinyls/wild59.png" },
];

export function VehicleTuningStudio({
  vehicleId,
  vehicleName,
  modelUrl,
  partMeshMap,
  builds,
  saving,
  uploadingDecal,
  onUploadDecal,
  onSave,
}: Props) {
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

  async function uploadCustomDecal(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const uploaded = await onUploadDecal(file);
      setTuning((current) => ({
        ...current,
        decalPreset: "custom",
        customDecalMediaId: uploaded.id,
      }));
      event.target.value = "";
    } catch {
      // The parent surface already exposes the upload error.
    }
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
              <span className="text-[10px] font-semibold uppercase tracking-[.17em]">BAJOCERO-Z · CUSTOM SHOP</span>
            </div>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">{vehicleName}</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-white/42">
              Personalizá EL UNITO con piezas reales del addon NFS, vinyls, pegatinas propias, altura, ruedas, luces y show.
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
        <VehicleModelViewer vehicleId={vehicleId} modelUrl={modelUrl} partMeshMap={partMeshMap} tuningConfig={tuning} showConfig={show} />
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

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <article className="rounded-[26px] border border-violet-300/15 bg-[linear-gradient(145deg,rgba(105,66,255,.12),rgba(8,7,13,.96))] p-4">
          <div className="flex items-center justify-between gap-3">
            <div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-violet-200">Piezas NFS</p><p className="mt-1 text-xs text-white/42">Partes reales rescatadas del addon del Uno.</p></div>
            <span className="rounded-full border border-violet-300/20 bg-violet-400/10 px-2.5 py-1 text-[9px] font-semibold text-violet-100">121 MESHES</span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <label className="rounded-2xl border border-white/[0.07] bg-black/25 p-3 text-[11px] text-white/45">
              Body kit
              <select value={tuning.bodyKit} onChange={(event) => setTuning((current) => ({ ...current, bodyKit: Number(event.target.value) }))} className="mt-2 w-full rounded-xl border border-white/10 bg-[#0b0912] px-3 py-2.5 text-xs text-white outline-none">
                <option value={0}>Stock</option><option value={1}>Kit 01</option>
              </select>
            </label>
            <label className="rounded-2xl border border-white/[0.07] bg-black/25 p-3 text-[11px] text-white/45">
              Widebody
              <select value={tuning.widebody} onChange={(event) => setTuning((current) => ({ ...current, widebody: Number(event.target.value) }))} className="mt-2 w-full rounded-xl border border-white/10 bg-[#0b0912] px-3 py-2.5 text-xs text-white outline-none">
                <option value={0}>Sin widebody</option><option value={1}>Wide 01</option><option value={2}>Wide 02</option><option value={3}>Wide 03</option>
              </select>
            </label>
            <label className="rounded-2xl border border-white/[0.07] bg-black/25 p-3 text-[11px] text-white/45">
              Capot
              <select value={tuning.hoodStyle} onChange={(event) => setTuning((current) => ({ ...current, hoodStyle: Number(event.target.value) }))} className="mt-2 w-full rounded-xl border border-white/10 bg-[#0b0912] px-3 py-2.5 text-xs text-white outline-none">
                {Array.from({ length: 11 }, (_, index) => <option key={index} value={index}>{index === 0 ? "Stock" : "Style " + String(index).padStart(2, "0")}</option>)}
              </select>
            </label>
            <label className="rounded-2xl border border-white/[0.07] bg-black/25 p-3 text-[11px] text-white/45">
              Spoiler
              <select value={tuning.spoilerStyle} onChange={(event) => setTuning((current) => ({ ...current, spoilerStyle: Number(event.target.value) }))} className="mt-2 w-full rounded-xl border border-white/10 bg-[#0b0912] px-3 py-2.5 text-xs text-white outline-none">
                <option value={0}>Sin spoiler</option>
                {Array.from({ length: 40 }, (_, index) => <option key={index + 1} value={index + 1}>{"Style " + String(index + 1).padStart(2, "0")}</option>)}
              </select>
            </label>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setTuning((current) => ({ ...current, hoodCarbon: !current.hoodCarbon }))} className={"rounded-2xl border px-3 py-3 text-xs " + (tuning.hoodCarbon ? "border-violet-300/30 bg-violet-400/10 text-violet-100" : "border-white/[0.07] bg-black/20 text-white/45")}>Capot carbono · {tuning.hoodCarbon ? "ON" : "OFF"}</button>
            <button type="button" onClick={() => setTuning((current) => ({ ...current, spoilerCarbon: !current.spoilerCarbon }))} className={"rounded-2xl border px-3 py-3 text-xs " + (tuning.spoilerCarbon ? "border-violet-300/30 bg-violet-400/10 text-violet-100" : "border-white/[0.07] bg-black/20 text-white/45")}>Spoiler carbono · {tuning.spoilerCarbon ? "ON" : "OFF"}</button>
          </div>
          <button type="button" onClick={() => setTuning((current) => ({ ...current, audioTrunkOpen: !current.audioTrunkOpen }))} className={"mt-2 flex w-full items-center justify-between rounded-2xl border px-3 py-3 text-xs " + (tuning.audioTrunkOpen ? "border-violet-300/35 bg-violet-400/12 text-violet-100" : "border-white/[0.07] bg-black/20 text-white/50")}>
            <span>Baúl LOCODANISONIDO · doble sub</span><strong>{tuning.audioTrunkOpen ? "ABIERTO" : "CERRADO"}</strong>
          </button>
        </article>

        <article className="rounded-[26px] border border-violet-300/15 bg-[radial-gradient(circle_at_100%_0%,rgba(139,92,255,.18),transparent_42%),#0b0912] p-4">
          <div className="flex items-center gap-2"><Sparkles size={15} className="text-violet-300" /><div><p className="text-xs font-semibold">Pegatinas / Vinyls</p><p className="mt-1 text-[10px] uppercase tracking-[.13em] text-white/30">BAJOCERO-Z · EL UNITO · LOCODANISONIDO</p></div></div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {[
              ["bajoceroz", "BAJOCERO-Z"],
              ["elunito", "EL UNITO"],
              ["locodanisonido", "LOCODANISONIDO"],
              ["none", "Sin pegatina"],
            ].map(([value, label]) => (
              <button key={value} type="button" onClick={() => setTuning((current) => ({ ...current, decalPreset: value as VehicleTuningConfig["decalPreset"] }))} className={"rounded-2xl border p-3 text-left text-xs font-semibold " + (tuning.decalPreset === value ? "border-violet-300/35 bg-violet-400/12 text-violet-100" : "border-white/[0.07] bg-black/20 text-white/48")}>{label}</button>
            ))}
          </div>

          <p className="mt-4 text-[9px] font-semibold uppercase tracking-[.16em] text-white/30">Vinyls rescatados de NFS Underground 2</p>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
            {NFS_VINYLS.map((vinyl) => (
              <button
                key={vinyl.value}
                type="button"
                onClick={() => setTuning((current) => ({ ...current, decalPreset: vinyl.value }))}
                className={"relative h-20 w-28 shrink-0 overflow-hidden rounded-2xl border text-left " + (tuning.decalPreset === vinyl.value ? "border-violet-300/45 ring-1 ring-violet-300/20" : "border-white/[0.08]")}
              >
                <img src={vinyl.image} alt="" className="absolute inset-0 h-full w-full object-cover opacity-75" />
                <span className="absolute inset-0 bg-gradient-to-t from-black via-black/15 to-transparent" />
                <span className="absolute bottom-2 left-2 right-2 text-[10px] font-semibold text-white">{vinyl.label}</span>
              </button>
            ))}
          </div>

          <label className={"mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed px-3 py-3 text-xs " + (tuning.decalPreset === "custom" ? "border-violet-300/35 bg-violet-400/10 text-violet-100" : "border-white/10 bg-black/20 text-white/55")}>
            {uploadingDecal ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
            {uploadingDecal ? "Subiendo pegatina…" : "Subir PNG / JPG propio"}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={uploadingDecal} onChange={(event) => void uploadCustomDecal(event)} />
          </label>

          <label className="mt-4 block">
            <span className="flex items-center justify-between text-[11px] text-white/48"><span>Tamaño pegatina</span><strong className="text-white/75">{Math.round(tuning.decalScale * 100)}%</strong></span>
            <input type="range" min={0.45} max={2.2} step={0.05} value={tuning.decalScale} onChange={(event) => setTuning((current) => ({ ...current, decalScale: Number(event.target.value) }))} className="mt-2 w-full accent-violet-400" />
          </label>
          <label className="mt-3 block">
            <span className="flex items-center justify-between text-[11px] text-white/48"><span>Mover adelante / atrás</span><strong className="text-white/75">{tuning.decalOffsetZ.toFixed(2)}</strong></span>
            <input type="range" min={-0.8} max={0.8} step={0.02} value={tuning.decalOffsetZ} onChange={(event) => setTuning((current) => ({ ...current, decalOffsetZ: Number(event.target.value) }))} className="mt-2 w-full accent-violet-400" />
          </label>
          <label className="mt-3 block">
            <span className="flex items-center justify-between text-[11px] text-white/48"><span>Mover arriba / abajo</span><strong className="text-white/75">{tuning.decalOffsetY.toFixed(2)}</strong></span>
            <input type="range" min={-0.45} max={0.45} step={0.02} value={tuning.decalOffsetY} onChange={(event) => setTuning((current) => ({ ...current, decalOffsetY: Number(event.target.value) }))} className="mt-2 w-full accent-violet-400" />
          </label>
        </article>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <button type="button" onClick={() => applyPreset("street")} className="rounded-2xl border border-white/[0.07] bg-[#0b0912] px-3 py-3 text-xs"><Gauge size={14} className="mx-auto mb-1.5 text-white/45" /> Street</button>
        <button type="button" onClick={() => applyPreset("low")} className="rounded-2xl border border-white/[0.07] bg-[#0b0912] px-3 py-3 text-xs"><Sparkles size={14} className="mx-auto mb-1.5 text-white/45" /> Low</button>
        <button type="button" onClick={() => applyPreset("show")} className="rounded-2xl border border-white/[0.07] bg-[#0b0912] px-3 py-3 text-xs"><Rotate3D size={14} className="mx-auto mb-1.5 text-white/45" /> Show</button>
      </div>

      <div className="mt-4 rounded-[24px] border border-white/[0.07] bg-[#0b0912] p-4">
        <label className="text-[10px] uppercase tracking-[.14em] text-white/35">Nombre del build</label>
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="Ej. EL UNITO · Night Build" className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-sm outline-none focus:border-violet-300/35" />
        <button type="button" disabled={saving} onClick={() => void save()} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-500 px-5 py-3.5 font-semibold disabled:opacity-50">
          {saving ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />} Guardar y usar este build
        </button>
      </div>
    </section>
  );
}
