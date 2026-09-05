import type { SupabaseClient } from "@supabase/supabase-js";

type PurchaseReceiptEmailStatus = "sent" | "skipped" | "failed";
export type PurchaseReceiptEmailResult = {
  status: PurchaseReceiptEmailStatus;
  reason?: string;
  providerMessageId?: string;
};

const clean = (value: string | null | undefined) => (value ?? "").trim();
const escapeHtml = (value: string | null | undefined) =>
  clean(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

function formatAmount(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency,
      currencyDisplay: "symbol",
      minimumFractionDigits: currency === "ARS" ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString("es-AR")}`;
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(value));
}

export async function sendSpacePurchaseReceiptEmail(args: {
  admin: SupabaseClient;
  purchaseId: string;
}): Promise<PurchaseReceiptEmailResult> {
  const { data: purchase, error } = await args.admin
    .from("space_inventory_purchases")
    .select("*")
    .eq("id", args.purchaseId)
    .maybeSingle();

  if (error || !purchase) return { status: "failed", reason: "PURCHASE_RECEIPT_CONTEXT_MISSING" };
  if (purchase.status !== "confirmed") return { status: "skipped", reason: "PURCHASE_NOT_CONFIRMED" };
  if (purchase.email_status === "sent") return { status: "skipped", reason: "PURCHASE_RECEIPT_ALREADY_SENT" };

  const [{ data: space }, { data: profile }, { data: player }] = await Promise.all([
    args.admin.from("spaces").select("name,slug").eq("id", purchase.space_id).maybeSingle(),
    purchase.created_by_user_id
      ? args.admin.from("profiles").select("email").eq("id", purchase.created_by_user_id).maybeSingle()
      : Promise.resolve({ data: null }),
    purchase.created_by_player_id
      ? args.admin.from("players").select("display_name,contact_email").eq("id", purchase.created_by_player_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const to = clean(purchase.recipient_email) || clean(profile?.email) || clean(player?.contact_email);
  if (!to) return { status: "skipped", reason: "RECIPIENT_EMAIL_MISSING" };

  const apiKey = clean(process.env.RESEND_API_KEY);
  if (!apiKey) return { status: "failed", reason: "EMAIL_PROVIDER_NOT_CONFIGURED" };

  const currency = clean(purchase.currency).toUpperCase() || "ARS";
  const amount = formatAmount(Number(purchase.amount), currency);
  const merchant = clean(purchase.merchant_name) || "Comercio";
  const location = clean(purchase.merchant_location);
  const where = location ? `${merchant} · ${location}` : merchant;
  const spaceName = clean(space?.name) || "CLOUVA";
  const paidAt = formatDate(purchase.paid_at);
  const reference = clean(purchase.external_reference);
  const provider = clean(purchase.payment_provider);
  const paymentLabel = purchase.payment_method === "qr" ? "QR" : clean(purchase.payment_method).toUpperCase();
  const sourceReceiptUrl = clean(purchase.source_receipt_url);

  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#05090d;color:#eefaff;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:28px 14px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:auto;background:#091118;border:1px solid #183442;border-radius:24px"><tr><td style="padding:28px"><div style="font-size:13px;font-weight:800;letter-spacing:.18em;color:#77ddff">CLOUVA</div><h1 style="font-size:25px;margin:10px 0 8px">Comprobante de compra</h1><div style="color:#8fa6b0;margin-bottom:26px">${escapeHtml(spaceName)}</div><div style="padding:20px;background:#071017;border:1px solid #153747;border-radius:18px;margin-bottom:18px"><div style="font-size:13px;color:#8fa6b0">Gastaste</div><div style="font-size:34px;font-weight:900;margin-top:5px">${escapeHtml(amount)}</div><div style="font-size:14px;color:#c8d8df;margin-top:15px">en <strong style="color:#fff">${escapeHtml(where)}</strong></div></div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:14px;line-height:1.6"><tr><td style="padding:7px 0;color:#8fa6b0">Fecha</td><td style="padding:7px 0;text-align:right">${escapeHtml(paidAt)}</td></tr><tr><td style="padding:7px 0;color:#8fa6b0">Pago</td><td style="padding:7px 0;text-align:right">${escapeHtml(paymentLabel)}${provider ? ` · ${escapeHtml(provider)}` : ""}</td></tr>${reference ? `<tr><td style="padding:7px 0;color:#8fa6b0">Referencia</td><td style="padding:7px 0;text-align:right">${escapeHtml(reference)}</td></tr>` : ""}<tr><td style="padding:7px 0;color:#8fa6b0">Comprobante CLOUVA</td><td style="padding:7px 0;text-align:right">${escapeHtml(purchase.receipt_number)}</td></tr></table>${sourceReceiptUrl ? `<a href="${escapeHtml(sourceReceiptUrl)}" style="display:block;margin-top:22px;padding:14px;text-align:center;background:#8ce7ff;color:#031016;text-decoration:none;border-radius:14px;font-weight:800">Ver comprobante del comercio</a>` : ""}<p style="font-size:12px;line-height:1.6;color:#718892;margin:26px 0 0">Este es un comprobante interno de CLOUVA para registrar el gasto del negocio. No reemplaza la factura o comprobante fiscal emitido por el comercio.</p></td></tr><tr><td style="border-top:1px solid #15303c;padding:20px 28px;color:#718892;font-size:12px"><b style="color:#8ce7ff">CLOUVA</b><br>Vida de flows.</td></tr></table></td></tr></table></body></html>`;

  const text = `CLOUVA — Comprobante de compra\n\n${spaceName}\nGastaste: ${amount}\nDónde: ${where}\nFecha: ${paidAt}\nPago: ${paymentLabel}${provider ? ` · ${provider}` : ""}${reference ? `\nReferencia: ${reference}` : ""}\nComprobante CLOUVA: ${purchase.receipt_number}${sourceReceiptUrl ? `\nComprobante del comercio: ${sourceReceiptUrl}` : ""}\n\nEste comprobante interno de CLOUVA no reemplaza la factura o comprobante fiscal del comercio.`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `space-purchase-receipt/${purchase.id}`,
    },
    body: JSON.stringify({
      from: clean(process.env.CLOUVA_EMAIL_FROM || "CLOUVA <admin@clouva.com.ar>"),
      to: [to],
      reply_to: "admin@clouva.com.ar",
      subject: `${spaceName}: gastaste ${amount} en ${merchant}`,
      html,
      text,
      tags: [{ name: "category", value: "space_purchase_receipt" }],
    }),
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as { id?: string } | null;
  if (!response.ok) return { status: "failed", reason: `EMAIL_PROVIDER_${response.status}` };
  return { status: "sent", providerMessageId: payload?.id };
}
