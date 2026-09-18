import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { buildStructureExportZip } from "@/lib/structures/export";
import { downloadStructureImage, getOwnedStructure, rebuildStructureImageOrder } from "@/lib/structures/server";
import type {
  StructureCameraNodeRecord,
  StructureImageRecord,
  StructureRuleRecord,
  StructureSurfaceRecord,
} from "@/lib/structures/spatial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RouteContext = { params: Promise<{ id: string }> };

function responseError(error: unknown) {
  const message = error instanceof Error ? error.message : "No se pudo exportar la estructura.";
  const status = isAuthError(error) ? 401 : /no encontrada/i.test(message) ? 404 : 400;
  return NextResponse.json({ error: message }, { status });
}

async function downloadEvidence(images: StructureImageRecord[]) {
  const result = new Map<string, Buffer>();
  const concurrency = 6;
  for (let offset = 0; offset < images.length; offset += concurrency) {
    const group = images.slice(offset, offset + concurrency);
    const downloaded = await Promise.all(group.map(async (image) => ({
      id: image.id,
      bytes: await downloadStructureImage(image.public_url),
    })));
    for (const item of downloaded) result.set(item.id, item.bytes);
  }
  return result;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const structure = await getOwnedStructure(admin, user.id, id);

    await rebuildStructureImageOrder(admin, id);

    const [
      imagesResult,
      surfacesResult,
      camerasResult,
      rulesResult,
      linksResult,
    ] = await Promise.all([
      admin.from("structure_images").select("*").eq("structure_id", id).order("latitude", { ascending: false, nullsFirst: false }).order("longitude", { ascending: true, nullsFirst: false }).order("heading", { ascending: true, nullsFirst: false }).order("created_at", { ascending: true }),
      admin.from("structure_surfaces").select("*").eq("structure_id", id).order("name", { ascending: true }),
      admin.from("structure_camera_nodes").select("*").eq("structure_id", id),
      admin.from("structure_rules").select("*").eq("structure_id", id).order("priority", { ascending: false }),
      admin.from("structure_image_surface_links").select("*").eq("structure_id", id),
    ]);

    const firstError = [
      imagesResult.error,
      surfacesResult.error,
      camerasResult.error,
      rulesResult.error,
      linksResult.error,
    ].find(Boolean);
    if (firstError) throw new Error("No se pudo preparar toda la base espacial.");

    const images = (imagesResult.data ?? []) as unknown as StructureImageRecord[];
    if (!images.length) throw new Error("La estructura todavía no tiene imágenes para exportar.");

    const bytesByImageId = await downloadEvidence(images);
    const exported = await buildStructureExportZip({
      structure,
      images,
      surfaces: (surfacesResult.data ?? []) as unknown as StructureSurfaceRecord[],
      cameras: (camerasResult.data ?? []) as unknown as StructureCameraNodeRecord[],
      rules: (rulesResult.data ?? []) as unknown as StructureRuleRecord[],
      links: (linksResult.data ?? []) as Array<Record<string, unknown>>,
      bytesByImageId,
    });

    return new NextResponse(new Uint8Array(exported.zip), {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${exported.fileName.replace(/"/g, "")}"`,
        "content-length": String(exported.zip.length),
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return responseError(error);
  }
}
