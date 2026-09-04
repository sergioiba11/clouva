import Link from "next/link";
import { Boxes } from "lucide-react";

export default async function StudioDashboardLayout({ children, params }: { children: React.ReactNode; params: Promise<{ studioId: string }> }) {
  const { studioId } = await params;
  return <>
    {children}
    <Link
      href={`/studio-dashboard/${encodeURIComponent(studioId)}/inventario`}
      className="fixed bottom-20 right-4 z-40 inline-flex items-center gap-2 rounded-full border border-violet-300/20 bg-[#100b18]/95 px-4 py-3 text-sm font-semibold text-violet-100 shadow-[0_18px_50px_rgba(0,0,0,.42)] backdrop-blur-xl transition hover:border-violet-300/40 sm:bottom-6 sm:right-6"
      aria-label="Abrir inventario del Studio"
    >
      <Boxes size={17} />
      <span>Inventario</span>
    </Link>
  </>;
}
