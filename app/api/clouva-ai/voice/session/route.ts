import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Retired compatibility endpoint from the parallel voice prototype.
 * Trébol Live is served exclusively by /api/clouva-ai/live/token so token
 * limits, context, tools, confirmations and audit all share one pipeline.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: "Este endpoint de voz fue retirado. Usá el flujo canónico de Trébol Live.",
      canonicalEndpoint: "/api/clouva-ai/live/token",
    },
    { status: 410 },
  );
}
