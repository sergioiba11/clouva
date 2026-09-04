import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { requireSpaceInventoryAccess, resolveSpaceForStudio } from "@/lib/server/space-inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function apiStatus(error: unknown) {
  return (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ studioId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { studioId } = await params;
    const admin = createAdminSupabase();
    const space = await resolveSpaceForStudio({ admin, studioId });
    const access = await requireSpaceInventoryAccess({ admin, userId: user.id, spaceId: space.id, capability: "view" });

    const [eventsResult, purchasesResult, movementsResult, boardResult, itemsResult] = await Promise.all([
      admin.from("space_board_events").select("id,board_entry_id,event_type,quantity,unit_price,currency,total_amount,inventory_movement_id,commerce_order_id,player_id,note,created_at").eq("space_id", space.id).order("created_at", { ascending: false }).limit(2000),
      admin.from("space_inventory_purchase_requests").select("id,item_id,name,quantity_needed,unit,priority,estimated_price,actual_price,supplier,status,source,purchased_by_player_id,entered_by_player_id,purchased_at,entered_at,created_at").eq("space_id", space.id).neq("status", "cancelado").order("created_at", { ascending: false }).limit(2000),
      admin.from("space_inventory_movements").select("id,item_id,delta,unit,movement_type,player_id,reason,created_at").eq("space_id", space.id).order("created_at", { ascending: false }).limit(4000),
      admin.from("space_board_entries").select("id,name,category,is_free,active,item_id").eq("space_id", space.id),
      admin.from("space_inventory_items").select("id,name,category_id,unit,quantity,minimum_quantity,unit_cost,replacement_cost,active").eq("space_id", space.id),
    ]);
    for (const result of [eventsResult, purchasesResult, movementsResult, boardResult, itemsResult]) {
      if (result.error) throw new Error(result.error.message);
    }

    const events = eventsResult.data ?? [];
    const purchases = purchasesResult.data ?? [];
    const movements = movementsResult.data ?? [];
    const board = boardResult.data ?? [];
    const items = itemsResult.data ?? [];
    const playerIds = Array.from(new Set([
      ...events.map((row) => row.player_id).filter(Boolean),
      ...purchases.flatMap((row) => [row.purchased_by_player_id, row.entered_by_player_id]).filter(Boolean),
      ...movements.map((row) => row.player_id).filter(Boolean),
    ])) as string[];
    const { data: players, error: playersError } = playerIds.length
      ? await admin.from("players").select("id,display_name,username,profile_image_url").in("id", playerIds)
      : { data: [], error: null };
    if (playersError) throw new Error(playersError.message);

    const boardById = new Map(board.map((row) => [row.id, row]));
    const itemById = new Map(items.map((row) => [row.id, row]));
    const playerById = new Map((players ?? []).map((row) => [row.id, row]));

    const operationalSales = events.filter((row) => row.event_type === "VENTA").reduce((sum, row) => sum + number(row.total_amount), 0);
    const giftsValue = events.filter((row) => row.event_type === "REGALO").reduce((sum, row) => sum + number(row.total_amount), 0);
    const giftsCount = events.filter((row) => row.event_type === "REGALO").reduce((sum, row) => sum + number(row.quantity), 0);
    const expenses = purchases
      .filter((row) => row.status === "comprado" || row.status === "ingresado")
      .reduce((sum, row) => sum + number(row.actual_price ?? row.estimated_price), 0);
    const inventoryValue = items.filter((row) => row.active).reduce((sum, row) => sum + number(row.quantity) * number(row.unit_cost), 0);

    const salesByEntry = new Map<string, { id: string; name: string; category: string | null; quantity: number; revenue: number; events: number }>();
    for (const event of events) {
      const entry = boardById.get(event.board_entry_id);
      const current = salesByEntry.get(event.board_entry_id) ?? { id: event.board_entry_id, name: entry?.name ?? "Pizarrón", category: entry?.category ?? null, quantity: 0, revenue: 0, events: 0 };
      current.quantity += number(event.quantity);
      if (event.event_type === "VENTA") current.revenue += number(event.total_amount);
      current.events += 1;
      salesByEntry.set(event.board_entry_id, current);
    }

    const consumptionByItem = new Map<string, { id: string; name: string; unit: string; consumed: number; gifts: number; losses: number; sales: number }>();
    for (const movement of movements) {
      if (number(movement.delta) >= 0) continue;
      const item = itemById.get(movement.item_id);
      const current = consumptionByItem.get(movement.item_id) ?? { id: movement.item_id, name: item?.name ?? "Ítem", unit: movement.unit, consumed: 0, gifts: 0, losses: 0, sales: 0 };
      const amount = Math.abs(number(movement.delta));
      if (movement.movement_type === "CONSUMO") current.consumed += amount;
      if (movement.movement_type === "REGALO") current.gifts += amount;
      if (movement.movement_type === "ROTURA" || movement.movement_type === "PERDIDA") current.losses += amount;
      if (movement.movement_type === "VENTA") current.sales += amount;
      consumptionByItem.set(movement.item_id, current);
    }

    const daily = new Map<string, { date: string; sales: number; expenses: number; events: number }>();
    for (const event of events) {
      const date = event.created_at.slice(0, 10);
      const row = daily.get(date) ?? { date, sales: 0, expenses: 0, events: 0 };
      if (event.event_type === "VENTA") row.sales += number(event.total_amount);
      row.events += 1;
      daily.set(date, row);
    }
    for (const purchase of purchases) {
      const sourceDate = purchase.purchased_at ?? (purchase.status === "ingresado" ? purchase.entered_at : null);
      if (!sourceDate || !["comprado", "ingresado"].includes(purchase.status)) continue;
      const date = sourceDate.slice(0, 10);
      const row = daily.get(date) ?? { date, sales: 0, expenses: 0, events: 0 };
      row.expenses += number(purchase.actual_price ?? purchase.estimated_price);
      daily.set(date, row);
    }

    const recentEvents = events.slice(0, 30).map((event) => ({
      ...event,
      board: boardById.get(event.board_entry_id) ?? null,
      player: event.player_id ? playerById.get(event.player_id) ?? null : null,
    }));

    return NextResponse.json({
      space,
      role: access.role,
      summary: { operationalSales, expenses, operationalBalance: operationalSales - expenses, inventoryValue, giftsCount, giftsValue, saleEvents: events.filter((row) => row.event_type === "VENTA").length },
      salesByEntry: Array.from(salesByEntry.values()).sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity),
      consumptionByItem: Array.from(consumptionByItem.values()).sort((a, b) => (b.consumed + b.gifts + b.losses + b.sales) - (a.consumed + a.gifts + a.losses + a.sales)),
      daily: Array.from(daily.values()).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60),
      recentEvents,
      pendingPurchases: purchases.filter((row) => row.status === "pendiente" || row.status === "comprado").slice(0, 50),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudieron generar los reportes." }, { status: apiStatus(error) });
  }
}
