import { NextRequest, NextResponse } from "next/server";
import {
  avatarAnalyzerError,
  fetchAvatarAnalyzerWorker,
  requireAvatarAnalyzerUser,
  safeAnalyzerRunId,
} from "@/lib/avatar-analyzer-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) {
  try {
    await requireAvatarAnalyzerUser(request);
    const { runId: rawRunId } = await context.params;
    const runId = safeAnalyzerRunId(rawRunId);
    const response = await fetchAvatarAnalyzerWorker(`/avatar/analyze/result/${runId}`);
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(raw || `El Worker no pudo devolver el diagnóstico (${response.status})`);
    }
    const data = JSON.parse(raw) as unknown;
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (cause) {
    return NextResponse.json({ error: avatarAnalyzerError(cause) }, { status: 422 });
  }
}
