"use client";
import { useCallback, useEffect, useState } from "react";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import type { EvidenceRole, ReconciliationGroup, ReconciliationLine, ReconciliationReport } from "@/lib/commerce/product-reconciliation";

type Payload = {
  report: ReconciliationReport; revision: string; editable: boolean;
  groups: ReconciliationGroup[]; lines: ReconciliationLine[];
  sources: { source_index: number; source_url: string; file_name: string | null; listing_id: string | null; recognition?: { context_only?: boolean; unassigned_evidence?: boolean; suggested_role?: string; matched_group_keys?: string[]; matched_products?: { group_key: string; label: string; confidence: number }[]; observed_products?: string[]; context_reason?: string; [key: string]: unknown } | null }[];
  existingProducts: { id: string; name: string }[]; existingLinks: Record<string, { listingId: string }>;
  invoice: { source_url: string; currency: string | null } | null;
};
const symbols: Record<EvidenceRole, string> = { front: "↑", back: "↓", code: "X", other: "O" };
const labels: Record<EvidenceRole, string> = { front: "Frente", back: "Atrás", code: "QR / código", other: "Otras imágenes" };
const button = "min-h-11 rounded-xl border-2 border-violet-800 px-4 py-2 text-sm font-bold disabled:opacity-40";
const money = (value: number, currency: string) => new Intl.NumberFormat("es-AR", { style: "currency", currency }).format(value);
export function CommerceProductReview({ studioId, batchId, refreshKey, busy, onPendingChange, onReceive, onReanalyze, onUnitCount }: {
  studioId: string; batchId: string; refreshKey: string; busy: boolean;
  onPendingChange: (pending: number | null) => void;
  onReceive: () => void; onReanalyze: () => void; onUnitCount: (key: string, count: number) => Promise<void>;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState("");
  const [gallery, setGallery] = useState<{ groupKey: string; role?: EvidenceRole } | null>(null);
  const [chooseLine, setChooseLine] = useState("");
  const [extraValues, setExtraValues] = useState<Record<string, string>>({});
  const [unassignedTargets, setUnassignedTargets] = useState<Record<number, string>>({});
  const [onlyPending, setOnlyPending] = useState(false);
  const base = `/api/studios/${encodeURIComponent(studioId)}/commerce/import-batches/${encodeURIComponent(batchId)}`;
  const accept = useCallback((payload: Payload) => { const unassigned = payload.sources.filter(photo => photo.recognition?.unassigned_evidence === true).length; setData(payload); onPendingChange(payload.report.pending + unassigned); }, [onPendingChange]);
  const refresh = useCallback(async () => {
    const response = await authenticatedFetch(`${base}/reconcile`);
    accept(await readApiJson<Payload>(response));
  }, [base, accept]);
  useEffect(() => {
    let active = true;
    onPendingChange(null);
    void authenticatedFetch(`${base}/reconcile`).then(readApiJson<Payload>).then(payload => { if (active) accept(payload); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "No se pudo cargar la revisión."); });
    return () => { active = false; };
  }, [base, refreshKey, accept, onPendingChange]);
  async function decide(kind: string, groupKey?: string, lineId?: string, quantity = 1, listingId?: string, amount?: number) {
    if (!data || saving || busy) return;
    setSaving(groupKey || lineId || "review"); setError("");
    try {
      const response = await authenticatedFetch(`${base}/reconcile`, { method: "PATCH", body: JSON.stringify({ kind, groupKey, lineId, quantity, listingId, amount, revision: data.revision, actionId: crypto.randomUUID() }) });
      accept(await readApiJson<Payload>(response)); setChooseLine("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo confirmar."); await refresh().catch(() => {}); }
    finally { setSaving(""); }
  }
  async function assignEvidence(sourceIndex: number, lineId: string, role?: string) {
    if (!data || !lineId || saving || busy) return;
    setSaving(`unassigned-${sourceIndex}`); setError("");
    try {
      const response = await authenticatedFetch(`${base}/reconcile`, { method: "PATCH", body: JSON.stringify({ kind: "assign_evidence", sourceIndex, lineId, role, revision: data.revision, actionId: crypto.randomUUID() }) });
      accept(await readApiJson<Payload>(response));
      setUnassignedTargets(values => { const next = { ...values }; delete next[sourceIndex]; return next; });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo asignar la imagen."); await refresh().catch(() => {}); }
    finally { setSaving(""); }
  }
  async function addPhoto(groupKey: string, role: EvidenceRole, file?: File) {
    if (!data || !file || saving) return;
    setSaving(groupKey); setError("");
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
      const response = await authenticatedFetch(`${base}/evidence`, { method: "POST", body: JSON.stringify({ groupKey, role, fileName: file.name, dataUrl, revision: data.revision }) });
      accept(await readApiJson<Payload>(response));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo agregar la foto."); await refresh().catch(() => {}); }
    finally { setSaving(""); }
  }
  if (!data) return <div className="mt-4 rounded-2xl bg-white p-5 text-violet-950">{error || "Abriendo productos…"}</div>;
  const disabled = busy || Boolean(saving) || !data.editable;
  const source = (index: number) => data.sources.find(photo => photo.source_index === index);
  const selected = gallery ? data.report.products.find(p => p.groupKey === gallery.groupKey) : null;
  const galleryIndexes = selected ? gallery?.role ? selected.images[gallery.role] : [...new Set(Object.values(selected.images).flat())] : [];
  const display = data.report.products.filter(p => !onlyPending || p.pending || p.shortage > 0 || p.missingImages.length > 0);
  const contextSources = data.sources.filter(photo => photo.recognition?.context_only === true && photo.recognition?.unassigned_evidence !== true);
  const unassignedSources = data.sources.filter(photo => photo.recognition?.unassigned_evidence === true);
  const totalPending = data.report.pending + unassignedSources.length;
  return <section aria-label="Revisión por producto" className="mt-4 rounded-3xl border-2 border-violet-800 bg-white p-3 text-violet-950 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="text-xl font-black">Revisá tus productos</h3><p className="text-sm">{data.report.hasInvoice ? data.lines.length : data.report.products.length} artículos · {data.report.totals.physical} unidades físicas</p></div>
      <button className={button} disabled={disabled} onClick={onReanalyze}>Reanalizar</button>
    </div>
    <div className="my-4 flex flex-wrap gap-2 text-xs" aria-label="Leyenda de símbolos">
      {(["front", "back", "code", "other"] as EvidenceRole[]).map(role => <span key={role} className="rounded-lg bg-violet-50 px-2 py-1"><b className="mr-1 text-xl">{symbols[role]}</b>{labels[role]}</span>)}
      <span className="rounded-lg bg-violet-50 px-2 py-1"><b className="mr-1 text-xl">●</b>Todas las fotos</span>
    </div>
    {error && <p role="alert" className="my-3 rounded-xl border-2 border-sky-500 bg-sky-50 p-3 text-sm">{error}</p>}
    <div className="mb-4 flex flex-wrap gap-2">
      <button className={`${button} ${!onlyPending ? "bg-violet-800 text-white" : "bg-white"}`} onClick={() => setOnlyPending(false)}>Todos</button>
      <button className={`${button} ${onlyPending ? "bg-violet-800 text-white" : "bg-white"}`} onClick={() => setOnlyPending(true)}>Observaciones</button>
      {data.invoice && <a href={data.invoice.source_url} target="_blank" rel="noreferrer" className={`${button} ml-auto`}>Factura</a>}
    </div>
    {contextSources.length > 0 && <div className="mb-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
      {contextSources.map(photo => {
        const keys = Array.isArray(photo.recognition?.matched_group_keys) ? photo.recognition.matched_group_keys : [];
        const directLabels = Array.isArray(photo.recognition?.matched_products) ? photo.recognition.matched_products.map(item => item.label).filter(Boolean) : [];
        const invoiceArticles = data.lines.filter(line => line.matched_group_keys.some(key => keys.includes(key)));
        const articleLabels = directLabels.length ? directLabels : invoiceArticles.map(line => line.description);
        return <article key={photo.source_index} className="overflow-hidden rounded-2xl border-2 border-sky-500 bg-sky-50 p-3">
          <div className="flex gap-3">
            <img src={photo.source_url} alt="Foto con varios productos" className="h-24 w-24 shrink-0 rounded-xl border-2 border-sky-300 object-cover" />
            <div className="min-w-0"><h4 className="font-black">FOTO CON VARIOS PRODUCTOS</h4><p className="mt-1 text-xs font-bold text-sky-700">ARTÍCULOS DE LA FACTURA</p>
              <div className="mt-2 flex flex-wrap gap-1">{articleLabels.length ? articleLabels.map((label, index) => <span key={`${photo.source_index}-${index}`} className="rounded-lg border-2 border-violet-800 bg-white px-2 py-1 text-xs font-bold">{label}</span>) : <span className="text-xs font-bold">Sin coincidencia segura en factura</span>}</div>
            </div>
          </div>
        </article>;
      })}
    </div>}
    {unassignedSources.length > 0 && <details className="mb-4 rounded-2xl border-2 border-amber-400 bg-amber-50 p-3"><summary className="cursor-pointer list-none font-black">REVISAR {unassignedSources.length} IMÁGENES DUDOSAS <span className="ml-2 text-xs font-bold">· excepción · no suman stock</span></summary><p className="mt-2 text-xs font-bold">CLOUVA no pudo vincular estas imágenes después de reconstruir los objetos físicos. Abrí esta sección solamente para resolver los casos que realmente queden dudosos.</p><div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{unassignedSources.map(photo => <div key={photo.source_index} className="flex gap-2 rounded-xl border-2 border-amber-300 bg-white p-2"><a href={photo.source_url} target="_blank" rel="noreferrer" className="shrink-0"><img src={photo.source_url} alt="Imagen dudosa" className="h-20 w-20 rounded-lg object-cover" /></a><div className="min-w-0 flex-1"><div className="mb-1 text-[10px] font-black">DUDOSA · {photo.recognition?.suggested_role || "Detalle"}</div><select aria-label={`Asignar imagen ${photo.source_index}`} value={unassignedTargets[photo.source_index] || ""} disabled={disabled} onChange={event => setUnassignedTargets(values => ({ ...values, [photo.source_index]: event.target.value }))} className="h-9 w-full rounded-lg border-2 border-violet-800 bg-white px-2 text-xs"><option value="">Elegir artículo…</option>{data.lines.map(line => <option key={line.id} value={line.id}>{line.description}</option>)}</select><button disabled={disabled || !unassignedTargets[photo.source_index]} className="mt-1 h-9 w-full rounded-lg bg-violet-800 px-2 text-xs font-bold text-white disabled:opacity-40" onClick={() => void assignEvidence(photo.source_index, unassignedTargets[photo.source_index] || "", photo.recognition?.suggested_role)}>Asignar</button></div></div>)}</div></details>}
    <div className="grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-3">
      {display.map(product => {
        const front = product.images.front[0];
        const frontPhoto = front != null ? source(front) : null;
        const group = data.groups.find(g => g.groupKey === product.groupKey)!;
        const suggestion = product.candidates.find(c => c.suggested);
        const unknownExtra = data.report.hasInvoice && product.expected === 0 && product.extra > product.unbilled;
        const remainingExtra = product.extra - product.unbilled;
        const currency = data.invoice?.currency || "ARS";
        const extraValueText = extraValues[product.groupKey] ?? "";
        const extraValue = extraValueText.trim() === "" ? null : Number(extraValueText.replace(",", "."));
        const validExtraValue = extraValue != null && Number.isFinite(extraValue) && extraValue >= 0;
        const relatedLines = data.report.lines.filter(line => product.allocations.some(a => a.lineId === line.id) || data.lines.find(l => l.id === line.id)?.matched_group_keys.includes(product.groupKey));
        const transferred = product.allocations.filter(a => a.reassigned);
        const ordinaryMissing = product.missingImages.filter(role => role !== "code");
        return <article key={product.groupKey} className={`overflow-hidden rounded-2xl border-2 border-violet-800 p-3 ${unknownExtra ? "order-10 border-sky-500 bg-sky-50" : "order-0"}`}>
          <h4 className="mb-2 text-center text-lg font-black">{product.name}</h4>
          {group.brand && !product.name.toLowerCase().includes(group.brand.toLowerCase()) && <p className="mb-2 text-center text-sm">{group.brand}</p>}
          <button type="button" className="relative flex h-44 w-full items-center justify-center rounded-xl border-2 border-dashed border-violet-700 bg-violet-50" onClick={() => setGallery({ groupKey: product.groupKey, role: "front" })} aria-label={`Frente de ${product.name}`}>
            {frontPhoto ? <img src={frontPhoto.source_url} alt={`Frente de ${product.name}`} className="h-full w-full rounded-lg object-contain" /> : <span className="text-6xl">↑ <span className="text-sky-500">?</span></span>}
          </button>
          <div className="my-3 grid grid-cols-4 gap-2">
            {(["back", "code", "other"] as EvidenceRole[]).map(role => <button key={role} type="button" className="min-h-14 rounded-xl border-2 border-violet-800 text-4xl font-bold" aria-label={`${labels[role]} de ${product.name}`} onClick={() => setGallery({ groupKey: product.groupKey, role })}>{symbols[role]}{product.missingImages.includes(role) && <span className="text-xl text-sky-500"> ?</span>}</button>)}
            <button type="button" className="mx-auto self-center rounded-full text-5xl text-violet-800" aria-label={`Todas las imágenes de ${product.name}`} onClick={() => setGallery({ groupKey: product.groupKey })}>●</button>
          </div>
          <div className="flex items-center justify-between rounded-xl border-2 border-violet-800 p-2 text-sm">
            <span>Factura <b>{product.expected}</b></span><span>Recibido <b>{product.physical}</b></span>
            <div className="flex items-center gap-1">
              <button aria-label={`Restar una unidad de ${product.name}`} disabled={disabled || product.physical <= 1} className="h-10 w-8 rounded-lg bg-violet-50 text-xl disabled:opacity-30" onClick={async () => { setSaving(product.groupKey); await onUnitCount(product.groupKey, product.physical - 1); await refresh().catch(() => {}); setSaving(""); }}>−</button>
              <button aria-label={`Sumar una unidad de ${product.name}`} disabled={disabled || product.physical >= 100} className="h-10 w-8 rounded-lg bg-violet-50 text-xl disabled:opacity-30" onClick={async () => { setSaving(product.groupKey); await onUnitCount(product.groupKey, product.physical + 1); await refresh().catch(() => {}); setSaving(""); }}>+</button>
            </div>
          </div>
          <div className="mt-3 space-y-2" aria-label={`Observación de ${product.name}`}>
            {ordinaryMissing.length > 0 && <p className="rounded-xl bg-sky-100 px-3 py-2 font-bold">{ordinaryMissing.length} FALTA IMG <span className="float-right text-sky-600">{ordinaryMissing.map(role => symbols[role]).join(" ")} ?</span></p>}
            {product.missingImages.includes("code") && <p className="rounded-xl bg-sky-100 px-3 py-2 font-bold">FALTA IMG QR <span className="float-right text-sky-600">X ?</span></p>}
            {unknownExtra && <p className="rounded-xl bg-sky-100 px-3 py-2 font-bold">NO ESTÁ EN FACTURA</p>}
            {product.extra > 0 && !unknownExtra && <p className="rounded-xl bg-sky-100 px-3 py-2 font-bold">{product.unbilled ? <>EXTRA NO COBRADO{product.unbilledValue != null && <span className="float-right text-sky-600">+{money(product.unbilledValue, currency)}</span>}</> : `${product.extra} PROD DE MÁS`}</p>}
            {transferred.length > 0 && <div className="rounded-xl bg-sky-100 p-3"><b className="text-sm">EXTRA COBRADO COMO OTRO</b>{transferred.map(a => <p key={a.lineId} className="mt-1 text-sm">{data.lines.find(l => l.id === a.lineId)?.description} −{a.quantity} → {product.name} +{a.quantity}</p>)}</div>}
            {product.extra > 0 && <div className="flex flex-wrap gap-1" aria-label="Unidades recibidas">{Array.from({ length: Math.min(product.physical, 100) }, (_, i) => <span key={i} className={`rounded-lg border-2 px-2 py-1 text-xs font-bold ${i >= product.expected ? "border-sky-500 bg-sky-100" : "border-violet-200"}`}>{i >= product.expected ? `${i + 1} EXTRA` : i + 1}</span>)}</div>}
          </div>
          {unknownExtra && <div className="mt-3 space-y-2 rounded-xl border-2 border-sky-400 p-3">
            <p className="font-bold">¿Dónde se cobró?</p>
            <label className="flex min-h-12 items-center gap-2 rounded-lg bg-sky-50 px-3">
              <span className="text-2xl font-black text-sky-600">+$</span>
              <input type="number" min="0" step="0.01" inputMode="decimal" aria-label={`Valor total del extra ${product.name}`} value={extraValueText} onChange={event => setExtraValues(values => ({ ...values, [product.groupKey]: event.target.value }))} placeholder="0" className="min-w-0 flex-1 bg-transparent text-xl font-black outline-none" />
            </label>
            {suggestion && <div className="rounded-lg bg-sky-50 p-2"><p className="text-xs">Sugerencia</p><b>{suggestion.name}</b><p className="text-sm">Falta {suggestion.deficit} ↔ Extra {remainingExtra}</p><button disabled={disabled} className={`${button} mt-2 w-full bg-sky-100`} onClick={() => void decide("reassign", product.groupKey, suggestion.lineId, Math.min(remainingExtra, suggestion.deficit))}>¿SE COBRÓ ACÁ?</button></div>}
            <button disabled={disabled} className={`${button} w-full`} onClick={() => setChooseLine(chooseLine === product.groupKey ? "" : product.groupKey)}>Se cobró como otro</button>
            <button disabled={disabled || !validExtraValue} className={`${button} w-full bg-violet-800 text-white`} onClick={() => void decide("extra", product.groupKey, undefined, remainingExtra, undefined, extraValue ?? undefined)}>No se cobró · {validExtraValue ? `+${money(extraValue, currency)}` : "+$"}</button>
          </div>}
          {chooseLine === product.groupKey && <div className="mt-2 space-y-2"><p className="text-sm font-bold">Elegí el renglón</p>{product.candidates.map(c => <button key={c.lineId} disabled={disabled} className={`${button} w-full text-left`} onClick={() => void decide("reassign", product.groupKey, c.lineId, 1)}>{c.name}<span className="block text-xs">{c.deficit > 0 ? `Falta ${c.deficit}` : "Sin faltantes"} · Reasignar 1</span></button>)}{!product.candidates.length && <p className="text-sm">No hay renglones compatibles.</p>}</div>}
          {!unknownExtra && product.pending && <button disabled={disabled} className={`${button} mt-3 w-full bg-violet-800 text-white`} onClick={() => void decide("review", product.groupKey)}>{remainingExtra > 0 ? `Confirmar +${remainingExtra} stock` : "Confirmar producto"}</button>}
          {relatedLines.filter(line => line.deficit > 0).map(line => <div key={line.id} className="mt-3 rounded-xl border-2 border-sky-400 p-2 text-sm"><b>FALTAN {line.deficit}</b><p>{line.name}</p>{line.pending ? <button disabled={disabled} className={`${button} mt-2 w-full`} onClick={() => void decide("shortage", undefined, line.id)}>Confirmar faltante</button> : <span>Faltante confirmado</span>}</div>)}
          {!product.pending && !unknownExtra && <p className="mt-3 text-center text-sm font-bold">✓ Cantidad revisada</p>}
          {data.existingProducts.length > 0 && <details className="mt-3 text-sm"><summary className="cursor-pointer py-2 font-bold">Artículo existente</summary><label className="block">¿Ya lo tenés?<select aria-label={`Artículo existente para ${product.name}`} disabled={disabled} value={data.existingLinks[product.groupKey]?.listingId || ""} className="mt-2 w-full rounded-xl border-2 border-violet-800 bg-white p-2" onChange={event => void decide("link", product.groupKey, undefined, 1, event.target.value)}><option value="">Detectar por código / crear nuevo</option>{data.existingProducts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></details>}
          <details className="mt-3 text-sm"><summary className="cursor-pointer py-2 font-bold">Factura real</summary><ul className="space-y-1">{data.lines.map(line => <li key={line.id} className={`rounded-lg px-2 py-1 ${relatedLines.some(r => r.id === line.id) ? "border-2 border-sky-400 bg-sky-50 font-bold" : "text-violet-500"}`}>{line.description} ×{line.quantity}</li>)}</ul></details>
        </article>;
      })}
      {data.report.lines.filter(line => line.deficit > 0 && !data.report.products.some(p => p.allocations.some(a => a.lineId === line.id) || data.lines.find(l => l.id === line.id)?.matched_group_keys.includes(p.groupKey))).map(line => <article key={line.id} className="overflow-hidden rounded-2xl border-2 border-violet-800 p-3"><h4 className="mb-2 text-center text-lg font-black">{line.name}</h4><div className="flex h-44 w-full items-center justify-center rounded-xl border-2 border-dashed border-violet-700 bg-violet-50"><span className="text-6xl">↑ <span className="text-sky-500">?</span></span></div><div className="my-3 grid grid-cols-4 gap-2"><span className="flex min-h-14 items-center justify-center rounded-xl border-2 border-violet-800 text-4xl font-bold">↓ <span className="text-xl text-sky-500">?</span></span><span className="flex min-h-14 items-center justify-center rounded-xl border-2 border-violet-800 text-4xl font-bold">X <span className="text-xl text-sky-500">?</span></span><span className="flex min-h-14 items-center justify-center rounded-xl border-2 border-violet-800 text-4xl font-bold">O</span><span className="mx-auto self-center text-5xl text-violet-800">●</span></div><div className="flex items-center justify-between rounded-xl border-2 border-violet-800 p-3 text-sm"><span>Factura <b>{line.original}</b></span><span>Recibido <b>0</b></span></div><p className="mt-3 rounded-xl bg-sky-100 px-3 py-2 font-bold">FALTAN {line.deficit}</p>{line.pending ? <button disabled={disabled} className="mt-3 min-h-11 w-full rounded-xl border-2 border-violet-800 px-4 py-2 text-sm font-bold disabled:opacity-40" onClick={() => void decide("shortage", undefined, line.id)}>Confirmar faltante</button> : <p className="mt-3 text-center text-sm font-bold">✓ Faltante confirmado</p>}</article>)}
    </div>
    <div className="sticky bottom-2 mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-violet-800 bg-white p-3 shadow-lg">
      <p className="text-sm font-bold">{totalPending ? `${totalPending} por revisar` : "Cantidades revisadas"}</p>
      <button disabled={disabled || totalPending > 0} className={`${button} bg-violet-800 text-white`} onClick={onReceive}>{data.editable ? `Ingresar ${data.report.totals.physical} al stock` : "Recepción en stock / en proceso"}</button>
    </div>
    {selected && gallery && <div role="dialog" aria-modal="true" aria-label={`Fotos de ${selected.name}`} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3" onClick={() => setGallery(null)}>
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-3xl border-2 border-violet-800 bg-white p-4 text-violet-950" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3"><h4 className="text-xl font-bold">{selected.name}{gallery.role ? ` · ${labels[gallery.role]}` : ""}</h4><button className={button} onClick={() => setGallery(null)}>Cerrar</button></div>
        <div className="my-4 grid gap-3 sm:grid-cols-2">{galleryIndexes.map(index => { const photo = source(index); return photo ? <a key={index} href={photo.source_url} target="_blank" rel="noreferrer"><img src={photo.source_url} alt={`${selected.name} · ${index + 1}`} className="max-h-80 w-full rounded-xl border-2 border-violet-200 object-contain" /></a> : null; })}</div>
        {!galleryIndexes.length && <p className="my-5 text-center text-4xl text-sky-500">{gallery.role ? symbols[gallery.role] : ""} ?</p>}
        {data.editable && <div className="flex flex-wrap gap-2">{(gallery.role ? [gallery.role] : ["front", "back", "code", "other"] as EvidenceRole[]).map(role => <label key={role} className={`${button} cursor-pointer bg-violet-800 text-white`}>{saving ? "Guardando…" : `+ ${labels[role]}`}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled} className="hidden" onChange={event => { void addPhoto(selected.groupKey, role, event.target.files?.[0]); event.target.value = ""; }} /></label>)}</div>}
      </div>
    </div>}
  </section>;
}
