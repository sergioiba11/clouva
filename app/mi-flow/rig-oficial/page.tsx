import Link from "next/link";
import { OfficialAvatarRigCard } from "@/components/admin/OfficialAvatarRigCard";

export default function RigOficialPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-4 pb-24 pt-5 text-white">
      <div className="mb-5 flex items-center justify-between">
        <Link href="/mi-flow" className="text-sm text-white/60">← Volver</Link>
        <span className="text-[11px] uppercase tracking-[0.25em] text-white/40">Avatar Engine</span>
        <span className="w-12" />
      </div>

      <OfficialAvatarRigCard />
    </main>
  );
}
