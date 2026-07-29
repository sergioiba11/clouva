import { CheckoutStatus } from "@/components/billing/CheckoutStatus";

export const metadata = { title: "CLOUVA VIP pendiente", robots: { index: false, follow: false } };

export default function VipPendingPage() {
  return <CheckoutStatus tone="pending" title="La verificación sigue pendiente" message="Mercado Pago todavía no confirmó el cobro. CLOUVA mantendrá la operación pendiente y actualizará la membresía cuando llegue el Webhook verificado." />;
}
