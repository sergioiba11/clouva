"use client";

import Link from "next/link";
import { ArrowLeft, Check, MapPin, Pause, Radio, Search, ShieldCheck, UserPlus, Users, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { TrustedMap, type TrustedMapLocation } from "@/components/trusted-map/TrustedMap";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import { supabase } from "@/lib/supabase";

type PlayerSummary = { owner_user_id?: string; slug?: string; display_name?: string; username?: string | null; profile_image_url?: string | null; accent_color?: string | null };
type Connection = { id: string; requester_user_id: string; recipient_user_id: string; status: string; direction: "incoming" | "outgoing"; other: PlayerSummary | null };
type Group = { id: string; owner_user_id: string; name: string; isOwner: boolean; myMembership: { status?: string } | null; members: Array<{ user_id: string; status: string; player: PlayerSummary | null }>; owner: PlayerSummary | null };
type Snapshot = { me: PlayerSummary | null; connections: Connection[]; groups: Group[]; locations: TrustedMapLocation[]; suggestions: PlayerSummary[]; sharing: TrustedMapLocation | null };

export default function TrustedMapPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sharingState, setSharingState] = useState<"idle" | "locating" | "sharing">("idle");
  const watchRef = useRef<number | null>(null);
  const lastSentRef = useRef(0);

  const load = useCallback(async (search = "") => {
    if (!user) return;
    const response = await authenticatedFetch(`/api/trusted-map${search.trim().length >= 2 ? `?q=${encodeURIComponent(search.trim())}` : ""}`);
    const payload = await readApiJson<Snapshot>(response);
    setSnapshot(payload);
  }, [user]);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login?next=/mapa-de-confianza");
  }, [authLoading, router, user]);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    void load().catch((cause) => setError(cause instanceof Error ? cause.message : "No se pudo abrir el mapa.")).finally(() => setLoading(false));
  }, [load, user]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`trusted-map:${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "trusted_map_locations" }, () => { void load(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [load, user]);

  const stopWatcher = useCallback(() => {
    if (watchRef.current !== null && typeof navigator !== "undefined" && navigator.geolocation) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = null;
    setSharingState("idle");
  }, []);

  useEffect(() => () => stopWatcher(), [stopWatcher]);
  useEffect(() => { if (!user) stopWatcher(); }, [stopWatcher, user]);

  const acceptedConnections = useMemo(() => snapshot?.connections.filter((item) => item.status === "accepted") ?? [], [snapshot]);
  const acceptedGroups = useMemo(() => snapshot?.groups.filter((group) => group.isOwner || group.myMembership?.status === "accepted") ?? [], [snapshot]);
  const hasAudience = acceptedConnections.length > 0 || acceptedGroups.some((group) => group.members.some((member) => member.status === "accepted"));

  const action = async (body: Record<string, unknown>, success?: string) => {
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await authenticatedFetch("/api/trusted-map", { method: "POST", body: JSON.stringify(body) });
      const payload = await readApiJson<Snapshot>(response);
      setSnapshot(payload);
      if (success) setMessage(success);
      return payload;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo actualizar el mapa.");
      return null;
    } finally { setBusy(false); }
  };

  const search = async () => {
    if (query.trim().length < 2) return;
    setBusy(true); setError(null);
    try { await load(query); } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo buscar Players."); }
    finally { setBusy(false); }
  };

  const startSharing = () => {
    setError(null); setMessage(null);
    if (!hasAudience) { setError("Primero conectate con una persona o grupo y esperá su aceptación."); return; }
    if (typeof navigator === "undefined" || !navigator.geolocation) { setError("Este dispositivo no ofrece ubicación al navegador."); return; }
    if (watchRef.current !== null) return;
    setSharingState("locating");
    watchRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const now = Date.now();
        if (now - lastSentRef.current < 10_000) return;
        lastSentRef.current = now;
        setSharingState("sharing");
        void action({ action: "share_location", latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyMeters: position.coords.accuracy });
      },
      (geoError) => {
        stopWatcher();
        setError(geoError.code === geoError.PERMISSION_DENIED ? "No compartimos nada. Para activar el mapa, aceptá el permiso de ubicación del navegador." : "No pudimos obtener una señal de ubicación en este dispositivo.");
      },
      { enableHighAccuracy: false, maximumAge: 15_000, timeout: 12_000 },
    );
  };

  const pauseSharing = async () => { stopWatcher(); await action({ action: "pause_location" }, "Ubicación pausada."); };
  const stopSharing = async () => { stopWatcher(); await action({ action: "stop_location" }, "Dejaste de compartir ubicación."); };

  if (authLoading || loading) return <main className="min-h-screen bg-[#05070b] px-4 py-8 text-white"><div className="mx-auto h-[70vh] max-w-6xl animate-pulse rounded-[2rem] bg-white/[0.035]" /></main>;
  if (!user) return null;

  const incoming = snapshot?.connections.filter((item) => item.status === "pending" && item.direction === "incoming") ?? [];
  const outgoing = snapshot?.connections.filter((item) => item.status === "pending" && item.direction === "outgoing") ?? [];
  const groupInvites = snapshot?.groups.filter((group) => !group.isOwner && group.myMembership?.status === "pending") ?? [];

  return (
    <main className="min-h-screen bg-[#05070b] text-white">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#05070b]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3"><Link href={snapshot?.me?.slug ? `/${snapshot.me.slug}` : "/matrix"} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.04]"><ArrowLeft size={17} /></Link><div className="min-w-0"><p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-cyan-200/55">Privado · consentimiento mutuo</p><h1 className="truncate text-lg font-bold">Mapa de confianza</h1></div></div>
          <ShieldCheck size={21} className="text-cyan-200/70" />
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="min-w-0">
          <TrustedMap locations={snapshot?.locations ?? []} />
          <div className="mt-3 flex flex-wrap gap-2">
            {sharingState !== "sharing" ? <button type="button" onClick={startSharing} disabled={!hasAudience || busy} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-cyan-200 px-4 text-sm font-bold text-[#041015] disabled:cursor-not-allowed disabled:opacity-35"><Radio size={15} /> {sharingState === "locating" ? "Buscando señal…" : "Compartir mi ubicación"}</button> : <button type="button" onClick={() => void pauseSharing()} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-amber-200/25 bg-amber-200/10 px-4 text-sm font-semibold text-amber-100"><Pause size={15} /> Pausar</button>}
            {snapshot?.sharing ? <button type="button" onClick={() => void stopSharing()} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-4 text-sm text-white/65"><X size={15} /> Dejar de compartir</button> : null}
          </div>
          <p className="mt-2 text-[11px] leading-5 text-white/35">CLOUVA pide el permiso del dispositivo únicamente cuando tocás “Compartir mi ubicación”. La señal no se usa en tu Player público y no existe historial de recorridos.</p>
        </section>

        <aside className="grid content-start gap-4">
          {(incoming.length || groupInvites.length) ? <section className="rounded-[24px] border border-cyan-200/15 bg-cyan-200/[0.035] p-4"><h2 className="text-sm font-bold">Invitaciones</h2><div className="mt-3 grid gap-2">{incoming.map((connection) => <div key={connection.id} className="rounded-2xl border border-white/8 bg-black/20 p-3"><p className="text-sm font-semibold">{connection.other?.display_name || connection.other?.username || "Player"}</p><p className="mt-1 text-[10px] text-white/38">Quiere conectar ubicación contigo.</p><div className="mt-3 flex gap-2"><button disabled={busy} onClick={() => void action({ action: "accept", connectionId: connection.id }, "Conexión aceptada.")} className="inline-flex min-h-9 items-center gap-1 rounded-full bg-cyan-200 px-3 text-xs font-bold text-[#041015]"><Check size={13}/>Aceptar</button><button disabled={busy} onClick={() => void action({ action: "reject", connectionId: connection.id })} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-white/12 px-3 text-xs text-white/55"><X size={13}/>Rechazar</button></div></div>)}{groupInvites.map((group) => <div key={group.id} className="rounded-2xl border border-white/8 bg-black/20 p-3"><p className="text-sm font-semibold">{group.name}</p><p className="mt-1 text-[10px] text-white/38">Invitación a un grupo de confianza.</p><div className="mt-3 flex gap-2"><button onClick={() => void action({ action: "accept_group", groupId: group.id })} className="rounded-full bg-cyan-200 px-3 py-2 text-xs font-bold text-[#041015]">Aceptar</button><button onClick={() => void action({ action: "reject_group", groupId: group.id })} className="rounded-full border border-white/12 px-3 py-2 text-xs text-white/55">Rechazar</button></div></div>)}</div></section> : null}

          <section className="rounded-[24px] border border-white/10 bg-white/[0.025] p-4"><div className="flex items-center gap-2"><UserPlus size={16} className="text-cyan-200/65"/><h2 className="text-sm font-bold">Conectar un Player</h2></div><div className="mt-3 flex gap-2"><div className="relative min-w-0 flex-1"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30"/><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void search(); }} placeholder="Nombre o @usuario" className="h-11 w-full rounded-xl border border-white/10 bg-black/25 pl-9 pr-3 text-sm outline-none focus:border-cyan-200/30"/></div><button onClick={() => void search()} disabled={busy || query.trim().length < 2} className="h-11 rounded-xl border border-white/10 px-3 text-xs font-semibold disabled:opacity-30">Buscar</button></div>{snapshot?.suggestions.length ? <div className="mt-3 grid gap-2">{snapshot.suggestions.map((player) => <div key={player.owner_user_id} className="flex items-center gap-2 rounded-xl border border-white/8 p-2"><div className="h-9 w-9 overflow-hidden rounded-full bg-white/5">{player.profile_image_url ? <img src={player.profile_image_url} alt="" className="h-full w-full object-cover"/> : null}</div><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{player.display_name}</p><p className="truncate text-[10px] text-white/35">{player.username ? `@${player.username}` : "Player"}</p></div><button onClick={() => void action({ action: "invite", recipientUserId: player.owner_user_id }, "Invitación enviada.")} className="rounded-full border border-cyan-200/20 bg-cyan-200/5 px-3 py-2 text-[10px] font-semibold text-cyan-100">Conectar</button></div>)}</div> : null}</section>

          <section className="rounded-[24px] border border-white/10 bg-white/[0.025] p-4"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><Users size={16} className="text-violet-300/70"/><h2 className="text-sm font-bold">Mis conexiones</h2></div><span className="text-[10px] text-white/30">{acceptedConnections.length}</span></div><div className="mt-3 grid gap-2">{acceptedConnections.map((connection) => <div key={connection.id} className="flex items-center gap-2 rounded-xl border border-white/8 p-3"><span className="h-2 w-2 rounded-full bg-cyan-200 shadow-[0_0_12px_rgba(165,243,252,.7)]"/><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{connection.other?.display_name || connection.other?.username || "Player"}</p><p className="text-[10px] text-white/35">Conexión aceptada</p></div><button onClick={() => void action({ action: "revoke", connectionId: connection.id })} className="text-[10px] text-white/35 hover:text-white/70">Desconectar</button></div>)}{!acceptedConnections.length ? <p className="py-2 text-xs leading-5 text-white/32">Todavía no tenés conexiones aceptadas.</p> : null}{outgoing.length ? <p className="pt-1 text-[10px] text-white/28">{outgoing.length} invitación{outgoing.length === 1 ? "" : "es"} pendiente{outgoing.length === 1 ? "" : "s"}.</p> : null}</div></section>

          <section className="rounded-[24px] border border-white/10 bg-white/[0.025] p-4"><div className="flex items-center justify-between"><h2 className="text-sm font-bold">Grupos</h2><button onClick={() => { const name = window.prompt("Nombre del grupo de confianza"); if (name?.trim()) void action({ action: "create_group", name }); }} className="rounded-full border border-white/10 px-3 py-1.5 text-[10px]">+ Crear</button></div><div className="mt-3 grid gap-2">{acceptedGroups.map((group) => <div key={group.id} className="rounded-xl border border-white/8 p-3"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold">{group.name}</p><p className="mt-1 text-[10px] text-white/30">{group.members.filter((member) => member.status === "accepted").length + 1} personas</p></div>{group.isOwner ? <button onClick={() => void action({ action: "delete_group", groupId: group.id })} className="text-[10px] text-white/30">Eliminar</button> : <button onClick={() => void action({ action: "leave_group", groupId: group.id })} className="text-[10px] text-white/30">Salir</button>}</div>{group.isOwner && snapshot?.suggestions.length ? <div className="mt-2 flex flex-wrap gap-1">{snapshot.suggestions.slice(0,3).map((player) => <button key={player.owner_user_id} onClick={() => void action({ action: "invite_group", groupId: group.id, recipientUserId: player.owner_user_id })} className="rounded-full bg-white/[0.04] px-2.5 py-1.5 text-[9px] text-white/48">+ {player.display_name}</button>)}</div> : null}</div>)}{!acceptedGroups.length ? <p className="py-2 text-xs text-white/30">Creá un grupo para cuidarse entre varias personas.</p> : null}</div></section>
        </aside>
      </div>

      {(message || error) ? <div className={`fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-lg rounded-2xl border px-4 py-3 text-sm backdrop-blur-xl ${error ? "border-red-400/25 bg-red-950/80 text-red-100" : "border-cyan-200/20 bg-[#071317]/90 text-cyan-50"}`}>{error || message}</div> : null}
    </main>
  );
}
