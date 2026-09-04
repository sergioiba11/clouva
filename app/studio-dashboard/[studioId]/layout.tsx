import Link from "next/link";
import { BarChart3, Boxes, Settings2, Store } from "lucide-react";

export default async function StudioDashboardLayout({ children, params }: { children: React.ReactNode; params: Promise<{ studioId: string }> }) {
  const { studioId } = await params;
  const root = `/studio-dashboard/${encodeURIComponent(studioId)}/inventario`;
  return <>
    {children}
    <div className="fixed bottom-20 right-4 z-40 flex items-center gap-2 sm:bottom-6 sm:right-6">
      <Link
        href={`${root}/reportes`}
        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#100b18]/95 px-3 py-3 text-sm font-semibold text-white/60 shadow-[0_18px_50px_rgba(0,0,0,.3)] backdrop-blur-xl transition hover:border-violet-300/30 hover:text-white"
        aria-label="Abrir reportes del inventario"
      >
        <BarChart3 size={17} />
        <span className="hidden xl:inline">Reportes</span>
      </Link>
      <Link
        href={`${root}/configuracion`}
        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#100b18]/95 px-3 py-3 text-sm font-semibold text-white/60 shadow-[0_18px_50px_rgba(0,0,0,.3)] backdrop-blur-xl transition hover:border-violet-300/30 hover:text-white"
        aria-label="Configurar inventario del Studio"
      >
        <Settings2 size={17} />
        <span className="hidden lg:inline">Configurar</span>
      </Link>
      <Link
        href={`${root}/pizarron`}
        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#100b18]/95 px-3 py-3 text-sm font-semibold text-white/70 shadow-[0_18px_50px_rgba(0,0,0,.35)] backdrop-blur-xl transition hover:border-violet-300/30 hover:text-white"
        aria-label="Abrir Pizarrón del Studio"
      >
        <Store size={17} />
        <span className="hidden sm:inline">Pizarrón</span>
      </Link>
      <Link
        href={root}
        className="inline-flex items-center gap-2 rounded-full border border-violet-300/20 bg-[#100b18]/95 px-4 py-3 text-sm font-semibold text-violet-100 shadow-[0_18px_50px_rgba(0,0,0,.42)] backdrop-blur-xl transition hover:border-violet-300/40"
        aria-label="Abrir inventario del Studio"
      >
        <Boxes size={17} />
        <span>Inventario</span>
      </Link>
    </div>
  </>;
}
