export type UniversalQrType =
  | "clouva"
  | "mercadopago"
  | "argentina_interoperable"
  | "merchant_emv"
  | "payment_link"
  | "bank_destination"
  | "sandbox_merchant"
  | "unknown";

export type UniversalQrCapability = "DETECTED" | "RESOLVABLE" | "PAYABLE" | "UNSUPPORTED" | "NOT_AUTHORIZED";

export type ParsedUniversalQr = {
  type: UniversalQrType;
  raw: string;
  country?: string | null;
  merchant?: {
    name?: string | null;
    city?: string | null;
    merchantId?: string | null;
    mcc?: string | null;
  } | null;
  amount?: string | null;
  currency?: string | null;
  transactionId?: string | null;
  providerHint?: string | null;
  dynamic?: boolean | null;
  valid: boolean;
  executable: boolean;
  errors: string[];
  emv?: Record<string, string> | null;
};

export type UniversalQrResolution = ParsedUniversalQr & {
  capability: UniversalQrCapability;
  provider?: string | null;
  administrator?: string | null;
  orderId?: string | null;
  paymentMethods?: string[];
  amountEditable: boolean;
  safeMessage?: string | null;
};

export type UniversalQrQuote = {
  operationId: string;
  merchantAmount: string;
  merchantCurrency: string;
  referenceUsd: string;
  flowUnits: string;
  flowAmount: string;
  providerFeeUnits: string;
  clouvaFeeUnits: string;
  totalFlowUnits: string;
  totalFlow: string;
  fxPair: string;
  fxRate: string;
  fxSource: string;
  quotedAt: string;
  expiresAt: string;
};

export type QrProviderPaymentStatus = "PENDING" | "CONFIRMED" | "FAILED" | "CANCELLED" | "EXPIRED" | "UNKNOWN";

export type QrProviderPayment = {
  provider: string;
  providerPaymentId: string;
  status: QrProviderPaymentStatus;
  merchantAmount: string;
  currency: string;
  rawStatus?: string | null;
  qrTransactionId?: string | null;
  metadata?: Record<string, unknown>;
};

export interface MerchantQrPaymentProvider {
  readonly name: string;
  readonly sandbox: boolean;
  resolveQr(raw: string): Promise<UniversalQrResolution>;
  createPayment(input: {
    operationId: string;
    idempotencyKey: string;
    rawQr: string;
    resolution: UniversalQrResolution;
    merchantAmount: string;
    currency: string;
  }): Promise<QrProviderPayment>;
  getPayment(providerPaymentId: string): Promise<QrProviderPayment>;
}
