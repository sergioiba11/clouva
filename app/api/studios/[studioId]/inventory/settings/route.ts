import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { requireSpaceInventoryAccess, resolveSpaceForStudio } from "@/lib/server/space-inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function numeric(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nullableNumeric(value: unknown) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "categoria";
}

function apiStatus(error: unknown) {
  return (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
}

async function assertCategory(admin: ReturnType<typeof createAdminSupabase>, spaceId: string, categoryId: string | null) {
  if (!categoryId) return null;
  const { data, error } = await admin
    .from("space_inventory_categories")
    .select("id")
    .eq("id", categoryId)
    .eq("space_id", spaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    const failure = new Error("La categoría no pertenece a este Space.") as Error & { status?: number };
    failure.status = 400;
    throw failure;
  }
  return data.id;
}

async function ensureReorderRequest(args: {
  admin: ReturnType<typeof createAdminSupabase>;
  spaceId: string;
  item: Record<string, unknown>;
  actorUserId: string;
  actorPlayerId: string | null;
}) {
  const minimum = numeric(args.item.minimum_quantity);
  let quantity = numeric(args.item.quantity);
  const source = String(args.item.stock_source || "managed");

  if (source === "commerce_variant" && args.item.commerce_variant_id) {
    const { data, error } = await args.admin
      .from("commerce_product_variants")
      .select("stock")
      .eq("id", String(args.item.commerce_variant_id))
      .maybeSingle();
    if (error) throw new Error(error.message);
    quantity = numeric(data?.stock);
  } else if (source === "commerce_product" && args.item.commerce_product_id) {
    const { data, error } = await args.admin
      .from("commerce_products")
      .select("stock")
      .eq("id", String(args.item.commerce_product_id))
      .maybeSingle();
    if (error) throw new Error(error.message);
    quantity = numeric(data?.stock);
  }

  const { data: openRequests, error: openError } = await args.admin
    .from("space_inventory_purchase_requests")
    .select("id,status")
    .eq("space_id", args.spaceId)
    .eq("item_id", String(args.item.id))
    .eq("source", "stock_minimum")
    .in("status", ["pendiente", "comprado"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (openError) throw new Error(openError.message);
  const open = openRequests?.[0] ?? null;

  if (minimum <= 0 || quantity > minimum) {
    if (open?.status === "pendiente") {
      const { error } = await args.admin
        .from("space_inventory_purchase_requests")
        .update({ status: "cancelado", notes: "Cancelado automáticamente: el stock volvió a estar por encima del mínimo.", updated_at: new Date().toISOString() })
        .eq("id", open.id);
      if (error) throw new Error(error.message);
    }
    return;
  }

  const ideal = nullableNumeric(args.item.ideal_quantity) ?? minimum;
  const needed = Math.max(0.0001, ideal - quantity);
  const replacementCost = nullableNumeric(args.item.replacement_cost);
  const requestPatch = {
    quantity_needed: needed,
    unit: String(args.item.unit || "unidad"),
    estimated_price: replacementCost == null ? null : replacementCost * needed,
    supplier: args.item.supplier ? String(args.item.supplier) : null,
    updated_at: new Date().toISOString(),
  };

  if (open) {
    if (open.status === "pendiente") {
      const { error } = await args.admin
        .from("space_inventory_purchase_requests")
        .update(requestPatch)
        .eq("id", open.id);
      if (error) throw new Error(error.message);
    }
    return;
  }

  const { error } = await args.admin.from("space_inventory_purchase_requests").insert({
    space_id: args.spaceId,
    item_id: String(args.item.id),
    name: String(args.item.name),
    ...requestPatch,
    priority: "normal",
    status: "pendiente",
    source: "stock_minimum",
    added_by_player_id: args.actorPlayerId,
    added_by_user_id: args.actorUserId,
    notes: "Generado automáticamente por stock mínimo.",
  });
  // Concurrent stock/config updates may race to create the same open automatic request.
  // The partial unique index is the final idempotency barrier.
  if (error && error.code !== "23505") throw new Error(error.message);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ studioId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { studioId } = await params;
    const admin = createAdminSupabase();
    const space = await resolveSpaceForStudio({ admin, studioId });
    const access = await requireSpaceInventoryAccess({ admin, userId: user.id, spaceId: space.id, capability: "inventory" });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = text(body.action, 60);

    if (action === "create_category") {
      const name = text(body.name, 120);
      if (!name) return NextResponse.json({ error: "El nombre de la categoría es obligatorio." }, { status: 400 });
      const slug = slugify(text(body.slug, 100) || name);
      const { data: last } = await admin
        .from("space_inventory_categories")
        .select("display_order")
        .eq("space_id", space.id)
        .order("display_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      const { data, error } = await admin.from("space_inventory_categories").insert({
        space_id: space.id,
        name,
        slug,
        description: text(body.description, 500) || null,
        display_order: numeric(body.displayOrder, numeric(last?.display_order) + 10),
        created_by_user_id: user.id,
      }).select("*").single();
      if (error) {
        if (error.code === "23505") return NextResponse.json({ error: "Ya existe una categoría con ese nombre/slug." }, { status: 409 });
        throw new Error(error.message);
      }
      return NextResponse.json({ category: data }, { status: 201 });
    }

    if (action === "update_category") {
      const categoryId = text(body.categoryId, 80);
      const name = text(body.name, 120);
      if (!categoryId || !name) return NextResponse.json({ error: "Categoría inválida." }, { status: 400 });
      await assertCategory(admin, space.id, categoryId);
      const patch: Record<string, unknown> = {
        name,
        description: text(body.description, 500) || null,
        active: body.active !== false,
        updated_at: new Date().toISOString(),
      };
      if (body.displayOrder !== undefined) patch.display_order = numeric(body.displayOrder);
      if (body.slug !== undefined) patch.slug = slugify(text(body.slug, 100) || name);
      const { data, error } = await admin
        .from("space_inventory_categories")
        .update(patch)
        .eq("id", categoryId)
        .eq("space_id", space.id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return NextResponse.json({ category: data });
    }

    if (action === "update_item") {
      const itemId = text(body.itemId, 80);
      const name = text(body.name, 160);
      if (!itemId || !name) return NextResponse.json({ error: "Ítem inválido." }, { status: 400 });

      const categoryId = await assertCategory(admin, space.id, text(body.categoryId, 80) || null);
      const minimum = Math.max(0, numeric(body.minimumQuantity));
      const ideal = nullableNumeric(body.idealQuantity);
      const unitCost = nullableNumeric(body.unitCost);
      const replacementCost = nullableNumeric(body.replacementCost);
      const patch = {
        category_id: categoryId,
        name,
        description: text(body.description, 1200) || null,
        image_url: text(body.imageUrl, 1400) || null,
        unit: text(body.unit, 40) || "unidad",
        minimum_quantity: minimum,
        ideal_quantity: ideal == null ? null : Math.max(0, ideal),
        unit_cost: unitCost == null ? null : Math.max(0, unitCost),
        replacement_cost: replacementCost == null ? null : Math.max(0, replacementCost),
        supplier: text(body.supplier, 240) || null,
        physical_location: text(body.physicalLocation, 240) || null,
        notes: text(body.notes, 1500) || null,
        barcode_value: text(body.barcodeValue, 180) || null,
        active: body.active !== false,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await admin
        .from("space_inventory_items")
        .update(patch)
        .eq("id", itemId)
        .eq("space_id", space.id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      await ensureReorderRequest({ admin, spaceId: space.id, item: data as Record<string, unknown>, actorUserId: user.id, actorPlayerId: access.playerId });
      return NextResponse.json({ item: data });
    }

    if (action === "archive_item") {
      const itemId = text(body.itemId, 80);
      if (!itemId) return NextResponse.json({ error: "Ítem inválido." }, { status: 400 });
      const { data, error } = await admin
        .from("space_inventory_items")
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq("id", itemId)
        .eq("space_id", space.id)
        .select("id,active")
        .single();
      if (error) throw new Error(error.message);
      return NextResponse.json({ item: data });
    }

    return NextResponse.json({ error: "Acción de configuración no reconocida." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo actualizar la configuración." }, { status: apiStatus(error) });
  }
}
