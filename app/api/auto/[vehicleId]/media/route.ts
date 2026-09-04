import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { asNullableText, asText, requireVehicleAccess } from "@/lib/auto/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 12 * 1024 * 1024;
const PHASES = new Set(["general", "before", "after", "inspection"]);

function extensionFor(file: File) {
  const fromName = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (fromName && fromName.length <= 6) return fromName;
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
}

export async function POST(request: NextRequest, context: { params: Promise<{ vehicleId: string }> }) {
  try {
    const { vehicleId } = await context.params;
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const access = await requireVehicleAccess(admin, user, vehicleId, true);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Elegí una foto." }, { status: 400 });
    if (!file.type.startsWith("image/")) return NextResponse.json({ error: "El archivo debe ser una imagen." }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "La imagen supera 12 MB." }, { status: 413 });

    const phaseValue = asText(form.get("phase"), 30);
    const phase = PHASES.has(phaseValue) ? phaseValue : "general";
    const partCatalogId = asNullableText(form.get("partCatalogId"), 80);
    const repairId = asNullableText(form.get("repairId"), 80);
    const path = `${user.id}/${vehicleId}/${randomUUID()}.${extensionFor(file)}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error: uploadError } = await admin.storage.from("vehicle-media").upload(path, bytes, {
      contentType: file.type,
      upsert: false,
      cacheControl: "3600",
    });
    if (uploadError) throw new Error(uploadError.message);

    const { data: media, error: mediaError } = await admin.from("player_media").insert({
      player_id: access.player.id,
      studio_id: null,
      media_type: "image",
      origin: "clouva_auto",
      storage_path: path,
      caption: asNullableText(form.get("caption"), 500),
      alt_text: `${String(access.vehicle.make || "Auto")} ${String(access.vehicle.model || "")}`.trim(),
      visibility: "private",
    }).select("*").single();
    if (mediaError) {
      await admin.storage.from("vehicle-media").remove([path]);
      throw new Error(mediaError.message);
    }

    const { data: link, error: linkError } = await admin.from("vehicle_media_links").insert({
      vehicle_id: vehicleId,
      player_media_id: media.id,
      part_catalog_id: partCatalogId,
      repair_id: repairId,
      phase,
    }).select("*").single();
    if (linkError) {
      await admin.from("player_media").delete().eq("id", media.id);
      await admin.storage.from("vehicle-media").remove([path]);
      throw new Error(linkError.message);
    }

    await admin.from("vehicle_events").insert({
      vehicle_id: vehicleId,
      repair_id: repairId,
      event_type: "photo_added",
      title: phase === "before" ? "Foto antes" : phase === "after" ? "Foto después" : "Foto del vehículo",
      metadata: { player_media_id: media.id, part_catalog_id: partCatalogId, phase },
    });

    const signed = await admin.storage.from("vehicle-media").createSignedUrl(path, 3600);
    return NextResponse.json({ link, media: { ...media, resolved_url: signed.data?.signedUrl ?? null } }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo guardar la foto.";
    const status = isAuthError(error) || /no autorizado/i.test(message) ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
