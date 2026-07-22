import { NextRequest, NextResponse } from "next/server";
import {
  avatarAnalyzerError,
  fetchAvatarAnalyzerWorker,
  requireAvatarAnalyzerUser,
  safeAnalyzerRunId,
} from "@/lib/avatar-analyzer-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) {
  try {
    await requireAvatarAnalyzerUser(request);
    const { runId: rawRunId } = await context.params;
    const runId = safeAnalyzerRunId(rawRunId);
    const body = await request.json();
    const response = await fetchAvatarAnalyzerWorker(
      `/avatar/analyze/result/${runId}/corrections`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(raw || `El Worker no pudo guardar las correcciones (${response.status})`);
    }
    return NextResponse.json(JSON.parse(raw), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (cause) {
    return NextResponse.json({ error: avatarAnalyzerError(cause) }, { status: 422 });
  }
}
