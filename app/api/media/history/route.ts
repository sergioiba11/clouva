import { NextRequest, NextResponse } from "next/server";
import { MediaApiError, publicMediaError, requireMediaAdmin } from "@/lib/server/media-auth";
import { MEDIA_JOB_COLUMNS, toPublicMediaJob, type MediaJobRow } from "@/lib/server/media-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const type = request.nextUrl.searchParams.get("type");
    const cursor = request.nextUrl.searchParams.get("cursor");
    const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit") ?? 20), 1), 40);
    let query = admin
      .from("media_generation_jobs")
      .select(MEDIA_JOB_COLUMNS)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit + 1);
    if (type === "image" || type === "video") query = query.eq("type", type);
    if (cursor) {
      const parsed = Date.parse(cursor);
      if (!Number.isFinite(parsed)) throw new MediaApiError("Cursor inválido.", 400, "invalid_cursor");
      query = query.lt("created_at", new Date(parsed).toISOString());
    }
    const { data, error } = await query;
    if (error) throw new MediaApiError("No se pudo cargar el historial.", 500, "history_failed");
    const rows = (data ?? []) as unknown as MediaJobRow[];
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    return NextResponse.json({
      items: page.map(toPublicMediaJob),
      nextCursor: hasMore ? page.at(-1)?.created_at ?? null : null,
    });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
