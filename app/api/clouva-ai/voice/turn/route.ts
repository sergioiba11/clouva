import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Legacy voice persistence is closed; the audited Live turn endpoint owns it. */
export async function POST() {
  return NextResponse.json(
    {
      error: "Este endpoint de voz fue retirado. Usá el flujo canónico de Trébol Live.",
      canonicalEndpoint: "/api/clouva-ai/live/turn",
    },
    { status: 410 },
  );
}
