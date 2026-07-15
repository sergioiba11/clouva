"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

function redirect(path: string) {
  window.location.replace(path);
}

async function raceTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => window.setTimeout(() => reject(new Error(message)), ms)),
  ]);
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

    const emergencyRedirect = window.setTimeout(() => {
      redirect(isAddAccountMode ? "/mi-flow?openAccountSwitcher=1" : "/perfil");
    }, 9000);

    const handleCallback = async () => {
      try {
        if (oauthError) throw new Error(oauthError);

        const { supabase } = await import("@/lib/supabase");
        let session = (await supabase.auth.getSession()).data.session;

        if (!session && code) {
          const exchange = await raceTimeout(
            supabase.auth.exchangeCodeForSession(code),
            8000,
            "El acceso con Google tardó demasiado",
          );
          if (exchange.error) throw exchange.error;
          session = exchange.data.session;
        }

        if (!session?.user) {
          const retry = await raceTimeout(supabase.auth.getSession(), 3000, "La sesión tardó demasiado");
          session = retry.data.session;
        }

        if (!session?.user) {
          throw new Error("No se pudo crear la sesión de Google.");
        }

        const user = session.user;
        const isAdmin = user.email?.toLowerCase() === "sergio.iba.11@gmail.com";
        const destination = isAdmin ? "/admin" : "/perfil";

        setMessage("Sesión iniciada. Entrando a CLOUVA...");
        window.clearTimeout(emergencyRedirect);

        void (async () => {
          try {
            const defaultName =
              (user.user_metadata?.full_name as string | undefined) ??
              (user.user_metadata?.name as string | undefined) ??
              (user.email ? user.email.split("@")[0] : "Usuario");

            const { data: existing } = await supabase
              .from("profiles")
              .select("id, role, display_name, full_name")
              .eq("id", user.id)
              .maybeSingle();

            if (!existing) {
              await supabase.from("profiles").insert({
                id: user.id,
                display_name: defaultName,
                full_name: defaultName,
                role: isAdmin ? "admin" : "cliente",
              });
            }
          } catch (profileError) {
            console.error("Profile sync after Google login failed", profileError);
          }
        })();

        redirect(isAddAccountMode ? `${destination}?openAccountSwitcher=1` : destination);
      } catch (error) {
        window.clearTimeout(emergencyRedirect);
        const text = error instanceof Error ? error.message : "No se pudo iniciar sesión con Google";
        console.error("Google callback failed", error);
        redirect(`/login?error=${encodeURIComponent(text)}`);
      }
    };

    void handleCallback();
    return () => window.clearTimeout(emergencyRedirect);
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
