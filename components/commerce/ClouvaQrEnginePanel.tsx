"use client";

import { Copy, Download, Printer, QrCode, Search, UserRound, X } from "lucide-react";
import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";

type Listing = { id: string; catalog_product_id: string | null; name: string; slug: string };
type Variant = { id: string; product_id: string; catalog_variant_id: string | null; title: string | null; color: string | null; size: string | null; sku: string | null };
type Identifier = {
  id: string;
  catalog_product_id: string;
  catalog_variant_id: string | null;
  identifier_type: string;
  value: string;
  public_token?: string | null;
  status: string;
};
type Overview = { listings: Listing[]; variants: Variant[]; identifiers: Identifier[] };
type UserResult = { userId: string; playerId: string; slug: string; username: string | null; displayName: string; public: boolean };
type QrResult = { publicToken: string; url: string; created: boolean; status: string };

const INPUT = "w-full rounded-xl border border-white/10 bg-black/35 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-400/60";
const BUTTON = "rounded-xl border border-white/10 px-3 py-2.5 text-sm text-white/70 transition hover:border-violet-400/35 hover:text-white disabled:cursor-not-allowed disabled:opacity-35";

export function ClouvaQrEnginePanel({ studioId }: { studioId: string }) {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"PRODUCT" | "USER">("PRODUCT");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [listingId, setListingId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<UserResult[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserResult | null>(null);
  const [userQr, setUserQr] = useState<QrResult | null>(null);
  const [qrPng, setQrPng] = useState("");
  const [qrSvg, setQrSvg] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const authFetch = useCallback(async (url: string, init?: RequestInit) => {
    if (!session?.access_token) throw new Error("La sesión no está disponible.");
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

  const loadOverview = useCallback(async () => {
    if (!session?.access_token) return;
    const payload = await authFetch(`/api/studios/${encodeURIComponent(studioId)}/commerce/spot`) as Overview;
    setOverview(payload);
    setListingId((current) => current || payload.listings?.[0]?.id || "");
  }, [authFetch, session?.access_token, studioId]);

  useEffect(() => {
    if (open && mode === "PRODUCT" && !overview) void loadOverview().catch((cause) => setError(cause instanceof Error ? cause.message : "No se pudieron cargar los productos."));
  }, [loadOverview, mode, open, overview]);

  const listing = overview?.listings.find((item) => item.id === listingId) ?? null;
  const variants = useMemo(() => overview?.variants.filter((item) => item.product_id === listingId) ?? [], [listingId, overview?.variants]);
  const selectedVariant = variants.find((item) => item.id === variantId) ?? null;
  const productQr = useMemo(() => {
    if (!listing?.catalog_product_id) return null;
    const catalogVariantId = selectedVariant?.catalog_variant_id ?? null;
    return overview?.identifiers.find((identifier) =>
      identifier.status === "active"
      && identifier.identifier_type === "clouva_qr"
      && identifier.catalog_product_id === listing.catalog_product_id
      && identifier.catalog_variant_id === catalogVariantId) ?? null;
  }, [listing?.catalog_product_id, overview?.identifiers, selectedVariant?.catalog_variant_id]);

  const activeUrl = mode === "PRODUCT" ? productQr?.value ?? "" : userQr?.url ?? "";

  useEffect(() => {
    if (!activeUrl) { setQrPng(""); setQrSvg(""); return; }
    let cancelled = false;
    Promise.all([
      QRCode.toDataURL(activeUrl, { width: 760, margin: 3, errorCorrectionLevel: "H" }),
      QRCode.toString(activeUrl, { type: "svg", margin: 3, errorCorrectionLevel: "H" }),
    ]).then(([png, svg]) => { if (!cancelled) { setQrPng(png); setQrSvg(svg); } });
    return () => { cancelled = true; };
  }, [activeUrl]);

  async function generateProductQr(allVariants = false) {
    if (!listingId) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const payload = await authFetch(`/api/studios/${encodeURIComponent(studioId)}/commerce/codes`, {
        method: "POST",
        body: JSON.stringify({
          action: allVariants ? "generate_all_variants" : "generate",
          listingId,
          variantId: allVariants ? null : variantId || null,
          identifierTypes: ["clouva_qr"],
        }),
      }) as { results?: Array<{ status?: string }> };
      const rows = payload.results ?? [];
      const created = rows.filter((row) => row.status === "created").length;
      const kept = rows.filter((row) => row.status === "kept").length;
      setMessage(allVariants ? `${created} QR creados · ${kept} QR existentes reutilizados.` : created ? "QR CLOUVA creado y guardado." : "QR CLOUVA existente reutilizado.");
      await loadOverview();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo generar el QR.");
    } finally { setBusy(false); }
  }

  async function searchUsers() {
    if (query.trim().length < 2) { setUsers([]); return; }
    setBusy(true); setError(null); setMessage(null);
    try {
      const payload = await authFetch(`/api/studios/${encodeURIComponent(studioId)}/commerce/users?q=${encodeURIComponent(query.trim())}`) as { users?: UserResult[] };
      setUsers(payload.users ?? []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudieron buscar usuarios."); }
    finally { setBusy(false); }
  }

  async function generateUserQr() {
    if (!selectedUser) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const payload = await authFetch(`/api/studios/${encodeURIComponent(studioId)}/commerce/user-qr`, {
        method: "POST",
        body: JSON.stringify({ userId: selectedUser.userId }),
      }) as { qr: QrResult };
      setUserQr(payload.qr);
      setMessage(payload.qr.created ? "QR de usuario creado." : "QR de usuario existente reutilizado.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo generar el QR del usuario."); }
    finally { setBusy(false); }
  }

  function download(href: string, filename: string) {
    const anchor = document.createElement("a");
    anchor.href = href; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  }

  async function copyQr() {
    if (!activeUrl) return;
    await navigator.clipboard.writeText(activeUrl);
    setMessage("Enlace QR copiado.");
  }

  function downloadSvg() {
    if (!qrSvg) return;
    const href = URL.createObjectURL(new Blob([qrSvg], { type: "image/svg+xml" }));
    download(href, `clouva-qr-${mode.toLowerCase()}.svg`);
    window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
  }

  async function productLabel(print = false) {
    if (!productQr || !session?.access_token) return;
    setBusy(true); setError(null);
    try {
      const params = new URLSearchParams({ format: "pdf", layout: "full", page: "label", size: "40x30", copies: "1", marginMm: "8", showPrice: "true", showSku: "true", showQr: "true", print: String(print) });
      const response = await fetch(`/api/studios/${encodeURIComponent(studioId)}/commerce/labels/${encodeURIComponent(productQr.id)}?${params}`, { headers: { authorization: `Bearer ${session.access_token}` } });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || "No se pudo generar la etiqueta."); }
      const href = URL.createObjectURL(await response.blob());
      if (print) window.open(href, "_blank", "noopener,noreferrer");
      else download(href, `clouva-etiqueta-${listing?.slug || "producto"}.pdf`);
      window.setTimeout(() => URL.revokeObjectURL(href), 30_000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo generar la etiqueta."); }
    finally { setBusy(false); }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="fixed bottom-5 right-5 z-[65] flex items-center gap-2 rounded-2xl border border-violet-300/25 bg-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-[0_18px_50px_rgba(91,33,182,.45)] hover:bg-violet-500">
        <QrCode className="h-4 w-4" /> QR CLOUVA
      </button>
      {open ? <div className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-sm" onMouseDown={(event) => { if (event.currentTarget === event.target) setOpen(false); }}>
        <section className="absolute right-0 top-0 h-full w-full max-w-[520px] overflow-y-auto border-l border-violet-400/20 bg-[#08070d] p-5 text-white shadow-[-30px_0_100px_rgba(0,0,0,.5)] sm:p-6">
          <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.22em] text-violet-300">CLOUVA QR ENGINE</p><h2 className="mt-1 text-2xl font-semibold">Crear QR</h2><p className="mt-2 text-sm text-white/45">Un mismo resolver para prendas, productos y usuarios.</p></div><button type="button" onClick={() => setOpen(false)} className="grid h-10 w-10 place-items-center rounded-xl border border-white/10"><X className="h-4 w-4" /></button></div>
          <div className="mt-6 grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-white/[.025] p-1.5">
            <button type="button" onClick={() => { setMode("PRODUCT"); setUserQr(null); }} className={`rounded-xl px-3 py-2.5 text-sm font-semibold ${mode === "PRODUCT" ? "bg-violet-600" : "text-white/45"}`}><QrCode className="mr-2 inline h-4 w-4" />Prenda / producto</button>
            <button type="button" onClick={() => setMode("USER")} className={`rounded-xl px-3 py-2.5 text-sm font-semibold ${mode === "USER" ? "bg-violet-600" : "text-white/45"}`}><UserRound className="mr-2 inline h-4 w-4" />Usuario</button>
          </div>

          {mode === "PRODUCT" ? <div className="mt-5 space-y-3">
            <label className="block text-xs text-white/45">Producto<select className={`${INPUT} mt-1.5`} value={listingId} onChange={(event) => { setListingId(event.target.value); setVariantId(""); setMessage(null); }}><option value="">Elegir producto</option>{overview?.listings.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label className="block text-xs text-white/45">Nivel<select className={`${INPUT} mt-1.5`} value={variantId} onChange={(event) => { setVariantId(event.target.value); setMessage(null); }}><option value="">Producto completo</option>{variants.map((variant) => <option key={variant.id} value={variant.id}>{[variant.color, variant.size, variant.sku].filter(Boolean).join(" · ") || variant.title || "Variante"}</option>)}</select></label>
            <button disabled={busy || !listing} onClick={() => void generateProductQr(false)} className="w-full rounded-xl bg-violet-600 px-4 py-3 font-semibold disabled:opacity-35">{productQr ? "MOSTRAR QR EXISTENTE" : "GENERAR QR CLOUVA"}</button>
            {variants.length ? <button disabled={busy || !listing} onClick={() => void generateProductQr(true)} className={`${BUTTON} w-full`}>Generar QR faltantes para todas las variantes</button> : null}
          </div> : <div className="mt-5 space-y-3">
            <label className="block text-xs text-white/45">Buscar usuario<div className="mt-1.5 flex gap-2"><input className={INPUT} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchUsers(); }} placeholder="@usuario o nombre" /><button type="button" disabled={busy || query.trim().length < 2} onClick={() => void searchUsers()} className="grid h-11 w-12 shrink-0 place-items-center rounded-xl bg-violet-600 disabled:opacity-35"><Search className="h-4 w-4" /></button></div></label>
            <div className="space-y-2">{users.map((item) => <button key={item.userId} type="button" onClick={() => { setSelectedUser(item); setUserQr(null); }} className={`w-full rounded-xl border p-3 text-left ${selectedUser?.userId === item.userId ? "border-violet-400/45 bg-violet-500/10" : "border-white/10 bg-white/[.02]"}`}><strong className="block text-sm">{item.displayName}</strong><span className="text-xs text-white/40">{item.username ? `@${item.username.replace(/^@/, "")}` : item.slug}{item.public ? " · Player público" : " · Player no publicado"}</span></button>)}</div>
            <button disabled={busy || !selectedUser} onClick={() => void generateUserQr()} className="w-full rounded-xl bg-violet-600 px-4 py-3 font-semibold disabled:opacity-35">{userQr ? "MOSTRAR QR EXISTENTE" : "GENERAR QR DE USUARIO"}</button>
          </div>}

          {activeUrl ? <div className="mt-6 rounded-[1.75rem] border border-violet-400/20 bg-white/[.035] p-4">
            <div className="mx-auto max-w-[260px] rounded-2xl bg-white p-3">{qrPng ? <img src={qrPng} alt="QR CLOUVA" className="aspect-square w-full" /> : null}</div>
            <p className="mt-3 break-all text-center text-[11px] text-white/40">{activeUrl}</p>
            <div className="mt-4 grid grid-cols-2 gap-2"><button onClick={() => void copyQr()} className={BUTTON}><Copy className="mr-2 inline h-4 w-4" />Copiar</button><button disabled={!qrPng} onClick={() => qrPng && download(qrPng, "clouva-qr.png")} className={BUTTON}><Download className="mr-2 inline h-4 w-4" />PNG</button><button disabled={!qrSvg} onClick={downloadSvg} className={BUTTON}><Download className="mr-2 inline h-4 w-4" />SVG</button>{mode === "PRODUCT" && productQr ? <button onClick={() => void productLabel(false)} className={BUTTON}><Printer className="mr-2 inline h-4 w-4" />Etiqueta PDF</button> : null}</div>
            {mode === "PRODUCT" && productQr ? <button onClick={() => void productLabel(true)} className="mt-2 w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold"><Printer className="mr-2 inline h-4 w-4" />Imprimir etiqueta 40 × 30 mm</button> : null}
          </div> : null}
          {message ? <p className="mt-4 rounded-xl border border-emerald-400/15 bg-emerald-400/[.06] p-3 text-sm text-emerald-200">{message}</p> : null}
          {error ? <p className="mt-4 rounded-xl border border-red-400/15 bg-red-400/[.06] p-3 text-sm text-red-200">{error}</p> : null}
          <p className="mt-6 text-xs leading-5 text-white/30">Los QR activos son estables: si la entidad ya tiene uno, CLOUVA lo reutiliza. El QR guarda solamente la URL pública del resolver.</p>
        </section>
      </div> : null}
    </>
  );
}
