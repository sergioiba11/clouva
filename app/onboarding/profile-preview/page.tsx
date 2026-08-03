"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { OnboardingShell } from "@/components/onboarding/OnboardingShell";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import type { Player } from "@/lib/players-data";

export default function ProfilePreviewPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [player, setPlayer] = useState<Player | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, router, user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await authenticatedFetch("/api/players/me");
        const payload = await readApiJson<{ player: Player | null }>(response);
        if (!cancelled) setPlayer(payload.player);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "No se pudo cargar tu perfil.");
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  const publish = async () => {
    setPublishing(true);
    setError(null);
    try {
      const response = await authenticatedFetch("/api/players/me", {
        method: "PATCH",
        body: JSON.stringify({ publication_action: "publish" }),
      });
      const payload = await readApiJson<{
        player: Player;
        completedStudioJoins: number;
        pendingStudioReturnPath: string | null;
      }>(response);

      // Free memberships are completed here; paid intents return to checkout
      // first and only become memberships after Mercado Pago confirms payment.
      if (payload.pendingStudioReturnPath) {
        router.replace(payload.pendingStudioReturnPath);
        return;
      }
      router.push(`/onboarding/vip-offer?slug=${encodeURIComponent(payload.player.slug)}`);
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : "No se pudo publicar.");
      setPublishing(false);
    }
  };

  if (!player && !error) {
    return <OnboardingShell step={5} title="Preparando tu vista previa..."><div className="h-96 animate-pulse rounded-2xl bg-white/[0.04]" /></OnboardingShell>;
  }

  return (
    <OnboardingShell step={5} title="Tu perfil está en borrador." description="Revisalo antes de publicarlo. Todo continúa siendo editable.">
      {player ? (
        <div className="overflow-hidden rounded-[1.75rem] border border-white/10 bg-[#07060b]">
          <div className="relative h-44 bg-gradient-to-br from-violet-900/50 to-black">
            {player.cover_url || player.hero_image_url ? <img src={player.cover_url || player.hero_image_url || ""} alt="Portada" className="h-full w-full object-cover" /> : null}
            <div className="absolute inset-0 bg-gradient-to-t from-[#07060b] to-transparent" />
          </div>
          <div className="relative px-5 pb-6">
            {player.profile_image_url ? <img src={player.profile_image_url} alt={player.display_name} className="-mt-12 h-24 w-24 rounded-2xl border-4 border-[#07060b] object-cover" /> : <div className="-mt-12 flex h-24 w-24 items-center justify-center rounded-2xl border-4 border-[#07060b] bg-violet-500/20 text-3xl font-semibold">{player.display_name.charAt(0)}</div>}
            <h2 className="mt-4 text-2xl font-bold">{player.display_name}</h2>
            {player.username ? <p className="mt-1 text-sm text-white/40">@{player.username.replace(/^@/, "")}</p> : null}
            <p className="mt-4 text-sm leading-6 text-white/65">{player.short_bio || player.tagline || "Agregá una presentación desde el editor."}</p>
            <div className="mt-4 flex flex-wrap gap-2">{(player.professional_categories || []).map((category) => <span key={category} className="rounded-full border border-violet-400/20 bg-violet-500/10 px-3 py-1 text-xs text-violet-200">{category}</span>)}</div>
            <p className="mt-5 rounded-xl border border-white/8 bg-white/[0.025] px-3 py-2 text-xs text-white/45">clouva.com.ar/{player.slug}</p>
          </div>
        </div>
      ) : null}

      {error ? <p className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}
      <button disabled={!player || publishing} onClick={() => void publish()} className="mt-6 w-full rounded-xl bg-violet-600 px-5 py-3.5 font-semibold transition hover:bg-violet-500 disabled:opacity-60">{publishing ? "Publicando..." : "Publicar perfil"}</button>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <button onClick={() => router.push("/profile/edit")} className="rounded-xl border border-white/15 px-4 py-3 text-sm">Editar</button>
        <button onClick={() => router.push("/onboarding/instagram/select")} className="rounded-xl border border-white/15 px-4 py-3 text-sm">Cambiar imágenes</button>
      </div>
    </OnboardingShell>
  );
}
