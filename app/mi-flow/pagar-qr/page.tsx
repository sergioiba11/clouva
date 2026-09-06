import { MainNav } from "@/components/layout";
import { UniversalQrPayment } from "@/components/flows/UniversalQrPayment";

export default function PagarQrPage() {
  return (
    <main className="min-h-screen bg-[#050409] text-white">
      <MainNav />
      <UniversalQrPayment />
    </main>
  );
}
