"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

const STEP_TIMEOUT_MS = 8000;

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

export default function AuthCallbackContent() {
  const searchParams = useSearchParams();
  const startedRef = useRef(false);
  const [message, setMessage] = useState("Completando inicio de sesión...");
  const code = useMemo(() => searchParams.get("code"), [searchParams]);
  const isAddAccountMode = useMemo(() => searchParams.get("addAccount") === "1", [searchParams]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const handleCallback = async () => {
      try {
        const { supabase } = await withTimeout(import("@/lib/supabase"), "La aplicación");

        if (code) {
          const result = await withTimeout(supabase.auth.exchangeCodeForSession(code), "El inicio de sesión");
          if (result.error && !result.error.message.toLowerCase().includes("code verifier")) {
            throw result.error;
          }
        }

        const sessionResult = await withTimeout(supabase.auth.getSession(), "La sesión");
        if (sessionResult.error) throw sessionResult.error;

        const user = sessionResult.data.session?.user;
        if (!user) throw new Error("No se pudo establecer la sesión");

        const isAdmin = user.email?.toLowerCase() === "sergio.iba.11@gmail.com";
        const destination = isAdmin ? "/admin" : "/mi-flow";

        setMessage("Sesión iniciada. Entrando...");

        // El perfil se sincroniza en segundo plano y nunca bloquea la entrada.
        void (async () => {
          try {
            const defaultName =
              (user.user_metadata?.full_name as string | undefined) ??
              (user.email ? user.email.split("@")[0] : "Usuario");

            const { data: existing } = await supabase
              .from("profiles")
              .select("id, role, display_name")
              .eq("id", user.id)
              .maybeSingle();

            if (!existing) {
              await supabase.from("profiles").insert({
                id: user.id,
                display_name: defaultName,
                role: isAdmin ? "admin" : "cliente",
              });
            } else {
              const updates: { display_name?: string; role?: string } = {};
              if (!existing.display_name && defaultName) updates.display_name = defaultName;
              if (isAdmin && existing.role !== "admin" && existing.role !== "owner") updates.role = "admin";
              if (Object.keys(updates).length > 0) {
                await supabase.from("profiles").update(updates).eq("id", user.id);
              }
            }
          } catch (error) {
            console.error("Profile sync after login failed", error);
          }
        })();

        redirect(isAddAccountMode ? `${destination}?openAccountSwitcher=1` : destination);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "No se pudo completar el inicio de sesión";
        console.error("Auth callback failed", error);
        setMessage("No se pudo completar. Volviendo al login...");
        redirect(`/login?error=${encodeURIComponent(errorMessage)}`);
      }
    };

    void handleCallback();
  }, [code, isAddAccountMode]);

  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-3xl items-center justify-center px-4 py-12">
      <p className="text-white/80">{message}</p>
    </main>
  );
}
