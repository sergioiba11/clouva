"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { PreviewPersona } from "@/lib/clouva-control/screens";

const PERSONAS = new Set<PreviewPersona>([
  "visitante",
  "usuario_nuevo",
  "free",
  "vip",
  "creador",
  "miembro_estudio",
  "manager_estudio",
  "owner_estudio",
  "admin",
]);

function safePath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/matrix";
  return value;
}

export default function MobilePreviewClient() {
  const router = useRouter();
  const search = useSearchParams();
  const [message, setMessage] = useState("Preparando la vista real de CLOUVA...");

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      const requestedPersona = search.get("persona") as PreviewPersona | null;
      const persona = requestedPersona && PERSONAS.has(requestedPersona) ? requestedPersona : "admin";
      const next = safePath(search.get("next"));
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");

      sessionStorage.setItem("clouva-control-preview-persona", persona);
      window.dispatchEvent(new CustomEvent("clouva-control-preview-persona", { detail: persona }));
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);

      if (persona === "visitante") {
        setMessage("Abriendo CLOUVA como visitante...");
        await supabase.auth.signOut({ scope: "local" });
        if (active) router.replace(next);
        return;
      }

      if (!accessToken || !refreshToken) {
        setMessage("La sesión móvil no llegó completa. Volvé a abrir la vista desde CLOUVA CONTROL.");
        return;
      }

      const result = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      if (result.error) {
        setMessage(result.error.message);
        return;
      }

      if (active) router.replace(next);
    }

    void bootstrap();
    return () => {
      active = false;
    };
  }, [router, search]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#07060d] p-6 text-white">
      <div className="w-full max-w-sm rounded-3xl border border-violet-300/20 bg-violet-500/10 p-6 text-center shadow-[0_0_60px_rgba(124,58,237,0.2)]">
        <div className="mx-auto mb-4 h-10 w-10 animate-pulse rounded-full bg-violet-400/30 shadow-[0_0_30px_rgba(167,139,250,0.55)]" />
        <p className="text-sm leading-6 text-white/75">{message}</p>
      </div>
    </main>
  );
}
