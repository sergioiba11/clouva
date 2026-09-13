import { OfficialClouvaMark } from "@/components/clouva/OfficialClouvaMark";
import { ClouvaUniverseBackground } from "@/components/clouva/ClouvaUniverseBackground";

type ClouvaBootProps = {
  title?: string;
  subtitle?: string;
  showWorld?: boolean;
  prominentTitle?: boolean;
};

export function ClouvaBoot({
  title = "CLOUVA",
  subtitle = "Preparando tu universo...",
  showWorld = false,
  prominentTitle = false,
}: ClouvaBootProps) {
  return (
    <main
      aria-label={subtitle}
      className="relative grid min-h-[100dvh] place-items-center overflow-hidden bg-[#020106] px-6 text-white"
    >
      {showWorld ? <ClouvaUniverseBackground variant="access" /> : null}
      {!showWorld ? (
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(124,58,237,.13),transparent_30%),#020106]" />
      ) : null}

      <div className="relative z-10 flex flex-col items-center text-center">
        <div className="grid h-20 w-20 place-items-center rounded-full border border-violet-300/10 bg-black/20 shadow-[0_0_60px_rgba(139,92,246,.20)] backdrop-blur-sm">
          <OfficialClouvaMark
            tone="light"
            alt="CLOUVA"
            width={72}
            height={72}
            className="h-[72px] w-[72px] animate-[pulse_2.2s_ease-in-out_infinite] drop-shadow-[0_0_24px_rgba(180,110,255,.55)] motion-reduce:animate-none"
          />
        </div>
        {prominentTitle ? (
          <h1 className="mt-6 text-2xl font-semibold tracking-[-0.02em] text-white sm:text-3xl">{title}</h1>
        ) : (
          <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.42em] text-violet-200/85">{title}</p>
        )}
        <p className="mt-3 text-sm text-white/65">{subtitle}</p>
      </div>
    </main>
  );
}
