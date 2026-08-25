"use client";

import { Copy, Download, QrCode, Share2 } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";

type QrPayload = {
  player: {
    slug: string;
    username: string | null;
    display_name?: string;
    displayName?: string;
  };
  qr: {
    publicToken: string;
    url: string;
    status: "ACTIVE" | "REVOKED";
    created: boolean;
  };
};

export function MyQrCard() {
  const { session, loading } = useAuth();
  const [payload, setPayload] = useState<QrPayload | null>(null);
  const [pngUrl, setPngUrl] = useState("");
  const [svg, setSvg] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !session?.access_token) return;
    let cancelled = false;
    setBusy(true);
    fetch("/api/clouva-qr", {
      method: "POST",
      headers: { authorization: `Bearer ${session.access_token}` },
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "No se pudo abrir tu QR.");
        return body as QrPayload;
      })
      .then((body) => { if (!cancelled) setPayload(body); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "No se pudo abrir tu QR."); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [loading, session?.access_token]);

  useEffect(() => {
    if (!payload?.qr.url) return;
    let cancelled = false;
    Promise.all([
      QRCode.toDataURL(payload.qr.url, { width: 920, margin: 3, errorCorrectionLevel: "H" }),
      QRCode.toString(payload.qr.url, { type: "svg", margin: 3, errorCorrectionLevel: "H" }),
    ]).then(([png, vector]) => {
      if (!cancelled) { setPngUrl(png); setSvg(vector); }
    }).catch(() => { if (!cancelled) setError("No se pudo renderizar el QR."); });
    return () => { cancelled = true; };
  }, [payload?.qr.url]);

  const handle = useMemo(() => {
    const value = payload?.player.username?.trim().replace(/^@/, "");
    return value ? `@${value}` : payload?.player.display_name || payload?.player.displayName || payload?.player.slug || "CLOUVA";
  }, [payload]);

  function download(href: string, filename: string) {
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  async function copyLink() {
    if (!payload?.qr.url) return;
    await navigator.clipboard.writeText(payload.qr.url);
    setMessage("Enlace copiado.");
  }

  async function share() {
    if (!payload?.qr.url) return;
    if (navigator.share) await navigator.share({ title: `QR CLOUVA · ${handle}`, url: payload.qr.url });
    else await copyLink();
  }

  function downloadSvg() {
    if (!svg) return;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    download(url, `clouva-qr-${payload?.player.slug || "player"}.svg`);
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  if (busy) return <div className="rounded-[2rem] border border-violet-400/20 bg-[#0b0912] p-10 text-center text-white/50">Preparando tu QR CLOUVA…</div>;
  if (error) return <div className="rounded-[2rem] border border-red-400/20 bg-[#0b0912] p-8 text-red-200">{error}</div>;
  if (!payload) return null;

  return (
    <section className="overflow-hidden rounded-[2rem] border border-violet-400/25 bg-[radial-gradient(circle_at_top_right,rgba(124,58,237,.24),transparent_45%),#0b0912] p-6 shadow-[0_30px_100px_rgba(91,33,182,.18)] sm:p-8">
      <div className="text-center">
        <p className="text-xs font-bold uppercase tracking-[.24em] text-violet-300">QR CLOUVA</p>
        <h1 className="mt-3 text-3xl font-semibold">Mi QR</h1>
        <p className="mt-2 text-white/50">Tu identidad permanente dentro de La Matrix.</p>
      </div>
      <div className="mx-auto mt-7 max-w-sm rounded-[2rem] bg-white p-5 text-black">
        {pngUrl ? <img src={pngUrl} alt={`QR CLOUVA de ${handle}`} className="aspect-square w-full" /> : <div className="grid aspect-square place-items-center"><QrCode className="h-16 w-16" /></div>}
        <div className="mt-3 text-center"><strong className="text-lg">{handle}</strong><p className="mt-1 text-xs text-black/50">clouva.com.ar/q/…</p></div>
      </div>
      <div className="mx-auto mt-6 grid max-w-xl gap-2 sm:grid-cols-4">
        <button onClick={copyLink} className="rounded-xl border border-white/10 px-3 py-3 text-sm text-white/75 hover:border-violet-400/35"><Copy className="mr-2 inline h-4 w-4" />Copiar</button>
        <button onClick={share} className="rounded-xl border border-white/10 px-3 py-3 text-sm text-white/75 hover:border-violet-400/35"><Share2 className="mr-2 inline h-4 w-4" />Compartir</button>
        <button disabled={!pngUrl} onClick={() => pngUrl && download(pngUrl, `clouva-qr-${payload.player.slug}.png`)} className="rounded-xl border border-white/10 px-3 py-3 text-sm text-white/75 disabled:opacity-35"><Download className="mr-2 inline h-4 w-4" />PNG</button>
        <button disabled={!svg} onClick={downloadSvg} className="rounded-xl bg-violet-600 px-3 py-3 text-sm font-semibold disabled:opacity-35"><Download className="mr-2 inline h-4 w-4" />SVG</button>
      </div>
      {message ? <p className="mt-4 text-center text-xs text-emerald-300">{message}</p> : null}
      <p className="mt-5 text-center text-xs text-white/35">El QR conserva el mismo token. Al escanearlo abre tu perfil público Player.</p>
    </section>
  );
}
