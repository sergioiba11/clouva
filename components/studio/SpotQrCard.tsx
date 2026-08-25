"use client";

import { Copy, Download, ExternalLink, Printer, QrCode } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";

type SpotQrCardProps = {
  entityName: string;
  publicPath: string;
  isPublic: boolean;
  compact?: boolean;
};

const CANONICAL_ORIGIN = "https://clouva.com.ar";

function fileSlug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "spot";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function SpotQrCard({ entityName, publicPath, isPublic, compact = false }: SpotQrCardProps) {
  const publicUrl = useMemo(() => {
    const normalizedPath = publicPath.startsWith("/") ? publicPath : `/${publicPath}`;
    return new URL(normalizedPath, CANONICAL_ORIGIN).toString();
  }, [publicPath]);
  const [qrPng, setQrPng] = useState("");
  const [qrSvg, setQrSvg] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      QRCode.toDataURL(publicUrl, { width: 960, margin: 3, errorCorrectionLevel: "H" }),
      QRCode.toString(publicUrl, { type: "svg", margin: 3, errorCorrectionLevel: "H" }),
    ]).then(([png, svg]) => {
      if (!cancelled) {
        setQrPng(png);
        setQrSvg(svg);
      }
    });
    return () => { cancelled = true; };
  }, [publicUrl]);

  async function copyLink() {
    await navigator.clipboard.writeText(publicUrl);
    setMessage("Enlace del Spot copiado.");
    window.setTimeout(() => setMessage(null), 2200);
  }

  function downloadPng() {
    if (!qrPng) return;
    const anchor = document.createElement("a");
    anchor.href = qrPng;
    anchor.download = `${fileSlug(entityName)}-spot-qr.png`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  function downloadSvg() {
    if (!qrSvg) return;
    const href = URL.createObjectURL(new Blob([qrSvg], { type: "image/svg+xml" }));
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `${fileSlug(entityName)}-spot-qr.svg`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
  }

  function printQr() {
    if (!qrPng) return;
    const popup = window.open("", "_blank", "noopener,noreferrer,width=760,height=900");
    if (!popup) return;
    popup.document.write(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(entityName)} — QR del Spot</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Inter, Arial, sans-serif; color: #111; background: #fff; }
    main { width: min(92vw, 620px); padding: 48px; text-align: center; }
    h1 { margin: 0; font-size: 34px; letter-spacing: -.03em; }
    p { color: #555; }
    img { display: block; width: min(72vw, 430px); height: auto; margin: 32px auto; }
    .url { font-size: 13px; word-break: break-all; color: #777; }
    @media print { main { width: 100%; } }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(entityName)}</h1>
    <p>Escaneá para entrar a nuestro Spot en CLOUVA</p>
    <img src="${qrPng}" alt="QR del Spot" />
    <p class="url">${escapeHtml(publicUrl)}</p>
  </main>
  <script>window.onload = () => { window.print(); };</script>
</body>
</html>`);
    popup.document.close();
  }

  const status = isPublic ? "Spot público" : "Spot no publicado";

  if (compact) {
    return (
      <div className="rounded-[1.5rem] border border-violet-400/20 bg-[radial-gradient(circle_at_0%_0%,rgba(124,58,237,.18),transparent_52%),rgba(255,255,255,.025)] p-5">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">Tu Spot</p>
            <h3 className="mt-2 text-xl font-semibold">{entityName}</h3>
            <div className="mt-2 flex items-center gap-2 text-sm text-white/55">
              <span className={`h-2 w-2 rounded-full ${isPublic ? "bg-emerald-400" : "bg-amber-300"}`} />
              {status}
            </div>
            <p className="mt-3 max-w-lg truncate text-xs text-white/35">{publicUrl}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <a href={publicUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-3 py-2 text-xs font-semibold">
                Ver Spot <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <button type="button" onClick={() => void copyLink()} className="inline-flex items-center gap-2 rounded-xl border border-white/12 px-3 py-2 text-xs text-white/70">
                <Copy className="h-3.5 w-3.5" /> Copiar link
              </button>
            </div>
            {message ? <p className="mt-3 text-xs text-emerald-300">{message}</p> : null}
          </div>
          <div className="shrink-0 rounded-2xl bg-white p-2 shadow-[0_0_35px_rgba(139,92,246,.16)]">
            {qrPng ? <img src={qrPng} alt={`QR del Spot de ${entityName}`} className="h-32 w-32" /> : <div className="grid h-32 w-32 place-items-center text-black/35"><QrCode className="h-8 w-8" /></div>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[2rem] border border-violet-400/20 bg-[radial-gradient(circle_at_15%_0%,rgba(124,58,237,.22),transparent_38%),#0b0913]">
      <div className="border-b border-white/8 px-5 py-5 sm:px-7">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-300">QR del Spot</p>
            <h2 className="mt-2 text-2xl font-semibold">{entityName}</h2>
            <p className="mt-1 text-sm text-white/45">QR permanente conectado a la página pública del Spot.</p>
          </div>
          <div className="inline-flex items-center gap-2 self-start rounded-full border border-white/10 bg-black/25 px-3 py-1.5 text-xs text-white/60">
            <span className={`h-2 w-2 rounded-full ${isPublic ? "bg-emerald-400 shadow-[0_0_8px_#34d399]" : "bg-amber-300"}`} />
            {status}
          </div>
        </div>
      </div>

      <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-center">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-white/35">URL pública canónica</p>
          <p className="mt-2 break-all rounded-xl border border-white/10 bg-black/25 p-3 text-sm text-white/70">{publicUrl}</p>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-white/45">
            Este QR abre el Spot público. Cambiar contenido, membresías, servicios o diseño no cambia el QR impreso.
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            <a href={publicUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold transition hover:bg-violet-500">
              Ver Spot <ExternalLink className="h-4 w-4" />
            </a>
            <button type="button" onClick={() => void copyLink()} className="inline-flex items-center gap-2 rounded-xl border border-white/12 px-4 py-2.5 text-sm text-white/75 transition hover:border-violet-400/35 hover:text-white">
              <Copy className="h-4 w-4" /> Copiar enlace
            </button>
            <button type="button" disabled={!qrPng} onClick={downloadPng} className="inline-flex items-center gap-2 rounded-xl border border-white/12 px-4 py-2.5 text-sm text-white/75 transition hover:border-violet-400/35 hover:text-white disabled:opacity-35">
              <Download className="h-4 w-4" /> Descargar PNG
            </button>
            <button type="button" disabled={!qrSvg} onClick={downloadSvg} className="inline-flex items-center gap-2 rounded-xl border border-white/12 px-4 py-2.5 text-sm text-white/75 transition hover:border-violet-400/35 hover:text-white disabled:opacity-35">
              <Download className="h-4 w-4" /> SVG
            </button>
            <button type="button" disabled={!qrPng} onClick={printQr} className="inline-flex items-center gap-2 rounded-xl border border-white/12 px-4 py-2.5 text-sm text-white/75 transition hover:border-violet-400/35 hover:text-white disabled:opacity-35">
              <Printer className="h-4 w-4" /> Imprimir QR
            </button>
          </div>
          {message ? <p className="mt-4 text-sm text-emerald-300">{message}</p> : null}
        </div>

        <div className="mx-auto w-full max-w-[320px] rounded-[2rem] border border-white/10 bg-white p-4 shadow-[0_0_60px_rgba(124,58,237,.2)]">
          {qrPng ? <img src={qrPng} alt={`QR del Spot de ${entityName}`} className="aspect-square w-full" /> : <div className="grid aspect-square w-full place-items-center text-black/30"><QrCode className="h-12 w-12" /></div>}
          <div className="px-2 pb-2 pt-3 text-center text-black">
            <p className="font-semibold">{entityName}</p>
            <p className="mt-1 text-xs text-black/55">Escaneá para entrar al Spot</p>
          </div>
        </div>
      </div>
    </div>
  );
}
