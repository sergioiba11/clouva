import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { getOwnedStructure, normalizeRuleList } from "@/lib/structures/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function responseError(error: unknown) {
  const message = error instanceof Error ? error.message : "No se pudo completar la operación.";
  const status = isAuthError(error) ? 401 : /no encontrada/i.test(message) ? 404 : 400;
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const structure = await getOwnedStructure(admin, user.id, id);

    const [
      imagesResult,
      surfacesResult,
      camerasResult,
      rulesResult,
      jobsResult,
      outputsResult,
      linksResult,
    ] = await Promise.all([
      admin.from("structure_images").select("*").eq("structure_id", id).order("created_at", { ascending: true }),
      admin.from("structure_surfaces").select("*").eq("structure_id", id).order("name", { ascending: true }),
      admin.from("structure_camera_nodes").select("*").eq("structure_id", id),
      admin.from("structure_rules").select("*").eq("structure_id", id).order("priority", { ascending: false }),
      admin.from("structure_render_jobs").select("*").eq("structure_id", id).order("created_at", { ascending: false }).limit(12),
      admin.from("structure_render_outputs").select("*").eq("structure_id", id).order("created_at", { ascending: false }).limit(40),
      admin.from("structure_image_surface_links").select("*").eq("structure_id", id),
    ]);

    const firstError = [
      imagesResult.error,
      surfacesResult.error,
      camerasResult.error,
      rulesResult.error,
      jobsResult.error,
      outputsResult.error,
      linksResult.error,
    ].find(Boolean);
    if (firstError) throw new Error("No se pudo cargar toda la base espacial.");

    return NextResponse.json({
      structure,
      images: imagesResult.data ?? [],
      surfaces: surfacesResult.data ?? [],
      cameraNodes: camerasResult.data ?? [],
      rules: rulesResult.data ?? [],
      renderJobs: jobsResult.data ?? [],
      renderOutputs: outputsResult.data ?? [],
      imageSurfaceLinks: linksResult.data ?? [],
    });
  } catch (error) {
    return responseError(error);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    await getOwnedStructure(admin, user.id, id);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.name === "string" && body.name.trim()) update.name = body.name.trim().slice(0, 120);
    if (typeof body.description === "string") update.description = body.description.trim().slice(0, 3000) || null;
    if (typeof body.locationName === "string") update.location_name = body.locationName.trim().slice(0, 240) || null;
    if (typeof body.historicalNotes === "string") update.historical_notes = body.historicalNotes.trim().slice(0, 5000) || null;
    if (typeof body.structureType === "string" && body.structureType.trim()) update.structure_type = body.structureType.trim().slice(0, 80);
    if (body.blockout && typeof body.blockout === "object" && !Array.isArray(body.blockout)) update.blockout = body.blockout;

    if (Object.prototype.hasOwnProperty.call(body, "originLatitude")) {
      const value = Number(body.originLatitude);
      update.origin_latitude = Number.isFinite(value) ? value : null;
    }
    if (Object.prototype.hasOwnProperty.call(body, "originLongitude")) {
      const value = Number(body.originLongitude);
      update.origin_longitude = Number.isFinite(value) ? value : null;
    }

    let rules: string[] | null = null;
    if (Object.prototype.hasOwnProperty.call(body, "reconstructionRules")) {
      rules = normalizeRuleList(body.reconstructionRules);
      update.reconstruction_rules = rules;
    }

    const { data, error } = await admin
      .from("structures")
      .update(update)
      .eq("id", id)
      .eq("owner_id", user.id)
      .select("*")
      .single();
    if (error || !data) throw new Error("No se pudo guardar la estructura.");

    if (rules) {
      await admin.from("structure_rules").delete().eq("structure_id", id);
      if (rules.length) {
        await admin.from("structure_rules").insert(
          rules.map((rule, index) => ({
            structure_id: id,
            rule,
            priority: 100 - index,
            active: true,
          })),
        );
      }
    }

    return NextResponse.json({ structure: data });
  } catch (error) {
    return responseError(error);
  }
}
