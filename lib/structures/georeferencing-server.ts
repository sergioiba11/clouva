import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { geoToLocalMeters, type StructureImageRecord, type StructureRecord } from "@/lib/structures/spatial";

export async function recalculateStructureSpatialWorld(
  admin: SupabaseClient,
  structure: StructureRecord,
) {
  if (structure.origin_latitude == null || structure.origin_longitude == null) {
    throw new Error("Definí el origen geográfico antes de recalcular la escena.");
  }

  const { data, error } = await admin
    .from("structure_images")
    .select("*")
    .eq("structure_id", structure.id);
  if (error) throw new Error("No se pudieron leer las cámaras para recalcular.");

  let recalculated = 0;
  for (const row of (data ?? []) as unknown as StructureImageRecord[]) {
    if (row.latitude == null || row.longitude == null) continue;

    const local = geoToLocalMeters({
      lat: row.latitude,
      lon: row.longitude,
      alt: row.altitude,
      originLat: structure.origin_latitude,
      originLon: structure.origin_longitude,
      originAlt: structure.origin_alt,
      northRotationDeg: structure.north_rotation_deg,
    });

    const imageUpdate = {
      local_x: local.x,
      local_y: -local.z,
      local_z: local.y,
      updated_at: new Date().toISOString(),
    };

    const { error: imageError } = await admin
      .from("structure_images")
      .update(imageUpdate)
      .eq("id", row.id)
      .eq("structure_id", structure.id);
    if (imageError) throw new Error("No se pudo recalcular una cámara.");

    const { error: cameraError } = await admin
      .from("structure_camera_nodes")
      .upsert({
        structure_id: structure.id,
        image_id: row.id,
        latitude: row.latitude,
        longitude: row.longitude,
        altitude: row.altitude,
        local_x: local.x,
        local_y: -local.z,
        local_z: local.y,
        position_x: local.x,
        position_y: local.y,
        position_z: local.z,
        heading: row.heading,
        pitch: row.pitch,
        roll: row.roll,
        fov: row.fov,
        confidence: row.confidence,
        spatial_source: row.spatial_source ?? "unplaced",
        spatial_status: row.placement_status ?? "unplaced",
        updated_at: new Date().toISOString(),
      }, { onConflict: "image_id" });
    if (cameraError) throw new Error("No se pudo recalcular un nodo de cámara.");

    recalculated += 1;
  }

  return { recalculated };
}
