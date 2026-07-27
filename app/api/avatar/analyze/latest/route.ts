
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

export async function GET(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser(request);
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

    const metadata = asRecord(data?.metadata) || {};
    const stored = asRecord(metadata.avatar_analyzer_v4);
    if (stored && typeof stored.runId === "string") {
      return NextResponse.json({
        available: true,
        pending: false,
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
        jobId: pending.jobId,
        startedAt: pending.startedAt,
        pendingStatus: pending.status,
        pendingError: pending.error,
      }, { headers: { "Cache-Control": "no-store" } });
    }

    return NextResponse.json({ available: false, pending: false }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (cause) {
    return NextResponse.json({ error: errorMessage(cause) }, { status: 422 });
  }
}
