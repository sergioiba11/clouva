import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import {
  getOwnedStructure,
  rebuildStructureImageOrder,
  syncCameraNode,
} from "@/lib/structures/server";
import {
  coordinatesToLocalMeters,
  headingToCardinal,
  localMetersToCoordinates,
  type StructureImageRecord,
} from "@/lib/structures/spatial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; imageId: string }> };

function nullableNumber(value: unknown) {
  if (value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function responseError(error: unknown) {
  const message = error instanceof Error ? error.message : "No se pudo actualizar la referencia.";
  return NextResponse.json({ error: message }, { status: isAuthError(error) ? 401 : 400 });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id, imageId } = await context.params;
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const structure = await getOwnedStructure(admin, user.id, id);
    const { data: current, error: currentError } = await admin
      .from("structure_images")
      .select("*")
      .eq("id", imageId)
      .eq("structure_id", id)
      .maybeSingle();
    if (currentError || !current) throw new Error("Referencia no encontrada.");

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

    for (const [input, column, max] of [
      ["sector", "sector", 120],
      ["sceneType", "scene_type", 80],
      ["sourceType", "source_type", 80],
      ["description", "description", 1200],
    ] as const) {
      if (Object.prototype.hasOwnProperty.call(body, input)) {
        update[column] = typeof body[input] === "string" ? body[input].trim().slice(0, max) || null : null;
      }
    }

    const numericFields = [
      ["latitude", "latitude"],
      ["longitude", "longitude"],
      ["altitude", "altitude"],
      ["heading", "heading"],
      ["pitch", "pitch"],
      ["roll", "roll"],
      ["fov", "fov"],
      ["localX", "local_x"],
      ["localY", "local_y"],
      ["localZ", "local_z"],
    ] as const;
    let manualSpatialChange = false;

    for (const [input, column] of numericFields) {
      if (!Object.prototype.hasOwnProperty.call(body, input)) continue;
      const value = nullableNumber(body[input]);
      if (value === undefined) continue;
      update[column] = value;
      const currentValue = Number((current as Record<string, unknown>)[column]);
      const nextValue = value == null ? null : Number(value);
      const changed = nextValue == null
        ? (current as Record<string, unknown>)[column] != null
        : !Number.isFinite(currentValue) || Math.abs(currentValue - nextValue) > 1e-8;
      if (changed) manualSpatialChange = true;
    }

    if (Array.isArray(body.visibleSurfaces)) {
      update.visible_surfaces = body.visibleSurfaces
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, 100))
        .filter(Boolean)
        .slice(0, 40);
    }
    if (Array.isArray(body.tags)) {
      update.tags = body.tags
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, 60))
        .filter(Boolean)
        .slice(0, 40);
    }
    if (Object.prototype.hasOwnProperty.call(body, "priority")) {
      const priority = Math.max(-100, Math.min(100, Math.round(Number(body.priority) || 0)));
      update.priority = priority;
    }
    const requestedVerified = Object.prototype.hasOwnProperty.call(body, "manualVerified")
      ? Boolean(body.manualVerified)
      : current.manual_verified;

    const nextHeading = Object.prototype.hasOwnProperty.call(update, "heading")
      ? update.heading as number | null
      : current.heading;
    const localWasEdited = Object.prototype.hasOwnProperty.call(update, "local_x")
      || Object.prototype.hasOwnProperty.call(update, "local_y");

    if (
      localWasEdited
      && structure.origin_latitude != null
      && structure.origin_longitude != null
    ) {
      const nextLocalX = Object.prototype.hasOwnProperty.call(update, "local_x")
        ? update.local_x as number | null
        : current.local_x;
      const nextLocalY = Object.prototype.hasOwnProperty.call(update, "local_y")
        ? update.local_y as number | null
        : current.local_y;
      if (nextLocalX != null && nextLocalY != null) {
        const geo = localMetersToCoordinates(
          { latitude: structure.origin_latitude, longitude: structure.origin_longitude },
          { x: nextLocalX, y: nextLocalY },
        );
        update.latitude = geo.latitude;
        update.longitude = geo.longitude;
      }
    } else {
      const nextLatitude = Object.prototype.hasOwnProperty.call(update, "latitude")
        ? update.latitude as number | null
        : current.latitude;
      const nextLongitude = Object.prototype.hasOwnProperty.call(update, "longitude")
        ? update.longitude as number | null
        : current.longitude;
      if (
        nextLatitude != null
        && nextLongitude != null
        && structure.origin_latitude != null
        && structure.origin_longitude != null
      ) {
        const local = coordinatesToLocalMeters(
          { latitude: structure.origin_latitude, longitude: structure.origin_longitude },
          { latitude: nextLatitude, longitude: nextLongitude },
        );
        update.local_x = local.x;
        update.local_y = local.y;
      }
    }

    if (manualSpatialChange || requestedVerified) {
      update.manual_verified = true;
      update.spatial_source = "manual";
      update.analysis_status = "verified";
      update.confidence = 1;
    } else if (Object.prototype.hasOwnProperty.call(body, "manualVerified")) {
      update.manual_verified = false;
      update.analysis_status = current.analysis_status === "verified" ? "analyzed" : current.analysis_status;
    }

    update.cardinal_direction = headingToCardinal(nextHeading);

    const { data, error } = await admin
      .from("structure_images")
      .update(update)
      .eq("id", imageId)
      .eq("structure_id", id)
      .select("*")
      .single();
    if (error || !data) throw new Error("No se pudo guardar la referencia.");

    await syncCameraNode(admin, data as unknown as StructureImageRecord);
    await rebuildStructureImageOrder(admin, id);
    return NextResponse.json({ image: data });
  } catch (error) {
    return responseError(error);
  }
}
