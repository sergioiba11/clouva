export type MerchantQrRailStatus =
  | "pending"
  | "confirmed"
  | "failed"
  | "refunded"
  | "partially_refunded"
  | "unknown";

export type MerchantQrCapability = {
  provider: string;
  country: "AR";
  currency: "ARS";
  methods: Array<"PCT">;
  qrStandard: "Transferencias 3.0";
  canResolve: boolean;
  canPay: boolean;
  canRefund: boolean;
  sandboxAvailable: boolean;
  productionEnabled: boolean;
};

export type MerchantQrCollector = {
  name: string;
  identificationNumber: string;
  account: string;
  mcc?: string | null;
  bank?: string | null;
  branchOffice?: string | null;
  terminal?: string | null;
};

export type MerchantQrResolution = {
  provider: string;
  status: "open_amount" | "closed_amount" | "pending" | "unsupported" | "unknown";
  administrator?: string | null;
  collector?: MerchantQrCollector | null;
  order?: {
    id: string;
    totalAmount: string | null;
    items?: Array<Record<string, unknown>>;
  } | null;
  retryDelaySeconds?: number | null;
  rawStatus?: string | null;
};

export type MerchantQrCreatePaymentInput = {
  operationId: string;
  rawQr: string;
  amount: string;
  currency: "ARS";
  resolution: MerchantQrResolution;
  description?: string | null;
};

export type MerchantQrPayment = {
  provider: string;
  providerOperationId: string;
  providerExternalId?: string | null;
  coelsaId?: string | null;
  status: MerchantQrRailStatus;
  rawStatus?: string | null;
  amount: string;
  currency: "ARS";
  merchantName?: string | null;
  merchantAccount?: string | null;
  merchantIdentificationNumber?: string | null;
  rejectionReason?: string | null;
};

export interface MerchantQrPaymentRail {
  readonly name: string;
  capabilities(): MerchantQrCapability;
  resolveQr(rawQr: string): Promise<MerchantQrResolution>;
  createMerchantPayment(input: MerchantQrCreatePaymentInput): Promise<MerchantQrPayment>;
  getMerchantPayment(providerOperationId: string): Promise<MerchantQrPayment>;
  getMerchantPaymentByExternalId(externalId: string): Promise<MerchantQrPayment>;
}
