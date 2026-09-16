import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { processAssetImportJob } from "@/lib/admin-assets/import-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 1800;

function matchesSecret(received: string, expected: string) {
  const a = Buffer.from(received, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.CLOUVA_ASSET_IMPORT_WORKER_SECRET ?? "";
  const receivedSecret = request.headers.get("x-clouva-worker-secret") ?? "";
  if (!expectedSecret || !matchesSecret(receivedSecret, expectedSecret)) {
    return NextResponse.json({ error: "Worker no autorizado." }, { status: 401 });
  }

  try {
    const body = await request.json() as { jobId?: unknown };
    const jobId = typeof body.jobId === "string" ? body.jobId : "";
    if (!jobId) return NextResponse.json({ error: "Falta jobId." }, { status: 400 });

    const job = await processAssetImportJob(jobId);
    return NextResponse.json({ ok: true, job });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falló el worker de importación.";
    console.error("[admin-assets-import] worker failed", error);
    return NextResponse.json({ error: message.slice(0, 800) }, { status: 500 });
  }
}
