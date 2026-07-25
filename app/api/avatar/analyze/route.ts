import { NextRequest, NextResponse } from "next/server";
import { errorMessage, requireUser, resolveOriginalAvatar, workerBaseUrlAndToken, workerError } from "./_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser(request);
    const avatar = await resolveOriginalAvatar(supabase, user.id);
    const { workerBaseUrl, workerToken } = workerBaseUrlAndToken();

    const response = await fetch(`${workerBaseUrl}/avatar/analyze-v4-preview-async`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(workerToken ? { Authorization: `Bearer ${workerToken}` } : {}),
      },
      body: JSON.stringify({
        source_url: avatar.sourceUrl,
        include_renders: true,
        requested_rig_profile: "BODY_BASIC",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(30 * 1000),
    });
    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      throw new Error(
        `No se pudo iniciar el análisis (${response.status})${raw ? `: ${workerError(raw).slice(0, 1200)}` : ""}`,
      );
    }

    const data = await response.json() as { jobId?: string };
    if (!data.jobId) throw new Error("El worker no devolvió un jobId");
    return NextResponse.json({ jobId: data.jobId });
  } catch (cause) {
    console.error("Avatar Analyzer kickoff failed", cause);
    return NextResponse.json({ error: errorMessage(cause) }, { status: 422 });
  }
}
