import { NextResponse } from "next/server";
import { getRigPersistenceAdmin } from "@/lib/creator-studio/rig-persistence";
import { resolveOfficialClouvaAvatar } from "@/lib/avatar-engine/official-clouva-avatar-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const avatar = await resolveOfficialClouvaAvatar(getRigPersistenceAdmin());
    const upstream = await fetch(avatar.url, {
      cache: "no-store",
      redirect: "follow",
      headers: { "User-Agent": "CLOUVA-Official-Avatar/1.0" },
    });

    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { error: `No se pudo descargar el avatar oficial de CLOUVA (HTTP ${upstream.status}).` },
        { status: 502 },
      );
    }

    const headers = new Headers({
      "Content-Type": upstream.headers.get("content-type") || "model/gltf-binary",
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      "X-Clouva-Avatar-Id": avatar.id,
      "X-Clouva-Avatar-Source": avatar.source,
    });
    const contentLength = upstream.headers.get("content-length");
    if (contentLength) headers.set("Content-Length", contentLength);

    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo resolver el avatar oficial de CLOUVA.",
      },
      { status: 503 },
    );
  }
}
