"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Script from "next/script";
import { useRouter, useSearchParams } from "next/navigation";
import { getRedirectByRole, roleHome } from "@/lib/auth";
import { useAuth } from "@/components/auth-provider";
import { readApiJson } from "@/lib/authenticated-fetch";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              type?: "standard" | "icon";
              theme?: "outline" | "filled_black" | "filled_blue";
              size?: "large" | "medium" | "small";
              shape?: "rectangular" | "pill" | "circle" | "square";
              text?: "signin_with" | "signup_with" | "continue_with" | "signin";
              logo_alignment?: "left" | "center";
              locale?: string;
              width?: number;
            },
          ) => void;
        };
      };
    };
  }
}

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

async function claimPendingInstagram(accessToken: string) {
  const response = await fetch("/api/integrations/instagram/claim", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return readApiJson<{ importSessionId: string }>(response);
}

export default function LoginContent() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [googleScriptReady, setGoogleScriptReady] = useState(false);
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const handleGoogleCredentialRef = useRef<(response: { credential?: string }) => void>(() => {});
  const router = useRouter();
  const searchParams = useSearchParams();
  const isAddAccountMode = useMemo(() => searchParams.get("addAccount") === "1", [searchParams]);
  const continueMode = useMemo(() => searchParams.get("continue"), [searchParams]);
  const { user, session, role, loading: authLoading, hydrationReady } = useAuth();

  useEffect(() => {
    setError(searchParams.get("error") || null);
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    const releaseTimer = window.setTimeout(() => {
      if (!cancelled) setCheckingSession(false);
    }, 7000);

    const resolveLoginScreen = async () => {
      if (isAddAccountMode) {
        if (!cancelled) setCheckingSession(false);
        return;
      }
      if (!hydrationReady || authLoading) return;
      if (!user || !session) {
        if (!cancelled) setCheckingSession(false);
        return;
      }

      if (continueMode === "instagram") {
        try {
          const claimed = await claimPendingInstagram(session.access_token);
          if (!cancelled) router.replace(`/onboarding/instagram/select?importSession=${encodeURIComponent(claimed.importSessionId)}`);
        } catch (claimError) {
          if (!cancelled) {
            setError(claimError instanceof Error ? claimError.message : "No se pudo retomar Instagram.");
            setCheckingSession(false);
          }
        }
        return;
      }

      const targetId = localStorage.getItem("clouva.switch_target");
      if (targetId && targetId !== user.id) {
        try {
          const { supabase } = await import("@/lib/supabase");
          await supabase.auth.signOut();
        } finally {
          if (!cancelled) setCheckingSession(false);
        }
        return;
      }

      localStorage.removeItem("clouva.switch_target");
      if (!cancelled) {
        setCheckingSession(false);
        router.replace(roleHome[role]);
      }
    };

    void resolveLoginScreen();
    return () => {
      cancelled = true;
      window.clearTimeout(releaseTimer);
    };
  }, [authLoading, continueMode, hydrationReady, isAddAccountMode, role, router, session, user]);

  const redirectByRole = async (userId: string, accessToken: string, forceSwitcher = false) => {
    if (continueMode === "instagram") {
      const claimed = await claimPendingInstagram(accessToken);
      router.replace(`/onboarding/instagram/select?importSession=${encodeURIComponent(claimed.importSessionId)}`);
      return;
    }

    const { supabase } = await import("@/lib/supabase");
    const { data: loadedProfile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();
    let profile = loadedProfile;

    if (profileError) throw profileError;
    if (!profile) {
      const { data: created, error: createError } = await supabase
        .from("profiles")
        .insert({ id: userId, role: "cliente" })
        .select("role")
        .maybeSingle();
      if (createError) throw createError;
      profile = created;
    }

    const redirectPath = getRedirectByRole(profile?.role ?? "cliente");
    router.replace(forceSwitcher ? `${redirectPath}?openAccountSwitcher=1` : redirectPath);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const { supabase } = await import("@/lib/supabase");
      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError || !data.user || !data.session) throw signInError ?? new Error("No se pudo iniciar sesión.");
      localStorage.removeItem("clouva.switch_target");
      await redirectByRole(data.user.id, data.session.access_token, isAddAccountMode);
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : "No se pudo iniciar sesión.");
      setLoading(false);
    }
  };

  const handleGoogleCredential = async (response: { credential?: string }) => {
    setError(null);
    if (!response.credential) {
      setError("Google no devolvió una credencial válida.");
      return;
    }
    setLoading(true);
    try {
      const { supabase } = await import("@/lib/supabase");
      const { data, error: signInError } = await supabase.auth.signInWithIdToken({
        provider: "google",
        token: response.credential,
      });
      if (signInError || !data.user || !data.session) throw signInError ?? new Error("No se pudo iniciar sesión con Google.");
      localStorage.removeItem("clouva.switch_target");
      await redirectByRole(data.user.id, data.session.access_token, isAddAccountMode);
    } catch (googleError) {
      setError(googleError instanceof Error ? googleError.message : "No se pudo iniciar sesión con Google.");
      setLoading(false);
    }
  };

  useEffect(() => {
    handleGoogleCredentialRef.current = handleGoogleCredential;
  });

  useEffect(() => {
    if (!googleScriptReady || !GOOGLE_CLIENT_ID || checkingSession) return;
    const container = googleButtonRef.current;
    if (!container || !window.google) return;

    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (response) => handleGoogleCredentialRef.current(response),
    });

    window.google.accounts.id.renderButton(container, {
      type: "standard",
      theme: "filled_black",
      size: "large",
      shape: "pill",
      text: "continue_with",
      logo_alignment: "left",
      locale: "es",
      width: Math.min(400, container.offsetWidth || 400),
    });
  }, [googleScriptReady, checkingSession]);

  const onInstagram = async () => {
    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/integrations/instagram/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ returnPath: "/onboarding/instagram/select" }),
      });
      const payload = await readApiJson<{ authorizeUrl: string }>(response);
      window.location.assign(payload.authorizeUrl);
    } catch (instagramError) {
      setError(instagramError instanceof Error ? instagramError.message : "No se pudo abrir Instagram.");
      setLoading(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#05040a] px-4 py-10 text-white">
      {GOOGLE_CLIENT_ID ? (
        <Script
          src="https://accounts.google.com/gsi/client"
          strategy="afterInteractive"
          onLoad={() => setGoogleScriptReady(true)}
        />
      ) : null}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_5%,rgba(124,58,237,.32),transparent_38%),radial-gradient(circle_at_15%_80%,rgba(76,29,149,.22),transparent_35%)]" />
      <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.025)_1px,transparent_1px)] [background-size:44px_44px]" />

      <section className="relative w-full max-w-md rounded-[2rem] border border-white/10 bg-[#0b0913]/90 p-6 shadow-2xl shadow-violet-950/30 backdrop-blur-xl sm:p-8">
        <Link href="/" className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-violet-400/25 bg-violet-500/10 text-2xl font-bold text-violet-300">C</Link>
        <div className="mt-6 text-center">
          <h1 className="text-4xl font-bold tracking-[0.16em]">CLOUVA</h1>
          <p className="mt-3 text-sm text-white/55">Tu identidad. Tu perfil. Tu mundo.</p>
        </div>

        {checkingSession ? (
          <div className="mt-8 space-y-3">
            <div className="h-12 animate-pulse rounded-xl bg-white/10" />
            <div className="h-12 animate-pulse rounded-xl bg-white/10" />
            <div className="h-12 animate-pulse rounded-xl bg-white/10" />
          </div>
        ) : (
          <div className="mt-8 space-y-3">
            <div ref={googleButtonRef} className="flex min-h-[44px] w-full justify-center overflow-hidden rounded-xl [&>div]:!w-full" />
            <button disabled={loading} type="button" onClick={() => void onInstagram()} className="w-full rounded-xl bg-gradient-to-r from-fuchsia-600 via-violet-600 to-indigo-600 px-4 py-3.5 font-semibold text-white transition hover:brightness-110 disabled:opacity-60">Crear mi perfil con Instagram</button>
            <p className="text-center text-xs leading-5 text-white/40">Disponible para cuentas Creator y Business.</p>

            <div className="flex items-center gap-3 py-2 text-[10px] uppercase tracking-[0.2em] text-white/25"><span className="h-px flex-1 bg-white/10" />o con correo<span className="h-px flex-1 bg-white/10" /></div>
            <form onSubmit={onSubmit} className="space-y-3">
              <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Correo" className="w-full rounded-xl border border-white/15 bg-black/30 px-4 py-3 outline-none transition focus:border-violet-400/60" />
              <input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Contraseña" className="w-full rounded-xl border border-white/15 bg-black/30 px-4 py-3 outline-none transition focus:border-violet-400/60" />
              <button disabled={loading} className="w-full rounded-xl border border-white/15 px-4 py-3 font-medium transition hover:border-violet-400/60 disabled:opacity-60">{loading ? "Procesando..." : "Continuar con correo"}</button>
            </form>

            {error ? <p className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}
            <div className="flex justify-center gap-4 pt-2 text-xs text-white/40">
              <Link href="/registro" className="hover:text-white">Crear cuenta</Link>
              <Link href="/legal/privacy" className="hover:text-white">Privacidad</Link>
              <Link href="/legal/terms" className="hover:text-white">Términos</Link>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
