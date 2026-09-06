export type FlowPaymentDirection = "payin" | "payout";
export type FlowProviderStatus = "pending" | "confirmed" | "failed" | "cancelled" | "refunded" | "unknown";

export type FlowRailCapabilities = {
  provider: string;
  direction: FlowPaymentDirection;
  countries: string[];
  currencies: string[];
  paymentMethods: string[];
};

export type FlowPayInQuote = {
  country: string;
  currency: string;
  amount: number;
  referenceUsd: number;
  fxRate: number;
  fxPair: string;
  fxSource: string;
  quotedAt: string;
  expiresAt?: string | null;
  providerFee?: number;
};

export type FlowCreatePaymentInput = {
  operationId: string;
  externalReference: string;
  amount: number;
  currency: string;
  country: string;
  description: string;
  notificationUrl: string;
  callbackUrl: string;
  payer?: {
    name?: string | null;
    email?: string | null;
    document?: string | null;
  };
  paymentMethod?: string | null;
};

export type FlowProviderPayment = {
  provider: string;
  providerPaymentId: string;
  status: FlowProviderStatus;
  amount: number;
  currency: string;
  redirectUrl?: string | null;
  rawStatus?: string | null;
};

export interface FlowPayInProvider {
  readonly name: string;
  capabilities(): FlowRailCapabilities;
  createPayment(input: FlowCreatePaymentInput): Promise<FlowProviderPayment>;
  getPayment(id: string): Promise<FlowProviderPayment>;
  normalizeStatus(status: string): FlowProviderStatus;
}

export type FlowPayoutDestinationData = {
  firstName: string;
  lastName: string;
  documentType: string;
  documentId: string;
  bankAccount: string;
  bankAccountType?: string | null;
  bankCode?: string | null;
};

export type FlowCreatePayoutInput = {
  redemptionId: string;
  externalId: string;
  country: string;
  currency: string;
  amount: number;
  notificationUrl: string;
  destination: FlowPayoutDestinationData;
  purpose?: string;
  flowType?: "B2C" | "B2B" | "P2P";
  remitter?: Record<string, unknown> | null;
};

export type FlowProviderPayout = {
  provider: string;
  providerPayoutId: string;
  status: FlowProviderStatus;
  amount: number;
  currency: string;
  rawStatus?: string | null;
};

export interface FlowPayoutProvider {
  readonly name: string;
  capabilities(): FlowRailCapabilities;
  validateDestination(country: string, destination: FlowPayoutDestinationData): void;
  createPayout(input: FlowCreatePayoutInput): Promise<FlowProviderPayout>;
  getPayout(id: string): Promise<FlowProviderPayout>;
  normalizeStatus(status: string): FlowProviderStatus;
}
