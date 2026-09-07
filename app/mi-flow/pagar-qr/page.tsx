import Link from "next/link";
import { UniversalQrPayment } from "@/components/flows/UniversalQrPayment";

export default function MiFlowPagarQrPage() {
  return (
    <main className="min-h-screen bg-[#050509] px-4 py-6 text-white sm:px-6">
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <Link
          href="/mi-flow/billetera"
          className="inline-flex min-h-10 items-center rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-sm font-semibold text-white/70 transition hover:border-violet-300/20 hover:text-white"
        >
          ← Volver a Mi Flow
        </Link>
        <UniversalQrPayment />
      </div>
    </main>
  );
}
