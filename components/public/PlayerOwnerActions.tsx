"use client";

import Link from "next/link";
import { BookOpen, Building2, Music2, Pencil, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";

/**
 * Acciones privadas del dueño directamente sobre su perfil público.
 * No se renderiza nada para cualquier otro visitante.
 */
export function PlayerOwnerActions({ ownerUserId }: { ownerUserId: string | null }) {
  const { user } = useAuth();
  const isOwner = Boolean(user && ownerUserId && user.id === ownerUserId);
  const [ownedStudioId, setOwnedStudioId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!isOwner || !user) {
      setOwnedStudioId(undefined);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { supabase } = await import("@/lib/supabase");
      const { data } = await supabase.from("studios").select("id").eq("owner_id", user.id).limit(1).maybeSingle();
      if (!cancelled) setOwnedStudioId(data?.id ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [isOwner, user]);

  if (!isOwner) return null;

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <Link
        href="/profile/edit"
        className="inline-flex items-center gap-2 rounded-full border border-violet-400/35 bg-violet-500/15 px-4 py-2 text-xs font-semibold text-violet-200 transition hover:bg-violet-500/25"
      >
        <Pencil size={14} /> Editar mi perfil
      </Link>
      <Link
        href="/profile/knowledge"
        className="inline-flex items-center gap-2 rounded-full border border-violet-300/25 bg-violet-500/10 px-4 py-2 text-xs font-semibold text-violet-100 transition hover:bg-violet-500/20"
      >
        <BookOpen size={14} /> Mi conocimiento
      </Link>
      <Link
        href="/profile/spotify-artist"
        className="inline-flex items-center gap-2 rounded-full border border-[#1DB954]/35 bg-[#1DB954]/10 px-4 py-2 text-xs font-semibold text-[#72e49a] transition hover:bg-[#1DB954]/20"
      >
        <Music2 size={14} /> Conectar Spotify for Artists
      </Link>
      {ownedStudioId ? (
        <Link
          href={`/studio-dashboard/${ownedStudioId}`}
          className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/30 px-4 py-2 text-xs font-semibold text-white/80 transition hover:border-violet-400/45"
        >
          <Building2 size={14} /> Administrar estudio
        </Link>
      ) : ownedStudioId === null ? (
        <Link
          href="/studios/nuevo"
          className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/30 px-4 py-2 text-xs font-semibold text-white/80 transition hover:border-violet-400/45"
        >
          <Plus size={14} /> Crear estudio
        </Link>
      ) : null}
    </div>
  );
}
