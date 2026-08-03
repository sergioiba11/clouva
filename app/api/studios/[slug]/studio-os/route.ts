import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { isBillingEnabled } from "@/core/billing/providers/mercadopago/config";
import { createSubscriptionForProduct } from "@/core/billing/service";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadOwnedStudio(admin: ReturnType<typeof createAdminSupabase>, slug: string, userId: string) {
  const { data: studio, error } = await admin
    .from("studios")
    .select("id,slug,name,owner_id,studio_os_status,studio_os_subscription_id,studio_os_activated_at,studio_os_expires_at")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!studio) {
    const missing = new Error("El Estudio no existe.");
    (missing as Error & { status?: number }).status = 404;
    throw missing;
  }

  const { data: profile, error: profileError } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (profileError) throw new Error(profileError.message);
  if (studio.owner_id !== userId && profile?.role !== "admin") {
    const forbidden = new Error("Solo el dueño puede contratar Studio OS para este Estudio.");
    (forbidden as Error & { status?: number }).status = 403;
    throw forbidden;
  }
  return studio;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug } = await params;
    const admin = createAdminSupabase();
    const studio = await loadOwnedStudio(admin, slug, user.id);
    const { data: subscription, error } = studio.studio_os_subscription_id
      ? await admin.from("billing_subscriptions").select("id,status,current_period_end,metadata").eq("id", studio.studio_os_subscription_id).maybeSingle()
      : { data: null, error: null };
    if (error) throw new Error(error.message);
    return NextResponse.json({ studio, subscription });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo cargar Studio OS." }, { status });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    if (!isBillingEnabled()) return NextResponse.json({ error: "Los pagos todavía no están habilitados." }, { status: 503 });
    const { user } = await requireUser(request);
    if (!user.email) return NextResponse.json({ error: "Tu cuenta necesita un correo válido para pagar." }, { status: 400 });
    const { slug } = await params;
    const admin = createAdminSupabase();
    const studio = await loadOwnedStudio(admin, slug, user.id);
    if (["active", "grace", "legacy_active"].includes(studio.studio_os_status)) {
      return NextResponse.json({ active: true, studioSlug: studio.slug });
    }

    const { data: product, error: productError } = await admin
      .from("billing_products")
      .select("id,is_active")
      .eq("code", "clouva_studio_os")
      .maybeSingle();
    if (productError) throw new Error(productError.message);
    if (!product?.is_active) {
      return NextResponse.json({ error: "Studio OS todavía no tiene un precio activo. No se inventó un importe: debe configurarlo un administrador." }, { status: 503 });
    }

    const appBase = process.env.APP_BASE_URL?.trim() || "https://clouva.com.ar";
    const result = await createSubscriptionForProduct({
      admin,
      userId: user.id,
      payerEmail: user.email,
      productId: product.id,
      studioId: studio.id,
      reason: `CLOUVA Studio OS — ${studio.name}`,
      backUrl: `${appBase}/studios/${studio.slug}/studio-os?status=pending`,
      idempotencyKey: request.headers.get("x-idempotency-key")?.trim() || randomUUID(),
    });
    return NextResponse.json(result);
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo iniciar Studio OS." }, { status });
  }
}
