import { NextRequest, NextResponse } from "next/server";
import { MediaApiError, publicMediaError, requireMediaAdmin } from "@/lib/server/media-auth";
import { getVideoProject } from "@/lib/server/video-projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function findEditablePlayer(admin: Awaited<ReturnType<typeof requireMediaAdmin>>["admin"], userId: string) {
  const { data: owned, error: ownedError } = await admin
    .from("players")
    .select("id,slug,is_published,publication_status")
    .eq("owner_user_id", userId)
    .maybeSingle();
  if (ownedError) throw new Error(ownedError.message);
  if (owned) return owned;

  const { data: member, error: memberError } = await admin
    .from("player_members")
    .select("player_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .in("role", ["owner", "manager", "editor"])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (memberError) throw new Error(memberError.message);
  if (!member) return null;

  const { data: player, error } = await admin
    .from("players")
    .select("id,slug,is_published,publication_status")
    .eq("id", member.player_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return player;
}

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const { projectId } = await context.params;
    const project = await getVideoProject(admin, projectId, user.id);
    if (!project) return NextResponse.json({ error: "El proyecto no existe.", code: "project_not_found" }, { status: 404 });
    if (project.status !== "completed" || !project.output_url || !project.output_storage_path) {
      throw new MediaApiError("El video debe estar completado antes de agregarlo al Player.", 409, "video_not_completed");
    }

    const player = await findEditablePlayer(admin, user.id);
    if (!player) throw new MediaApiError("No pudimos resolver tu Player.", 404, "player_not_found");

    const externalId = `clouva-video-project:${project.id}`;
    const { data: lastMedia, error: orderError } = await admin
      .from("player_media")
      .select("display_order")
      .eq("player_id", player.id)
      .order("display_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (orderError) throw new Error(orderError.message);
    const displayOrder = Number(lastMedia?.display_order ?? -1) + 1;

    const { data: media, error } = await admin
      .from("player_media")
      .upsert({
        player_id: player.id,
        studio_id: null,
        media_type: "video",
        origin: "system",
        external_id: externalId,
        source_url: project.output_url,
        storage_path: project.output_storage_path,
        public_url: project.output_url,
        thumbnail_url: project.thumbnail_url,
        caption: project.title,
        alt_text: project.title,
        display_order: displayOrder,
        visibility: "public",
        imported_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, {
        onConflict: "origin,external_id,player_id",
      })
      .select("id,player_id,public_url,thumbnail_url,caption,visibility,display_order")
      .single();
    if (error || !media) throw new MediaApiError("No se pudo agregar el video al Player.", 500, "player_media_failed");

    const isPublic = player.is_published === true && player.publication_status === "published";
    return NextResponse.json({
      media,
      player: {
        id: player.id,
        slug: player.slug,
        href: isPublic ? `/${player.slug}` : null,
        isPublic,
      },
    });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
