import { NextRequest, NextResponse } from "next/server";
import { loadCommerceLabelForIdentifier, recordCommerceLabelEvents } from "@/lib/server/commerce-label-data";
import {
  parseCommerceLabelOptions,
  renderCommerceLabelPng,
  renderCommerceLabelsPdf,
  renderCommerceLabelSvg,
} from "@/lib/server/commerce-labels";
import { requireManagedSpot } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; identifierId: string }> },
) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId, identifierId } = await params;
    const admin = createAdminSupabase();
    const { spot } = await requireManagedSpot({ admin, userId: user.id, studioId });
    const label = await loadCommerceLabelForIdentifier({ admin, spotId: spot.id, identifierId });
    if (!label) return NextResponse.json({ error: "Código activo inexistente en este Spot." }, { status: 404 });

    const options = parseCommerceLabelOptions(request.nextUrl.searchParams);
    const svg = await renderCommerceLabelSvg(label.record, options);
    const printRequested = request.nextUrl.searchParams.get("print") === "true";
    const eventType = printRequested
      ? "printed"
      : options.format === "png" ? "downloaded_png" : options.format === "pdf" ? "downloaded_pdf" : "downloaded_svg";
    if (request.nextUrl.searchParams.get("preview") !== "true") {
      await recordCommerceLabelEvents({
        admin,
        identifierIds: label.identifiers.map((identifier) => identifier.id),
        studioId: spot.studio_id,
        spotId: spot.id,
        actorId: user.id,
        eventType,
        metadata: { format: options.format, layout: options.layout, page: options.page, size: options.size, copies: options.copies },
      });
    }

    const baseName = `el-iglu-${label.identifier.identifier_type}-${label.identifier.id}`;
    if (options.format === "png") {
      const png = await renderCommerceLabelPng(svg);
      return new NextResponse(new Uint8Array(png), { headers: responseHeaders("image/png", `${baseName}.png`, printRequested) });
    }
    if (options.format === "pdf") {
      const pdf = await renderCommerceLabelsPdf([svg], options);
      return new NextResponse(new Uint8Array(pdf), { headers: responseHeaders("application/pdf", `${baseName}.pdf`, printRequested) });
    }
    return new NextResponse(svg, { headers: responseHeaders("image/svg+xml; charset=utf-8", `${baseName}.svg`, printRequested) });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo generar la etiqueta." }, { status });
  }
}

function responseHeaders(contentType: string, filename: string, inline: boolean) {
  return {
    "content-type": contentType,
    "content-disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
    "cache-control": "private, no-store",
  };
}
