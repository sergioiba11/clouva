import { MapPin } from "lucide-react";
import { PlayerLocationMap } from "./PlayerLocationMap";

export function PlayerPublicLocationCard({
  latitude,
  longitude,
  label,
  accent,
}: {
  latitude: number | null;
  longitude: number | null;
  label: string;
  accent?: string | null;
}) {
  return (
    <section className="relative aspect-square w-full max-w-[238px] overflow-hidden rounded-[22px] border border-white/12 bg-[#05070b] shadow-[0_18px_55px_rgba(0,0,0,.3)] sm:max-w-[250px]">
      <PlayerLocationMap
        latitude={latitude}
        longitude={longitude}
        label={label}
        accent={accent}
        compact
        className="absolute inset-0"
      />

      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(2,5,9,.66),transparent_26%,transparent_68%,rgba(2,5,9,.82))]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_52%,transparent_12%,rgba(2,5,9,.12)_58%,rgba(2,5,9,.44)_100%)]" />

      <div className="pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/48 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-white/68 backdrop-blur">
        <MapPin size={10} /> Ubicación del Player
      </div>

      <div className="pointer-events-none absolute bottom-7 left-3 right-3 rounded-xl border border-white/8 bg-black/42 px-3 py-2 backdrop-blur-sm">
        <p className="truncate text-[10px] font-semibold uppercase tracking-[0.13em] text-white/72">{label}</p>
        <p className="mt-1 text-[8px] uppercase tracking-[0.12em] text-white/30">Localidad pública elegida</p>
      </div>
    </section>
  );
}
