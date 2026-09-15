import { NextResponse } from "next/server";
import { resolvePublicProfileRadio } from "@/lib/server/profile-radio-data";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ publicAlias: string }> },
) {
  const { publicAlias } = await params;
  const station = await resolvePublicProfileRadio(publicAlias).catch(() => null);

  if (!station) {
    return NextResponse.json({ error: "Radio no disponible." }, { status: 404 });
  }

  return NextResponse.json(
    {
      station: {
        id: station.id,
        alias: station.alias,
        name: station.name,
        artwork: station.artworkUrl,
      },
      status: station.streamUrl ? "IDLE" : "OFFLINE",
      metadata: station.metadata,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
