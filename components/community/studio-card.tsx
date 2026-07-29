import Link from "next/link";
import type { Studio } from "@/lib/community-data";

type StudioCardProps = {
  studio: Studio;
  memberCount: number;
  projectCount: number;
};

export function StudioCard({ studio, memberCount, projectCount }: StudioCardProps) {
  return (
    <Link
      href={`/studios/${studio.slug}`}
      className="panel group block overflow-hidden rounded-[2rem] transition hover:-translate-y-1"
    >
      <div className="relative aspect-[16/9] bg-white/[0.04]">
        {studio.cover_url ? (
          <img
            src={studio.cover_url}
            alt={studio.name}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-white/30">CLOUVA</div>
        )}
        {studio.logo_url ? (
          <img
            src={studio.logo_url}
            alt={`${studio.name} logo`}
            className="absolute bottom-3 left-3 h-14 w-14 rounded-2xl border border-white/20 bg-black/40 object-cover"
          />
        ) : null}
      </div>
      <div className="p-5">
        <h3 className="text-lg font-medium">{studio.name}</h3>
        {studio.city ? <p className="mt-1 text-xs uppercase tracking-[0.2em] text-white/45">{studio.city}</p> : null}
        <div className="mt-3 flex items-center gap-4 text-xs text-white/60">
          <span>{memberCount} integrantes</span>
          <span>{projectCount} proyectos</span>
        </div>
        <span className="mt-4 inline-block rounded-full bg-[#8f7cff] px-4 py-2 text-sm font-medium text-black">
          Entrar
        </span>
      </div>
    </Link>
  );
}
