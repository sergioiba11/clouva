import Link from "next/link";
import { CalendarClock, CalendarDays, Link2, MoonStar, Settings2 } from "lucide-react";
import "./agenda.css";

export default function AgendaLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <nav className="fixed bottom-3 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-white/10 bg-[#101017]/90 p-1.5 shadow-2xl backdrop-blur-xl md:bottom-auto md:left-auto md:right-5 md:top-5 md:translate-x-0">
        <Link href="/agenda" className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-white/65 transition hover:bg-white/[0.07] hover:text-white"><CalendarDays size={14} /><span className="hidden sm:inline">Agenda</span></Link>
        <Link href="/agenda#luna" className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-white/65 transition hover:bg-white/[0.07] hover:text-white"><MoonStar size={14} /><span className="hidden sm:inline">Luna</span></Link>
        <Link href="/agenda/disponibilidad" className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-white/65 transition hover:bg-white/[0.07] hover:text-white"><CalendarClock size={14} /><span className="hidden sm:inline">Disponibilidad</span></Link>
        <Link href="/agenda/conexiones" className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-white/65 transition hover:bg-white/[0.07] hover:text-white"><Link2 size={14} /><span className="hidden sm:inline">Conexiones</span></Link>
        <Link href="/agenda/configuracion" className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-white/65 transition hover:bg-white/[0.07] hover:text-white"><Settings2 size={14} /><span className="hidden sm:inline">Configurar</span></Link>
      </nav>
    </>
  );
}
