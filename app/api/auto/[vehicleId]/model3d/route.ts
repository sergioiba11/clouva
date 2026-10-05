import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireVehicleAccess } from "@/lib/auto/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 90 * 1024 * 1024;

function safeName(value: string) {
  return value
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9áéíóúüñ _-]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100) || "Modelo del vehículo";
}

function slugify(value: string) {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 84);
  return slug || "vehicle-model";
}

export async function POST(request: NextRequest, context: { params: Promise<{ vehicleId: string }> }) {
  try {
    const { vehicleId } = await context.params;
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const access = await requireVehicleAccess(admin, user, vehicleId, true);

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Elegí un archivo .glb." }, { status: 400 });
    }

    const extension = file.name.split(".").pop()?.toLowerCase();
    const validMime = file.type === "model/gltf-binary" || file.type === "application/octet-stream" || !file.type;
    if (extension !== "glb" || !validMime) {
      return NextResponse.json({ error: "Por ahora CLOUVA Auto importa modelos GLB autocontenidos." }, { status: 400 });
    }
    if (!file.size) return NextResponse.json({ error: "El GLB está vacío." }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "El GLB supera 90 MB." }, { status: 413 });

    const displayName = safeName(String(form.get("name") || file.name));
    const token = randomUUID();
    const path = `${user.id}/${vehicleId}/models/${token}.glb`;
    const bytes = new Uint8Array(await file.arrayBuffer());

    const { error: uploadError } = await admin.storage.from("vehicle-media").upload(path, bytes, {
      contentType: "model/gltf-binary",
      cacheControl: "3600",
      upsert: false,
    });
    if (uploadError) throw new Error(uploadError.message);

    let assetId: string | null = null;
    try {
      const { data: asset, error: assetError } = await admin
        .from("creator_3d_assets")
        .insert({
          user_id: user.id,
          name: displayName,
          slug: `${slugify(displayName)}-${token.slice(0, 8)}`,
          kind: "object",
          category: "vehicle",
          status: "ready",
          storage_path: path,
          metadata: {
            source: "vehicle_model_upload",
            vehicle_id: vehicleId,
            original_filename: file.name,
            byte_size: file.size,
            mime_type: file.type || "model/gltf-binary",
          },
        })
        .select("id,name,kind,category,status,model_url,storage_path,preview_image_url,metadata")
        .single();
      if (assetError) throw new Error(assetError.message);
      assetId = asset.id;

      const { error: deactivateError } = await admin
        .from("vehicle_3d_bindings")
        .update({ is_active: false })
        .eq("vehicle_id", vehicleId)
        .eq("is_active", true);
      if (deactivateError) throw new Error(deactivateError.message);

      const { data: binding, error: bindingError } = await admin
        .from("vehicle_3d_bindings")
        .insert({
          vehicle_id: vehicleId,
          creator_3d_asset_id: asset.id,
          representation_level: 4,
          part_mesh_map: {},
          is_active: true,
          metadata: {
            source: "manual_glb",
            original_filename: file.name,
          },
        })
        .select("*")
        .single();
      if (bindingError) throw new Error(bindingError.message);

      await admin.from("vehicle_events").insert({
        vehicle_id: vehicleId,
        event_type: "vehicle_3d_model_changed",
        title: `Modelo 3D activado: ${displayName}`,
        metadata: { creator_3d_asset_id: asset.id, binding_id: binding.id },
      });

      const signed = await admin.storage.from("vehicle-media").createSignedUrl(path, 3600);
      return NextResponse.json({
        asset: { ...asset, model_url: signed.data?.signedUrl ?? null },
        binding,
        vehicle: {
          id: vehicleId,
          label: `${String(access.vehicle.make || "")} ${String(access.vehicle.model || "")}`.trim(),
        },
      }, { status: 201 });
    } catch (cause) {
      if (assetId) await admin.from("creator_3d_assets").delete().eq("id", assetId).eq("user_id", user.id);
      await admin.storage.from("vehicle-media").remove([path]);
      throw cause;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo importar el modelo 3D.";
    const status = isAuthError(error) || /no autorizado/i.test(message) ? 401 : /no encontrado/i.test(message) ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
