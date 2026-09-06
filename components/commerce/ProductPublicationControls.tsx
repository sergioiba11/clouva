"use client";

import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Link2,
  Loader2,
  Megaphone,
  PackagePlus,
  Plus,
  Share2,
  ShoppingCart,
  Sparkles,
  Store,
  UserRound,
  Warehouse,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type Publication = {
  id: string;
  target_type: "player" | "space" | "marketplace";
  target_player_id: string | null;
  target_space_id: string | null;
  placement: string;
  is_visible: boolean;
  channel: string;
  destination_key: string | null;
  destination_label: string | null;
  destination_url: string | null;
  publication_mode: "automatic" | "assisted" | "manual";
  status: string;
  external_id: string | null;
  external_url: string | null;
  published_at: string | null;
  channel_title: string | null;
  channel_description: string | null;
  price_snapshot: number | null;
  currency_snapshot: string | null;
  stock_snapshot: number | null;
};

type Variant = {
  id: string;
  sku: string | null;
  title: string | null;
  size: string | null;
  color: string | null;
  stock: number;
  price_override: number | null;
  cost_override: number | null;
};

type ProductInfo = {
  name: string;
  description: string | null;
  price: number;
  currency: string;
  stock: number | null;
  cover_url?: string | null;
  gallery?: string[] | null;
  cost_amount?: number | null;
  variants?: Variant[];
  metrics?: {
    restockCycles: number;
    unitsPurchased: number;
    unitsSold: number;
    capitalInvested: number;
    grossRevenue: number;
    costOfGoods: number;
    allocatedFees: number;
    realizedProfit: number;
    latestUnitCost: number | null;
    lastPurchaseAt: string | null;
    salesByChannel: Record<string, number>;
  };
};

type Target = {
  key: string;
  type: "player" | "space";
  id: string;
  detail: string;
};

const FB_MARKETPLACE_URL = "https://www.facebook.com/marketplace/create/item";
const INPUT = "w-full rounded-xl border border-white/10 bg-black/35 px-3 py-2.5 text-xs text-white outline-none focus:border-violet-400/50";
const BUTTON = "inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-xs font-semibold text-white/65 transition hover:border-violet-400/30 hover:text-white disabled:opacity-40";

function money(value: number | null | undefined, currency = "ARS") {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  try { return new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value)); }
  catch { return `${currency} ${Number(value).toLocaleString("es-AR")}`; }
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: "Borrador",
    ready: "Listo",
    publishing: "Publicando",
    published: "Publicado",
    needs_user_action: "Requiere acción",
    failed: "Error",
    paused: "Pausado",
    sold: "Vendido",
    removed: "Retirado",
    unavailable: "Sin stock",
    needs_removal: "Retirar",
  };
  return labels[status] ?? status;
}

function channelLabel(publication: Publication) {
  if (publication.channel === "clouva_market") return "CLOUVA Market";
  if (publication.channel === "facebook_marketplace") return "Facebook Marketplace";
  if (publication.channel === "facebook_group") return publication.destination_label || "Grupo de Facebook";
  if (publication.channel === "facebook_page") return publication.destination_label || "Facebook Page";
  return publication.destination_label || publication.channel;
}

function publicationText(publication: Publication, product?: ProductInfo) {
  const title = publication.channel_title?.trim() || product?.name || "";
  const description = publication.channel_description?.trim() || product?.description?.trim() || "";
  const price = publication.price_snapshot ?? product?.price;
  const currency = publication.currency_snapshot || product?.currency || "ARS";
  return [title, description, price != null ? `Precio: ${money(Number(price), currency)}` : ""].filter(Boolean).join("\n\n");
}

export function ProductPublicationControls({
  productId,
  player,
  space,
  product,
}: {
  productId: string;
  player: { id: string; name: string } | null;
  space: { id: string; name: string };
  product?: ProductInfo;
}) {
  const [publications, setPublications] = useState<Publication[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [groupDraft, setGroupDraft] = useState({ label: "", url: "" });
  const [externalUrlDrafts, setExternalUrlDrafts] = useState<Record<string, string>>({});
  const [copyDrafts, setCopyDrafts] = useState<Record<string, { title: string; description: string }>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [salePublicationId, setSalePublicationId] = useState<string | null>(null);
  const [saleDraft, setSaleDraft] = useState({ quantity: "1", price: String(product?.price ?? ""), fee: "0", paymentMethod: "cash", reference: "" });
  const [restockOpen, setRestockOpen] = useState(false);
  const [restockDraft, setRestockDraft] = useState({ variantId: "", quantity: "1", unitCost: String(product?.metrics?.latestUnitCost ?? product?.cost_amount ?? ""), supplier: "", purchaseDate: "" });

  const targets = useMemo<Target[]>(() => [
    ...(player ? [{ key: `player:${player.id}`, type: "player" as const, id: player.id, detail: "Mostrar en mi Player" }] : []),
    { key: `space:${space.id}`, type: "space" as const, id: space.id, detail: "Mostrar en este espacio" },
  ], [player, space]);

  const marketplaceRows = useMemo(() => publications.filter((publication) => publication.target_type === "marketplace"), [publications]);
  const clouvaMarket = marketplaceRows.find((publication) => publication.channel === "clouva_market") ?? null;
  const facebookMarketplace = marketplaceRows.find((publication) => publication.channel === "facebook_marketplace") ?? null;
  const facebookGroups = marketplaceRows.filter((publication) => publication.channel === "facebook_group");
  const externalRows = marketplaceRows.filter((publication) => publication.channel.startsWith("facebook_") && publication.channel !== "clouva_market");
  const productImages = useMemo(() => Array.from(new Set([
    ...(product?.cover_url ? [product.cover_url] : []),
    ...((product?.gallery ?? []).filter((url): url is string => typeof url === "string" && Boolean(url))),
  ])), [product?.cover_url, product?.gallery]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/commerce/products/${encodeURIComponent(productId)}/publications`);
      const payload = await readApiJson<{ publications: Publication[] }>(response);
      setPublications(payload.publications ?? []);
      setExternalUrlDrafts(Object.fromEntries((payload.publications ?? []).map((row) => [row.id, row.external_url ?? ""])));
      setCopyDrafts(Object.fromEntries((payload.publications ?? []).map((row) => [row.id, {
        title: row.channel_title ?? product?.name ?? "",
        description: row.channel_description ?? product?.description ?? "",
      }])));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudieron cargar las publicaciones.");
    } finally {
      setLoading(false);
    }
  }, [product?.description, product?.name, productId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    setSaleDraft((current) => ({ ...current, price: current.price || String(product?.price ?? "") }));
    setRestockDraft((current) => ({ ...current, unitCost: current.unitCost || String(product?.metrics?.latestUnitCost ?? product?.cost_amount ?? "") }));
  }, [product?.cost_amount, product?.metrics?.latestUnitCost, product?.price]);

  function isVisible(target: Target) {
    return publications.some((publication) => publication.is_visible
      && publication.target_type === target.type
      && (target.type === "player" ? publication.target_player_id === target.id : publication.target_space_id === target.id)
      && publication.placement === "merch");
  }

  async function put(body: Record<string, unknown>) {
    const response = await authenticatedFetch(`/api/commerce/products/${encodeURIComponent(productId)}/publications`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    return readApiJson<{ publication: Publication }>(response);
  }

  async function toggle(target: Target) {
    setSavingKey(target.key); setError(null); setMessage(null);
    try {
      await put({
        targetType: target.type,
        targetPlayerId: target.type === "player" ? target.id : null,
        targetSpaceId: target.type === "space" ? target.id : null,
        placement: "merch",
        isVisible: !isVisible(target),
      });
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo actualizar la publicación."); }
    finally { setSavingKey(null); }
  }

  async function setClouvaMarket(visible: boolean) {
    setSavingKey("clouva_market"); setError(null); setMessage(null);
    try {
      await put({
        targetType: "marketplace",
        channel: "clouva_market",
        destinationKey: "default",
        destinationLabel: "CLOUVA Market",
        publicationMode: "automatic",
        status: visible ? "published" : "draft",
        isVisible: visible,
        placement: "market",
        channelTitle: product?.name,
        channelDescription: product?.description,
        priceSnapshot: product?.price,
        currencySnapshot: product?.currency,
        stockSnapshot: product?.stock,
      });
      setMessage(visible ? "Producto publicado en CLOUVA Market." : "Producto ocultado de CLOUVA Market.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo actualizar CLOUVA Market."); }
    finally { setSavingKey(null); }
  }

  async function prepareFacebookMarketplace() {
    setSavingKey("facebook_marketplace"); setError(null); setMessage(null);
    try {
      await put({
        targetType: "marketplace",
        channel: "facebook_marketplace",
        destinationKey: "default",
        destinationLabel: "Facebook Marketplace",
        destinationUrl: FB_MARKETPLACE_URL,
        publicationMode: "assisted",
        status: "needs_user_action",
        isVisible: true,
        placement: "market",
        channelTitle: facebookMarketplace?.channel_title || product?.name,
        channelDescription: facebookMarketplace?.channel_description || product?.description,
        priceSnapshot: product?.price,
        currencySnapshot: product?.currency,
        stockSnapshot: product?.stock,
      });
      setMessage("Facebook Marketplace quedó preparado. CLOUVA conserva el producto y Facebook requiere la confirmación final.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo preparar Facebook Marketplace."); }
    finally { setSavingKey(null); }
  }

  async function addFacebookGroup() {
    const label = groupDraft.label.trim();
    const url = groupDraft.url.trim();
    if (!label || !url) { setError("Ingresá el nombre y la URL del grupo."); return; }
    setSavingKey("new-group"); setError(null); setMessage(null);
    try {
      await put({
        targetType: "marketplace",
        channel: "facebook_group",
        destinationKey: url,
        destinationLabel: label,
        destinationUrl: url,
        publicationMode: "assisted",
        status: "ready",
        isVisible: true,
        placement: "group",
        channelTitle: product?.name,
        channelDescription: product?.description,
        priceSnapshot: product?.price,
        currencySnapshot: product?.currency,
        stockSnapshot: product?.stock,
      });
      setGroupDraft({ label: "", url: "" });
      setMessage(`${label} quedó agregado a la cola de publicación.`);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar el grupo."); }
    finally { setSavingKey(null); }
  }

  async function prepareAll() {
    setSavingKey("all"); setError(null); setMessage(null);
    try {
      await put({
        targetType: "marketplace", channel: "clouva_market", destinationKey: "default",
        destinationLabel: "CLOUVA Market", publicationMode: "automatic", status: "published",
        isVisible: true, placement: "market", channelTitle: product?.name,
        channelDescription: product?.description, priceSnapshot: product?.price,
        currencySnapshot: product?.currency, stockSnapshot: product?.stock,
      });
      await put({
        targetType: "marketplace", channel: "facebook_marketplace", destinationKey: "default",
        destinationLabel: "Facebook Marketplace", destinationUrl: FB_MARKETPLACE_URL,
        publicationMode: "assisted", status: "needs_user_action", isVisible: true,
        placement: "market", channelTitle: facebookMarketplace?.channel_title || product?.name,
        channelDescription: facebookMarketplace?.channel_description || product?.description,
        priceSnapshot: product?.price, currencySnapshot: product?.currency, stockSnapshot: product?.stock,
      });
      for (const group of facebookGroups) {
        await put({
          targetType: "marketplace", channel: "facebook_group",
          destinationKey: group.destination_key, destinationLabel: group.destination_label,
          destinationUrl: group.destination_url, publicationMode: "assisted",
          status: "needs_user_action", isVisible: true, placement: group.placement,
          channelTitle: group.channel_title || product?.name,
          channelDescription: group.channel_description || product?.description,
          priceSnapshot: product?.price, currencySnapshot: product?.currency, stockSnapshot: product?.stock,
        });
      }
      setMessage("CLOUVA Market quedó publicado y la cola de Facebook quedó lista para confirmar.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo preparar la publicación multicanal."); }
    finally { setSavingKey(null); }
  }

  async function copyPublication(publication: Publication) {
    try {
      await navigator.clipboard.writeText(publicationText(publication, product));
      setMessage(`Copy de ${channelLabel(publication)} copiado.`);
    } catch {
      setError("El navegador no permitió copiar el texto.");
    }
  }

  async function generateCopy(publication: Publication) {
    setSavingKey(`copy:${publication.id}`); setError(null); setMessage(null);
    try {
      const response = await authenticatedFetch(`/api/commerce/products/${encodeURIComponent(productId)}/publication-copy`, {
        method: "POST",
        body: JSON.stringify({ channel: publication.channel }),
      });
      const copy = await readApiJson<{ title: string; description: string }>(response);
      await put({
        targetType: "marketplace",
        channel: publication.channel,
        destinationKey: publication.destination_key,
        destinationLabel: publication.destination_label,
        destinationUrl: publication.destination_url,
        publicationMode: publication.publication_mode,
        status: publication.status,
        isVisible: publication.is_visible,
        placement: publication.placement,
        externalUrl: publication.external_url,
        channelTitle: copy.title,
        channelDescription: copy.description,
        priceSnapshot: product?.price,
        currencySnapshot: product?.currency,
        stockSnapshot: product?.stock,
        metadata: { copy_provider: "gemini", copy_generated_at: new Date().toISOString() },
      });
      setEditingId(publication.id);
      setMessage(`Copy para ${channelLabel(publication)} generado con Gemini.`);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo generar el copy."); }
    finally { setSavingKey(null); }
  }

  async function saveCopy(publication: Publication) {
    const draft = copyDrafts[publication.id];
    if (!draft) return;
    setSavingKey(`edit-copy:${publication.id}`); setError(null); setMessage(null);
    try {
      await put({
        targetType: "marketplace",
        channel: publication.channel,
        destinationKey: publication.destination_key,
        destinationLabel: publication.destination_label,
        destinationUrl: publication.destination_url,
        publicationMode: publication.publication_mode,
        status: publication.status,
        isVisible: publication.is_visible,
        placement: publication.placement,
        externalUrl: publication.external_url,
        channelTitle: draft.title,
        channelDescription: draft.description,
        priceSnapshot: product?.price,
        currencySnapshot: product?.currency,
        stockSnapshot: product?.stock,
      });
      setEditingId(null);
      setMessage("Copy guardado.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar el copy."); }
    finally { setSavingKey(null); }
  }

  async function markPublished(publication: Publication) {
    setSavingKey(`published:${publication.id}`); setError(null); setMessage(null);
    try {
      await put({
        targetType: "marketplace",
        channel: publication.channel,
        destinationKey: publication.destination_key,
        destinationLabel: publication.destination_label,
        destinationUrl: publication.destination_url,
        publicationMode: publication.publication_mode,
        status: "published",
        isVisible: true,
        placement: publication.placement,
        externalUrl: externalUrlDrafts[publication.id] || null,
        channelTitle: publication.channel_title || product?.name,
        channelDescription: publication.channel_description || product?.description,
        priceSnapshot: product?.price,
        currencySnapshot: product?.currency,
        stockSnapshot: product?.stock,
      });
      setMessage(`${channelLabel(publication)} marcado como publicado.`);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo confirmar la publicación."); }
    finally { setSavingKey(null); }
  }

  async function registerExternalSale(publication: Publication) {
    const quantity = Math.floor(Number(saleDraft.quantity));
    const price = Number(saleDraft.price);
    const fee = Number(saleDraft.fee || 0);
    if (!Number.isInteger(quantity) || quantity <= 0 || !Number.isFinite(price) || price < 0 || !Number.isFinite(fee) || fee < 0) {
      setError("Revisá cantidad, precio final y gastos."); return;
    }
    setSavingKey(`sale:${publication.id}`); setError(null); setMessage(null);
    try {
      const response = await authenticatedFetch(`/api/commerce/products/${encodeURIComponent(productId)}/publications/external-sale`, {
        method: "POST",
        body: JSON.stringify({
          publicationId: publication.id,
          quantity,
          unitPrice: price,
          feeAmount: fee,
          paymentMethod: saleDraft.paymentMethod,
          externalReference: saleDraft.reference,
        }),
      });
      const payload = await readApiJson<{ sale: { remaining_stock?: number; order_id?: string } }>(response);
      setSalePublicationId(null);
      setMessage(`Venta registrada. Stock restante: ${payload.sale?.remaining_stock ?? "actualizado"}.`);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo registrar la venta."); }
    finally { setSavingKey(null); }
  }

  async function restock() {
    const quantity = Math.floor(Number(restockDraft.quantity));
    const unitCost = restockDraft.unitCost.trim() ? Number(restockDraft.unitCost) : null;
    if (!Number.isInteger(quantity) || quantity <= 0 || (unitCost != null && (!Number.isFinite(unitCost) || unitCost < 0))) {
      setError("Revisá la cantidad y el costo de reposición."); return;
    }
    setSavingKey("restock"); setError(null); setMessage(null);
    try {
      await authenticatedFetch(`/api/commerce/products/${encodeURIComponent(productId)}/restock`, {
        method: "POST",
        body: JSON.stringify({
          variantId: restockDraft.variantId || null,
          quantity,
          unitCost,
          supplier: restockDraft.supplier,
          purchaseDate: restockDraft.purchaseDate,
        }),
      }).then((response) => readApiJson(response));
      setRestockOpen(false);
      setMessage(`${quantity} unidad${quantity === 1 ? "" : "es"} ingresada${quantity === 1 ? "" : "s"} al inventario.`);
      window.dispatchEvent(new CustomEvent("clouva:commerce-refresh"));
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo registrar la reposición."); }
    finally { setSavingKey(null); }
  }

  if (loading) return <div className="mt-3 flex items-center gap-2 text-xs text-white/35"><Loader2 size={13} className="animate-spin" /> Cargando publicaciones…</div>;

  return (
    <div className="mt-4 space-y-4 border-t border-white/[0.07] pt-4">
      <div>
        <p className="text-[10px] uppercase tracking-[.14em] text-white/30">CLOUVA</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {targets.map((target) => {
            const active = isVisible(target);
            const pending = savingKey === target.key;
            return (
              <button key={target.key} type="button" onClick={() => void toggle(target)} disabled={pending} title={target.detail} className={`${BUTTON} ${active ? "border-violet-400/45 bg-violet-500/15 text-violet-100" : ""}`}>
                {pending ? <Loader2 size={13} className="animate-spin" /> : target.type === "player" ? <UserRound size={13} /> : <Warehouse size={13} />}
                {target.detail}
                <span className={active ? "text-emerald-300" : "text-white/25"}>{active ? "Activo" : "Oculto"}</span>
              </button>
            );
          })}
          <button type="button" onClick={() => void setClouvaMarket(!(clouvaMarket?.is_visible && clouvaMarket.status === "published"))} disabled={savingKey === "clouva_market"} className={`${BUTTON} ${clouvaMarket?.is_visible && clouvaMarket.status === "published" ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100" : ""}`}>
            {savingKey === "clouva_market" ? <Loader2 size={13} className="animate-spin" /> : <Store size={13} />}
            CLOUVA Market
            <span>{clouvaMarket?.is_visible && clouvaMarket.status === "published" ? "Publicado" : "Oculto"}</span>
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-violet-400/15 bg-violet-500/[0.035] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.16em] text-violet-200"><Megaphone size={13} /> Distribución multicanal</p>
            <p className="mt-1 text-xs text-white/40">CLOUVA publica automáticamente; Facebook queda preparado para confirmarlo en el flujo oficial.</p>
          </div>
          <button type="button" onClick={() => void prepareAll()} disabled={Boolean(savingKey)} className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-40">
            {savingKey === "all" ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />} Publicar en todos
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-white/[0.08] bg-black/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><p className="text-sm font-semibold">Facebook Marketplace</p><p className="mt-0.5 text-[10px] text-white/35">Publicación asistida · mismo stock de CLOUVA</p></div>
            <button type="button" onClick={() => void prepareFacebookMarketplace()} disabled={Boolean(savingKey)} className={BUTTON}>
              {savingKey === "facebook_marketplace" ? <Loader2 size={13} className="animate-spin" /> : <Share2 size={13} />}
              {facebookMarketplace ? "Actualizar preparación" : "Preparar"}
            </button>
          </div>
          {facebookMarketplace ? <ExternalPublicationRow
            publication={facebookMarketplace}
            product={product}
            busy={savingKey}
            urlDraft={externalUrlDrafts[facebookMarketplace.id] ?? ""}
            setUrlDraft={(value) => setExternalUrlDrafts((current) => ({ ...current, [facebookMarketplace.id]: value }))}
            editing={editingId === facebookMarketplace.id}
            editDraft={copyDrafts[facebookMarketplace.id] ?? { title: "", description: "" }}
            setEditDraft={(next) => setCopyDrafts((current) => ({ ...current, [facebookMarketplace.id]: next }))}
            saleOpen={salePublicationId === facebookMarketplace.id}
            saleDraft={saleDraft}
            setSaleDraft={setSaleDraft}
            onCopy={() => void copyPublication(facebookMarketplace)}
            onGenerate={() => void generateCopy(facebookMarketplace)}
            onEdit={() => setEditingId(editingId === facebookMarketplace.id ? null : facebookMarketplace.id)}
            onSaveCopy={() => void saveCopy(facebookMarketplace)}
            onOpen={() => window.open(facebookMarketplace.destination_url || FB_MARKETPLACE_URL, "_blank", "noopener,noreferrer")}
            onMarkPublished={() => void markPublished(facebookMarketplace)}
            onSale={() => setSalePublicationId(salePublicationId === facebookMarketplace.id ? null : facebookMarketplace.id)}
            onConfirmSale={() => void registerExternalSale(facebookMarketplace)}
          /> : null}
        </div>

        <div className="mt-3 rounded-xl border border-white/[0.08] bg-black/20 p-3">
          <p className="text-sm font-semibold">Grupos de Facebook</p>
          <p className="mt-0.5 text-[10px] text-white/35">Guardá los grupos donde vendés y CLOUVA arma la cola por producto.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1.5fr_auto]">
            <input className={INPUT} placeholder="Nombre del grupo" value={groupDraft.label} onChange={(event) => setGroupDraft((current) => ({ ...current, label: event.target.value }))} />
            <input className={INPUT} placeholder="https://facebook.com/groups/..." value={groupDraft.url} onChange={(event) => setGroupDraft((current) => ({ ...current, url: event.target.value }))} />
            <button type="button" disabled={savingKey === "new-group"} onClick={() => void addFacebookGroup()} className={BUTTON}>{savingKey === "new-group" ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Agregar</button>
          </div>
          <div className="mt-3 space-y-2">
            {facebookGroups.map((group) => <ExternalPublicationRow
              key={group.id}
              publication={group}
              product={product}
              busy={savingKey}
              urlDraft={externalUrlDrafts[group.id] ?? ""}
              setUrlDraft={(value) => setExternalUrlDrafts((current) => ({ ...current, [group.id]: value }))}
              editing={editingId === group.id}
              editDraft={copyDrafts[group.id] ?? { title: "", description: "" }}
              setEditDraft={(next) => setCopyDrafts((current) => ({ ...current, [group.id]: next }))}
              saleOpen={salePublicationId === group.id}
              saleDraft={saleDraft}
              setSaleDraft={setSaleDraft}
              onCopy={() => void copyPublication(group)}
              onGenerate={() => void generateCopy(group)}
              onEdit={() => setEditingId(editingId === group.id ? null : group.id)}
              onSaveCopy={() => void saveCopy(group)}
              onOpen={() => group.destination_url && window.open(group.destination_url, "_blank", "noopener,noreferrer")}
              onMarkPublished={() => void markPublished(group)}
              onSale={() => setSalePublicationId(salePublicationId === group.id ? null : group.id)}
              onConfirmSale={() => void registerExternalSale(group)}
            />)}
            {!facebookGroups.length ? <p className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-[10px] text-white/30">Todavía no agregaste grupos para este producto.</p> : null}
          </div>
        </div>

        {productImages.length ? <div className="mt-3">
          <p className="text-[10px] uppercase tracking-[.14em] text-white/30">Fotos aprobadas / disponibles</p>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {productImages.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer" className="shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/30"><img src={url} alt={`Foto ${index + 1}`} className="h-16 w-16 object-cover" /></a>)}
          </div>
        </div> : null}
      </div>

      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="flex items-center gap-2 text-xs font-semibold"><PackagePlus size={14} /> Reposición</p><p className="mt-1 text-[10px] text-white/35">La nueva compra suma stock y queda como movimiento `purchase_receipt`; el producto no se duplica.</p></div>
          <button type="button" onClick={() => setRestockOpen((value) => !value)} className={BUTTON}>{restockOpen ? <X size={13} /> : <PackagePlus size={13} />} {restockOpen ? "Cerrar" : "Reponer"}</button>
        </div>
        {product?.metrics ? <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-4">
          <Metric label="Reposiciones" value={String(product.metrics.restockCycles)} />
          <Metric label="Vendidas" value={String(product.metrics.unitsSold)} />
          <Metric label="Facturación" value={money(product.metrics.grossRevenue, product.currency)} />
          <Metric label="Ganancia realizada" value={money(product.metrics.realizedProfit, product.currency)} />
        </div> : null}
        {restockOpen ? <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {(product?.variants?.length ?? 0) > 0 ? <select className={INPUT} value={restockDraft.variantId} onChange={(event) => setRestockDraft((current) => ({ ...current, variantId: event.target.value }))}><option value="">Producto base</option>{product?.variants?.map((variant) => <option key={variant.id} value={variant.id}>{variant.title || variant.sku || variant.id} · stock {variant.stock}</option>)}</select> : null}
          <input className={INPUT} inputMode="numeric" placeholder="Cantidad" value={restockDraft.quantity} onChange={(event) => setRestockDraft((current) => ({ ...current, quantity: event.target.value }))} />
          <input className={INPUT} inputMode="decimal" placeholder="Costo unitario" value={restockDraft.unitCost} onChange={(event) => setRestockDraft((current) => ({ ...current, unitCost: event.target.value }))} />
          <input className={INPUT} placeholder="Proveedor (opcional)" value={restockDraft.supplier} onChange={(event) => setRestockDraft((current) => ({ ...current, supplier: event.target.value }))} />
          <input className={INPUT} type="date" value={restockDraft.purchaseDate} onChange={(event) => setRestockDraft((current) => ({ ...current, purchaseDate: event.target.value }))} />
          <button type="button" disabled={savingKey === "restock"} onClick={() => void restock()} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-40">{savingKey === "restock" ? "Registrando…" : "Ingresar stock"}</button>
        </div> : null}
      </div>

      {externalRows.some((row) => row.status === "needs_removal") ? <p className="rounded-xl border border-amber-400/20 bg-amber-500/[0.07] p-3 text-xs text-amber-100">Hay publicaciones externas para retirar porque el stock llegó a cero.</p> : null}
      {message ? <p className="flex items-start gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/[0.07] p-3 text-xs text-emerald-100"><CheckCircle2 size={14} className="mt-0.5 shrink-0" /> {message}</p> : null}
      {error ? <p className="rounded-xl border border-rose-400/20 bg-rose-500/[0.07] p-3 text-xs text-rose-200">{error}</p> : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-white/[0.07] bg-black/20 p-2"><p className="text-white/30">{label}</p><p className="mt-1 font-semibold text-white/75">{value}</p></div>;
}

function ExternalPublicationRow({
  publication,
  product,
  busy,
  urlDraft,
  setUrlDraft,
  editing,
  editDraft,
  setEditDraft,
  saleOpen,
  saleDraft,
  setSaleDraft,
  onCopy,
  onGenerate,
  onEdit,
  onSaveCopy,
  onOpen,
  onMarkPublished,
  onSale,
  onConfirmSale,
}: {
  publication: Publication;
  product?: ProductInfo;
  busy: string | null;
  urlDraft: string;
  setUrlDraft: (value: string) => void;
  editing: boolean;
  editDraft: { title: string; description: string };
  setEditDraft: (value: { title: string; description: string }) => void;
  saleOpen: boolean;
  saleDraft: { quantity: string; price: string; fee: string; paymentMethod: string; reference: string };
  setSaleDraft: Dispatch<SetStateAction<{ quantity: string; price: string; fee: string; paymentMethod: string; reference: string }>>;
  onCopy: () => void;
  onGenerate: () => void;
  onEdit: () => void;
  onSaveCopy: () => void;
  onOpen: () => void;
  onMarkPublished: () => void;
  onSale: () => void;
  onConfirmSale: () => void;
}) {
  return <div className="mt-3 rounded-xl border border-white/[0.08] bg-white/[0.025] p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><p className="text-xs font-semibold">{channelLabel(publication)}</p><p className="mt-0.5 text-[9px] uppercase tracking-wider text-white/30">{statusLabel(publication.status)} · {publication.publication_mode === "assisted" ? "Asistida" : "Automática"}</p></div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={onGenerate} disabled={Boolean(busy)} className={BUTTON}>{busy === `copy:${publication.id}` ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} IA</button>
        <button type="button" onClick={onCopy} className={BUTTON}><Copy size={12} /> Copiar</button>
        <button type="button" onClick={onEdit} className={BUTTON}><Megaphone size={12} /> Editar</button>
        <button type="button" onClick={onOpen} className={BUTTON}><ExternalLink size={12} /> Abrir</button>
      </div>
    </div>
    {editing ? <div className="mt-3 space-y-2">
      <input className={INPUT} value={editDraft.title} onChange={(event) => setEditDraft({ ...editDraft, title: event.target.value })} placeholder="Título" />
      <textarea className={INPUT} rows={4} value={editDraft.description} onChange={(event) => setEditDraft({ ...editDraft, description: event.target.value })} placeholder="Descripción" />
      <button type="button" onClick={onSaveCopy} disabled={Boolean(busy)} className={BUTTON}>{busy === `edit-copy:${publication.id}` ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Guardar copy</button>
    </div> : null}
    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
      <div className="relative flex-1"><Link2 size={12} className="absolute left-3 top-3 text-white/25" /><input className={`${INPUT} pl-8`} placeholder="Pegá la URL de la publicación final (opcional)" value={urlDraft} onChange={(event) => setUrlDraft(event.target.value)} /></div>
      <button type="button" onClick={onMarkPublished} disabled={Boolean(busy)} className={BUTTON}>{busy === `published:${publication.id}` ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Marcar publicado</button>
      <button type="button" onClick={onSale} className={BUTTON}><ShoppingCart size={12} /> Registrar venta</button>
    </div>
    {saleOpen ? <div className="mt-3 grid gap-2 rounded-xl border border-emerald-400/15 bg-emerald-500/[0.035] p-3 sm:grid-cols-2">
      <input className={INPUT} inputMode="numeric" value={saleDraft.quantity} onChange={(event) => setSaleDraft((current) => ({ ...current, quantity: event.target.value }))} placeholder="Cantidad" />
      <input className={INPUT} inputMode="decimal" value={saleDraft.price || String(product?.price ?? "")} onChange={(event) => setSaleDraft((current) => ({ ...current, price: event.target.value }))} placeholder="Precio final unitario" />
      <input className={INPUT} inputMode="decimal" value={saleDraft.fee} onChange={(event) => setSaleDraft((current) => ({ ...current, fee: event.target.value }))} placeholder="Gastos / comisión" />
      <select className={INPUT} value={saleDraft.paymentMethod} onChange={(event) => setSaleDraft((current) => ({ ...current, paymentMethod: event.target.value }))}><option value="cash">Efectivo</option><option value="transfer">Transferencia</option><option value="debit_card">Débito</option><option value="credit_card">Crédito</option><option value="other">Otro</option></select>
      <input className={`${INPUT} sm:col-span-2`} value={saleDraft.reference} onChange={(event) => setSaleDraft((current) => ({ ...current, reference: event.target.value }))} placeholder="Referencia externa (opcional)" />
      <button type="button" onClick={onConfirmSale} disabled={Boolean(busy)} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-40 sm:col-span-2">{busy === `sale:${publication.id}` ? "Registrando…" : "Confirmar venta externa"}</button>
    </div> : null}
  </div>;
}
