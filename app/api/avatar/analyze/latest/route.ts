
import { NextRequest, NextResponse } from "next/server";
import { errorMessage, requireUser } from "../_shared";
import { safeAnalyzerRunId } from "@/lib/avatar-analyzer-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MetadataRecord = Record<string, unknown>;

function asRecord(value: unknown): MetadataRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as MetadataRecord
    : null;
}

/** Identidad real del avatar asignado para la etapa "Avatar asignado" del
 * wizard. `assignedAvatar = user.activeAvatar ?? officialClouvaAvatar` ya es
 * el comportamiento real: esta fila ES la activa del usuario (CLOUVA cuando
 * el usuario logueado es la cuenta oficial), no hay nada que hardcodear acá
 * -- ver resolveOriginalAvatar() en _shared.ts para el mismo criterio que
 * usa el kickoff del análisis. */
function buildAssignedAvatarInfo(row: MetadataRecord | null | undefined) {
  if (!row) return null;
  const metadata = asRecord(row.metadata) || {};
  return {
    avatarId: typeof row.id === "string" ? row.id : null,
    name: typeof row.name === "string" && row.name.trim() ? row.name.trim() : null,
    glbPath: typeof row.storage_path === "string" && row.storage_path.trim()
      ? row.storage_path.trim()
      : (typeof row.model_url === "string" ? row.model_url : null),
    rigStatus: typeof row.status === "string" ? row.status : null,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
    source: typeof metadata.original_meshy_url === "string" ? "meshy" : "upload",
  };
}

export async function GET(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser(request);
    const { data, error } = await supabase
      .from("user_avatars")
      .select("id,name,status,model_url,storage_path,metadata,updated_at")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;

    const avatar = buildAssignedAvatarInfo(data as MetadataRecord | null);
    const metadata = asRecord(data?.metadata) || {};
    const stored = asRecord(metadata.avatar_analyzer_v4);
    if (stored && typeof stored.runId === "string") {
      return NextResponse.json({
        available: true,
        pending: false,
        avatar,
        runId: safeAnalyzerRunId(stored.runId),
        analyzerVersion: stored.analyzerVersion,
        mapVersion: stored.mapVersion,
        sourceSha256: stored.sourceSha256,
        status: stored.status,
        requestedRigProfile: stored.requestedRigProfile,
        summary: asRecord(stored.summary) || {
          status: String(stored.status ?? "needs_review"),
          runId: safeAnalyzerRunId(stored.runId),
          analyzerVersion: stored.analyzerVersion,
          sourceSha256: stored.sourceSha256,
          requestedRigProfile: stored.requestedRigProfile,
          warningCount: 0,
          rigModified: false,
        },
        updatedAt: stored.updatedAt,
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const pending = asRecord(metadata.avatar_analyzer_v4_pending);
    if (pending && typeof pending.jobId === "string") {
      return NextResponse.json({
        available: false,
        pending: true,
        avatar,
        jobId: pending.jobId,
        startedAt: pending.startedAt,
        pendingStatus: pending.status,
        pendingError: pending.error,
      }, { headers: { "Cache-Control": "no-store" } });
    }

    return NextResponse.json({ available: false, pending: false, avatar }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (cause) {
    return NextResponse.json({ error: errorMessage(cause) }, { status: 422 });
  }
}
