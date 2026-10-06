"use client";

import {
  CarFront,
  Disc3,
  Gauge,
  Lightbulb,
  Loader2,
  Paintbrush,
  Plus,
  Rotate3D,
  Save,
  Sparkles,
  Sticker,
  Upload,
  Volume2,
} from "lucide-react";
import { type ChangeEvent, type ReactNode, useEffect, useMemo, useState } from "react";
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

type Category = "body" | "wheels" | "paint" | "vinyls" | "audio" | "lights";

const CATEGORY_ITEMS: Array<{ key: Category; label: string; icon: ReactNode }> = [
  { key: "body", label: "Carrocería", icon: <CarFront size={18} /> },
  { key: "wheels", label: "Llantas", icon: <Disc3 size={18} /> },
  { key: "paint", label: "Pintura", icon: <Paintbrush size={18} /> },
  { key: "vinyls", label: "Vinyls", icon: <Sticker size={18} /> },
  { key: "audio", label: "Audio", icon: <Volume2 size={18} /> },
  { key: "lights", label: "Luces", icon: <Lightbulb size={18} /> },
];

const WHEELS: Array<{ value: VehicleTuningConfig["wheelStyle"]; label: string }> = [
  { value: "bbs", label: "BBS" },
  { value: "enkei", label: "ENKEI" },
  { value: "momo", label: "MOMO" },
  { value: "oz", label: "OZ" },
  { value: "rays", label: "RAYS" },
  { value: "volk", label: "VOLK" },
];

const NFS_VINYLS: Array<{ value: VehicleTuningConfig["decalPreset"]; label: string; image: string }> = [
  { value: "nfs_audiobahn", label: "AudioBahn", image: "/models/vehicles/fiat-uno-vinyls/audiobahn.png" },
  { value: "nfs_scorpion", label: "Scorpion", image: "/models/vehicles/fiat-uno-vinyls/scorpion.png" },
  { value: "nfs_japanrobo", label: "Japan Robo", image: "/models/vehicles/fiat-uno-vinyls/japanrobo.png" },
  { value: "nfs_lightning45", label: "Lightning", image: "/models/vehicles/fiat-uno-vinyls/lightning45.png" },
  { value: "nfs_wild59", label: "Wild 059", image: "/models/vehicles/fiat-uno-vinyls/wild59.png" },
];

const PAINTS = ["#00d8e8", "#6d4aff", "#e8e8e3", "#17171a", "#ff3b30", "#d1ff52", "#ff9f0a", "#3f83ff"];

const deck =
  "rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(184,184,177,.16),rgba(16,16,14,.93)_22%,rgba(7,8,6,.98))] shadow-[0_18px_70px_rgba(0,0,0,.38)] backdrop-blur-xl";
const optionBase =
  "shrink-0 rounded-xl border px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[.08em] transition";

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
  const [name, setName] = useState(selectedBuild?.name ?? "BAJOCERO-Z · EL UNITO");
  const [tuning, setTuning] = useState<VehicleTuningConfig>(() => normalizeVehicleTuning(selectedBuild?.tuning_config));
  const [show, setShow] = useState<VehicleShowConfig>(() => normalizeVehicleShow(selectedBuild?.show_config));
  const [category, setCategory] = useState<Category>("body");

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
    setName(`BAJOCERO-Z · BUILD ${builds.length + 1}`);
    setTuning(selectedBuild ? normalizeVehicleTuning(selectedBuild.tuning_config) : DEFAULT_VEHICLE_TUNING);
    setShow(selectedBuild ? normalizeVehicleShow(selectedBuild.show_config) : DEFAULT_VEHICLE_SHOW);
  }

  function applyPreset(preset: "street" | "low" | "show") {
    if (preset === "street") {
      setTuning((current) => ({
        ...current,
        rideHeight: -0.04,
        wheelScale: 1,
        wheelStyle: "bbs",
        neonEnabled: false,
        autoRotate: false,
      }));
      return;
    }
    if (preset === "low") {
      setTuning((current) => ({
        ...current,
        rideHeight: -0.18,
        wheelScale: 1.08,
        wheelStyle: "volk",
        neonEnabled: true,
        neonIntensity: 1.25,
      }));
      return;
    }
    setTuning((current) => ({
      ...current,
      rideHeight: -0.1,
      wheelScale: 1.04,
      wheelStyle: "rays",
      neonEnabled: true,
      neonIntensity: 1.9,
      autoRotate: true,
    }));
  }

  async function uploadCustomDecal(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const uploaded = await onUploadDecal(file);
      setTuning((current) => ({ ...current, decalPreset: "custom", customDecalMediaId: uploaded.id }));
      event.target.value = "";
    } catch {
      // Parent surface already exposes the upload error.
    }
  }

  async function save() {
    await onSave({
      buildId: selectedBuildId,
      name: name.trim() || "BAJOCERO-Z · EL UNITO",
      tuningConfig: tuning,
      showConfig: show,
      audioMediaId: selectedBuild?.audio_media_id ?? null,
      activate: true,
    });
  }

  const activeLabel = CATEGORY_ITEMS.find((item) => item.key === category)?.label ?? "Tuning";

  return (
    <section className="mt-3 space-y-3">
      <div className={`${deck} overflow-hidden`}>
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-4">
          <div>
            <p className="text-[10px] font-black uppercase italic tracking-[.18em] text-[#cfff5d]">
              BAJOCERO-Z // UNDERGROUND CUSTOMS
            </p>
            <h2 className="mt-1 text-3xl font-black italic tracking-[-.05em] text-white">{vehicleName}</h2>
            <p className="mt-1 text-[11px] uppercase tracking-[.12em] text-white/35">
              EL UNITO · NFSU2 PARTS · LOCODANISONIDO
            </p>
          </div>
          <button
            type="button"
            onClick={newBuild}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.06] px-3 py-2 text-xs font-semibold"
          >
            <Plus size={14} /> Nuevo
          </button>
        </div>

        {builds.length ? (
          <div className="flex gap-2 overflow-x-auto px-4 py-3 [scrollbar-width:none]">
            {builds.map((build) => (
              <button
                key={build.id}
                type="button"
                onClick={() => chooseBuild(build)}
                className={`${optionBase} ${
                  selectedBuildId === build.id
                    ? "border-[#d1ff52]/55 bg-[#d1ff52]/15 text-[#e3ff9b]"
                    : "border-white/10 bg-black/25 text-white/45"
                }`}
              >
                {build.name}{build.is_active ? " · ACTIVO" : ""}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="relative h-[54dvh] min-h-[420px] max-h-[720px] overflow-hidden rounded-[28px] border border-white/10 bg-[#11120e] shadow-[0_24px_80px_rgba(0,0,0,.45)]">
        <VehicleModelViewer
          vehicleId={vehicleId}
          modelUrl={modelUrl}
          partMeshMap={partMeshMap}
          tuningConfig={tuning}
          showConfig={show}
        />

        <div className="absolute left-3 right-3 top-3 flex gap-1.5 overflow-x-auto rounded-2xl border border-white/15 bg-[linear-gradient(180deg,rgba(210,210,204,.38),rgba(67,68,62,.55))] p-1.5 shadow-xl backdrop-blur-xl [scrollbar-width:none]">
          {CATEGORY_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setCategory(item.key)}
              className={`flex min-w-[72px] flex-1 flex-col items-center gap-1 rounded-xl px-2 py-2 text-[9px] font-black uppercase italic tracking-[.08em] transition ${
                category === item.key ? "bg-black/45 text-[#d1ff52] shadow-inner" : "text-white/70"
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        <div className="pointer-events-none absolute bottom-4 left-4 rounded-xl border border-white/15 bg-black/55 px-3 py-2 backdrop-blur-md">
          <p className="text-[9px] font-black uppercase italic tracking-[.17em] text-[#cfff5d]">{activeLabel}</p>
          <p className="mt-0.5 text-xs font-semibold text-white">{name || "BAJOCERO-Z · EL UNITO"}</p>
        </div>
        <div className="pointer-events-none absolute bottom-4 right-4 rounded-xl border border-white/15 bg-black/55 px-3 py-2 text-right backdrop-blur-md">
          <p className="text-[9px] uppercase tracking-[.15em] text-white/35">Setup</p>
          <p className="mt-0.5 text-xs font-bold text-white">
            {tuning.wheelStyle.toUpperCase()} · {Math.round(tuning.wheelScale * 100)}%
          </p>
        </div>
      </div>

      <div className={`${deck} p-4`}>
        {category === "body" ? (
          <div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase italic tracking-[.16em] text-[#cfff5d]">Visual / Body</p>
                <p className="mt-1 text-xs text-white/35">121 meshes del addon del Fiat Uno.</p>
              </div>
              <span className="rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[9px] font-semibold text-white/50">
                NFSU2 DATA
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <label className="rounded-xl border border-white/10 bg-black/30 p-3 text-[10px] uppercase tracking-[.12em] text-white/45">
                Body kit
                <select
                  value={tuning.bodyKit}
                  onChange={(event) => setTuning((current) => ({ ...current, bodyKit: Number(event.target.value) }))}
                  className="mt-2 w-full rounded-lg border border-white/10 bg-[#11120e] px-2 py-2 text-xs font-semibold text-white outline-none"
                >
                  <option value={0}>Stock</option>
                  <option value={1}>Kit 01</option>
                </select>
              </label>
              <label className="rounded-xl border border-white/10 bg-black/30 p-3 text-[10px] uppercase tracking-[.12em] text-white/45">
                Widebody
                <select
                  value={tuning.widebody}
                  onChange={(event) => setTuning((current) => ({ ...current, widebody: Number(event.target.value) }))}
                  className="mt-2 w-full rounded-lg border border-white/10 bg-[#11120e] px-2 py-2 text-xs font-semibold text-white outline-none"
                >
                  <option value={0}>Off</option>
                  <option value={1}>Wide 01</option>
                  <option value={2}>Wide 02</option>
                  <option value={3}>Wide 03</option>
                </select>
              </label>
              <label className="rounded-xl border border-white/10 bg-black/30 p-3 text-[10px] uppercase tracking-[.12em] text-white/45">
                Capot
                <select
                  value={tuning.hoodStyle}
                  onChange={(event) => setTuning((current) => ({ ...current, hoodStyle: Number(event.target.value) }))}
                  className="mt-2 w-full rounded-lg border border-white/10 bg-[#11120e] px-2 py-2 text-xs font-semibold text-white outline-none"
                >
                  {Array.from({ length: 11 }, (_, index) => (
                    <option key={index} value={index}>{index === 0 ? "Stock" : `Style ${String(index).padStart(2, "0")}`}</option>
                  ))}
                </select>
              </label>
              <label className="rounded-xl border border-white/10 bg-black/30 p-3 text-[10px] uppercase tracking-[.12em] text-white/45">
                Spoiler
                <select
                  value={tuning.spoilerStyle}
                  onChange={(event) => setTuning((current) => ({ ...current, spoilerStyle: Number(event.target.value) }))}
                  className="mt-2 w-full rounded-lg border border-white/10 bg-[#11120e] px-2 py-2 text-xs font-semibold text-white outline-none"
                >
                  <option value={0}>Sin spoiler</option>
                  {Array.from({ length: 40 }, (_, index) => (
                    <option key={index + 1} value={index + 1}>{`Style ${String(index + 1).padStart(2, "0")}`}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTuning((current) => ({ ...current, hoodCarbon: !current.hoodCarbon }))}
                className={`${optionBase} ${tuning.hoodCarbon ? "border-[#d1ff52]/45 bg-[#d1ff52]/10 text-[#dfff87]" : "border-white/10 bg-black/25 text-white/45"}`}
              >
                Capot CF · {tuning.hoodCarbon ? "ON" : "OFF"}
              </button>
              <button
                type="button"
                onClick={() => setTuning((current) => ({ ...current, spoilerCarbon: !current.spoilerCarbon }))}
                className={`${optionBase} ${tuning.spoilerCarbon ? "border-[#d1ff52]/45 bg-[#d1ff52]/10 text-[#dfff87]" : "border-white/10 bg-black/25 text-white/45"}`}
              >
                Spoiler CF · {tuning.spoilerCarbon ? "ON" : "OFF"}
              </button>
            </div>
          </div>
        ) : null}

        {category === "wheels" ? (
          <div>
            <p className="text-[10px] font-black uppercase italic tracking-[.16em] text-[#cfff5d]">Rim Shop / NFSU2</p>
            <p className="mt-1 text-xs text-white/35">Geometrías extraídas de la biblioteca real CARS/WHEELS del juego instalado.</p>
            <div className="mt-4 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
              {WHEELS.map((wheel) => (
                <button
                  key={wheel.value}
                  type="button"
                  onClick={() => setTuning((current) => ({ ...current, wheelStyle: wheel.value }))}
                  className={`min-w-[88px] rounded-2xl border px-4 py-4 text-center ${
                    tuning.wheelStyle === wheel.value
                      ? "border-[#d1ff52]/55 bg-[#d1ff52]/12 text-[#e1ff93]"
                      : "border-white/10 bg-black/30 text-white/45"
                  }`}
                >
                  <Disc3 size={23} className="mx-auto" />
                  <span className="mt-2 block text-xs font-black italic">{wheel.label}</span>
                  <span className="mt-1 block text-[9px] text-white/30">17&quot; NFS</span>
                </button>
              ))}
            </div>
            <label className="mt-4 block">
              <span className="flex items-center justify-between text-[11px] text-white/48">
                <span>Tamaño llanta</span><strong className="text-white">{Math.round(tuning.wheelScale * 100)}%</strong>
              </span>
              <input
                type="range"
                min={0.82}
                max={1.24}
                step={0.01}
                value={tuning.wheelScale}
                onChange={(event) => setTuning((current) => ({ ...current, wheelScale: Number(event.target.value) }))}
                className="mt-2 w-full accent-[#cfff5d]"
              />
            </label>
            <label className="mt-3 block">
              <span className="flex items-center justify-between text-[11px] text-white/48">
                <span>Altura / stance</span><strong className="text-white">{Math.round(tuning.rideHeight * 100)} visual</strong>
              </span>
              <input
                type="range"
                min={-0.3}
                max={0.2}
                step={0.01}
                value={tuning.rideHeight}
                onChange={(event) => setTuning((current) => ({ ...current, rideHeight: Number(event.target.value) }))}
                className="mt-2 w-full accent-[#cfff5d]"
              />
            </label>
          </div>
        ) : null}

        {category === "paint" ? (
          <div>
            <p className="text-[10px] font-black uppercase italic tracking-[.16em] text-[#cfff5d]">Paint Shop</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {PAINTS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={color}
                  onClick={() => setTuning((current) => ({ ...current, bodyColor: color }))}
                  className={`h-12 w-12 rounded-full border-4 transition ${
                    tuning.bodyColor.toLowerCase() === color.toLowerCase() ? "border-[#d1ff52] scale-110" : "border-white/15"
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
              <label className="grid h-12 w-12 cursor-pointer place-items-center rounded-full border border-dashed border-white/20 bg-black/30">
                <Paintbrush size={17} className="text-white/60" />
                <input
                  type="color"
                  value={tuning.bodyColor}
                  onChange={(event) => setTuning((current) => ({ ...current, bodyColor: event.target.value }))}
                  className="sr-only"
                />
              </label>
            </div>
            <label className="mt-5 block">
              <span className="flex items-center justify-between text-[11px] text-white/48">
                <span>Polarizado</span><strong className="text-white">{Math.round(tuning.windowTint * 100)}%</strong>
              </span>
              <input
                type="range"
                min={0}
                max={0.92}
                step={0.01}
                value={tuning.windowTint}
                onChange={(event) => setTuning((current) => ({ ...current, windowTint: Number(event.target.value) }))}
                className="mt-2 w-full accent-[#cfff5d]"
              />
            </label>
          </div>
        ) : null}

        {category === "vinyls" ? (
          <div>
            <p className="text-[10px] font-black uppercase italic tracking-[.16em] text-[#cfff5d]">Vinyl Shop</p>
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
              {([
                ["bajoceroz", "BAJOCERO-Z"],
                ["elunito", "EL UNITO"],
                ["locodanisonido", "LOCODANISONIDO"],
                ["none", "LIMPIO"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTuning((current) => ({ ...current, decalPreset: value }))}
                  className={`${optionBase} ${
                    tuning.decalPreset === value
                      ? "border-[#d1ff52]/50 bg-[#d1ff52]/12 text-[#e2ff97]"
                      : "border-white/10 bg-black/25 text-white/45"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-4 text-[9px] font-semibold uppercase tracking-[.15em] text-white/35">Rescatados de VINYLS.BIN</p>
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
              {NFS_VINYLS.map((vinyl) => (
                <button
                  key={vinyl.value}
                  type="button"
                  onClick={() => setTuning((current) => ({ ...current, decalPreset: vinyl.value }))}
                  className={`relative h-24 w-32 shrink-0 overflow-hidden rounded-xl border ${
                    tuning.decalPreset === vinyl.value ? "border-[#d1ff52]/65" : "border-white/10"
                  }`}
                >
                  <img src={vinyl.image} alt="" className="absolute inset-0 h-full w-full object-cover opacity-80" />
                  <span className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />
                  <span className="absolute bottom-2 left-2 text-[10px] font-bold text-white">{vinyl.label}</span>
                </button>
              ))}
            </div>
            <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-black/25 px-3 py-3 text-xs text-white/65">
              {uploadingDecal ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
              {uploadingDecal ? "Subiendo…" : "Subir pegatina PNG / JPG / WebP"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                disabled={uploadingDecal}
                onChange={(event) => void uploadCustomDecal(event)}
              />
            </label>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <label className="block text-[10px] uppercase tracking-[.12em] text-white/40">
                Tamaño
                <input type="range" min={0.45} max={2.2} step={0.05} value={tuning.decalScale} onChange={(event) => setTuning((current) => ({ ...current, decalScale: Number(event.target.value) }))} className="mt-2 w-full accent-[#cfff5d]" />
              </label>
              <label className="block text-[10px] uppercase tracking-[.12em] text-white/40">
                Adelante / atrás
                <input type="range" min={-0.8} max={0.8} step={0.02} value={tuning.decalOffsetZ} onChange={(event) => setTuning((current) => ({ ...current, decalOffsetZ: Number(event.target.value) }))} className="mt-2 w-full accent-[#cfff5d]" />
              </label>
              <label className="block text-[10px] uppercase tracking-[.12em] text-white/40">
                Arriba / abajo
                <input type="range" min={-0.45} max={0.45} step={0.02} value={tuning.decalOffsetY} onChange={(event) => setTuning((current) => ({ ...current, decalOffsetY: Number(event.target.value) }))} className="mt-2 w-full accent-[#cfff5d]" />
              </label>
            </div>
          </div>
        ) : null}

        {category === "audio" ? (
          <div>
            <p className="text-[10px] font-black uppercase italic tracking-[.16em] text-[#cfff5d]">LOCODANISONIDO</p>
            <p className="mt-1 text-sm text-white/45">Show car / baúl de audio.</p>
            <button
              type="button"
              onClick={() => setTuning((current) => ({ ...current, audioTrunkOpen: !current.audioTrunkOpen }))}
              className={`mt-4 flex w-full items-center justify-between rounded-2xl border p-4 ${
                tuning.audioTrunkOpen
                  ? "border-[#d1ff52]/50 bg-[#d1ff52]/10 text-[#e0ff91]"
                  : "border-white/10 bg-black/30 text-white/55"
              }`}
            >
              <span className="flex items-center gap-3"><Volume2 size={22} /> Baúl · doble sub</span>
              <strong className="text-xs">{tuning.audioTrunkOpen ? "ABIERTO" : "CERRADO"}</strong>
            </button>
            <button
              type="button"
              onClick={() => setTuning((current) => ({ ...current, decalPreset: "locodanisonido" }))}
              className={`${optionBase} mt-3 w-full ${
                tuning.decalPreset === "locodanisonido"
                  ? "border-[#d1ff52]/50 bg-[#d1ff52]/10 text-[#e0ff91]"
                  : "border-white/10 bg-black/25 text-white/45"
              }`}
            >
              Aplicar sticker LOCODANISONIDO
            </button>
          </div>
        ) : null}

        {category === "lights" ? (
          <div>
            <p className="text-[10px] font-black uppercase italic tracking-[.16em] text-[#cfff5d]">Lights / Show</p>
            <label className="mt-4 block rounded-xl border border-white/10 bg-black/30 p-3 text-[10px] uppercase tracking-[.12em] text-white/45">
              Estilo de óptica
              <select
                value={tuning.headlightStyle}
                onChange={(event) => setTuning((current) => ({ ...current, headlightStyle: Number(event.target.value) }))}
                className="mt-2 w-full rounded-lg border border-white/10 bg-[#11120e] px-2 py-2 text-xs font-semibold text-white outline-none"
              >
                <option value={0}>Stock</option>
                <option value={5}>Style 05 · NFS</option>
              </select>
            </label>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTuning((current) => ({ ...current, headlights: !current.headlights }))}
                className={`rounded-xl border p-4 text-left ${
                  tuning.headlights ? "border-[#d1ff52]/45 bg-[#d1ff52]/10" : "border-white/10 bg-black/30"
                }`}
              >
                <Lightbulb size={20} />
                <span className="mt-2 block text-xs font-semibold">Ópticas</span>
                <span className="mt-1 block text-[10px] text-white/35">{tuning.headlights ? "ON" : "OFF"}</span>
              </button>
              <button
                type="button"
                onClick={() => setTuning((current) => ({ ...current, neonEnabled: !current.neonEnabled }))}
                className={`rounded-xl border p-4 text-left ${
                  tuning.neonEnabled ? "border-[#d1ff52]/45 bg-[#d1ff52]/10" : "border-white/10 bg-black/30"
                }`}
              >
                <Sparkles size={20} />
                <span className="mt-2 block text-xs font-semibold">Underglow</span>
                <span className="mt-1 block text-[10px] text-white/35">{tuning.neonEnabled ? "ON" : "OFF"}</span>
              </button>
            </div>
            <label className="mt-4 flex items-center justify-between rounded-xl border border-white/10 bg-black/30 p-3">
              <span className="text-xs text-white/55">Color neon</span>
              <input type="color" value={tuning.neonColor} onChange={(event) => setTuning((current) => ({ ...current, neonColor: event.target.value }))} className="h-10 w-16 bg-transparent" />
            </label>
            <label className="mt-3 block">
              <span className="flex items-center justify-between text-[11px] text-white/48">
                <span>Intensidad</span><strong className="text-white">{Math.round(tuning.neonIntensity * 100)}%</strong>
              </span>
              <input type="range" min={0} max={3} step={0.05} value={tuning.neonIntensity} onChange={(event) => setTuning((current) => ({ ...current, neonIntensity: Number(event.target.value) }))} className="mt-2 w-full accent-[#cfff5d]" />
            </label>
            <button
              type="button"
              onClick={() => setTuning((current) => ({ ...current, autoRotate: !current.autoRotate }))}
              className={`${optionBase} mt-3 w-full ${
                tuning.autoRotate ? "border-[#d1ff52]/45 bg-[#d1ff52]/10 text-[#e0ff91]" : "border-white/10 bg-black/25 text-white/45"
              }`}
            >
              <Rotate3D size={15} className="mr-2 inline" /> Plataforma giratoria · {tuning.autoRotate ? "ON" : "OFF"}
            </button>
          </div>
        ) : null}
      </div>

      <div className={`${deck} p-3`}>
        <div className="grid grid-cols-3 gap-2">
          <button type="button" onClick={() => applyPreset("street")} className="rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-xs font-semibold text-white/65"><Gauge size={15} className="mx-auto mb-1" />Street</button>
          <button type="button" onClick={() => applyPreset("low")} className="rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-xs font-semibold text-white/65"><Sparkles size={15} className="mx-auto mb-1" />Low</button>
          <button type="button" onClick={() => applyPreset("show")} className="rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-xs font-semibold text-white/65"><Rotate3D size={15} className="mx-auto mb-1" />Show</button>
        </div>
        <div className="mt-3 flex gap-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            placeholder="BAJOCERO-Z · EL UNITO"
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm font-semibold outline-none focus:border-[#d1ff52]/40"
          />
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-[#d1ff52] px-4 py-3 text-xs font-black text-black disabled:opacity-50"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Guardar
          </button>
        </div>
      </div>
    </section>
  );
}
