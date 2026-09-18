import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { getOwnedStructure } from "@/lib/structures/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

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
  const message = error instanceof Error ? error.message : "No se pudo guardar la geometría.";
  return NextResponse.json({ error: message }, { status: isAuthError(error) ? 401 : 400 });
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    await getOwnedStructure(admin, user.id, id);
    const { data, error } = await admin
      .from("structure_spatial_features")
      .select("*")
      .eq("structure_id", id)
      .order("updated_at", { ascending: true });
    if (error) throw new Error("No se pudieron cargar las geometrías.");
    return NextResponse.json({ spatialFeatures: data ?? [] });
  } catch (error) {
    return responseError(error);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    await getOwnedStructure(admin, user.id, id);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const featureType = typeof body.featureType === "string" ? body.featureType : "";
    if (!FEATURE_TYPES.has(featureType)) throw new Error("Tipo de geometría no soportado.");

    const { data, error } = await admin
      .from("structure_spatial_features")
      .insert({
        structure_id: id,
        feature_type: featureType,
        name: typeof body.name === "string" ? body.name.trim().slice(0, 160) || null : null,
        geometry: normalizedGeometry(body.geometry),
        properties: normalizedProperties(body.properties),
      })
      .select("*")
      .single();
    if (error || !data) throw new Error("No se pudo crear la geometría.");
    return NextResponse.json({ feature: data });
  } catch (error) {
    return responseError(error);
  }
}
