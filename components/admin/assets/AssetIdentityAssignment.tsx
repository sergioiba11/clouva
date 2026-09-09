"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Loader2, Link2 } from "lucide-react";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import { BRAND_IDENTITY_ROLES, type BrandIdentityRole } from "@/lib/server/brand-engine/admin-asset-assignment";

type OwnerType = "studio" | "player";
type OwnerOption = { id: string; name: string; slug: string | null };
type OwnersResponse = { studios: OwnerOption[]; players: OwnerOption[] };
type AssignmentResponse = { ok: true; brandAssetId: string; brandAssetVersionId: string; published: boolean };

type Props = {
  source: string;
  bucket: string;
  path: string;
  name: string;
};

const ROLE_LABELS: Record<BrandIdentityRole, string> = {
  primary: "Primary / logo principal",
  symbol: "Symbol / isotipo",
  horizontal: "Horizontal",
  vertical: "Vertical",
  square: "Square / avatar",
  transparent: "Transparent",
  white: "White / fondo oscuro",
  black: "Black / fondo claro",
  favicon: "Favicon",
  "master-svg": "Master SVG",
  "symbol-svg": "Symbol SVG",
  "horizontal-svg": "Horizontal SVG",
  "vertical-svg": "Vertical SVG",
  "white-svg": "White SVG",
  "black-svg": "Black SVG",
  "monochrome-svg": "Monochrome SVG",
  "print-pdf": "Print PDF",
  "brand-config": "Brand config JSON",
};

export function AssetIdentityAssignment({ source, bucket, path, name }: Props) {
  const [owners, setOwners] = useState<OwnersResponse>({ studios: [], players: [] });
  const [loadingOwners, setLoadingOwners] = useState(true);
  const [ownerType, setOwnerType] = useState<OwnerType>("studio");
  const [ownerId, setOwnerId] = useState("");
  const [role, setRole] = useState<BrandIdentityRole>("primary");
  const [publish, setPublish] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<AssignmentResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoadingOwners(true);
      try {
        const response = await authenticatedFetch("/api/admin/assets/identity");
        const data = await readApiJson<OwnersResponse>(response);
        if (!cancelled) {
          setOwners(data);
          setOwnerId(data.studios[0]?.id ?? "");
        }
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "No se pudieron cargar Studios y Players.");
      } finally {
        if (!cancelled) setLoadingOwners(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  const ownerOptions = useMemo(() => ownerType === "studio" ? owners.studios : owners.players, [ownerType, owners]);

  const changeOwnerType = (next: OwnerType) => {
    setOwnerType(next);
    const list = next === "studio" ? owners.studios : owners.players;
    setOwnerId(list[0]?.id ?? "");
  };

  const submit = async () => {
    if (!ownerId || busy) return;
    setBusy(true);
    setMessage(null);
    setResult(null);
    try {
      const response = await authenticatedFetch("/api/admin/assets/identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerType,
          ownerId,
          publish,
          assignments: [{ source, bucket, path, role }],
        }),
      });
      const data = await readApiJson<AssignmentResponse>(response);
      setResult(data);
      setMessage(data.published ? "Asset asignado y pack oficial publicado." : "Asset asignado al pack de identidad. Podés seguir agregando variantes antes de publicarlo.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo asignar el asset.");
    } finally {
      setBusy(false);
    }
  };

  const hasInput = Boolean(source && bucket && path);

  return (
    <div className="space-y-4 pb-24 text-white">
      <Link href="/admin/assets" className="inline-flex items-center gap-2 text-sm text-white/55 hover:text-white"><ArrowLeft className="h-4 w-4" />Volver a Assets</Link>

      <header className="rounded-[1.5rem] border border-violet-400/20 bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,0.18),transparent_38%),rgba(0,0,0,0.32)] p-5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-violet-200"><Link2 className="h-4 w-4" />Asignar a identidad</div>
        <h1 className="mt-2 text-2xl font-semibold">Convertir un asset existente en branding reutilizable</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-white/45">CLOUVA conserva el archivo original. Acá solamente registrás qué significa dentro del Brand Engine y a qué Studio o Player pertenece.</p>
      </header>

      <section className="rounded-[1.4rem] border border-white/10 bg-black/25 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/30">Asset seleccionado</p>
        <p className="mt-2 text-base font-semibold">{name || path || "Sin asset"}</p>
        <p className="mt-1 break-all text-xs text-white/35">{source || "—"} · {bucket || "—"} · {path || "—"}</p>
      </section>

      {!hasInput ? <div className="rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-4 text-sm text-amber-100">Volvé a Asset Explorer y elegí “Asignar a identidad” desde un archivo real.</div> : null}

      <section className="grid gap-4 rounded-[1.4rem] border border-white/10 bg-black/25 p-4 lg:grid-cols-2">
        <label className="text-xs text-white/45">Tipo de dueño<select value={ownerType} onChange={(event) => changeOwnerType(event.target.value as OwnerType)} disabled={busy || loadingOwners} className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/40 px-3 text-sm text-white outline-none"><option value="studio">Studio</option><option value="player">Player</option></select></label>
        <label className="text-xs text-white/45">{ownerType === "studio" ? "Studio" : "Player"}<select value={ownerId} onChange={(event) => setOwnerId(event.target.value)} disabled={busy || loadingOwners} className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/40 px-3 text-sm text-white outline-none"><option value="">Elegir…</option>{ownerOptions.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}{owner.slug ? ` · ${owner.slug}` : ""}</option>)}</select></label>
        <label className="text-xs text-white/45 lg:col-span-2">Rol semántico<select value={role} onChange={(event) => setRole(event.target.value as BrandIdentityRole)} disabled={busy} className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/40 px-3 text-sm text-white outline-none">{BRAND_IDENTITY_ROLES.map((value) => <option key={value} value={value}>{ROLE_LABELS[value]}</option>)}</select></label>
        <label className="lg:col-span-2 flex items-start gap-3 rounded-xl border border-violet-400/15 bg-violet-400/[0.05] p-3 text-sm text-white/65"><input type="checkbox" checked={publish} onChange={(event) => setPublish(event.target.checked)} disabled={busy} className="mt-1 accent-violet-500" /><span><strong className="text-white/85">Publicar como pack oficial activo</strong><span className="mt-1 block text-xs leading-5 text-white/40">Usalo cuando el archivo forma parte de la identidad oficial. Para publicar se necesita al menos un Primary; podés asignar el resto primero y publicar al final.</span></span></label>
      </section>

      {message ? <div className={`rounded-xl border px-4 py-3 text-sm ${result ? "border-emerald-300/20 bg-emerald-300/[0.06] text-emerald-100" : "border-violet-400/20 bg-violet-400/[0.07] text-violet-100"}`}>{message}</div> : null}

      <div className="flex flex-wrap justify-end gap-2"><Link href="/admin/assets" className="rounded-xl border border-white/10 px-4 py-3 text-sm text-white/55">Cancelar</Link><button type="button" onClick={() => void submit()} disabled={!hasInput || !ownerId || busy || loadingOwners} className="inline-flex min-w-44 items-center justify-center gap-2 rounded-xl bg-violet-500 px-5 py-3 text-sm font-semibold disabled:opacity-40">{busy || loadingOwners ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{publish ? "Asignar y publicar" : "Asignar a identidad"}</button></div>
    </div>
  );
}
