import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendSpacePurchaseReceiptEmail } from "@/lib/server/space-purchase-receipt-email";

export type SpacePurchasePaymentMethod = "qr" | "cash" | "transfer" | "debit_card" | "credit_card" | "other";

export type RecordSpaceInventoryPurchaseArgs = {
  admin: SupabaseClient;
  spaceId: string;
  merchantName: string;
  merchantLocation?: string | null;
  externalReference?: string | null;
  paymentMethod: SpacePurchasePaymentMethod;
  paymentProvider?: string | null;
  providerPaymentId?: string | null;
  amount: number;
  currency?: string;
  status?: "pending" | "confirmed" | "cancelled" | "refunded";
  paidAt?: string;
  sourceReceiptUrl?: string | null;
  recipientEmail?: string | null;
  createdByUserId?: string | null;
  createdByPlayerId?: string | null;
  metadata?: Record<string, unknown>;
  idempotencyKey: string;
  purchaseRequestIds?: string[];
};

const clean = (value: string | null | undefined, max = 500) => (value ?? "").trim().slice(0, max);

function receiptNumber() {
  return `CLV-C-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
}

async function findExistingPurchase(args: RecordSpaceInventoryPurchaseArgs) {
  const byKey = await args.admin
    .from("space_inventory_purchases")
    .select("*")
    .eq("idempotency_key", args.idempotencyKey)
    .maybeSingle();
  if (byKey.data) return byKey.data;

  if (args.paymentProvider && args.providerPaymentId) {
    const byProvider = await args.admin
      .from("space_inventory_purchases")
      .select("*")
      .eq("payment_provider", args.paymentProvider)
      .eq("provider_payment_id", args.providerPaymentId)
      .maybeSingle();
    if (byProvider.data) return byProvider.data;
  }
  return null;
}

async function deliverReceipt(admin: SupabaseClient, purchase: Record<string, any>) {
  if (purchase.status !== "confirmed" || purchase.email_status === "sent") return purchase;

  const email = await sendSpacePurchaseReceiptEmail({ admin, purchaseId: purchase.id });
  const now = new Date().toISOString();
  const patch =
    email.status === "sent"
      ? {
          email_status: "sent",
          email_provider_id: email.providerMessageId ?? null,
          email_sent_at: now,
          email_last_error: null,
          updated_at: now,
        }
      : email.status === "skipped"
        ? {
            email_status: "skipped",
            email_last_error: email.reason ?? null,
            updated_at: now,
          }
        : {
            email_status: "failed",
            email_last_error: email.reason ?? "EMAIL_SEND_FAILED",
            updated_at: now,
          };

  const { data: updated, error } = await admin
    .from("space_inventory_purchases")
    .update(patch)
    .eq("id", purchase.id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return updated;
}

export async function recordSpaceInventoryPurchase(args: RecordSpaceInventoryPurchaseArgs) {
  const merchantName = clean(args.merchantName, 240);
  const currency = clean(args.currency || "ARS", 3).toUpperCase();
  const idempotencyKey = clean(args.idempotencyKey, 300);
  if (!merchantName) throw new Error("MERCHANT_NAME_REQUIRED");
  if (!Number.isFinite(args.amount) || args.amount <= 0) throw new Error("PURCHASE_AMOUNT_INVALID");
  if (currency.length !== 3) throw new Error("PURCHASE_CURRENCY_INVALID");
  if (!idempotencyKey) throw new Error("PURCHASE_IDEMPOTENCY_KEY_REQUIRED");

  const existing = await findExistingPurchase(args);
  if (existing) return { purchase: await deliverReceipt(args.admin, existing), created: false };

  const now = new Date().toISOString();
  const { data, error } = await args.admin
    .from("space_inventory_purchases")
    .insert({
      space_id: args.spaceId,
      merchant_name: merchantName,
      merchant_location: clean(args.merchantLocation, 500) || null,
      external_reference: clean(args.externalReference, 300) || null,
      payment_method: args.paymentMethod,
      payment_provider: clean(args.paymentProvider, 120) || null,
      provider_payment_id: clean(args.providerPaymentId, 300) || null,
      amount: args.amount,
      currency,
      status: args.status || "confirmed",
      paid_at: args.paidAt || now,
      receipt_number: receiptNumber(),
      source_receipt_url: clean(args.sourceReceiptUrl, 1200) || null,
      fiscal_document: false,
      recipient_email: clean(args.recipientEmail, 320) || null,
      email_status: "pending",
      created_by_user_id: args.createdByUserId || null,
      created_by_player_id: args.createdByPlayerId || null,
      metadata: args.metadata || {},
      idempotency_key: idempotencyKey,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      const duplicate = await findExistingPurchase(args);
      if (duplicate) return { purchase: await deliverReceipt(args.admin, duplicate), created: false };
    }
    throw new Error(error.message);
  }

  if (args.purchaseRequestIds?.length) {
    const ids = Array.from(new Set(args.purchaseRequestIds.filter(Boolean)));
    if (ids.length) {
      const linked = await args.admin
        .from("space_inventory_purchase_requests")
        .update({ purchase_id: data.id, updated_at: now })
        .eq("space_id", args.spaceId)
        .in("id", ids);
      if (linked.error) throw new Error(linked.error.message);
    }
  }

  return { purchase: await deliverReceipt(args.admin, data), created: true };
}
