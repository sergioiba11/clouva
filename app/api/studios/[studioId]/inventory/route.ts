import { NextRequest, NextResponse } from "next/server";
import { isAuthError, requireUser, createAdminSupabase } from "@/lib/server/supabase";
import { inventoryStatus, requireSpaceInventoryAccess, resolveSpaceForStudio } from "@/lib/server/space-inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MOVEMENT_TYPES = new Set(["COMPRA", "INGRESO", "CONSUMO", "VENTA", "REGALO", "ROTURA", "PERDIDA", "AJUSTE"]);
const PURCHASE_PRIORITIES = new Set(["baja", "normal", "alta", "urgente"]);
const PURCHASE_STATUSES = new Set(["pendiente", "comprado", "ingresado", "cancelado"]);

function text(value: unknown, max = 400) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function numeric(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function nullableNumeric(value: unknown) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function apiStatus(error: unknown) {
  return (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
}

async function loadInventory(admin: ReturnType<typeof createAdminSupabase>, spaceId: string) {
  const [categoriesResult, itemsResult, purchasesResult, movementsResult, boardResult, membersResult] = await Promise.all([
    admin.from("space_inventory_categories").select("*").eq("space_id", spaceId).eq("active", true).order("display_order"),
    admin.from("space_inventory_items").select("*").eq("space_id", spaceId).eq("active", true).order("name"),
    admin.from("space_inventory_purchase_requests").select("*").eq("space_id", spaceId).neq("status", "cancelado").order("created_at", { ascending: false }),
    admin.from("space_inventory_movements").select("*").eq("space_id", spaceId).order("created_at", { ascending: false }).limit(100),
    admin.from("space_board_entries").select("*").eq("space_id", spaceId).order("display_order"),
    admin.from("space_members").select("player_id,role,status").eq("space_id", spaceId).eq("status", "active"),
  ]);
  for (const result of [categoriesResult, itemsResult, purchasesResult, movementsResult, boardResult, membersResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const items = itemsResult.data ?? [];
  const productIds = Array.from(new Set(items.map((row) => row.commerce_product_id).filter(Boolean))) as string[];
  const variantIds = Array.from(new Set(items.map((row) => row.commerce_variant_id).filter(Boolean))) as string[];
  const playerIds = Array.from(new Set([
    ...(membersResult.data ?? []).map((row) => row.player_id),
    ...(movementsResult.data ?? []).map((row) => row.player_id).filter(Boolean),
    ...(purchasesResult.data ?? []).flatMap((row) => [row.added_by_player_id, row.purchased_by_player_id, row.entered_by_player_id]).filter(Boolean),
  ])) as string[];

  const [productsResult, variantsResult, playersResult] = await Promise.all([
    productIds.length ? admin.from("commerce_products").select("id,name,stock,cost_amount,price,status").in("id", productIds) : Promise.resolve({ data: [], error: null }),
    variantIds.length ? admin.from("commerce_product_variants").select("id,product_id,stock,cost_override,price_override,title,size,color,active").in("id", variantIds) : Promise.resolve({ data: [], error: null }),
    playerIds.length ? admin.from("players").select("id,display_name,username,profile_image_url").in("id", playerIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (productsResult.error) throw new Error(productsResult.error.message);
  if (variantsResult.error) throw new Error(variantsResult.error.message);
  if (playersResult.error) throw new Error(playersResult.error.message);

  const products = new Map((productsResult.data ?? []).map((row) => [row.id, row]));
  const variants = new Map((variantsResult.data ?? []).map((row) => [row.id, row]));
  const players = new Map((playersResult.data ?? []).map((row) => [row.id, row]));

  const resolvedItems = items.map((item) => {
    const product = item.commerce_product_id ? products.get(item.commerce_product_id) : null;
    const variant = item.commerce_variant_id ? variants.get(item.commerce_variant_id) : null;
    const quantity = item.stock_source === "commerce_variant" ? numeric(variant?.stock) : item.stock_source === "commerce_product" ? numeric(product?.stock) : numeric(item.quantity);
    const unitCost = item.unit_cost ?? variant?.cost_override ?? product?.cost_amount ?? null;
    return { ...item, quantity, unit_cost: unitCost, state: inventoryStatus(quantity, numeric(item.minimum_quantity)), commerce: product ? { product, variant } : null };
  });

  const movementRows = (movementsResult.data ?? []).map((row) => ({ ...row, player: row.player_id ? players.get(row.player_id) ?? null : null }));
  const purchaseRows = (purchasesResult.data ?? []).map((row) => ({
    ...row,
    added_by: row.added_by_player_id ? players.get(row.added_by_player_id) ?? null : null,
    purchased_by: row.purchased_by_player_id ? players.get(row.purchased_by_player_id) ?? null : null,
  }));
  const memberRows = (membersResult.data ?? []).map((row) => ({ ...row, player: players.get(row.player_id) ?? null }));

  const low = resolvedItems.filter((item) => item.state !== "OK").length;
  const pending = purchaseRows.filter((row) => row.status === "pendiente" || row.status === "comprado").length;
  const estimatedValue = resolvedItems.reduce((sum, item) => sum + numeric(item.quantity) * numeric(item.unit_cost), 0);
  const expenses = purchaseRows.filter((row) => row.status === "comprado" || row.status === "ingresado").reduce((sum, row) => sum + numeric(row.actual_price ?? row.estimated_price), 0);
  const operationalSales = movementRows.filter((row) => row.movement_type === "VENTA").reduce((sum, row) => sum + Math.abs(numeric(row.delta)) * numeric((row.metadata as Record<string, unknown> | null)?.unit_price), 0);

  return {
    categories: categoriesResult.data ?? [], items: resolvedItems, purchases: purchaseRows,
    movements: movementRows, board: boardResult.data ?? [], members: memberRows,
    summary: { totalItems: resolvedItems.length, lowStock: low, pendingPurchases: pending, estimatedValue, expenses, operationalSales },
  };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ studioId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { studioId } = await params;
    const admin = createAdminSupabase();
    const space = await resolveSpaceForStudio({ admin, studioId });
    const access = await requireSpaceInventoryAccess({ admin, userId: user.id, spaceId: space.id, capability: "view" });
    const data = await loadInventory(admin, space.id);
    return NextResponse.json({ space, role: access.role, ...data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo cargar el inventario." }, { status: apiStatus(error) });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ studioId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { studioId } = await params;
    const admin = createAdminSupabase();
    const space = await resolveSpaceForStudio({ admin, studioId });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = text(body.action, 60);

    if (action === "create_item") {
      const access = await requireSpaceInventoryAccess({ admin, userId: user.id, spaceId: space.id, capability: "inventory" });
      const name = text(body.name, 160);
      if (!name) return NextResponse.json({ error: "El nombre es obligatorio." }, { status: 400 });
      const initialQuantity = Math.max(0, numeric(body.quantity));
      const payload = {
        space_id: space.id, category_id: text(body.categoryId, 80) || null, name,
        description: text(body.description, 1200) || null, image_url: text(body.imageUrl, 1200) || null,
        stock_source: "managed", quantity: 0, unit: text(body.unit, 40) || "unidad",
        minimum_quantity: Math.max(0, numeric(body.minimumQuantity)), ideal_quantity: nullableNumeric(body.idealQuantity),
        unit_cost: nullableNumeric(body.unitCost), replacement_cost: nullableNumeric(body.replacementCost),
        supplier: text(body.supplier, 240) || null, physical_location: text(body.physicalLocation, 240) || null,
        notes: text(body.notes, 1500) || null, barcode_value: text(body.barcodeValue, 160) || null,
        added_by_player_id: access.playerId, added_by_user_id: user.id,
      };
      const { data: item, error } = await admin.from("space_inventory_items").insert(payload).select("*").single();
      if (error) throw new Error(error.message);
      if (initialQuantity > 0) {
        const movement = await admin.rpc("record_space_inventory_movement", { p_item_id: item.id, p_delta: initialQuantity, p_movement_type: "INGRESO", p_actor_user_id: user.id, p_reason: "Stock inicial" });
        if (movement.error) throw new Error(movement.error.message);
      }
      return NextResponse.json({ item }, { status: 201 });
    }

    if (action === "movement") {
      await requireSpaceInventoryAccess({ admin, userId: user.id, spaceId: space.id, capability: "inventory" });
      const itemId = text(body.itemId, 80);
      const amount = Math.abs(numeric(body.quantity));
      const direction = body.direction === "out" ? -1 : 1;
      const movementType = text(body.movementType, 30).toUpperCase() || (direction > 0 ? "INGRESO" : "CONSUMO");
      if (!itemId || amount <= 0 || !MOVEMENT_TYPES.has(movementType)) return NextResponse.json({ error: "Movimiento inválido." }, { status: 400 });
      const { data, error } = await admin.rpc("record_space_inventory_movement", {
        p_item_id: itemId, p_delta: amount * direction, p_movement_type: movementType, p_actor_user_id: user.id,
        p_reason: text(body.reason, 500) || null,
        p_metadata: typeof body.metadata === "object" && body.metadata ? body.metadata : {},
      });
      if (error) throw new Error(error.message);
      return NextResponse.json({ movement: data });
    }

    if (action === "create_purchase") {
      const access = await requireSpaceInventoryAccess({ admin, userId: user.id, spaceId: space.id, capability: "inventory" });
      const name = text(body.name, 160);
      const priority = text(body.priority, 20) || "normal";
      if (!name || !PURCHASE_PRIORITIES.has(priority)) return NextResponse.json({ error: "Compra inválida." }, { status: 400 });
      const { data, error } = await admin.from("space_inventory_purchase_requests").insert({
        space_id: space.id, item_id: text(body.itemId, 80) || null, name,
        quantity_needed: Math.max(0.0001, numeric(body.quantityNeeded, 1)), unit: text(body.unit, 40) || "unidad", priority,
        estimated_price: nullableNumeric(body.estimatedPrice), supplier: text(body.supplier, 240) || null,
        notes: text(body.notes, 1000) || null, added_by_player_id: access.playerId, added_by_user_id: user.id,
      }).select("*").single();
      if (error) throw new Error(error.message);
      return NextResponse.json({ purchase: data }, { status: 201 });
    }

    if (action === "update_purchase") {
      const access = await requireSpaceInventoryAccess({ admin, userId: user.id, spaceId: space.id, capability: "inventory" });
      const purchaseId = text(body.purchaseId, 80);
      const status = text(body.status, 20);
      if (!purchaseId || !PURCHASE_STATUSES.has(status)) return NextResponse.json({ error: "Estado de compra inválido." }, { status: 400 });
      if (status === "ingresado") {
        const result = await admin.rpc("enter_space_inventory_purchase", { p_purchase_id: purchaseId, p_actor_user_id: user.id });
        if (result.error) throw new Error(result.error.message);
        return NextResponse.json({ purchase: result.data });
      }
      const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
      if (body.actualPrice !== undefined) patch.actual_price = nullableNumeric(body.actualPrice);
      if (body.receiptUrl !== undefined) patch.receipt_url = text(body.receiptUrl, 1200) || null;
      if (status === "comprado") {
        patch.purchased_at = new Date().toISOString(); patch.purchased_by_player_id = access.playerId; patch.purchased_by_user_id = user.id;
      }
      const { data, error } = await admin.from("space_inventory_purchase_requests").update(patch).eq("id", purchaseId).eq("space_id", space.id).select("*").single();
      if (error) throw new Error(error.message);
      return NextResponse.json({ purchase: data });
    }

    if (action === "create_board_entry" || action === "update_board_entry") {
      const access = await requireSpaceInventoryAccess({ admin, userId: user.id, spaceId: space.id, capability: "sales" });
      const name = text(body.name, 160);
      if (!name) return NextResponse.json({ error: "El nombre es obligatorio." }, { status: 400 });
      const payload = {
        name, description: text(body.description, 1000) || null, category: text(body.category, 100) || null,
        price: body.isFree ? null : nullableNumeric(body.price), currency: text(body.currency, 8) || "ARS",
        availability: ["disponible", "agotado", "pausado"].includes(text(body.availability, 20)) ? text(body.availability, 20) : "disponible",
        active: body.active !== false, image_url: text(body.imageUrl, 1200) || null,
        item_id: text(body.itemId, 80) || null, is_free: Boolean(body.isFree), updated_at: new Date().toISOString(),
      };
      if (action === "create_board_entry") {
        const { data, error } = await admin.from("space_board_entries").insert({ ...payload, space_id: space.id, created_by_player_id: access.playerId, created_by_user_id: user.id }).select("*").single();
        if (error) throw new Error(error.message);
        return NextResponse.json({ entry: data }, { status: 201 });
      }
      const boardId = text(body.boardId, 80);
      const { data, error } = await admin.from("space_board_entries").update(payload).eq("id", boardId).eq("space_id", space.id).select("*").single();
      if (error) throw new Error(error.message);
      return NextResponse.json({ entry: data });
    }

    if (action === "register_board_sale") {
      await requireSpaceInventoryAccess({ admin, userId: user.id, spaceId: space.id, capability: "sales" });
      const boardId = text(body.boardId, 80);
      const quantity = Math.max(0.0001, numeric(body.quantity, 1));
      const { data: entry, error: boardError } = await admin.from("space_board_entries").select("id,name,item_id,price,is_free,active,availability").eq("id", boardId).eq("space_id", space.id).single();
      if (boardError) throw new Error(boardError.message);
      if (!entry.active || entry.availability !== "disponible") return NextResponse.json({ error: "Esta entrada del Pizarrón no está disponible." }, { status: 409 });
      if (!entry.item_id) return NextResponse.json({ error: "El servicio queda registrado en el Pizarrón, pero todavía no tiene un evento financiero: usá el checkout/caja existente para cobrarlo." }, { status: 409 });
      const { data, error } = await admin.rpc("record_space_inventory_movement", {
        p_item_id: entry.item_id, p_delta: -quantity, p_movement_type: "VENTA", p_actor_user_id: user.id,
        p_reason: `Venta desde Pizarrón: ${entry.name}`, p_reference_type: "space_board_entry", p_reference_id: entry.id,
        p_metadata: { unit_price: entry.is_free ? 0 : numeric(entry.price), board_entry_id: entry.id },
      });
      if (error) throw new Error(error.message);
      return NextResponse.json({ movement: data });
    }

    return NextResponse.json({ error: "Acción no reconocida." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo completar la operación." }, { status: apiStatus(error) });
  }
}
