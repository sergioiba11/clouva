import { NextRequest, NextResponse } from "next/server";
import { loadCommerceLabelsForListing, recordCommerceLabelEvents } from "@/lib/server/commerce-label-data";
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

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId } = await params;
    const listingId = request.nextUrl.searchParams.get("listingId") ?? "";
    if (!listingId) return NextResponse.json({ error: "Elegí un producto." }, { status: 400 });
    const admin = createAdminSupabase();
    const { spot } = await requireManagedSpot({ admin, userId: user.id, studioId });
    const labels = await loadCommerceLabelsForListing({
      admin,
      spotId: spot.id,
      listingId,
      listingVariantId: request.nextUrl.searchParams.get("variantId"),
    });
    if (!labels) return NextResponse.json({ error: "Producto inexistente en este Spot." }, { status: 404 });
    const options = parseCommerceLabelOptions(request.nextUrl.searchParams);
    const printable = labels.records.filter(({ record }) => record.barcode || record.qr);
    if (!printable.length) return NextResponse.json({ error: "El producto no tiene identificadores activos para imprimir." }, { status: 409 });
    if (options.format !== "pdf" && printable.length !== 1) {
      return NextResponse.json({ error: "Usá PDF para imprimir varias variantes juntas." }, { status: 400 });
    }
    const svgs = await Promise.all(printable.map(({ record }) => renderCommerceLabelSvg(record, options)));
    const printRequested = request.nextUrl.searchParams.get("print") === "true";
    const eventType = printRequested
      ? "printed"
      : options.format === "png" ? "downloaded_png" : options.format === "pdf" ? "downloaded_pdf" : "downloaded_svg";
    await recordCommerceLabelEvents({
      admin,
      identifierIds: printable.flatMap(({ identifiers }) => identifiers.map((identifier) => identifier.id)),
      studioId: spot.studio_id,
      spotId: spot.id,
      actorId: user.id,
      eventType,
      metadata: { batch: true, format: options.format, layout: options.layout, page: options.page, size: options.size, copies: options.copies },
    });

    const filename = `el-iglu-${labels.listing.id}-etiquetas.${options.format}`;
    const headers = {
      "content-disposition": `${printRequested ? "inline" : "attachment"}; filename="${filename}"`,
      "cache-control": "private, no-store",
    };
    if (options.format === "pdf") {
      const pdf = await renderCommerceLabelsPdf(svgs, options);
      return new NextResponse(new Uint8Array(pdf), { headers: { ...headers, "content-type": "application/pdf" } });
    }
    if (options.format === "png") {
      const png = await renderCommerceLabelPng(svgs[0]);
      return new NextResponse(new Uint8Array(png), { headers: { ...headers, "content-type": "image/png" } });
    }
    return new NextResponse(svgs[0], { headers: { ...headers, "content-type": "image/svg+xml; charset=utf-8" } });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudieron generar las etiquetas." }, { status });
  }
}
