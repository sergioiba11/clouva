import { NextRequest, NextResponse } from "next/server";
import {
  avatarAnalyzerAdminClient,
  avatarAnalyzerError,
  requireAvatarAnalyzerUser,
  safeAnalyzerRunId,
} from "@/lib/avatar-analyzer-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MetadataRecord = Record<string, unknown>;

export async function GET(request: NextRequest) {
  try {
    const user = await requireAvatarAnalyzerUser(request);
    const supabase = avatarAnalyzerAdminClient();
    const { data, error } = await supabase
      .from("user_avatars")
      .select("id,metadata,updated_at")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;

    const metadata = data?.metadata && typeof data.metadata === "object"
      ? data.metadata as MetadataRecord
      : {};
    const stored = metadata.avatar_analyzer_v4 && typeof metadata.avatar_analyzer_v4 === "object"
      ? metadata.avatar_analyzer_v4 as MetadataRecord
      : null;
    if (!stored || typeof stored.runId !== "string") {
      return NextResponse.json({ available: false }, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    return NextResponse.json({
      available: true,
      runId: safeAnalyzerRunId(stored.runId),
      analyzerVersion: stored.analyzerVersion,
      mapVersion: stored.mapVersion,
      sourceSha256: stored.sourceSha256,
      status: stored.status,
      requestedRigProfile: stored.requestedRigProfile,
      updatedAt: stored.updatedAt,
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (cause) {
    return NextResponse.json({ error: avatarAnalyzerError(cause) }, { status: 422 });
  }
}
