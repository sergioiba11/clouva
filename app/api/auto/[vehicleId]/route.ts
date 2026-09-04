import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import {
  asNonNegativeInt,
  asNonNegativeMoney,
  asNullableText,
  asText,
  requireVehicleAccess,
} from "@/lib/auto/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PART_STATUSES = new Set(["good", "review", "repair", "replace", "missing", "in_progress", "solved"]);
const PRIORITIES = new Set(["low", "normal", "high", "critical"]);
const REPAIR_CATEGORIES = new Set(["critical", "function", "maintenance", "aesthetic", "upgrade"]);
const REPAIR_STATUSES = new Set(["planned", "in_progress", "completed", "cancelled"]);

async function loadDetail(admin: ReturnType<typeof createAdminSupabase>, vehicleId: string, playerId: string) {
  const [vehicleResult, systemsResult, partsResult, statesResult, inspectionsResult, repairsResult, eventsResult, bindingsResult, mediaLinksResult] = await Promise.all([
    admin.from("vehicles").select("*").eq("id", vehicleId).single(),
    admin.from("vehicle_system_catalog").select("*").order("sort_order"),
    admin.from("vehicle_part_catalog").select("*").order("sort_order"),
    admin.from("vehicle_part_state").select("*").eq("vehicle_id", vehicleId),
    admin.from("vehicle_inspections").select("*").eq("vehicle_id", vehicleId).order("created_at", { ascending: false }).limit(20),
    admin.from("vehicle_repairs").select("*").eq("vehicle_id", vehicleId).order("created_at", { ascending: false }).limit(100),
    admin.from("vehicle_events").select("*").eq("vehicle_id", vehicleId).order("occurred_at", { ascending: false }).limit(100),
    admin.from("vehicle_3d_bindings").select("*").eq("vehicle_id", vehicleId).eq("is_active", true).maybeSingle(),
    admin.from("vehicle_media_links").select("*").eq("vehicle_id", vehicleId).order("created_at", { ascending: false }).limit(100),
  ]);
  for (const result of [vehicleResult, systemsResult, partsResult, statesResult, inspectionsResult, repairsResult, eventsResult, bindingsResult, mediaLinksResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  let asset: Record<string, unknown> | null = null;
  if (bindingsResult.data?.creator_3d_asset_id) {
    const { data, error } = await admin
      .from("creator_3d_assets")
      .select("id,name,kind,category,status,model_url,storage_path,preview_image_url,metadata")
      .eq("id", bindingsResult.data.creator_3d_asset_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    asset = data;
  }

  const mediaIds = (mediaLinksResult.data ?? []).map((row) => row.player_media_id);
  const mediaById = new Map<string, Record<string, unknown>>();
  if (mediaIds.length) {
    const { data, error } = await admin.from("player_media").select("*").eq("player_id", playerId).in("id", mediaIds);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      let url = row.public_url || row.source_url || null;
      if (!url && row.storage_path) {
        const signed = await admin.storage.from("vehicle-media").createSignedUrl(row.storage_path, 3600);
        url = signed.data?.signedUrl ?? null;
      }
      mediaById.set(row.id, { ...row, resolved_url: url });
    }
  }
  const media = (mediaLinksResult.data ?? []).map((link) => ({ ...link, media: mediaById.get(link.player_media_id) ?? null }));

  const repairs = repairsResult.data ?? [];
  const costs = repairs.reduce(
    (sum, repair) => {
      if (repair.status === "cancelled") return sum;
      const parts = Number(repair.parts_cost || 0);
      const labor = Number(repair.labor_cost || 0);
      sum.parts += parts;
      sum.labor += labor;
      sum.total += parts + labor;
      if (repair.status !== "completed") sum.pending += Number(repair.estimated_cost || 0);
      return sum;
    },
    { parts: 0, labor: 0, total: 0, pending: 0 },
  );

  return {
    vehicle: vehicleResult.data,
    systems: systemsResult.data ?? [],
    parts: partsResult.data ?? [],
    states: statesResult.data ?? [],
    inspections: inspectionsResult.data ?? [],
    repairs,
    events: eventsResult.data ?? [],
    media,
    model3d: bindingsResult.data ? { binding: bindingsResult.data, asset } : null,
    costs,
  };
}

export async function GET(request: NextRequest, context: { params: Promise<{ vehicleId: string }> }) {
  try {
    const { vehicleId } = await context.params;
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const access = await requireVehicleAccess(admin, user, vehicleId);
    return NextResponse.json(await loadDetail(admin, vehicleId, access.player.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo cargar CLOUVA Auto.";
    const status = isAuthError(error) || /no autorizado/i.test(message) ? 401 : /no encontrado/i.test(message) ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ vehicleId: string }> }) {
  try {
    const { vehicleId } = await context.params;
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const access = await requireVehicleAccess(admin, user, vehicleId, true);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = asText(body.action, 40);

    if (action === "part_state") {
      const partCatalogId = asText(body.partCatalogId, 80);
      if (!partCatalogId) return NextResponse.json({ error: "Falta la pieza." }, { status: 400 });
      const status = PART_STATUSES.has(String(body.status)) ? String(body.status) : "review";
      const priority = PRIORITIES.has(String(body.priority)) ? String(body.priority) : "normal";
      const partsCost = asNonNegativeMoney(body.partsCost);
      const laborCost = asNonNegativeMoney(body.laborCost);
      const payload = {
        vehicle_id: vehicleId,
        part_catalog_id: partCatalogId,
        status,
        priority,
        notes: asNullableText(body.notes, 4000),
        odometer_km: asNonNegativeInt(body.odometerKm, Number(access.vehicle.odometer_km || 0)),
        parts_cost: partsCost,
        labor_cost: laborCost,
        last_inspected_at: body.inspected ? new Date().toISOString() : undefined,
        repaired_at: ["good", "solved"].includes(status) && body.repaired ? new Date().toISOString() : undefined,
      };
      const cleanPayload = Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
      const { data, error } = await admin
        .from("vehicle_part_state")
        .upsert(cleanPayload, { onConflict: "vehicle_id,part_catalog_id" })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      await admin.from("vehicle_events").insert({
        vehicle_id: vehicleId,
        event_type: "part_state_changed",
        title: "Estado de pieza actualizado",
        description: asNullableText(body.eventLabel, 240),
        odometer_km: cleanPayload.odometer_km,
        metadata: { part_catalog_id: partCatalogId, status, priority },
      });
      return NextResponse.json({ state: data });
    }

    if (action === "inspection") {
      const rawItems = Array.isArray(body.items) ? body.items : [];
      const items = rawItems
        .map((item) => (item && typeof item === "object" ? item as Record<string, unknown> : {}))
        .filter((item) => asText(item.partCatalogId, 80) && ["good", "review", "repair", "replace", "missing"].includes(String(item.result)));
      if (!items.length) return NextResponse.json({ error: "La revisión no tiene resultados." }, { status: 400 });
      const odometerKm = asNonNegativeInt(body.odometerKm, Number(access.vehicle.odometer_km || 0));
      const { data: inspection, error: inspectionError } = await admin.from("vehicle_inspections").insert({
        vehicle_id: vehicleId,
        title: asText(body.title, 160) || "Revisión básica",
        status: "completed",
        odometer_km: odometerKm,
        notes: asNullableText(body.notes, 4000),
        completed_at: new Date().toISOString(),
      }).select("*").single();
      if (inspectionError) throw new Error(inspectionError.message);
      const rows = items.map((item) => ({
        inspection_id: inspection.id,
        part_catalog_id: asText(item.partCatalogId, 80),
        result: String(item.result),
        observations: asNullableText(item.observations, 1200),
      }));
      const { error: itemsError } = await admin.from("vehicle_inspection_items").insert(rows);
      if (itemsError) throw new Error(itemsError.message);
      for (const item of items) {
        await admin.from("vehicle_part_state").upsert({
          vehicle_id: vehicleId,
          part_catalog_id: asText(item.partCatalogId, 80),
          status: String(item.result),
          priority: String(item.result) === "good" ? "normal" : String(item.result) === "review" ? "high" : "critical",
          notes: asNullableText(item.observations, 1200),
          last_inspected_at: new Date().toISOString(),
          odometer_km: odometerKm,
        }, { onConflict: "vehicle_id,part_catalog_id" });
      }
      await admin.from("vehicle_events").insert({ vehicle_id: vehicleId, event_type: "inspection", title: inspection.title, odometer_km: odometerKm, metadata: { inspection_id: inspection.id, items: items.length } });
      return NextResponse.json({ inspection });
    }

    if (action === "repair") {
      const title = asText(body.title, 180);
      if (!title) return NextResponse.json({ error: "La reparación necesita un título." }, { status: 400 });
      const category = REPAIR_CATEGORIES.has(String(body.category)) ? String(body.category) : "function";
      const status = REPAIR_STATUSES.has(String(body.status)) ? String(body.status) : "planned";
      const partCatalogId = asNullableText(body.partCatalogId, 80);
      const partsCost = asNonNegativeMoney(body.partsCost);
      const laborCost = asNonNegativeMoney(body.laborCost);
      const { data: repair, error } = await admin.from("vehicle_repairs").insert({
        vehicle_id: vehicleId,
        part_catalog_id: partCatalogId,
        category,
        status,
        title,
        diagnosis: asNullableText(body.diagnosis, 4000),
        resolution: asNullableText(body.resolution, 4000),
        parts_cost: partsCost,
        labor_cost: laborCost,
        estimated_cost: asNonNegativeMoney(body.estimatedCost),
        odometer_km: asNonNegativeInt(body.odometerKm, Number(access.vehicle.odometer_km || 0)),
        started_at: status === "in_progress" || status === "completed" ? new Date().toISOString() : null,
        completed_at: status === "completed" ? new Date().toISOString() : null,
      }).select("*").single();
      if (error) throw new Error(error.message);
      if (partCatalogId) {
        await admin.from("vehicle_part_state").upsert({
          vehicle_id: vehicleId,
          part_catalog_id: partCatalogId,
          status: status === "completed" ? "solved" : status === "in_progress" ? "in_progress" : "repair",
          priority: category === "critical" ? "critical" : "high",
          parts_cost: partsCost,
          labor_cost: laborCost,
          repaired_at: status === "completed" ? new Date().toISOString() : null,
        }, { onConflict: "vehicle_id,part_catalog_id" });
      }
      await admin.from("vehicle_events").insert({
        vehicle_id: vehicleId,
        repair_id: repair.id,
        event_type: status === "completed" ? "repair_completed" : "repair_created",
        title,
        amount: partsCost + laborCost,
        odometer_km: repair.odometer_km,
        metadata: { category, status, part_catalog_id: partCatalogId },
      });
      return NextResponse.json({ repair });
    }

    if (action === "vehicle") {
      const updates: Record<string, unknown> = {};
      if (body.nickname !== undefined) updates.nickname = asNullableText(body.nickname, 100);
      if (body.odometerKm !== undefined) updates.odometer_km = asNonNegativeInt(body.odometerKm);
      if (body.notes !== undefined) updates.notes = asNullableText(body.notes, 4000);
      if (body.colorCurrent !== undefined) updates.color_current = asNullableText(body.colorCurrent, 80);
      if (!Object.keys(updates).length) return NextResponse.json({ error: "No hay cambios para guardar." }, { status: 400 });
      const { data, error } = await admin.from("vehicles").update(updates).eq("id", vehicleId).select("*").single();
      if (error) throw new Error(error.message);
      return NextResponse.json({ vehicle: data });
    }

    return NextResponse.json({ error: "Acción de CLOUVA Auto no reconocida." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo actualizar CLOUVA Auto.";
    const status = isAuthError(error) || /no autorizado/i.test(message) ? 401 : /no encontrado/i.test(message) ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
