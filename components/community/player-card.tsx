import Link from "next/link";

type PlayerCardProps = {
  username: string;
  name: string;
  avatarUrl: string | null;
  role?: string | null;
  city?: string | null;
};

export function PlayerCard({ username, name, avatarUrl, role, city }: PlayerCardProps) {
  return (
    <Link
      href={`/u/${username}`}
      className="panel group block overflow-hidden rounded-[2rem] p-5 transition hover:-translate-y-1"
    >
      <div className="flex items-center gap-4">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-white/[0.04]">
          {avatarUrl ? (
            <img src={avatarUrl} alt={name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-white/30">CLOUVA</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-medium">{name}</h3>
          <p className="truncate text-xs text-white/50">@{username}</p>
          {role ? <p className="mt-1 text-xs uppercase tracking-[0.15em] text-white/45">{role}</p> : null}
          {city ? <p className="mt-0.5 text-xs text-white/40">{city}</p> : null}
        </div>
      </div>
      <span className="mt-4 inline-block rounded-full border border-white/20 px-4 py-1.5 text-xs font-medium">
        Ver perfil
      </span>
    </Link>
  );
}
