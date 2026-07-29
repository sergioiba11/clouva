"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AvatarPlaceholder, PublicShell } from "@/components/public/PublicShell";
import {
  playerPublicSelect,
  playerStudiosSelect,
  type Player,
  type PlayerStudioAffiliation,
} from "@/lib/players-data";

export default function PlayerProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const [slug, setSlug] = useState("");
  const [player, setPlayer] = useState<Player | null>(null);
  const [affiliations, setAffiliations] = useState<PlayerStudioAffiliation[]>([]);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    void params.then((v) => setSlug(v.slug));
  }, [params]);

  useEffect(() => {
    if (!slug) return;
    void (async () => {
      const { supabase } = await import("@/lib/supabase");
      const { data } = await supabase
        .from("players")
        .select(playerPublicSelect)
        .eq("slug", slug)
        .eq("is_published", true)
        .maybeSingle();
      if (!data) {
        setNotFound(true);
        return;
      }
      const playerRow = data as Player;
      setPlayer(playerRow);

      const { data: studioLinks } = await supabase
        .from("player_studios")
        .select(playerStudiosSelect)
        .eq("player_id", playerRow.id)
        .eq("is_visible", true)
        .order("display_order");
      setAffiliations((studioLinks ?? []) as unknown as PlayerStudioAffiliation[]);
    })();
  }, [slug]);

  const share = async () => {
    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({ title: player?.display_name, url }).catch(() => {});
    } else {
      await navigator.clipboard.writeText(url);
    }
  };

  if (notFound) {
    return (
      <PublicShell brand="CLOUVA" navLinks={[{ label: "La Matrix", href: "/matrix" }]}>
        <section className="mx-auto max-w-3xl px-4 py-20 text-center">
          <p className="text-white/60">No encontramos ese perfil.</p>
        </section>
      </PublicShell>
    );
  }

  if (!player) {
    return (
      <PublicShell brand="CLOUVA">
        <section className="mx-auto max-w-3xl px-4 py-20 text-center text-white/50">Cargando...</section>
      </PublicShell>
    );
  }

  const contactHref = player.booking_email
    ? `mailto:${player.booking_email}`
    : player.contact_email
      ? `mailto:${player.contact_email}`
      : player.whatsapp_url || null;

  return (
    <PublicShell
      brand={player.display_name}
      brandHref={`/players/${player.slug}`}
      navLinks={[
        { label: "Inicio", href: `/players/${player.slug}` },
        { label: "Estudios", href: "/studios" },
      ]}
    >
      {/* Hero */}
      <section className="relative">
        <div className="relative h-72 w-full bg-white/[0.03] sm:h-96">
          {player.cover_url || player.hero_image_url ? (
            <img
              src={player.cover_url || player.hero_image_url || ""}
              alt={player.display_name}
              className="h-full w-full object-cover"
            />
          ) : (
            <AvatarPlaceholder label={player.display_name} className="h-full w-full text-8xl" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#07060b] via-[#07060b]/40 to-transparent" />
        </div>
        <div className="mx-auto max-w-4xl px-4 pb-8 pt-0 sm:px-6">
          <div className="-mt-16 flex flex-col items-start gap-4">
            {player.profile_image_url ? (
              <img
                src={player.profile_image_url}
                alt={player.display_name}
                className="h-28 w-28 rounded-2xl border-4 border-[#07060b] object-cover"
              />
            ) : (
              <AvatarPlaceholder label={player.display_name} className="h-28 w-28 rounded-2xl border-4 border-[#07060b] text-4xl" />
            )}
            <div>
              <h1 className="text-3xl font-bold sm:text-4xl">{player.display_name}</h1>
              {player.tagline ? <p className="mt-1 text-[#a996ff]">{player.tagline}</p> : null}
              {player.secondary_tagline ? <p className="text-sm text-white/50">{player.secondary_tagline}</p> : null}
              <p className="mt-2 text-sm text-white/50">
                {[player.primary_role, player.origin].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {contactHref ? (
                <a href={contactHref} className="rounded-full bg-[#8f7cff] px-4 py-2 text-sm font-medium text-black">
                  Contactar
                </a>
              ) : null}
              <button onClick={share} className="rounded-full border border-white/20 px-4 py-2 text-sm font-medium">
                Compartir
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Sobre el Player */}
      {player.short_bio || player.long_bio ? (
        <section className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
          <h2 className="text-xl font-semibold">Sobre {player.display_name}</h2>
          <p className="mt-3 text-sm leading-relaxed text-white/70">{player.long_bio || player.short_bio}</p>
          {player.disciplines?.length ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {player.disciplines.map((d) => (
                <span key={d} className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/60">
                  {d}
                </span>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Estudios y colectivos */}
      {affiliations.length > 0 ? (
        <section className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
          <h2 className="text-xl font-semibold">Estudios y colectivos</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {affiliations.map((a, i) =>
              a.studio ? (
                <Link
                  key={i}
                  href={`/studios/${a.studio.slug}`}
                  className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-[#8f7cff]/50"
                >
                  {a.studio.logo_url ? (
                    <img src={a.studio.logo_url} alt={a.studio.name} className="h-10 w-10 rounded-xl object-cover" />
                  ) : (
                    <AvatarPlaceholder label={a.studio.name} className="h-10 w-10 rounded-xl" />
                  )}
                  <div>
                    <p className="font-medium">{a.studio.name}</p>
                    {a.role ? <p className="text-xs text-white/50">{a.role}</p> : null}
                  </div>
                </Link>
              ) : null,
            )}
          </div>
        </section>
      ) : null}
    </PublicShell>
  );
}
