export type BillingEnvironment = "test" | "production";
export type BillingProviderName = "mercadopago";

export type InternalSubscriptionStatus =
  | "created"
  | "pending"
  | "authorized"
  | "active"
  | "past_due"
  | "paused"
  | "cancelled"
  | "expired"
  | "error";

export type CreatePlanInput = {
  reason: string;
  amount: number;
  currency: string;
  interval: "month" | "year";
  intervalCount: number;
  backUrl: string;
  externalReference: string;
};

export type CreateSubscriptionInput = {
  planId: string;
  payerEmail: string;
  externalReference: string;
  backUrl: string;
};

export interface BillingProvider {
  createPlan(input: CreatePlanInput): Promise<Record<string, unknown>>;
  getPlan(id: string): Promise<Record<string, unknown>>;
  createSubscription(input: CreateSubscriptionInput): Promise<Record<string, unknown>>;
  getSubscription(id: string): Promise<Record<string, unknown>>;
  cancelSubscription(id: string): Promise<Record<string, unknown>>;
  getPayment(id: string): Promise<Record<string, unknown>>;
  getAuthorizedPayment(id: string): Promise<Record<string, unknown>>;
}
