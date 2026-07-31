import { NextRequest, NextResponse } from "next/server";
import { Storage } from "@google-cloud/storage";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let storage: Storage | null = null;
function getStorage() {
  if (!storage) storage = new Storage();
  return storage;
}

// NOTE: a signed URL only means real access control if the underlying
// object lives in a PRIVATE bucket. The existing clouva-generated-media
// bucket (lib/gcs-media.ts) is public-read by design (AI-generated site
// media), so pointing a sold digital product at it would make this signature
// cosmetic -- the same object is already fetchable unsigned. Selling real
// digital goods needs its own private bucket, not provisioned here (an
// infra change, left for a separate explicit step).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { id: productId } = await params;
    const admin = createAdminSupabase();

    const { data: purchase, error: purchaseError } = await admin
      .from("commerce_inventory")
      .select("id")
      .eq("user_id", user.id)
      .eq("product_id", productId)
      .limit(1)
      .maybeSingle();
    if (purchaseError) throw new Error(purchaseError.message);
    if (!purchase) return NextResponse.json({ error: "No compraste este producto." }, { status: 403 });

    const { data: product, error: productError } = await admin
      .from("commerce_products")
      .select("digital_asset_url")
      .eq("id", productId)
      .maybeSingle();
    if (productError) throw new Error(productError.message);
    if (!product?.digital_asset_url) return NextResponse.json({ error: "Este producto no tiene un archivo digital." }, { status: 404 });

    const parsed = new URL(product.digital_asset_url);
    const [, bucketName, ...objectParts] = parsed.pathname.split("/");
    const objectPath = objectParts.join("/");
    if (!bucketName || !objectPath) throw new Error("La ruta del archivo digital no es válida.");

    const [signedUrl] = await getStorage().bucket(bucketName).file(objectPath).getSignedUrl({
      action: "read",
      expires: Date.now() + 15 * 60 * 1000,
    });

    return NextResponse.json({ url: signedUrl, expiresInSeconds: 900 });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo generar el link de descarga.";
    return NextResponse.json({ error: message }, { status });
  }
}
