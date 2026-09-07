import { Storage } from "@google-cloud/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET_NAME =
  process.env.CLOUVA_ADMIN_ASSETS_BUCKET ??
  process.env.CLOUVA_GENERATED_MEDIA_BUCKET ??
  "clouva-generated-media";
const FLOW_LOGO_PATH = "admin-assets/brand/01_flows_sudamerica.png";

let storage: Storage | null = null;

function getStorage() {
  if (!storage) storage = new Storage();
  return storage;
}

export async function GET() {
  const file = getStorage().bucket(BUCKET_NAME).file(FLOW_LOGO_PATH);

  try {
    const [[metadata], [buffer]] = await Promise.all([file.getMetadata(), file.download()]);

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": metadata.contentType || "image/png",
        "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
        "Content-Length": String(buffer.byteLength),
        "X-Clouva-Asset": FLOW_LOGO_PATH,
      },
    });
  } catch (error) {
    console.error("[flow-brand] official FLOW logo could not be read", error);
    return Response.json(
      { error: "El logo oficial de FLOW no está disponible." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
}
