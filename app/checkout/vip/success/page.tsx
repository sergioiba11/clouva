import { CheckoutStatus } from "@/components/billing/CheckoutStatus";

export const metadata = { title: "CLOUVA VIP activo", robots: { index: false, follow: false } };

export default function VipSuccessPage() {
  return <CheckoutStatus tone="success" title="CLOUVA VIP está activo" message="El pago fue confirmado por Mercado Pago y los beneficios se activaron desde el servidor." />;
}
