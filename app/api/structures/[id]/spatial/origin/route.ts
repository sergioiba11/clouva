import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { recalculateStructureSpatialWorld } from "@/lib/structures/georeferencing-server";
import { getOwnedStructure } from "@/lib/structures/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function finite(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function responseError(error: unknown) {
  const message = error instanceof Error ? error.message : "No se pudo definir el origen.";
  return NextResponse.json({ error: message }, { status: isAuthError(error) ? 401 : 400 });
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const current = await getOwnedStructure(admin, user.id, id);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;

    let originLat = Object.prototype.hasOwnProperty.call(body, "originLat")
      ? finite(body.originLat)
      : current.origin_latitude;
    let originLon = Object.prototype.hasOwnProperty.call(body, "originLon")
      ? finite(body.originLon)
      : current.origin_longitude;
    let originAlt = Object.prototype.hasOwnProperty.call(body, "originAlt")
      ? finite(body.originAlt)
      : current.origin_alt;

    if (typeof body.imageId === "string" && body.imageId) {
      const { data: image, error } = await admin
        .from("structure_images")
        .select("latitude,longitude,altitude")
        .eq("id", body.imageId)
        .eq("structure_id", id)
        .maybeSingle();
      if (error || !image || image.latitude == null || image.longitude == null) {
        throw new Error("La cámara elegida no tiene latitud y longitud reales.");
      }
      originLat = Number(image.latitude);
      originLon = Number(image.longitude);
      originAlt = image.altitude == null ? originAlt : Number(image.altitude);
    }

    if (originLat == null || originLon == null || originLat < -90 || originLat > 90 || originLon < -180 || originLon > 180) {
      throw new Error("El origen necesita latitud y longitud válidas.");
    }

    const northRotationDeg = Object.prototype.hasOwnProperty.call(body, "northRotationDeg")
      ? finite(body.northRotationDeg) ?? 0
      : current.north_rotation_deg ?? 0;
    const mapZoom = Object.prototype.hasOwnProperty.call(body, "mapZoom")
      ? finite(body.mapZoom)
      : current.map_zoom;
    const mapType = body.mapType === "roadmap" ? "roadmap" : body.mapType === "satellite" ? "satellite" : current.map_type ?? "satellite";

    const { data, error } = await admin
      .from("structures")
      .update({
        origin_latitude: originLat,
        origin_longitude: originLon,
        origin_alt: originAlt,
        north_rotation_deg: northRotationDeg,
        map_zoom: mapZoom,
        map_type: mapType,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("owner_id", user.id)
      .select("*")
      .single();
    if (error || !data) throw new Error("No se pudo guardar el origen.");

    const recalc = await recalculateStructureSpatialWorld(admin, data);
    return NextResponse.json({ structure: data, ...recalc });
  } catch (error) {
    return responseError(error);
  }
}
