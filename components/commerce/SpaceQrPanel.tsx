"use client";

import { Copy, Download, ExternalLink, Loader2, Printer, QrCode } from "lucide-react";
import { useEffect, useState } from "react";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type SpaceQrPayload = {
  space: {
    id: string;
    name: string;
    slug: string;
    type: string;
    publicEnabled: boolean;
    status: string;
  };
  publicUrl: string;
  qrDataUrl: string;
  qr: {
    id: string;
    publicToken: string;
    url: string;
    status: string;
    destinationPath: string | null;
  };
};

export function SpaceQrPanel({ spaceId }: { spaceId: string }) {
  const [data, setData] = useState<SpaceQrPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await authenticatedFetch(`/api/spaces/${encodeURIComponent(spaceId)}/qr`);
        const payload = await readApiJson<SpaceQrPayload>(response);
        if (!cancelled) setData(payload);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "No se pudo cargar el QR del espacio.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [spaceId]);

  async function copyPublicUrl() {
    if (!data) return;
    await navigator.clipboard.writeText(data.publicUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function downloadQr() {
    if (!data) return;
    const anchor = document.createElement("a");
    anchor.href = data.qrDataUrl;
    anchor.download = `${data.space.slug}-qr.png`;
    anchor.click();
  }

  function printQr() {
    if (!data) return;
    const frame = document.createElement("iframe");
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    frame.onload = () => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      window.setTimeout(() => frame.remove(), 1000);
    };
    frame.src = data.qrDataUrl;
    document.body.appendChild(frame);
  }

  if (loading) return <div className="mt-5 flex min-h-40 items-center justify-center rounded-[24px] border border-white/[0.08] bg-[#0b0912] text-sm text-white/40"><Loader2 size={16} className="mr-2 animate-spin" /> Preparando QR permanente…</div>;
  if (error) return <div className="mt-5 rounded-[24px] border border-rose-300/15 bg-rose-300/[0.05] p-5 text-sm text-rose-200">{error}</div>;
  if (!data) return null;

  return (
    <section className="mt-5 rounded-[24px] border border-white/[0.08] bg-[#0b0912] p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div><p className="text-xs uppercase tracking-[.15em] text-white/32">QR del espacio</p><h2 className="mt-1 text-xl font-semibold">{data.space.name}</h2></div>
        <span className="grid h-10 w-10 place-items-center rounded-2xl border border-violet-300/15 bg-violet-300/[0.06] text-violet-300"><QrCode size={19} /></span>
      </div>
      <div className="mt-5 grid gap-5 sm:grid-cols-[190px_1fr] sm:items-center">
        <div className="rounded-2xl bg-white p-3"><img src={data.qrDataUrl} alt={`QR de ${data.space.name}`} className="aspect-square w-full" /></div>
        <div>
          <p className="text-xs uppercase tracking-[.13em] text-white/28">URL pública</p>
          <p className="mt-1 break-all text-sm text-white/70">{data.publicUrl}</p>
          <p className="mt-3 text-xs text-white/38">Estado: <span className={data.space.publicEnabled ? "text-emerald-300" : "text-amber-300"}>{data.space.publicEnabled ? "público" : "no publicado"}</span> · QR {data.qr.status.toLowerCase()}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <a href={data.publicUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-3.5 py-2.5 text-xs font-semibold"><ExternalLink size={14} /> Ver</a>
            <button type="button" onClick={() => void copyPublicUrl()} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-xs"><Copy size={14} /> {copied ? "Copiado" : "Copiar enlace"}</button>
            <button type="button" onClick={downloadQr} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-xs"><Download size={14} /> Descargar QR</button>
            <button type="button" onClick={printQr} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-xs"><Printer size={14} /> Imprimir QR</button>
          </div>
        </div>
      </div>
    </section>
  );
}
