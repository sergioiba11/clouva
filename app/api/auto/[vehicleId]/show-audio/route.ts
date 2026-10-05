import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { asNullableText, requireVehicleAccess } from "@/lib/auto/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 200 * 1024 * 1024;
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "m4a", "aac", "ogg", "flac", "webm"]);

function safeExtension(file: File) {
  const fromName = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (fromName && AUDIO_EXTENSIONS.has(fromName)) return fromName;
  if (file.type.includes("wav")) return "wav";
  if (file.type.includes("ogg")) return "ogg";
  if (file.type.includes("flac")) return "flac";
  if (file.type.includes("webm")) return "webm";
  if (file.type.includes("mp4") || file.type.includes("m4a")) return "m4a";
  return "mp3";
}

function audioName(file: File) {
  const withoutExtension = file.name.replace(/\.[^.]+$/, "").trim();
  return withoutExtension.slice(0, 180) || "Audio CLOUVA Auto";
}

export async function POST(request: NextRequest, context: { params: Promise<{ vehicleId: string }> }) {
  try {
    const { vehicleId } = await context.params;
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const access = await requireVehicleAccess(admin, user, vehicleId, true);
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) return NextResponse.json({ error: "Elegí un archivo de audio." }, { status: 400 });
    const extension = safeExtension(file);
    const validType = file.type.startsWith("audio/") || AUDIO_EXTENSIONS.has(extension);
    if (!validType) return NextResponse.json({ error: "El archivo debe ser audio." }, { status: 400 });
    if (!file.size) return NextResponse.json({ error: "El archivo está vacío." }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "El audio supera 200 MB." }, { status: 413 });

    const path = `${user.id}/${vehicleId}/show/${randomUUID()}.${extension}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error: uploadError } = await admin.storage.from("vehicle-media").upload(path, bytes, {
      contentType: file.type || "audio/mpeg",
      upsert: false,
      cacheControl: "3600",
    });
    if (uploadError) throw new Error(uploadError.message);

    const caption = asNullableText(form.get("caption"), 500) || audioName(file);
    const { data: media, error: mediaError } = await admin.from("player_media").insert({
      player_id: access.player.id,
      studio_id: null,
      media_type: "audio",
      origin: "manual",
      storage_path: path,
      caption,
      alt_text: `Show audio · ${String(access.vehicle.make || "Auto")} ${String(access.vehicle.model || "")}`.trim(),
      visibility: "private",
    }).select("id,caption,storage_path,created_at").single();

    if (mediaError) {
      await admin.storage.from("vehicle-media").remove([path]);
      throw new Error(mediaError.message);
    }

    await admin.from("vehicle_events").insert({
      vehicle_id: vehicleId,
      event_type: "show_audio_added",
      title: `Audio de show agregado: ${caption}`,
      metadata: { player_media_id: media.id },
    });

    const signed = await admin.storage.from("vehicle-media").createSignedUrl(path, 3600);
    return NextResponse.json({
      track: {
        id: media.id,
        caption: media.caption,
        resolved_url: signed.data?.signedUrl ?? null,
        created_at: media.created_at,
      },
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo guardar el audio.";
    const status = isAuthError(error) || /no autorizado/i.test(message) ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
