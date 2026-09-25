import { NextRequest, NextResponse } from "next/server";
import { requireManagedSpot } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function canonicalCodeKey(type: unknown, value: unknown) {
  const normalized = String(value ?? "").trim().replace(/[\s-]+/g, "").toUpperCase();
  if (!normalized) return "";
  if (/^\d+$/.test(normalized)) return `gtin:${normalized.replace(/^0+/, "") || "0"}`;
  return `${String(type ?? "")}:${normalized}`;
}

type MergeImage = { sourceIndex: number; role: "Frente" | "Atrás" | "Detalle" };

function mergeRoles(targetImages: MergeImage[], sourceImages: MergeImage[]): MergeImage[] {
  const byIndex = new Map<number, MergeImage>();
  for (const image of [...targetImages, ...sourceImages]) {
    if (!byIndex.has(image.sourceIndex)) byIndex.set(image.sourceIndex, image);
  }
  const all = Array.from(byIndex.values());
  // La portada y el dorso del destino mandan; el resto pasa a detalle.
  const front = targetImages.find((image) => image.role === "Frente")
    ?? sourceImages.find((image) => image.role === "Frente")
    ?? all[0];
  const back = targetImages.find((image) => image.role === "Atrás")
    ?? sourceImages.find((image) => image.role === "Atrás");
  return all
    .map((image) => ({
      sourceIndex: image.sourceIndex,
      role: front && image.sourceIndex === front.sourceIndex
        ? ("Frente" as const)
        : back && image.sourceIndex === back.sourceIndex
          ? ("Atrás" as const)
          : ("Detalle" as const),
    }))
    .sort((a, b) => a.sourceIndex - b.sourceIndex);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; batchId: string }> },
) {
  try {
    const { user } = await requireUser(request);
    const { slug, batchId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      sourceGroupKey?: unknown;
      targetGroupKey?: unknown;
    };
    const sourceGroupKey = typeof body.sourceGroupKey === "string" ? body.sourceGroupKey.trim() : "";
    const targetGroupKey = typeof body.targetGroupKey === "string" ? body.targetGroupKey.trim() : "";
    if (!sourceGroupKey || !targetGroupKey || sourceGroupKey === targetGroupKey) {
      return NextResponse.json({ error: "Elegí dos productos distintos para fusionar." }, { status: 400 });
    }

    const admin = createAdminSupabase();
    const { spot } = await requireManagedSpot({ admin, userId: user.id, studioId: slug });

    const { data: batch, error: batchError } = await admin
      .from("commerce_product_import_batches")
      .select("id,status,metadata")
      .eq("id", batchId)
      .eq("spot_id", spot.id)
      .maybeSingle();
    if (batchError) throw new Error(batchError.message);
    if (!batch) return NextResponse.json({ error: "El lote no existe en este Spot." }, { status: 404 });
    if (batch.status === "analyzing") {
      return NextResponse.json(
        { error: "El lote se está analizando. Esperá a que termine antes de fusionar." },
        { status: 409 },
      );
    }

    const metadata = record(batch.metadata);
    const groups = Array.isArray(metadata.groups) ? metadata.groups.map(record) : [];
    const source = groups.find((group) => group.groupKey === sourceGroupKey);
    const target = groups.find((group) => group.groupKey === targetGroupKey);
    if (!source || !target) {
      return NextResponse.json({ error: "Uno de los productos ya no está en el lote." }, { status: 404 });
    }

    // Códigos externos distintos = variantes distintas, no se fusionan.
    const sourceId = record(source.identifier);
    const targetId = record(target.identifier);
    const sourceCode = sourceId.value ? canonicalCodeKey(sourceId.type, sourceId.value) : "";
    const targetCode = targetId.value ? canonicalCodeKey(targetId.type, targetId.value) : "";
    const external = (key: string) => key && !key.startsWith("sku:") && !key.startsWith("clouva_barcode:") && !key.startsWith("clouva_qr:") && !key.startsWith(":");
    if (external(sourceCode) && external(targetCode) && sourceCode !== targetCode) {
      return NextResponse.json(
        { error: "Tienen códigos distintos, son variantes distintas y no se pueden fusionar." },
        { status: 409 },
      );
    }

    const { data: itemRows, error: itemsError } = await admin
      .from("commerce_product_import_items")
      .select("id,source_index,group_key,listing_id,status,recognition")
      .eq("batch_id", batch.id)
      .eq("spot_id", spot.id);
    if (itemsError) throw new Error(itemsError.message);
    const items = itemRows ?? [];
    const involved = items.filter((item) =>
      item.group_key === sourceGroupKey || item.group_key === targetGroupKey,
    );
    if (involved.some((item) => Boolean(item.listing_id))) {
      return NextResponse.json(
        { error: "Uno de los productos ya se ingresó al stock. No se puede fusionar." },
        { status: 409 },
      );
    }
    if (!involved.length) {
      return NextResponse.json({ error: "Esos productos no tienen fotos en el lote." }, { status: 404 });
    }

    const toImages = (value: unknown): MergeImage[] => Array.isArray(value)
      ? value.flatMap((raw) => {
          const image = record(raw);
          const sourceIndex = Number(image.sourceIndex);
          if (!Number.isInteger(sourceIndex)) return [];
          const role = image.role === "Atrás" ? "Atrás" : image.role === "Detalle" ? "Detalle" : "Frente";
          return [{ sourceIndex, role } satisfies MergeImage];
        })
      : [];
    const toCodes = (value: unknown) => Array.isArray(value)
      ? value.flatMap((raw) => {
          const code = record(raw);
          if (typeof code.value !== "string" || !code.value.trim() || typeof code.type !== "string") return [];
          return [{
            value: code.value.trim(),
            type: code.type,
            source: code.source === "box" ? "box" : code.source === "product" ? "product" : "unknown",
            confidence: Math.max(0, Math.min(1, Number(code.confidence || 0))),
            ...(Number.isInteger(Number(code.sourceIndex)) ? { sourceIndex: Number(code.sourceIndex) } : {}),
          }];
        })
      : [];

    const mergedImages = mergeRoles(toImages(target.images), toImages(source.images));
    const codeByCanonical = new Map<string, ReturnType<typeof toCodes>[number]>();
    for (const code of [...toCodes(target.visibleIdentifiers), ...toCodes(source.visibleIdentifiers)]) {
      const key = canonicalCodeKey(code.type, code.value);
      const prev = codeByCanonical.get(key);
      if (!prev || (prev.confidence < 1 && code.confidence >= 1)) codeByCanonical.set(key, code);
    }
    const mergedCodes = Array.from(codeByCanonical.values());
    const pickId = (candidate: JsonRecord) =>
      candidate.value && typeof candidate.type === "string"
        ? { value: String(candidate.value), type: String(candidate.type) }
        : null;
    // El código del destino manda; si no tiene, hereda el del origen.
    const mergedIdentifier = pickId(targetId) ?? pickId(sourceId);

    const text = (value: unknown) => typeof value === "string" ? value : "";
    const num = (value: unknown, fallback: number) =>
      Number.isFinite(Number(value)) ? Number(value) : fallback;
    const merged: JsonRecord = {
      ...target,
      name: text(target.name) || text(source.name),
      brand: text(target.brand) || text(source.brand),
      model: text(target.model) || text(source.model),
      packageKind: target.packageKind !== "unknown" ? target.packageKind : source.packageKind,
      // Fotos distintas no prueban unidades distintas: se conserva la mayor
      // cantidad y después se ajusta con el stepper si hace falta.
      unitCount: Math.max(1, Math.min(100, Math.floor(Math.max(num(target.unitCount, 1), num(source.unitCount, 1))))),
      identifier: mergedIdentifier,
      visibleIdentifiers: mergedCodes,
      confidence: Math.min(num(target.confidence, 0), num(source.confidence, 0)),
      needsReview: target.needsReview === true || source.needsReview === true,
      images: mergedImages,
    };

    const nextGroups = groups
      .filter((group) => group.groupKey !== sourceGroupKey)
      .map((group) => (group.groupKey === targetGroupKey ? merged : group));
    const unitByKey = new Map<string, number>(
      nextGroups.map((group) => [String(group.groupKey), Math.max(1, Math.floor(Number(group.unitCount) || 1))]),
    );

    // Mover las fotos del origen al destino.
    const sourceIds = involved.filter((item) => item.group_key === sourceGroupKey).map((item) => item.id);
    if (sourceIds.length) {
      const { error: moveError } = await admin
        .from("commerce_product_import_items")
        .update({ group_key: targetGroupKey, updated_at: new Date().toISOString() })
        .in("id", sourceIds);
      if (moveError) throw new Error(moveError.message);
      for (const item of involved.filter((item) => item.group_key === sourceGroupKey)) {
        const recognition = record(item.recognition);
        const grouping = record(recognition.grouping);
        if (!Object.keys(grouping).length) continue;
        const { error: recognitionError } = await admin
          .from("commerce_product_import_items")
          .update({
            recognition: { ...recognition, grouping: { ...grouping, group_key: targetGroupKey } },
            updated_at: new Date().toISOString(),
          })
          .eq("id", item.id);
        if (recognitionError) throw new Error(recognitionError.message);
      }
    }

    // La factura sigue al destino: las líneas que apuntaban al origen ahora
    // apuntan al fusionado y se recalcula lo detectado.
    const { data: invoiceLines, error: invoiceError } = await admin
      .from("commerce_product_import_invoice_items")
      .select("id,matched_group_keys")
      .eq("batch_id", batch.id)
      .eq("spot_id", spot.id);
    if (invoiceError) throw new Error(invoiceError.message);
    for (const line of invoiceLines ?? []) {
      const keys = Array.isArray(line.matched_group_keys) ? line.matched_group_keys.filter((key): key is string => typeof key === "string") : [];
      if (!keys.includes(sourceGroupKey)) continue;
      const nextKeys = Array.from(new Set([...keys.filter((key) => key !== sourceGroupKey), targetGroupKey]));
      const matchedQuantity = nextKeys.reduce((total, key) => total + (unitByKey.get(key) ?? 0), 0);
      const { error: lineError } = await admin
        .from("commerce_product_import_invoice_items")
        .update({
          matched_group_keys: nextKeys,
          matched_listing_ids: [],
          matched_quantity: matchedQuantity,
          updated_at: new Date().toISOString(),
        })
        .eq("id", line.id);
      if (lineError) throw new Error(lineError.message);
    }

    const updatedAt = new Date().toISOString();
    const { error: batchError2 } = await admin
      .from("commerce_product_import_batches")
      .update({
        metadata: { ...metadata, groups: nextGroups },
        detected_products: nextGroups.length,
        updated_at: updatedAt,
      })
      .eq("id", batch.id);
    if (batchError2) throw new Error(batchError2.message);

    return NextResponse.json({
      sourceGroupKey,
      targetGroupKey,
      group: merged,
      groups: nextGroups,
    });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo fusionar." },
      { status },
    );
  }
}
