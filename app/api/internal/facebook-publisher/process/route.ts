import { NextRequest, NextResponse } from "next/server";
import { processFacebookPublicationBatch } from "@/lib/server/facebook-publisher";
import { createAdminSupabase } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function expectedSecret() {
  return (process.env.FACEBOOK_PUBLISHER_TASK_SECRET || process.env.CLOUVA_ASSET_IMPORT_WORKER_SECRET || "").trim();
}

export async function POST(request: NextRequest) {
  const configuredSecret = expectedSecret();
  const receivedSecret = request.headers.get("x-clouva-facebook-publisher-secret") || "";
  if (!configuredSecret || receivedSecret !== configuredSecret) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { batchId?: string };
    const batchId = String(body.batchId || "").trim();
    if (!batchId) return NextResponse.json({ error: "Falta batchId." }, { status: 400 });
    const result = await processFacebookPublicationBatch(createAdminSupabase(), batchId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("facebook publisher worker failed", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Falló el publisher runner.",
    }, { status: 500 });
  }
}
