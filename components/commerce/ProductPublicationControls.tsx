"use client";

import { Loader2, UserRound, Warehouse } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type Publication = {
  id: string;
  target_type: "player" | "space" | "marketplace";
  target_player_id: string | null;
  target_space_id: string | null;
  placement: string;
  is_visible: boolean;
};

type Target = {
  key: string;
  type: "player" | "space";
  id: string;
  label: string;
  detail: string;
};

export function ProductPublicationControls({
  productId,
  player,
  space,
}: {
  productId: string;
  player: { id: string; name: string } | null;
  space: { id: string; name: string };
}) {
  const [publications, setPublications] = useState<Publication[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const targets = useMemo<Target[]>(() => [
    ...(player ? [{ key: `player:${player.id}`, type: "player" as const, id: player.id, label: player.name, detail: "Mostrar en mi Player" }] : []),
    { key: `space:${space.id}`, type: "space" as const, id: space.id, label: space.name, detail: "Mostrar en este espacio" },
  ], [player, space]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/commerce/products/${encodeURIComponent(productId)}/publications`);
      const payload = await readApiJson<{ publications: Publication[] }>(response);
      setPublications(payload.publications ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudieron cargar las publicaciones.");
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => { void load(); }, [load]);

  function isVisible(target: Target) {
    return publications.some((publication) => publication.is_visible
      && publication.target_type === target.type
      && (target.type === "player" ? publication.target_player_id === target.id : publication.target_space_id === target.id)
      && publication.placement === "merch");
  }

  async function toggle(target: Target) {
    const nextVisible = !isVisible(target);
    setSavingKey(target.key);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/commerce/products/${encodeURIComponent(productId)}/publications`, {
        method: "PUT",
        body: JSON.stringify({
          targetType: target.type,
          targetPlayerId: target.type === "player" ? target.id : null,
          targetSpaceId: target.type === "space" ? target.id : null,
          placement: "merch",
          isVisible: nextVisible,
        }),
      });
      await readApiJson(response);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo actualizar la publicación.");
    } finally {
      setSavingKey(null);
    }
  }

  if (loading) return <div className="mt-3 flex items-center gap-2 text-xs text-white/35"><Loader2 size={13} className="animate-spin" /> Cargando destinos…</div>;

  return (
    <div className="mt-4 border-t border-white/[0.07] pt-4">
      <p className="text-[10px] uppercase tracking-[.14em] text-white/30">Dónde aparece</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {targets.map((target) => {
          const active = isVisible(target);
          const pending = savingKey === target.key;
          return (
            <button
              key={target.key}
              type="button"
              onClick={() => void toggle(target)}
              disabled={pending}
              title={target.detail}
              className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition disabled:opacity-50 ${active ? "border-violet-400/45 bg-violet-500/15 text-violet-100" : "border-white/10 bg-white/[0.03] text-white/45 hover:text-white"}`}
            >
              {pending ? <Loader2 size={13} className="animate-spin" /> : target.type === "player" ? <UserRound size={13} /> : <Warehouse size={13} />}
              {target.detail}
              <span className={active ? "text-emerald-300" : "text-white/25"}>{active ? "Activo" : "Oculto"}</span>
            </button>
          );
        })}
      </div>
      {error ? <p className="mt-2 text-xs text-rose-300">{error}</p> : null}
    </div>
  );
}
