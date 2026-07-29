import type { BillingEnvironment } from "../../contracts";

export type MercadoPagoConfig = {
  environment: BillingEnvironment;
  accessToken: string;
  publicKey: string;
  webhookSecret: string;
  applicationId: string;
  userId: string;
  apiBaseUrl: string;
};

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} no está configurada.`);
  return value;
}

export function getBillingEnvironment(): BillingEnvironment {
  return process.env.MERCADOPAGO_ENVIRONMENT === "production" ? "production" : "test";
}

export function getMercadoPagoConfig(environment = getBillingEnvironment()): MercadoPagoConfig {
  const production = environment === "production";
  return {
    environment,
    accessToken: required(production ? "MERCADOPAGO_PROD_ACCESS_TOKEN" : "MERCADOPAGO_TEST_ACCESS_TOKEN"),
    publicKey: required(production ? "MERCADOPAGO_PROD_PUBLIC_KEY" : "MERCADOPAGO_TEST_PUBLIC_KEY"),
    webhookSecret: required(production ? "MERCADOPAGO_PROD_WEBHOOK_SECRET" : "MERCADOPAGO_TEST_WEBHOOK_SECRET"),
    applicationId: required("MERCADOPAGO_APPLICATION_ID"),
    userId: required("MERCADOPAGO_USER_ID"),
    apiBaseUrl: process.env.MERCADOPAGO_API_BASE_URL?.trim() || "https://api.mercadopago.com",
  };
}

export function isBillingEnabled() {
  return process.env.CLOUVA_BILLING_ENABLED === "true";
}
