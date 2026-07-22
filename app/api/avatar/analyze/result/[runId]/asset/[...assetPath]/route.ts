import { NextRequest, NextResponse } from "next/server";
import {
  avatarAnalyzerError,
  fetchAvatarAnalyzerWorker,
  requireAvatarAnalyzerUser,
  safeAnalyzerAssetPath,
  safeAnalyzerRunId,
} from "@/lib/avatar-analyzer-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ runId: string; assetPath: string[] }> },
) {
  try {
    await requireAvatarAnalyzerUser(request);
    const { runId: rawRunId, assetPath } = await context.params;
    const runId = safeAnalyzerRunId(rawRunId);
    const safePath = safeAnalyzerAssetPath(assetPath);
    const response = await fetchAvatarAnalyzerWorker(
      `/avatar/analyze/result/${runId}/asset/${safePath}`,
    );
    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      throw new Error(raw || `El Worker no pudo devolver el archivo (${response.status})`);
    }
    const body = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "application/octet-stream";
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (cause) {
    return NextResponse.json({ error: avatarAnalyzerError(cause) }, { status: 422 });
  }
}
