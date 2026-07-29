import { CheckoutStatus } from "@/components/billing/CheckoutStatus";

export const metadata = { title: "No se activó CLOUVA VIP", robots: { index: false, follow: false } };

export default function VipFailurePage() {
  return <CheckoutStatus tone="failure" title="CLOUVA VIP no fue activado" message="La suscripción fue rechazada, cancelada o no pudo verificarse. No se modificó ningún beneficio de tu cuenta." />;
}
