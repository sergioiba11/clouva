"use client";

import Link from "next/link";
import { BookOpen, Building2, MapPinned, Music2, Pencil, Plus } from "lucide-react";
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
    return () => { cancelled = true; };
  }, [isOwner, user]);

  if (!isOwner) return null;

  const actionClass = "inline-flex min-h-10 min-w-0 items-center justify-center gap-2 rounded-full px-3.5 py-2 text-[11px] font-semibold transition sm:px-4 sm:text-xs";

  return (
    <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
      <Link href="/profile/edit" className={`${actionClass} border border-violet-400/35 bg-violet-500/15 text-violet-200 hover:bg-violet-500/25`}>
        <Pencil size={14} /> <span className="truncate">Editar mi perfil</span>
      </Link>
      <Link href="/profile/knowledge" className={`${actionClass} border border-violet-300/25 bg-violet-500/10 text-violet-100 hover:bg-violet-500/20`}>
        <BookOpen size={14} /> <span className="truncate">Mi conocimiento</span>
      </Link>
      <Link href="/mapa-de-confianza" className={`${actionClass} col-span-2 border border-cyan-200/20 bg-cyan-200/[0.06] text-cyan-100 hover:bg-cyan-200/10 sm:col-auto`}>
        <MapPinned size={14} /> <span>Mapa de confianza</span>
      </Link>
      <Link href="/profile/spotify-artist" className={`${actionClass} border border-[#1DB954]/35 bg-[#1DB954]/10 text-[#72e49a] hover:bg-[#1DB954]/20`}>
        <Music2 size={14} /> <span className="truncate">Spotify for Artists</span>
      </Link>
      {ownedStudioId ? (
        <Link href={`/studio-dashboard/${ownedStudioId}`} className={`${actionClass} border border-white/15 bg-black/30 text-white/80 hover:border-violet-400/45`}>
          <Building2 size={14} /> <span className="truncate">Administrar estudio</span>
        </Link>
      ) : ownedStudioId === null ? (
        <Link href="/studios/nuevo" className={`${actionClass} border border-white/15 bg-black/30 text-white/80 hover:border-violet-400/45`}>
          <Plus size={14} /> <span className="truncate">Crear estudio</span>
        </Link>
      ) : null}
    </div>
  );
}
