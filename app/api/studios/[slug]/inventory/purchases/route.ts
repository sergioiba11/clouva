import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isAuthError, requireUser, createAdminSupabase } from "@/lib/server/supabase";
import { requireSpaceInventoryAccess, resolveSpaceForStudio } from "@/lib/server/space-inventory";
import { recordSpaceInventoryPurchase, type SpacePurchasePaymentMethod } from "@/lib/server/space-inventory-purchase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAYMENT_METHODS = new Set<SpacePurchasePaymentMethod>(["qr", "cash", "transfer", "debit_card", "credit_card", "other"]);

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function apiStatus(error: unknown) {
  return (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
}

function metadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function validDate(value: unknown) {
  const raw = text(value, 80);
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId } = await params;
    const admin = createAdminSupabase();
    const space = await resolveSpaceForStudio({ admin, studioId });
    await requireSpaceInventoryAccess({ admin, userId: user.id, spaceId: space.id, capability: "view" });

    const { data, error } = await admin
      .from("space_inventory_purchases")
      .select("*")
      .eq("space_id", space.id)
      .order("paid_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);

    return NextResponse.json({ space, purchases: data ?? [] });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudieron cargar los comprobantes de compra." },
      { status: apiStatus(error) },
    );
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId } = await params;
    const admin = createAdminSupabase();
    const space = await resolveSpaceForStudio({ admin, studioId });
    const access = await requireSpaceInventoryAccess({ admin, userId: user.id, spaceId: space.id, capability: "inventory" });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const merchantName = text(body.merchantName, 240);
    const merchantLocation = text(body.merchantLocation, 500);
    const externalReference = text(body.externalReference, 300);
    const paymentMethod = text(body.paymentMethod, 30).toLowerCase() as SpacePurchasePaymentMethod;
    const paymentProvider = text(body.paymentProvider, 120);
    const providerPaymentId = text(body.providerPaymentId, 300);
    const currency = (text(body.currency, 3) || "ARS").toUpperCase();
    const amount = Number(body.amount);
    const sourceReceiptUrl = text(body.sourceReceiptUrl, 1200);

    if (!merchantName) return NextResponse.json({ error: "El comercio es obligatorio." }, { status: 400 });
    if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "El importe es inválido." }, { status: 400 });
    if (!PAYMENT_METHODS.has(paymentMethod)) return NextResponse.json({ error: "El método de pago es inválido." }, { status: 400 });
    if (currency.length !== 3) return NextResponse.json({ error: "La moneda es inválida." }, { status: 400 });

    const requestedKey = text(request.headers.get("idempotency-key"), 300) || text(body.idempotencyKey, 300);
    const derivedKey = providerPaymentId && paymentProvider
      ? `space-purchase:${space.id}:${paymentProvider}:${providerPaymentId}`
      : externalReference
        ? `space-purchase:${space.id}:${merchantName.toLowerCase()}:${externalReference}:${amount}:${currency}`
        : `space-purchase:${space.id}:manual:${randomUUID()}`;

    const purchaseRequestIds = Array.isArray(body.purchaseRequestIds)
      ? body.purchaseRequestIds.map((value) => text(value, 80)).filter(Boolean).slice(0, 500)
      : [];

    const result = await recordSpaceInventoryPurchase({
      admin,
      spaceId: space.id,
      merchantName,
      merchantLocation: merchantLocation || null,
      externalReference: externalReference || null,
      paymentMethod,
      paymentProvider: paymentProvider || null,
      providerPaymentId: providerPaymentId || null,
      amount,
      currency,
      status: "confirmed",
      paidAt: validDate(body.paidAt),
      sourceReceiptUrl: sourceReceiptUrl || null,
      recipientEmail: user.email ?? null,
      createdByUserId: user.id,
      createdByPlayerId: access.playerId,
      metadata: metadata(body.metadata),
      idempotencyKey: requestedKey || derivedKey,
      purchaseRequestIds,
    });

    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo registrar el comprobante de compra." },
      { status: apiStatus(error) },
    );
  }
}
