import type { InternalSubscriptionStatus } from "../../contracts";

export function mapMercadoPagoSubscriptionStatus(value: unknown): InternalSubscriptionStatus {
  const status = String(value || "").toLowerCase();
  if (status === "authorized") return "authorized";
  if (status === "paused") return "paused";
  if (status === "cancelled") return "cancelled";
  if (status === "pending") return "pending";
  return status ? "error" : "pending";
}

export function isApprovedPayment(value: unknown) {
  return String(value || "").toLowerCase() === "approved";
}
