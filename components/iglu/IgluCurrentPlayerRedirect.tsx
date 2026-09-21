"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type MePayload = {
  player?: {
    slug?: string | null;
    is_published?: boolean | null;
    publication_status?: string | null;
  } | null;
  error?: string;
};

export function IgluCurrentPlayerRedirect() {
  const router = useRouter();
  const [state, setState] = useState<"loading" | "needs-profile" | "auth" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/players/me", { cache: "no-store", credentials: "include" })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as MePayload;
        if (cancelled) return;
        if (response.status === 401) {
          setState("auth");
          return;
        }
        if (!response.ok) {
          setState("error");
          return;
        }
        const player = payload.player;
        if (player?.slug && player.is_published && player.publication_status === "published") {
          router.replace(`/${player.slug}`);
          return;
        }
        setState("needs-profile");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="min-h-[100svh] bg-[#01060c] px-5 py-16 text-white">
      <section className="mx-auto max-w-md rounded-[28px] border border-cyan-200/15 bg-[#06111d]/90 p-6 shadow-2xl">
        <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-cyan-100/55">IGLÚ · PERFIL</p>
        {state === "loading" ? <h1 className="mt-3 text-2xl font-black">Abriendo tu Player público…</h1> : null}
        {state === "needs-profile" ? (
          <>
            <h1 className="mt-3 text-2xl font-black">Tu Player todavía no está publicado</h1>
            <p className="mt-3 text-sm leading-6 text-white/55">Completá o publicá tu identidad Player y después PERFIL va a abrir directamente tu vista pública.</p>
            <Link href="/profile/edit" className="mt-6 inline-flex min-h-12 items-center rounded-full bg-cyan-100 px-5 text-sm font-black text-[#04101c]">Completar mi Player →</Link>
          </>
        ) : null}
        {state === "auth" ? (
          <>
            <h1 className="mt-3 text-2xl font-black">Iniciá sesión para abrir tu Player</h1>
            <Link href="/login" className="mt-6 inline-flex min-h-12 items-center rounded-full bg-cyan-100 px-5 text-sm font-black text-[#04101c]">Iniciar sesión →</Link>
          </>
        ) : null}
        {state === "error" ? (
          <>
            <h1 className="mt-3 text-2xl font-black">No pudimos resolver tu Player</h1>
            <p className="mt-3 text-sm text-white/50">Probá nuevamente o abrí tu perfil para revisar la identidad publicada.</p>
            <Link href="/profile/edit" className="mt-6 inline-flex min-h-12 items-center rounded-full border border-cyan-100/25 px-5 text-sm font-bold">Revisar perfil →</Link>
          </>
        ) : null}
      </section>
    </main>
  );
}
