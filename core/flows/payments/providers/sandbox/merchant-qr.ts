import "server-only";
import { randomUUID } from "node:crypto";
import { classifyParsedQr, parseUniversalQr } from "@/core/flows/qr/parse";
import type { MerchantQrPaymentProvider, QrProviderPayment, UniversalQrResolution } from "@/core/flows/qr/types";
import { universalQrSandboxEnabled } from "@/core/flows/qr/server";

const payments = new Map<string, QrProviderPayment>();

function assertSandbox() {
  if (!universalQrSandboxEnabled()) throw new Error("UNIVERSAL_QR_SANDBOX_DISABLED");
}

function mode() {
  const value = process.env.CLOUVA_UNIVERSAL_QR_SANDBOX_RESULT?.trim().toLowerCase();
  if (value === "confirmed" || value === "failed" || value === "pending" || value === "timeout") return value;
  return "pending";
}

export class UniversalQrSandboxProvider implements MerchantQrPaymentProvider {
  readonly name = "sandbox";
  readonly sandbox = true;

  async resolveQr(raw: string): Promise<UniversalQrResolution> {
    assertSandbox();
    const parsed = parseUniversalQr(raw);
    return classifyParsedQr(parsed, { sandboxEnabled: parsed.type === "sandbox_merchant" });
  }

  async createPayment(input: {
    operationId: string;
    idempotencyKey: string;
    rawQr: string;
    resolution: UniversalQrResolution;
    merchantAmount: string;
    currency: string;
  }): Promise<QrProviderPayment> {
    assertSandbox();
    const existing = payments.get(input.idempotencyKey);
    if (existing) return existing;
    const scenario = mode();
    if (scenario === "timeout") throw new Error("SANDBOX_NETWORK_TIMEOUT");
    const status = scenario === "confirmed" ? "CONFIRMED" : scenario === "failed" ? "FAILED" : "PENDING";
    const payment: QrProviderPayment = {
      provider: this.name,
      providerPaymentId: `sbx_${input.operationId}_${randomUUID().slice(0, 8)}`,
      status,
      merchantAmount: input.merchantAmount,
      currency: input.currency,
      rawStatus: scenario.toUpperCase(),
      qrTransactionId: input.resolution.transactionId || `sandbox:${input.operationId}`,
      metadata: { sandbox: true, operationId: input.operationId },
    };
    payments.set(input.idempotencyKey, payment);
    return payment;
  }

  async getPayment(providerPaymentId: string): Promise<QrProviderPayment> {
    assertSandbox();
    const payment = [...payments.values()].find((value) => value.providerPaymentId === providerPaymentId);
    if (!payment) throw new Error("SANDBOX_PAYMENT_NOT_FOUND");
    return payment;
  }
}
