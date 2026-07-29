import type {
  BillingProvider,
  CreatePlanInput,
  CreateSubscriptionInput,
} from "../../contracts";
import { getMercadoPagoConfig, type MercadoPagoConfig } from "./config";

async function parseResponse(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown> & {
    message?: string;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.message || payload.error || `Mercado Pago respondió HTTP ${response.status}.`);
  }
  return payload;
}

export class MercadoPagoProvider implements BillingProvider {
  constructor(private readonly config: MercadoPagoConfig = getMercadoPagoConfig()) {}

  private async request(path: string, init?: RequestInit) {
    const response = await fetch(`${this.config.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.config.accessToken}`,
        "content-type": "application/json",
        ...(init?.headers || {}),
      },
      cache: "no-store",
    });
    return parseResponse(response);
  }

  createPlan(input: CreatePlanInput) {
    const frequency = input.interval === "year" ? input.intervalCount * 12 : input.intervalCount;
    return this.request("/preapproval_plan", {
      method: "POST",
      body: JSON.stringify({
        reason: input.reason,
        auto_recurring: {
          frequency,
          frequency_type: "months",
          transaction_amount: input.amount,
          currency_id: input.currency,
        },
        back_url: input.backUrl,
        external_reference: input.externalReference,
        status: "active",
      }),
    });
  }

  getPlan(id: string) {
    return this.request(`/preapproval_plan/${encodeURIComponent(id)}`);
  }

  createSubscription(input: CreateSubscriptionInput) {
    return this.request("/preapproval", {
      method: "POST",
      body: JSON.stringify({
        preapproval_plan_id: input.planId,
        payer_email: input.payerEmail,
        external_reference: input.externalReference,
        back_url: input.backUrl,
        status: "pending",
      }),
    });
  }

  getSubscription(id: string) {
    return this.request(`/preapproval/${encodeURIComponent(id)}`);
  }

  cancelSubscription(id: string) {
    return this.request(`/preapproval/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({ status: "cancelled" }),
    });
  }

  getPayment(id: string) {
    return this.request(`/v1/payments/${encodeURIComponent(id)}`);
  }

  getAuthorizedPayment(id: string) {
    return this.request(`/authorized_payments/${encodeURIComponent(id)}`);
  }
}
