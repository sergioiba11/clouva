import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { getOwnedStructure } from "@/lib/structures/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; featureId: string }> };

const FEATURE_TYPES = new Set([
  "reference_point",
  "building_footprint",
  "lot",
  "court",
  "patio",
  "sidewalk",
  "street",
  "wall",
  "custom",
]);

function coordinatePair(value: unknown): value is [number, number] {
  return Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(Number(value[0]))
    && Number.isFinite(Number(value[1]))
    && Number(value[1]) >= -90
    && Number(value[1]) <= 90
    && Number(value[0]) >= -180
    && Number(value[0]) <= 180;
}

function normalizedGeometry(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Geometría inválida.");
  const raw = value as { type?: unknown; coordinates?: unknown };
  if (raw.type === "Point" && coordinatePair(raw.coordinates)) {
    return { type: "Point", coordinates: [Number(raw.coordinates[0]), Number(raw.coordinates[1])] };
  }
  if (raw.type === "LineString" && Array.isArray(raw.coordinates) && raw.coordinates.length >= 2 && raw.coordinates.every(coordinatePair)) {
    return { type: "LineString", coordinates: raw.coordinates.map((pair) => [Number(pair[0]), Number(pair[1])]) };
  }
  if (raw.type === "Polygon" && Array.isArray(raw.coordinates) && Array.isArray(raw.coordinates[0])) {
    const ring = raw.coordinates[0];
    if (ring.length < 3 || !ring.every(coordinatePair)) throw new Error("El polígono necesita al menos 3 vértices válidos.");
    const normalized = ring.map((pair) => [Number(pair[0]), Number(pair[1])]);
    const first = normalized[0];
    const last = normalized[normalized.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) normalized.push([...first]);
    return { type: "Polygon", coordinates: [normalized] };
  }
  throw new Error("Structures admite POINT, LINESTRING o POLYGON.");
}

function normalizedProperties(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}


function responseError(error: unknown) {
  const message = error instanceof Error ? error.message : "No se pudo actualizar la geometría.";
  return NextResponse.json({ error: message }, { status: isAuthError(error) ? 401 : 400 });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id, featureId } = await context.params;
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    await getOwnedStructure(admin, user.id, id);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.featureType === "string") {
      if (!FEATURE_TYPES.has(body.featureType)) throw new Error("Tipo de geometría no soportado.");
      update.feature_type = body.featureType;
    }
    if (Object.prototype.hasOwnProperty.call(body, "name")) {
      update.name = typeof body.name === "string" ? body.name.trim().slice(0, 160) || null : null;
    }
    if (Object.prototype.hasOwnProperty.call(body, "geometry")) update.geometry = normalizedGeometry(body.geometry);
    if (Object.prototype.hasOwnProperty.call(body, "properties")) update.properties = normalizedProperties(body.properties);

    const { data, error } = await admin
      .from("structure_spatial_features")
      .update(update)
      .eq("id", featureId)
      .eq("structure_id", id)
      .select("*")
      .single();
    if (error || !data) throw new Error("No se pudo actualizar la geometría.");
    return NextResponse.json({ feature: data });
  } catch (error) {
    return responseError(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { id, featureId } = await context.params;
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    await getOwnedStructure(admin, user.id, id);
    const { error } = await admin
      .from("structure_spatial_features")
      .delete()
      .eq("id", featureId)
      .eq("structure_id", id);
    if (error) throw new Error("No se pudo eliminar la geometría.");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return responseError(error);
  }
}
