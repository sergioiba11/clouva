"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { OnboardingShell } from "@/components/onboarding/OnboardingShell";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type Media = {
  id: string;
  caption?: string;
  media_type: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
};

type ImportSession = {
  id: string;
  available_profile_data: Record<string, unknown>;
  available_media: Media[];
  status: string;
};

function InstagramContentSelectionContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("importSession") || "";
  const { user, loading: authLoading } = useAuth();
  const [session, setSession] = useState<ImportSession | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [coverId, setCoverId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace(`/login?continue=instagram`);
  }, [authLoading, router, user]);

  useEffect(() => {
    if (!user || !sessionId) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await authenticatedFetch(`/api/integrations/instagram/import?sessionId=${encodeURIComponent(sessionId)}`);
        const payload = await readApiJson<{ session: ImportSession }>(response);
        if (!cancelled) setSession(payload.session);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "No se pudo cargar Instagram.");
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId, user]);

  const media = useMemo(() => Array.isArray(session?.available_media) ? session!.available_media : [], [session]);
  const profile = session?.available_profile_data || {};
  const profileImage = typeof profile.profile_image_url === "string" ? profile.profile_image_url : null;

  const toggle = (id: string) => {
    setSelectedIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= 12) return current;
      return [...current, id];
    });
  };

  const move = (id: string, direction: -1 | 1) => {
    setSelectedIds((current) => {
      const index = current.indexOf(id);
      const next = index + direction;
      if (index < 0 || next < 0 || next >= current.length) return current;
      const copy = [...current];
      [copy[index], copy[next]] = [copy[next], copy[index]];
      return copy;
    });
  };

  const createPresentation = async () => {
    if (selectedIds.length > 0 && selectedIds.length < 3) {
      setError("Elegí al menos 3 contenidos o desmarcá todo para continuar sin galería.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let professionalCategories: string[] = [];
      try {
        const stored = JSON.parse(sessionStorage.getItem("clouva.professional_categories") || "[]");
        if (Array.isArray(stored)) professionalCategories = stored.filter((item): item is string => typeof item === "string");
      } catch {
        professionalCategories = [];
      }

      const response = await authenticatedFetch("/api/integrations/instagram/import", {
        method: "POST",
        body: JSON.stringify({
          sessionId,
          selectedMediaIds: selectedIds,
          coverMediaId: coverId,
          profile: { professional_categories: professionalCategories },
          publish: false,
        }),
      });
      const payload = await readApiJson<{ playerId: string; slug: string }>(response);
      router.push(`/onboarding/profile-preview?player=${encodeURIComponent(payload.playerId)}&slug=${encodeURIComponent(payload.slug)}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo crear tu presentación.");
      setSaving(false);
    }
  };

  if (!session && !error) {
    return <OnboardingShell step={4} title="Preparando tu contenido..."><div className="h-64 animate-pulse rounded-2xl bg-white/[0.04]" /></OnboardingShell>;
  }

  return (
    <OnboardingShell step={4} title="Elegí lo que representa tu identidad." description="Seleccioná tu portada y entre 3 y 12 contenidos. También podés continuar sin galería.">
      {profileImage ? (
        <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.025] p-4">
          <img src={profileImage} alt="Foto importada" className="h-20 w-20 rounded-2xl object-cover" />
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-white/35">Foto de perfil</p>
            <p className="mt-1 font-semibold">{String(profile.display_name || profile.username || "Instagram")}</p>
            <p className="mt-1 text-xs text-white/40">Podrás reemplazarla en el editor.</p>
          </div>
        </div>
      ) : null}

      <div className="mt-6 flex items-center justify-between gap-3">
        <div>
          <p className="font-semibold">Contenido autorizado</p>
          <p className="text-xs text-white/40">{selectedIds.length} de 12 seleccionados</p>
        </div>
        <button type="button" onClick={() => { setSelectedIds([]); setCoverId(null); }} className="text-xs text-white/45 hover:text-white">Continuar sin galería</button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {media.map((item) => {
          const selected = selectedIds.includes(item.id);
          const cover = coverId === item.id;
          const image = item.media_type === "VIDEO" ? item.thumbnail_url : item.media_url;
          return (
            <div key={item.id} className={`relative overflow-hidden rounded-2xl border ${selected ? "border-violet-400" : "border-white/10"}`}>
              <button type="button" onClick={() => toggle(item.id)} className="block aspect-square w-full bg-white/[0.03]">
                {image ? <img src={image} alt={item.caption || "Contenido"} className="h-full w-full object-cover" /> : null}
                <span className={`absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border text-xs ${selected ? "border-violet-300 bg-violet-600" : "border-white/30 bg-black/50"}`}>{selected ? "✓" : ""}</span>
                {item.media_type === "VIDEO" ? <span className="absolute bottom-2 left-2 rounded-full bg-black/70 px-2 py-1 text-[10px]">VIDEO</span> : null}
              </button>
              {selected ? (
                <div className="flex items-center justify-between gap-1 bg-black/70 p-2 text-[10px]">
                  <button type="button" onClick={() => move(item.id, -1)} className="rounded px-2 py-1 hover:bg-white/10">←</button>
                  <button type="button" onClick={() => setCoverId(item.id)} className={`rounded px-2 py-1 ${cover ? "bg-violet-600" : "hover:bg-white/10"}`}>{cover ? "Portada" : "Usar de portada"}</button>
                  <button type="button" onClick={() => move(item.id, 1)} className="rounded px-2 py-1 hover:bg-white/10">→</button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {error ? <p className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}
      <div className="mt-6 flex gap-3">
        <button type="button" onClick={() => router.back()} className="rounded-xl border border-white/15 px-5 py-3">Volver</button>
        <button type="button" disabled={saving || !session} onClick={() => void createPresentation()} className="flex-1 rounded-xl bg-violet-600 px-5 py-3 font-semibold transition hover:bg-violet-500 disabled:opacity-60">{saving ? "Creando..." : "Crear mi presentación"}</button>
      </div>
    </OnboardingShell>
  );
}

export default function InstagramContentSelectionPage() {
  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center bg-[#05040a] text-sm text-white/50">Preparando tu contenido…</div>}>
      <InstagramContentSelectionContent />
    </Suspense>
  );
}
