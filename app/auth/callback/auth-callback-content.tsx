"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getRedirectByRole } from "@/lib/auth";

const CALLBACK_TIMEOUT_MS = 15000;

function redirect(path: string) {
  window.location.replace(path);
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

    const timeout = window.setTimeout(() => {
      setMessage("El inicio de sesión tardó demasiado. Volviendo a intentar...");
      redirect("/login?error=El%20inicio%20de%20sesión%20tardó%20demasiado");
    }, CALLBACK_TIMEOUT_MS);

    const handleCallback = async () => {
      try {
        const { supabase } = await import("@/lib/supabase");

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error && !error.message.toLowerCase().includes("code verifier")) {
            throw error;
          }
        }

        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        const user = sessionData.session?.user;
        if (!user) throw new Error("No se pudo establecer la sesión");

        const defaultName =
          (user.user_metadata?.full_name as string | undefined) ??
          (user.email ? user.email.split("@")[0] : "Usuario");

        const { data: existing, error: profileReadError } = await supabase
          .from("profiles")
          .select("id, role, display_name")
          .eq("id", user.id)
          .maybeSingle();

        if (profileReadError) {
          console.error("Could not read auth profile", profileReadError);
        }

        const isSergio = user.email?.toLowerCase() === "sergio.iba.11@gmail.com";

        if (!profileReadError) {
          if (!existing) {
            const { error: insertError } = await supabase.from("profiles").insert({
              id: user.id,
              display_name: defaultName,
              role: isSergio ? "admin" : "cliente",
            });
            if (insertError) console.error("Could not create auth profile", insertError);
          } else {
            const updates: { display_name?: string; role?: string } = {};
            if (!existing.display_name && defaultName) updates.display_name = defaultName;
            if (isSergio && existing.role !== "admin" && existing.role !== "owner") updates.role = "admin";
            if (Object.keys(updates).length > 0) {
              const { error: updateError } = await supabase.from("profiles").update(updates).eq("id", user.id);
              if (updateError) console.error("Could not update auth profile", updateError);
            }
          }
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .maybeSingle();

        window.clearTimeout(timeout);
        const redirectPath = getRedirectByRole(profile?.role ?? existing?.role);
        redirect(isAddAccountMode ? `${redirectPath}?openAccountSwitcher=1` : redirectPath);
      } catch (error) {
        window.clearTimeout(timeout);
        const message = error instanceof Error ? error.message : "No se pudo completar el inicio de sesión";
        console.error("Auth callback failed", error);
        redirect(`/login?error=${encodeURIComponent(message)}`);
      }
    };

    void handleCallback();

    return () => window.clearTimeout(timeout);
  }, [code, isAddAccountMode]);

  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-3xl items-center justify-center px-4 py-12">
      <p className="text-white/80">{message}</p>
    </main>
  );
}
