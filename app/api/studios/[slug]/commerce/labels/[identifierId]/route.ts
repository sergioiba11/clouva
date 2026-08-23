import { NextRequest, NextResponse } from "next/server";
import bwipjs from "bwip-js/node";
import QRCode from "qrcode";
import { requireManagedSpot } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

function barcodeSymbology(type: string) {
  if (type === "ean_13") return "ean13";
  if (type === "ean_8") return "ean8";
  if (type === "upc_a") return "upca";
  if (type === "upc_e") return "upce";
  return "code128";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; identifierId: string }> },
) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId, identifierId } = await params;
    const admin = createAdminSupabase();
    const { spot } = await requireManagedSpot({ admin, userId: user.id, studioId });
    const { data: identifier, error } = await admin
      .from("commerce_product_identifiers")
      .select("id,catalog_product_id,catalog_variant_id,spot_id,identifier_type,value")
      .eq("id", identifierId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!identifier || (identifier.spot_id && identifier.spot_id !== spot.id)) {
      return NextResponse.json({ error: "Código inexistente." }, { status: 404 });
    }
    const { data: product } = await admin
      .from("commerce_catalog_products")
      .select("name,brand")
      .eq("id", identifier.catalog_product_id)
      .maybeSingle();
    const { data: variant } = identifier.catalog_variant_id
      ? await admin
          .from("commerce_catalog_variants")
          .select("title,size,color,presentation")
          .eq("id", identifier.catalog_variant_id)
          .maybeSingle()
      : { data: null };
    const label = [product?.name, variant?.color, variant?.size, variant?.presentation].filter(Boolean).join(" · ");
    const asQr = identifier.identifier_type === "clouva_qr";
    const codeSvg = asQr
      ? await QRCode.toString(identifier.value, { type: "svg", margin: 0, width: 300, errorCorrectionLevel: "M" })
      : bwipjs.toSVG({
          bcid: barcodeSymbology(identifier.identifier_type),
          text: identifier.value,
          scale: 3,
          height: 14,
          includetext: true,
          textxalign: "center",
          backgroundcolor: "FFFFFF",
        });
    const embedded = codeSvg.replace(/<\?xml[^>]*>/g, "").replace(/<!DOCTYPE[^>]*>/g, "");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="360" viewBox="0 0 520 360">
      <rect width="520" height="360" rx="20" fill="#fff"/>
      <text x="28" y="42" fill="#111" font-family="Arial,sans-serif" font-size="16" font-weight="700">EL IGLÚ · CLOUVA</text>
      <text x="28" y="70" fill="#222" font-family="Arial,sans-serif" font-size="18">${escapeXml(label || "Producto")}</text>
      <g transform="translate(${asQr ? 110 : 25} 92) scale(${asQr ? 1 : 0.9})">${embedded}</g>
    </svg>`;
    return new NextResponse(svg, {
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        "content-disposition": `inline; filename="el-iglu-${identifier.identifier_type}-${identifier.id}.svg"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo generar la etiqueta." }, { status });
  }
}

function escapeXml(value: string) {
  return value.replace(/[<>&"']/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
    "'": "&apos;",
  })[character] ?? character);
}
