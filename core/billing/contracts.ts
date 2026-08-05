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

// Mercado Pago requires card_token_id (client-side tokenized card) whenever
// a subscription references preapproval_plan_id -- there is no redirect/
// init_point flow for "subscriptions with an associated plan". Since CLOUVA
// has no card-tokenization UI, subscriptions are created via the "sin plan
// asociado" (no associated plan) + status "pending" flow instead: the plan
// details go inline here rather than referencing planId, which is what
// actually gets an init_point back to redirect the payer to.
export type CreateSubscriptionInput = {
  reason: string;
  amount: number;
  currency: string;
  interval: "month" | "year";
  intervalCount: number;
  payerEmail: string;
  externalReference: string;
  backUrl: string;
};

export type CreatePreferenceInput = {
  items: Array<{ title: string; quantity: number; unitPrice: number; currency: string }>;
  externalReference: string;
  backUrls: { success: string; failure: string; pending: string };
  notificationUrl: string;
  payer?: { email: string; name?: string; phone?: string };
};

export interface BillingProvider {
  createPlan(input: CreatePlanInput): Promise<Record<string, unknown>>;
  getPlan(id: string): Promise<Record<string, unknown>>;
  createSubscription(input: CreateSubscriptionInput): Promise<Record<string, unknown>>;
  getSubscription(id: string): Promise<Record<string, unknown>>;
  cancelSubscription(id: string): Promise<Record<string, unknown>>;
  getPayment(id: string): Promise<Record<string, unknown>>;
  getAuthorizedPayment(id: string): Promise<Record<string, unknown>>;
  createPreference(input: CreatePreferenceInput): Promise<Record<string, unknown>>;
}
