"use client";

import { Expand, Loader2, Mic2, Music2, Pause, Play, Radio, Save, Sparkles, Upload, Zap } from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { VehicleModelViewer } from "@/components/auto/VehicleModelViewer";
import type { VehicleVisualBuild } from "@/components/auto/VehicleTuningStudio";
import {
  DEFAULT_VEHICLE_SHOW,
  DEFAULT_VEHICLE_TUNING,
  normalizeVehicleShow,
  normalizeVehicleTuning,
  type VehicleShowConfig,
  type VehicleTuningConfig,
} from "@/lib/auto/visual-config";

export type VehicleAudioTrack = {
  id: string;
  caption: string | null;
  resolved_url: string | null;
  created_at: string;
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
  audioLibrary: VehicleAudioTrack[];
  saving: boolean;
  uploading: boolean;
  onSave: (input: SaveBuildInput) => Promise<void>;
  onUploadAudio: (file: File) => Promise<VehicleAudioTrack>;
};

type SourceMode = "off" | "track" | "mic";

export function VehicleShowStudio({
  vehicleId,
  vehicleName,
  modelUrl,
  partMeshMap,
  builds,
  audioLibrary,
  saving,
  uploading,
  onSave,
  onUploadAudio,
}: Props) {
  const activeBuild = useMemo(() => builds.find((build) => build.is_active) ?? builds[0] ?? null, [builds]);
  const [selectedBuildId, setSelectedBuildId] = useState<string | null>(activeBuild?.id ?? null);
  const selectedBuild = useMemo(
    () => builds.find((build) => build.id === selectedBuildId) ?? activeBuild,
    [activeBuild, builds, selectedBuildId],
  );
  const [tuning, setTuning] = useState<VehicleTuningConfig>(() => normalizeVehicleTuning(selectedBuild?.tuning_config));
  const [show, setShow] = useState<VehicleShowConfig>(() => normalizeVehicleShow(selectedBuild?.show_config));
  const [trackId, setTrackId] = useState<string | null>(selectedBuild?.audio_media_id ?? null);
  const [sourceMode, setSourceMode] = useState<SourceMode>("off");
  const [playing, setPlaying] = useState(false);
  const [audioAnalyser, setAudioAnalyser] = useState<AnalyserNode | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);

  const selectedTrack = useMemo(() => audioLibrary.find((track) => track.id === trackId) ?? null, [audioLibrary, trackId]);

  useEffect(() => {
    if (!selectedBuild) return;
    setSelectedBuildId(selectedBuild.id);
    setTuning(normalizeVehicleTuning(selectedBuild.tuning_config));
    setShow(normalizeVehicleShow(selectedBuild.show_config));
    setTrackId(selectedBuild.audio_media_id);
  }, [selectedBuild?.id, selectedBuild?.updated_at]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    setPlaying(false);
    if (selectedTrack?.resolved_url) {
      audio.src = selectedTrack.resolved_url;
      audio.load();
    } else {
      audio.removeAttribute("src");
      audio.load();
    }
    if (sourceMode === "track") setSourceMode("off");
  }, [selectedTrack?.id, selectedTrack?.resolved_url]);

  useEffect(() => {
    return () => {
      micStreamRef.current?.getTracks().forEach((track) => track.stop());
      void contextRef.current?.close();
    };
  }, []);

  function ensureAudioGraph() {
    const audio = audioRef.current;
    if (!audio) throw new Error("No se pudo iniciar el reproductor.");

    let context = contextRef.current;
    if (!context) {
      context = new AudioContext();
      contextRef.current = context;
    }

    let analyser = analyserRef.current;
    if (!analyser) {
      analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.78;
      analyserRef.current = analyser;
      setAudioAnalyser(analyser);
    }

    if (!mediaSourceRef.current) {
      const source = context.createMediaElementSource(audio);
      source.connect(analyser);
      source.connect(context.destination);
      mediaSourceRef.current = source;
    }

    return { context, analyser };
  }

  async function playTrack() {
    setAudioError(null);
    if (!selectedTrack?.resolved_url || !audioRef.current) {
      setAudioError("Elegí o subí una canción para activar el show.");
      return;
    }
    try {
      micStreamRef.current?.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
      micSourceRef.current?.disconnect();
      micSourceRef.current = null;
      const { context } = ensureAudioGraph();
      if (context.state === "suspended") await context.resume();
      await audioRef.current.play();
      setSourceMode("track");
      setPlaying(true);
    } catch (cause) {
      setAudioError(cause instanceof Error ? cause.message : "No se pudo reproducir el audio.");
    }
  }

  function pauseTrack() {
    audioRef.current?.pause();
    setPlaying(false);
    setSourceMode("off");
  }

  async function startMic() {
    setAudioError(null);
    try {
      audioRef.current?.pause();
      setPlaying(false);
      const { context, analyser } = ensureAudioGraph();
      if (context.state === "suspended") await context.resume();
      micStreamRef.current?.getTracks().forEach((track) => track.stop());
      micSourceRef.current?.disconnect();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const micSource = context.createMediaStreamSource(stream);
      micSource.connect(analyser);
      micStreamRef.current = stream;
      micSourceRef.current = micSource;
      setSourceMode("mic");
    } catch (cause) {
      setAudioError(cause instanceof Error ? cause.message : "No se pudo abrir el micrófono.");
    }
  }

  function stopAudioReactive() {
    audioRef.current?.pause();
    setPlaying(false);
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
    micSourceRef.current?.disconnect();
    micSourceRef.current = null;
    setSourceMode("off");
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setAudioError(null);
    try {
      const track = await onUploadAudio(file);
      setTrackId(track.id);
    } catch (cause) {
      setAudioError(cause instanceof Error ? cause.message : "No se pudo subir la canción.");
    } finally {
      event.target.value = "";
    }
  }

  async function saveShow() {
    await onSave({
      buildId: selectedBuild?.id ?? null,
      name: selectedBuild?.name ?? "Show Build",
      tuningConfig: selectedBuild ? tuning : DEFAULT_VEHICLE_TUNING,
      showConfig: show,
      audioMediaId: trackId,
      activate: true,
    });
  }

  async function fullScreen() {
    const stage = stageRef.current;
    if (!stage) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await stage.requestFullscreen();
  }

  return (
    <section className="mt-3">
      <div className="rounded-[28px] border border-violet-300/15 bg-[radial-gradient(circle_at_78%_0%,rgba(119,76,255,.2),transparent_40%),#0b0912] p-5">
        <div className="inline-flex items-center gap-2 text-violet-200"><Radio size={17} /><span className="text-[10px] font-semibold uppercase tracking-[.17em]">LOCODANISONIDO · SHOW ENGINE</span></div>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight">EL UNITO escucha la canción.</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-white/42">
          Graves, medios y agudos mueven suspensión, cámara, luces y underglow. Para vivo podés usar una canción guardada o la entrada del micrófono.
        </p>

        {builds.length ? (
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
            {builds.map((build) => (
              <button
                key={build.id}
                type="button"
                onClick={() => {
                  setSelectedBuildId(build.id);
                  setTuning(normalizeVehicleTuning(build.tuning_config));
                  setShow(normalizeVehicleShow(build.show_config));
                  setTrackId(build.audio_media_id);
                  stopAudioReactive();
                }}
                className={`shrink-0 rounded-full border px-3 py-2 text-xs ${selectedBuild?.id === build.id ? "border-violet-300/35 bg-violet-400/15 text-violet-100" : "border-white/[0.08] bg-white/[0.03] text-white/42"}`}
              >
                {build.name}{build.is_active ? " · ACTIVO" : ""}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div ref={stageRef} className="relative mt-4 h-[46dvh] min-h-[360px] max-h-[650px] overflow-hidden rounded-[30px] border border-white/[0.08] bg-black">
        <VehicleModelViewer
          vehicleId={vehicleId}
          modelUrl={modelUrl}
          partMeshMap={partMeshMap}
          tuningConfig={tuning}
          showConfig={show}
          audioAnalyser={audioAnalyser}
          showMode={sourceMode !== "off"}
          className="rounded-none"
        />
        <div className="pointer-events-none absolute left-4 top-4 rounded-2xl border border-white/10 bg-black/55 px-3 py-2 backdrop-blur-md">
          <p className="text-[9px] uppercase tracking-[.16em] text-white/35">BAJOCERO-Z · LOCODANISONIDO</p>
          <p className="mt-0.5 text-xs font-semibold">{vehicleName}</p>
        </div>
        <div className="pointer-events-none absolute bottom-4 left-4 rounded-2xl border border-white/10 bg-black/55 px-3 py-2 backdrop-blur-md">
          <p className="text-[9px] uppercase tracking-[.16em] text-white/35">Entrada</p>
          <p className="mt-0.5 text-xs font-semibold">{sourceMode === "track" ? selectedTrack?.caption || "Canción" : sourceMode === "mic" ? "LIVE MIC" : "Standby"}</p>
        </div>
        <button type="button" onClick={() => void fullScreen()} className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-black/55 backdrop-blur-md" aria-label="Pantalla completa">
          <Expand size={16} />
        </button>
      </div>

      <audio ref={audioRef} crossOrigin="anonymous" preload="metadata" onEnded={() => { setPlaying(false); setSourceMode("off"); }} />

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <article className="rounded-[26px] border border-white/[0.07] bg-[#0b0912] p-4">
          <div className="flex items-center gap-2"><Music2 size={15} className="text-violet-300" /><p className="text-xs font-semibold">LOCODANISONIDO · Fuente de sonido</p></div>
          <select value={trackId ?? ""} onChange={(event) => { setTrackId(event.target.value || null); stopAudioReactive(); }} className="mt-4 w-full rounded-xl border border-white/10 bg-[#14101c] px-3 py-3 text-sm">
            <option value="">Elegir canción…</option>
            {audioLibrary.map((track) => <option key={track.id} value={track.id}>{track.caption || "Audio sin nombre"}</option>)}
          </select>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => playing ? pauseTrack() : void playTrack()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-500 px-3 py-3 text-xs font-semibold">
              {playing ? <Pause size={15} /> : <Play size={15} />} {playing ? "Pausar" : "Reproducir"}
            </button>
            <button type="button" onClick={() => sourceMode === "mic" ? stopAudioReactive() : void startMic()} className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-xs font-semibold ${sourceMode === "mic" ? "border-rose-300/30 bg-rose-400/10 text-rose-100" : "border-white/10 bg-white/[0.04]"}`}>
              <Mic2 size={15} /> {sourceMode === "mic" ? "Cortar LIVE" : "LIVE MIC"}
            </button>
          </div>

          <label className="mt-2 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-xs">
            {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} {uploading ? "Subiendo audio…" : "Subir canción al Player"}
            <input type="file" accept="audio/*" disabled={uploading} onChange={(event) => void upload(event)} className="hidden" />
          </label>

          {audioError ? <p className="mt-3 rounded-xl border border-rose-300/15 bg-rose-300/[0.06] p-3 text-xs text-rose-200">{audioError}</p> : null}
        </article>

        <article className="rounded-[26px] border border-white/[0.07] bg-[#0b0912] p-4">
          <div className="flex items-center gap-2"><Sparkles size={15} className="text-violet-300" /><p className="text-xs font-semibold">Escena</p></div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {([
              ["underground", "Underground"],
              ["ice", "Hielo"],
              ["blackout", "Blackout"],
            ] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setShow((current) => ({ ...current, scene: key }))} className={`rounded-xl border px-2 py-2.5 text-[11px] ${show.scene === key ? "border-violet-300/30 bg-violet-400/12 text-violet-100" : "border-white/[0.07] bg-black/20 text-white/40"}`}>{label}</button>
            ))}
          </div>

          <label className="mt-4 block">
            <span className="flex items-center justify-between text-[11px] text-white/48"><span>Reactividad general</span><strong className="text-white/75">{Math.round(show.reactivity * 100)}%</strong></span>
            <input type="range" min={0} max={2} step={0.05} value={show.reactivity} onChange={(event) => setShow((current) => ({ ...current, reactivity: Number(event.target.value) }))} className="mt-2 w-full accent-violet-400" />
          </label>
          <label className="mt-3 block">
            <span className="flex items-center justify-between text-[11px] text-white/48"><span>Graves → suspensión</span><strong className="text-white/75">{Math.round(show.bassBounce * 100)}%</strong></span>
            <input type="range" min={0} max={2} step={0.05} value={show.bassBounce} onChange={(event) => setShow((current) => ({ ...current, bassBounce: Number(event.target.value) }))} className="mt-2 w-full accent-violet-400" />
          </label>
          <label className="mt-3 block">
            <span className="flex items-center justify-between text-[11px] text-white/48"><span>Medios → neon</span><strong className="text-white/75">{Math.round(show.midGlow * 100)}%</strong></span>
            <input type="range" min={0} max={2} step={0.05} value={show.midGlow} onChange={(event) => setShow((current) => ({ ...current, midGlow: Number(event.target.value) }))} className="mt-2 w-full accent-violet-400" />
          </label>
          <label className="mt-3 block">
            <span className="flex items-center justify-between text-[11px] text-white/48"><span>Agudos → flashes</span><strong className="text-white/75">{Math.round(show.trebleFlash * 100)}%</strong></span>
            <input type="range" min={0} max={2} step={0.05} value={show.trebleFlash} onChange={(event) => setShow((current) => ({ ...current, trebleFlash: Number(event.target.value) }))} className="mt-2 w-full accent-violet-400" />
          </label>
          <label className="mt-3 block">
            <span className="flex items-center justify-between text-[11px] text-white/48"><span>Golpe de cámara</span><strong className="text-white/75">{Math.round(show.cameraPulse * 100)}%</strong></span>
            <input type="range" min={0} max={2} step={0.05} value={show.cameraPulse} onChange={(event) => setShow((current) => ({ ...current, cameraPulse: Number(event.target.value) }))} className="mt-2 w-full accent-violet-400" />
          </label>
          <label className="mt-3 block">
            <span className="flex items-center justify-between text-[11px] text-white/48"><span>Rotación de escena</span><strong className="text-white/75">{Math.round(show.autoRotateSpeed * 100)}%</strong></span>
            <input type="range" min={0} max={3} step={0.05} value={show.autoRotateSpeed} onChange={(event) => setShow((current) => ({ ...current, autoRotateSpeed: Number(event.target.value) }))} className="mt-2 w-full accent-violet-400" />
          </label>
        </article>
      </div>

      <div className="mt-3 rounded-[24px] border border-white/[0.07] bg-[#0b0912] p-4">
        <div className="flex gap-3">
          <Zap size={17} className="mt-0.5 shrink-0 text-violet-300" />
          <p className="text-xs leading-5 text-white/44">Pantalla completa deja sólo la escena. LIVE MIC analiza el sonido que entra al teléfono o notebook y no lo reproduce, así evitamos realimentación.</p>
        </div>
        <button type="button" disabled={saving} onClick={() => void saveShow()} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-500 px-5 py-3.5 font-semibold disabled:opacity-50">
          {saving ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />} Guardar Show en este build
        </button>
      </div>
    </section>
  );
}
