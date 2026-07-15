"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getRedirectByRole } from "@/lib/auth";

const STEP_TIMEOUT_MS = 30000;

function redirect(path: string) {
  window.location.replace(path);
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      window.setTimeout(() => reject(new Error(`${label} tardó demasiado`)), STEP_TIMEOUT_MS),
    ),
  ]);
}

async function waitForSession(supabase: any) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const result = await supabase.auth.getSession();
    if (result.error) throw result.error;
    if (result.data.session?.user) return result.data.session;
    await new Promise((resolve) => window.setTimeout(resolve, 400));
  }
  return null;
}

export default function AuthCallbackContent() {
  const searchParams = useSearchParams();
  const startedRef = useRef(false);
  const [message, setMessage] = useState("Completando inicio de sesión con Google...");
  const code = useMemo(() => searchParams.get("code"), [searchParams]);
  const oauthError = useMemo(
    () => searchParams.get("error_description") || searchParams.get("error"),
    [searchParams],
  );
  const isAddAccountMode = useMemo(() => searchParams.get("addAccount") === "1", [searchParams]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const handleCallback = async () => {
      try {
        if (oauthError) throw new Error(oauthError);

        const { supabase } = await withTimeout(import("@/lib/supabase"), "La aplicación");
        const initialSession = await withTimeout(supabase.auth.getSession(), "La sesión");
        if (initialSession.error) throw initialSession.error;

        let session = initialSession.data.session;

        if (!session && code) {
          const exchange = await withTimeout(
            supabase.auth.exchangeCodeForSession(code),
            "El inicio de sesión con Google",
          );

          if (exchange.error) {
            const normalized = exchange.error.message.toLowerCase();
            const alreadyHandled =
              normalized.includes("code verifier") ||
              normalized.includes("auth code") ||
              normalized.includes("already been used");
            if (!alreadyHandled) throw exchange.error;
          }

          session = exchange.data.session ?? null;
        }

        if (!session) {
          session = await withTimeout(waitForSession(supabase), "La sesión de Google");
        }

        const user = session?.user;
        if (!user) {
          throw new Error("Google autorizó el acceso, pero CLOUVA no recibió una sesión válida. Volvé a intentarlo.");
        }

        const defaultName =
          (user.user_metadata?.full_name as string | undefined) ??
          (user.user_metadata?.name as string | undefined) ??
          (user.email ? user.email.split("@")[0] : "Usuario");
        const avatarUrl =
          (user.user_metadata?.avatar_url as string | undefined) ??
          (user.user_metadata?.picture as string | undefined) ??
          null;

        let { data: profile } = await supabase
          .from("profiles")
          .select("id, role, display_name, full_name")
          .eq("id", user.id)
          .maybeSingle();

        if (!profile) {
          const { data: created } = await supabase
            .from("profiles")
            .insert({
              id: user.id,
              display_name: defaultName,
              full_name: defaultName,
              avatar_url: avatarUrl,
              role: "cliente",
            })
            .select("id, role, display_name, full_name")
            .maybeSingle();
          profile = created;
        } else {
          const updates: Record<string, string> = {};
          if (!profile.display_name && defaultName) updates.display_name = defaultName;
          if (!profile.full_name && defaultName) updates.full_name = defaultName;
          if (Object.keys(updates).length > 0) {
            await supabase.from("profiles").update(updates).eq("id", user.id);
          }
        }

        localStorage.removeItem("clouva.switch_target");
        const destination = getRedirectByRole(profile?.role ?? "cliente");
        setMessage("Sesión iniciada. Entrando a CLOUVA...");
        redirect(isAddAccountMode ? `${destination}?openAccountSwitcher=1` : destination);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "No se pudo completar el inicio de sesión";
        console.error("Auth callback failed", error);
        setMessage("No se pudo completar. Volviendo al login...");
        window.setTimeout(() => redirect(`/login?error=${encodeURIComponent(errorMessage)}`), 900);
      }
    };

    void handleCallback();
  }, [code, isAddAccountMode, oauthError]);

  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-3xl items-center justify-center px-4 py-12">
      <div className="text-center">
        <div className="mx-auto mb-4 h-9 w-9 animate-spin rounded-full border-2 border-white/20 border-t-[#a855f7]" />
        <p className="text-white/80">{message}</p>
      </div>
    </main>
  );
}
