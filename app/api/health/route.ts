import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      commit: process.env.CLOUVA_DEPLOYED_COMMIT ?? null,
      ref: process.env.CLOUVA_DEPLOYED_REF ?? null,
      revision: process.env.K_REVISION ?? null,
      buildDate: process.env.CLOUVA_BUILD_DATE ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
