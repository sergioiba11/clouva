import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { requireStudioManager } from "@/lib/server/studio-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STUDIO_EDITABLE = new Set([
  "name", "tagline", "description", "logo_url", "cover_url", "city", "country",
  "categories", "website_url", "social_links", "contact_email", "publication_status", "is_published",
]);

function sanitizeStudioChanges(input: unknown) {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!STUDIO_EDITABLE.has(key)) continue;
    if (key === "categories") output[key] = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 20) : [];
    else if (key === "social_links") output[key] = Array.isArray(value) ? value.slice(0, 30) : [];
    else if (["is_published"].includes(key)) output[key] = Boolean(value);
    else if (typeof value === "string") output[key] = value.trim().slice(0, key === "description" ? 5000 : 500);
    else if (value === null) output[key] = null;
  }
  return output;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ studioId: string }> },
) {
  try {
    const { user } = await requireUser(request);
    const { studioId } = await context.params;
    const admin = createAdminSupabase();
    const permission = await requireStudioManager({ admin, userId: user.id, studioId });

    const [studioResult, applicationsResult, membersResult, playersResult, projectsResult, eventsResult] = await Promise.all([
      admin.from("studios").select("*").eq("id", studioId).single(),
      admin.from("studio_applications").select("id,artist_name,category,instagram_url,clouva_profile_url,contact_email,presentation,activity,reason,material_links,availability,message,status,created_at,player:players(id,slug,display_name,profile_image_url)").eq("studio_id", studioId).order("created_at", { ascending: false }).limit(100),
      admin.from("studio_members").select("id,profile_id,role,status,joined_at,profile:profiles(id,username,display_name,full_name,avatar_url)").eq("studio_id", studioId).order("joined_at"),
      admin.from("player_studios").select("id,role,is_primary,is_visible,display_order,player:players(id,slug,display_name,primary_role,profile_image_url)").eq("studio_id", studioId).order("display_order"),
      admin.from("community_projects").select("*").eq("studio_id", studioId).order("created_at", { ascending: false }).limit(50),
      admin.from("community_events").select("*").eq("studio_id", studioId).order("starts_at", { ascending: false }).limit(50),
    ]);
    for (const result of [studioResult, applicationsResult, membersResult, playersResult, projectsResult, eventsResult]) {
      if (result.error) throw new Error(result.error.message);
    }

    return NextResponse.json({
      permission: { role: permission.role, vip: true },
      studio: studioResult.data,
      applications: applicationsResult.data ?? [],
      members: membersResult.data ?? [],
      players: playersResult.data ?? [],
      projects: projectsResult.data ?? [],
      events: eventsResult.data ?? [],
    });
  } catch (error) {
    const status = (error as Error & { status?: number }).status || (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo cargar el Estudio.";
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ studioId: string }> },
) {
  try {
    const { user } = await requireUser(request);
    const { studioId } = await context.params;
    const admin = createAdminSupabase();
    await requireStudioManager({ admin, userId: user.id, studioId });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action || "update_studio");

    if (action === "update_studio") {
      const changes = sanitizeStudioChanges(body.changes);
      const { data, error } = await admin.from("studios").update(changes).eq("id", studioId).select("*").single();
      if (error) throw new Error(error.message);
      await admin.from("admin_audit_log").insert({
        admin_user_id: user.id,
        action: "studio.update",
        entity_type: "studio",
        entity_id: studioId,
        reason: "Actualización desde Studio Dashboard",
        metadata: { fields: Object.keys(changes) },
      });
      return NextResponse.json({ studio: data });
    }

    if (action === "review_application") {
      const applicationId = String(body.applicationId || "");
      const status = String(body.status || "");
      if (!applicationId || !["in_review", "accepted", "rejected"].includes(status)) {
        return NextResponse.json({ error: "Acción de revisión inválida." }, { status: 400 });
      }
      const { data: application, error: applicationError } = await admin
        .from("studio_applications")
        .select("id,studio_id,player_id,user_id,status")
        .eq("id", applicationId)
        .eq("studio_id", studioId)
        .maybeSingle();
      if (applicationError) throw new Error(applicationError.message);
      if (!application) return NextResponse.json({ error: "Solicitud no encontrada." }, { status: 404 });
      if (!["submitted", "in_review"].includes(application.status as string)) {
        return NextResponse.json({ error: "La solicitud ya fue cerrada." }, { status: 409 });
      }

      const reviewedAt = new Date().toISOString();
      const { error: updateError } = await admin.from("studio_applications").update({
        status,
        reviewer_notes: typeof body.notes === "string" ? body.notes.trim().slice(0, 3000) : null,
        reviewed_by: user.id,
        reviewed_at: reviewedAt,
      }).eq("id", applicationId).in("status", ["submitted", "in_review"]);
      if (updateError) throw new Error(updateError.message);

      if (status === "accepted" && application.player_id) {
        const { error: linkError } = await admin.from("player_studios").upsert({
          player_id: application.player_id,
          studio_id: studioId,
          role: typeof body.publicRole === "string" ? body.publicRole.trim().slice(0, 100) : "Miembro",
          is_primary: false,
          is_visible: true,
          display_order: 999,
          approved_by: user.id,
          approved_at: reviewedAt,
        }, { onConflict: "player_id,studio_id" });
        if (linkError) throw new Error(linkError.message);
      }

      await admin.from("admin_audit_log").insert({
        admin_user_id: user.id,
        action: `studio.application.${status}`,
        entity_type: "studio_application",
        entity_id: applicationId,
        reason: typeof body.notes === "string" ? body.notes.trim().slice(0, 500) : null,
        metadata: { studio_id: studioId, player_id: application.player_id },
      });
      return NextResponse.json({ reviewed: true, status });
    }

    if (action === "update_player_order") {
      const items = Array.isArray(body.items) ? body.items : [];
      for (const [index, item] of items.entries()) {
        if (!item || typeof item !== "object") continue;
        const relationId = String((item as Record<string, unknown>).id || "");
        if (!relationId) continue;
        await admin.from("player_studios").update({ display_order: index }).eq("id", relationId).eq("studio_id", studioId);
      }
      return NextResponse.json({ reordered: true });
    }

    return NextResponse.json({ error: "Acción no reconocida." }, { status: 400 });
  } catch (error) {
    const status = (error as Error & { status?: number }).status || (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo actualizar el Estudio.";
    return NextResponse.json({ error: message }, { status });
  }
}
