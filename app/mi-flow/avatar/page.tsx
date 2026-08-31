"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, BrainCircuit, Shield, WandSparkles } from "lucide-react";
import { AvatarCanvas } from "@/components/avatar-engine/AvatarCanvas";
import { AvatarControls } from "@/components/avatar-engine/AvatarControls";
import { useAvatarStore } from "@/lib/avatar-engine/avatar-store";
import { useActiveAvatarStore } from "@/lib/avatar-engine/active-avatar-store";
import { useAuth } from "@/components/auth-provider";
import { supabase } from "@/lib/supabase";
import type { AvatarCategory } from "@/lib/avatar-engine/types";

export default function AvatarPage() {
  const [active, setActive] = useState<Exclude<AvatarCategory, "body">>("hair");
  const config = useAvatarStore((state) => state.config);
  const hydrate = useAvatarStore((state) => state.hydrate);
  const loadActiveAvatar = useActiveAvatarStore((state) => state.loadActiveAvatar);
  const activeAvatarLoading = useActiveAvatarStore((state) => state.loading);
  const hydratedAvatarUserId = useActiveAvatarStore((state) => state.hydratedUserId);
  const router = useRouter();
  const { role, user, hydrationReady } = useAuth();

  useEffect(() => { void hydrate(); }, [hydrate]);

  useEffect(() => {
    if (!hydrationReady || role !== "admin" || activeAvatarLoading) return;

    let cancelled = false;

    const loadClouvaAdminAvatar = async () => {
      const { data, error } = await supabase
        .from("players")
        .select("owner_user_id")
        .eq("slug", "clouva")
        .maybeSingle();

      if (cancelled) return;
      if (error) console.error("Could not resolve CLOUVA admin avatar owner", error);

      const clouvaAdminUserId = data?.owner_user_id ?? user?.id ?? null;
      if (!clouvaAdminUserId || hydratedAvatarUserId === clouvaAdminUserId) return;

      await loadActiveAvatar(clouvaAdminUserId);
    };

    void loadClouvaAdminAvatar();

    return () => {
      cancelled = true;
      if (user?.id && hydratedAvatarUserId && hydratedAvatarUserId !== user.id) {
        void loadActiveAvatar(user.id);
      }
    };
  }, [
    activeAvatarLoading,
    hydratedAvatarUserId,
    hydrationReady,
    loadActiveAvatar,
    role,
    user?.id,
  ]);

  const goBack = () => {
    if (window.history.length > 1) {
      router.back();
      window.setTimeout(() => {
        if (window.location.pathname === "/mi-flow/avatar") router.push("/mi-flow");
      }, 500);
      return;
    }
    router.push("/mi-flow");
  };

  return (
    <main className="avatar-engine-page" aria-label="CLOUVA Avatar Engine">
      <div className="avatar-engine-aura" aria-hidden="true" />
      <button
        type="button"
        onClick={goBack}
        className="avatar-back"
        style={{ position: "absolute", zIndex: 40, pointerEvents: "auto" }}
      >
        <ArrowLeft className="h-4 w-4" /> Volver
      </button>

      <nav
        style={{ position: "absolute", top: "max(1rem, env(safe-area-inset-top))", left: 0, right: 0, zIndex: 30, pointerEvents: "auto" }}
        className="flex justify-center"
      >
        <div className="mt-14 flex max-w-[92vw] flex-nowrap gap-2 overflow-x-auto rounded-full border border-white/10 bg-black/50 p-1.5 backdrop-blur">
          <Link href="/mi-flow/avatar-ia" className="whitespace-nowrap rounded-full px-3 py-1.5 text-xs text-white/80 hover:bg-white/10">Generar con IA</Link>
          <Link href="/mi-flow/avatar-customizer" className="whitespace-nowrap rounded-full px-3 py-1.5 text-xs text-white/80 hover:bg-white/10">Personalizar</Link>
          <Link href="/mi-flow/crear-prenda" className="whitespace-nowrap rounded-full px-3 py-1.5 text-xs text-white/80 hover:bg-white/10">Crear prenda</Link>
          <Link href="/mi-flow/armario" className="whitespace-nowrap rounded-full px-3 py-1.5 text-xs text-white/80 hover:bg-white/10">Mi armario</Link>
          <Link href="/avatar-analyzer-v4" className="flex whitespace-nowrap rounded-full px-3 py-1.5 text-xs text-sky-200 hover:bg-sky-500/20">
            <BrainCircuit className="mr-1 h-3.5 w-3.5" /> Analyzer V4
          </Link>
          <Link href="/creator-studio" className="flex whitespace-nowrap rounded-full px-3 py-1.5 text-xs text-violet-200 hover:bg-violet-500/20">
            <WandSparkles className="mr-1 h-3.5 w-3.5" /> Creator Studio
          </Link>
          {role === "admin" ? (
            <Link href="/admin" className="flex whitespace-nowrap rounded-full px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-500/20">
              <Shield className="mr-1 h-3.5 w-3.5" /> Admin
            </Link>
          ) : null}
        </div>
      </nav>

      <AvatarCanvas config={config} />
      <AvatarControls active={active} onActiveChange={setActive} />
    </main>
  );
}
