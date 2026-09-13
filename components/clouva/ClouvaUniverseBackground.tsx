type ClouvaUniverseBackgroundProps = {
  variant?: "landing" | "access";
  entering?: boolean;
};

const DESKTOP_BACKGROUND = "/_next/image?url=%2Fassets%2Fclouva%2F1000222440.png&w=1920&q=80";

export function ClouvaUniverseBackground({
  variant = "landing",
  entering = false,
}: ClouvaUniverseBackgroundProps) {
  const access = variant === "access";

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden bg-black" aria-hidden="true">
      <picture
        className={`absolute inset-0 block h-full w-full select-none will-change-transform transition-[transform,filter,opacity] duration-500 ease-out motion-reduce:transition-none ${
          access
            ? "scale-[1.035] opacity-70 blur-[4px] brightness-[.62]"
            : entering
              ? "scale-[1.035] opacity-90 brightness-[.86]"
              : "scale-100 opacity-100 brightness-100"
        }`}
      >
        <source media="(min-width: 821px)" srcSet={DESKTOP_BACKGROUND} />
        <img
          src="/api/clouva-landing-bg?v=v6"
          alt=""
          width={1920}
          height={1080}
          loading="eager"
          decoding="async"
          fetchPriority="high"
          className="h-full w-full object-cover object-top min-[821px]:object-center"
        />
      </picture>

      <div
        className={`absolute inset-0 transition-opacity duration-500 motion-reduce:transition-none ${
          access
            ? "bg-[linear-gradient(to_bottom,rgba(0,0,0,.38)_0%,rgba(4,1,12,.52)_44%,rgba(0,0,0,.78)_100%)]"
            : "bg-[linear-gradient(to_bottom,rgba(0,0,0,.10)_0%,rgba(0,0,0,.01)_42%,rgba(0,0,0,.06)_56%,rgba(0,0,0,.52)_76%,rgba(0,0,0,.97)_100%)]"
        } ${entering ? "opacity-100" : "opacity-100"}`}
      />

      {access ? (
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_43%,rgba(140,72,255,.17),transparent_30%),radial-gradient(circle_at_50%_100%,rgba(76,29,149,.18),transparent_42%)]" />
      ) : null}

      <div
        className={`absolute left-1/2 top-[41%] h-[38rem] w-[38rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(170,84,255,.20)_0%,rgba(121,43,255,.08)_32%,transparent_68%)] blur-2xl transition-all duration-500 motion-reduce:transition-none ${
          entering ? "scale-110 opacity-100" : access ? "scale-105 opacity-75" : "scale-90 opacity-35"
        }`}
      />
    </div>
  );
}
