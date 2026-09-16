import { Storage } from "@google-cloud/storage";
import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const storage = new Storage();
const DEFAULT_GCS_BUCKET = "clouva-generated-media";

type BrandLogoVersionRow = {
  id: string;
  status: string;
  primary_logo_url: string | null;
  white_svg_url: string | null;
  black_svg_url: string | null;
  white_logo_url: string | null;
  black_logo_url: string | null;
};

function clean(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function resolveSourceUrl(row: BrandLogoVersionRow, surface: "dark" | "light") {
  const whiteSvg = clean(row.white_svg_url);
  const blackSvg = clean(row.black_svg_url);
  const whiteLogo = clean(row.white_logo_url);
  const blackLogo = clean(row.black_logo_url);
  const primary = clean(row.primary_logo_url);

  return surface === "dark"
    ? whiteSvg ?? whiteLogo ?? primary ?? blackSvg ?? blackLogo
    : blackSvg ?? blackLogo ?? primary ?? whiteSvg ?? whiteLogo;
}

function parseAllowedGcsObject(sourceUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" || parsed.hostname !== "storage.googleapis.com") return null;

  const segments = parsed.pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
  const bucket = segments.shift() ?? "";
  const objectPath = segments.join("/");
  const allowedBuckets = new Set([
    process.env.CLOUVA_ADMIN_ASSETS_BUCKET,
    process.env.CLOUVA_GENERATED_MEDIA_BUCKET,
    DEFAULT_GCS_BUCKET,
  ].filter((value): value is string => Boolean(value)));

  if (!bucket || !objectPath || !allowedBuckets.has(bucket)) return null;
  return { bucket, objectPath };
}

function contentTypeFor(path: string, metadataType?: string | null) {
  if (metadataType) return metadataType;
  const lower = path.toLowerCase();
  if (lower.endsWith(".svg")) return "image/svg+xml; charset=utf-8";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  return "application/octet-stream";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ versionId: string }> },
) {
  try {
    const { versionId } = await params;
    const surface = request.nextUrl.searchParams.get("surface") === "light" ? "light" : "dark";
    const admin = createAdminSupabase();

    const { data, error } = await admin
      .from("brand_asset_versions")
      .select("id,status,primary_logo_url,white_svg_url,black_svg_url,white_logo_url,black_logo_url")
      .eq("id", versionId)
      .eq("status", "published")
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "La versión de marca publicada no existe." }, { status: 404 });

    const sourceUrl = resolveSourceUrl(data as BrandLogoVersionRow, surface);
    if (!sourceUrl) return NextResponse.json({ error: "Esta versión no tiene un logo disponible." }, { status: 404 });

    const gcsObject = parseAllowedGcsObject(sourceUrl);
    if (!gcsObject) {
      // Published non-GCS assets keep their existing delivery path. We never
      // proxy arbitrary user input: the redirect target comes from the
      // published Brand Asset row selected above.
      const parsed = new URL(sourceUrl);
      if (parsed.protocol !== "https:") return NextResponse.json({ error: "Origen de logo no permitido." }, { status: 400 });
      return NextResponse.redirect(parsed, 307);
    }

    const file = storage.bucket(gcsObject.bucket).file(gcsObject.objectPath);
    const [[bytes], [metadata]] = await Promise.all([file.download(), file.getMetadata()]);
    const contentType = contentTypeFor(gcsObject.objectPath, typeof metadata.contentType === "string" ? metadata.contentType : null);

    const headers = new Headers({
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
    });

    if (contentType.startsWith("image/svg+xml")) {
      // SVG is rendered as an image in CLOUVA. Keep the same-origin delivery
      // endpoint safe even if somebody opens the asset URL directly.
      headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    }

    return new NextResponse(new Uint8Array(bytes), { status: 200, headers });
  } catch (error) {
    console.error("[brand-logo-delivery] failed", error);
    return NextResponse.json({ error: "No se pudo cargar el logo oficial." }, { status: 500 });
  }
}
