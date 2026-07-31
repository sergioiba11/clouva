"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getRedirectByRole } from "@/lib/auth";
import { readApiJson } from "@/lib/authenticated-fetch";

function redirect(path: string) {
  window.location.replace(path);
}

async function raceTimeout<T>(promise: PromiseLike<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>((_, reject) => window.setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

async function claimPendingInstagram(accessToken: string) {
  const response = await fetch("/api/integrations/instagram/claim", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return readApiJson<{ importSessionId: string }>(response);
}

function clouvaIdForUser(userId: string) {
  return `CLV-${userId.replaceAll("-", "").slice(0, 10)}`;
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
  const continueMode = useMemo(() => searchParams.get("continue"), [searchParams]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let finished = false;
    const failSafe = window.setTimeout(() => {
      if (finished) return;
      redirect(`/login?error=${encodeURIComponent("Google no pudo confirmar la sesión. Volvé a intentarlo.")}`);
    }, 22000);

    const handleCallback = async () => {
      try {
        if (oauthError) throw new Error(oauthError);

        const { supabase } = await import("@/lib/supabase");
        setMessage("Confirmando la sesión de Google...");

        let session = (await raceTimeout(
          supabase.auth.getSession(),
          4000,
          "No se pudo leer la sesión de Google",
        )).data.session;

        if (!session?.user && code) {
          const exchange = await raceTimeout(
            supabase.auth.exchangeCodeForSession(code),
            12000,
            "El acceso con Google tardó demasiado",
          );
          if (exchange.error) throw exchange.error;
          session = exchange.data.session;
        }

        if (!session?.user) {
          const retry = await raceTimeout(
            supabase.auth.getSession(),
            4000,
            "La sesión de Google no quedó guardada",
          );
          session = retry.data.session;
        }

        if (!session?.user) throw new Error("No se pudo crear la sesión de Google.");

        const user = session.user;
        setMessage("Cargando tu perfil de CLOUVA...");
        const defaultName =
          (user.user_metadata?.full_name as string | undefined) ??
          (user.user_metadata?.name as string | undefined) ??
          (user.email ? user.email.split("@")[0] : "Usuario");

        const { data: loadedProfile, error: profileError } = await raceTimeout(
          supabase
            .from("profiles")
            .select("id, role, display_name, full_name, onboarding_status")
            .eq("id", user.id)
            .maybeSingle(),
          6000,
          "El perfil tardó demasiado en cargar",
        );
        let profile = loadedProfile;
        if (profileError) throw profileError;

        if (!profile) {
          const created = await raceTimeout(
            supabase
              .from("profiles")
              .insert({
                id: user.id,
                display_name: defaultName,
                full_name: defaultName,
                email: user.email ?? null,
                role: "customer",
                role_v2: "cliente",
                clouva_id: clouvaIdForUser(user.id),
                onboarding_status: "pending",
              })
              .select("id, role, display_name, full_name, onboarding_status")
              .single(),
            6000,
            "No se pudo crear el perfil",
          );
          if (created.error) throw created.error;
          profile = created.data;
        } else if (!profile.display_name || !profile.full_name) {
          const updated = await raceTimeout(
            supabase
              .from("profiles")
              .update({
                display_name: profile.display_name || defaultName,
                full_name: profile.full_name || defaultName,
                email: user.email ?? null,
              })
              .eq("id", user.id)
              .select("id, role, display_name, full_name, onboarding_status")
              .single(),
            6000,
            "No se pudo completar el perfil",
          );
          if (updated.error) throw updated.error;
          profile = updated.data;
        }

        if (continueMode === "instagram") {
          setMessage("Asociando Instagram con tu cuenta de CLOUVA...");
          const claimed = await raceTimeout(
            claimPendingInstagram(session.access_token),
            12000,
            "La conexión con Instagram tardó demasiado",
          );
          finished = true;
          window.clearTimeout(failSafe);
          redirect(`/onboarding/instagram/select?importSession=${encodeURIComponent(claimed.importSessionId)}`);
          return;
        }

        localStorage.removeItem("clouva.switch_target");
        const destination = profile?.onboarding_status === "pending"
          ? "/onboarding/identity"
          : profile?.onboarding_status === "exploring"
            ? "/matrix"
            : profile?.onboarding_status === "player_created"
              ? "/onboarding/instagram"
              : getRedirectByRole(profile?.role ?? "customer");
        const target = isAddAccountMode && !destination.startsWith("/onboarding") && destination !== "/matrix"
          ? `${destination}?openAccountSwitcher=1`
          : destination;

        finished = true;
        window.clearTimeout(failSafe);
        setMessage("Sesión iniciada. Entrando a CLOUVA...");
        redirect(target);
      } catch (error) {
        finished = true;
        window.clearTimeout(failSafe);
        const text = error instanceof Error ? error.message : "No se pudo iniciar sesión con Google";
        console.error("Google callback failed", error);
        const continueParam = continueMode ? `&continue=${encodeURIComponent(continueMode)}` : "";
        redirect(`/login?error=${encodeURIComponent(text)}${continueParam}`);
      }
    };

    void handleCallback();
    return () => window.clearTimeout(failSafe);
  }, [code, continueMode, isAddAccountMode, oauthError]);

  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-3xl items-center justify-center px-4 py-12">
      <div className="text-center">
        <div className="mx-auto mb-4 h-9 w-9 animate-spin rounded-full border-2 border-white/20 border-t-[#a855f7]" />
        <p className="text-white/80">{message}</p>
      </div>
    </main>
  );
}
