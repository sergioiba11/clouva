import Link from "next/link";
import { ArrowLeft, Cloud, Music2, Radio, Youtube } from "lucide-react";
import { SpotifyConnectionCard } from "@/components/music/SpotifyConnectionCard";

const upcoming = [
  { name: "Apple Music", icon: Music2, description: "Biblioteca y catálogo de Apple Music." },
  { name: "YouTube Music", icon: Youtube, description: "Música y actividad vinculada a YouTube." },
  { name: "SoundCloud", icon: Cloud, description: "Catálogo independiente y perfiles SoundCloud." },
];

export default function ConnectionsPage() {
  return (
    <main className="min-h-screen bg-[#05050a] px-4 py-8 text-white sm:px-6">
      <div className="mx-auto max-w-4xl">
        <Link href="/perfil" className="inline-flex items-center gap-2 text-xs text-white/45 transition hover:text-white"><ArrowLeft size={15} /> Volver</Link>
        <div className="mt-8 max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-violet-300/70">CLOUVA Connections</p>
          <h1 className="mt-2 text-3xl font-black tracking-[-0.04em] sm:text-5xl">Tus servicios, dentro de CLOUVA.</h1>
          <p className="mt-3 text-sm leading-6 text-white/50">Conectá tus cuentas una sola vez. CLOUVA usa cada permiso solamente para las acciones que vos iniciás.</p>
        </div>

        <div className="mt-8 grid gap-4">
          <SpotifyConnectionCard />
          {upcoming.map(({ name, icon: Icon, description }) => (
            <section key={name} className="rounded-[1.6rem] border border-white/[0.07] bg-white/[0.02] p-5 opacity-70 sm:p-6">
              <div className="flex items-center gap-4">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/[0.05] text-white/45"><Icon size={21} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><h2 className="font-bold">{name}</h2><span className="rounded-full border border-white/10 px-2 py-1 text-[10px] text-white/35">Próximamente</span></div>
                  <p className="mt-1 text-sm text-white/40">{description}</p>
                </div>
                <Radio size={17} className="text-white/20" />
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
