"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Script from "next/script";
import { useRouter, useSearchParams } from "next/navigation";
import { ClouvaBoot } from "@/components/clouva/ClouvaBoot";
import { ClouvaUniverseBackground } from "@/components/clouva/ClouvaUniverseBackground";
import { OfficialClouvaMark } from "@/components/clouva/OfficialClouvaMark";
import { getRedirectByRole } from "@/lib/auth";
import { useAuth } from "@/components/auth-provider";
import { readApiJson } from "@/lib/authenticated-fetch";
import type { User } from "@supabase/supabase-js";

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

function clouvaIdForUser(userId: string) {
  return `CLV-${userId.replaceAll("-", "").slice(0, 10)}`;
}

const SLUG_PARAM_RE = /^[a-z0-9-]{1,80}$/i;

// A visitor who clicked "Unirme gratis"/"Ser socio" on a studio's public page
// (StudioMembershipCheckoutAction) while logged out lands here with
// ?studio=&intent=&plan= -- this sends them straight back to that studio's
// checkout instead of the normal role-home/onboarding destination, without
// skipping resolvePostLoginDestination()'s profile-bootstrap side effect.
// Only ever builds an internal /studios/... path, never an arbitrary URL.
function studioRedirectOverride(searchParams: ReturnType<typeof useSearchParams>) {
  const studio = searchParams.get("studio");
  const intent = searchParams.get("intent");
  if (!studio || !SLUG_PARAM_RE.test(studio) || (intent !== "join" && intent !== "subscribe")) return null;
  const plan = searchParams.get("plan");
  const query = intent === "subscribe" && plan && SLUG_PARAM_RE.test(plan) ? `?plan=${encodeURIComponent(plan)}` : "";
  return `/studios/${encodeURIComponent(studio)}/checkout${query}`;
}

function userDisplayName(user: User) {
  return (
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    user.email?.split("@")[0] ??
    "Usuario"
  );
}

function firstName(user: User) {
  return userDisplayName(user).trim().split(/\s+/)[0] || "Usuario";
}

async function resolvePostLoginDestination(user: User) {
  const { supabase } = await import("@/lib/supabase");
  const { data: loadedProfile, error: profileError } = await supabase
    .from("profiles")
    .select("role,onboarding_status")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) throw profileError;

  let profile = loadedProfile;
  if (!profile) {
    const name = userDisplayName(user);
    const { data: created, error: createError } = await supabase
      .from("profiles")
      .insert({
        id: user.id,
        role: "customer",
        role_v2: "cliente",
        display_name: name,
        full_name: name,
        email: user.email ?? null,
        clouva_id: clouvaIdForUser(user.id),
        onboarding_status: "pending",
      })
      .select("role,onboarding_status")
      .single();
    if (createError) throw createError;
    profile = created;
  }

  if (profile?.onboarding_status === "pending") return "/onboarding/identity";
  if (profile?.onboarding_status === "exploring") return "/";
  if (profile?.onboarding_status === "player_created") return "/onboarding/instagram";
  if (profile?.onboarding_status === "published") return getRedirectByRole(profile.role);

  const { data: player, error: playerError } = await supabase
    .from("players")
    .select("id,is_published")
    .eq("owner_user_id", user.id)
    .maybeSingle();
  if (playerError) throw playerError;
  if (!player) return "/onboarding/identity";
  return player.is_published ? getRedirectByRole(profile?.role) : "/onboarding/instagram";
}

export default function LoginContent() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [googleScriptReady, setGoogleScriptReady] = useState(false);
  const [postAuthName, setPostAuthName] = useState<string | null>(null);
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const handleGoogleCredentialRef = useRef<(response: { credential?: string }) => void>(() => {});
  const router = useRouter();
  const searchParams = useSearchParams();
  const isAddAccountMode = useMemo(() => searchParams.get("addAccount") === "1", [searchParams]);
  const continueMode = useMemo(() => searchParams.get("continue"), [searchParams]);
  const { user, session, loading: authLoading, hydrationReady } = useAuth();

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
      try {
        const defaultDestination = await resolvePostLoginDestination(user);
        const destination = studioRedirectOverride(searchParams) ?? defaultDestination;
        if (!cancelled) router.replace(destination);
      } catch (destinationError) {
        if (!cancelled) {
          setError(destinationError instanceof Error ? destinationError.message : "No se pudo abrir tu cuenta.");
          setCheckingSession(false);
        }
      }
    };

    void resolveLoginScreen();
    return () => {
      cancelled = true;
      window.clearTimeout(releaseTimer);
    };
  }, [authLoading, continueMode, hydrationReady, isAddAccountMode, router, session, user]);

  const redirectAfterLogin = async (authUser: User, accessToken: string, forceSwitcher = false) => {
    if (continueMode === "instagram") {
      const claimed = await claimPendingInstagram(accessToken);
      router.replace(`/onboarding/instagram/select?importSession=${encodeURIComponent(claimed.importSessionId)}`);
      return;
    }

    const defaultRedirectPath = await resolvePostLoginDestination(authUser);
    const studioOverride = studioRedirectOverride(searchParams);
    if (studioOverride) {
      router.replace(studioOverride);
      return;
    }
    const redirectPath = defaultRedirectPath;
    const shouldOpenSwitcher = forceSwitcher && !redirectPath.startsWith("/onboarding") && redirectPath !== "/matrix";
    router.replace(shouldOpenSwitcher ? `${redirectPath}?openAccountSwitcher=1` : redirectPath);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setPostAuthName(null);
    setLoading(true);

    try {
      const { supabase } = await import("@/lib/supabase");
      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError || !data.user || !data.session) throw signInError ?? new Error("No se pudo iniciar sesión.");
      localStorage.removeItem("clouva.switch_target");
      setPostAuthName(firstName(data.user));
      await redirectAfterLogin(data.user, data.session.access_token, isAddAccountMode);
    } catch (signInError) {
      setPostAuthName(null);
      setError(signInError instanceof Error ? signInError.message : "No se pudo iniciar sesión.");
      setLoading(false);
    }
  };

  const handleGoogleCredential = async (response: { credential?: string }) => {
    setError(null);
    setPostAuthName(null);
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
      setPostAuthName(firstName(data.user));
      await redirectAfterLogin(data.user, data.session.access_token, isAddAccountMode);
    } catch (googleError) {
      setPostAuthName(null);
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
      theme: "outline",
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

  if (postAuthName) {
    return (
      <ClouvaBoot
        showWorld
        prominentTitle
        title={`Bienvenido, ${postAuthName}`}
        subtitle="Preparando tu universo..."
      />
    );
  }

  if (checkingSession) {
    return (
      <ClouvaBoot
        showWorld
        prominentTitle={Boolean(user)}
        title={user ? `Bienvenido, ${firstName(user)}` : "CLOUVA"}
        subtitle={user ? "Preparando tu universo..." : "Comprobando tu acceso..."}
      />
    );
  }

  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-[#020106] px-4 py-8 text-white sm:px-6 sm:py-10">
      {GOOGLE_CLIENT_ID ? (
        <Script
          src="https://accounts.google.com/gsi/client"
          strategy="afterInteractive"
          onLoad={() => setGoogleScriptReady(true)}
        />
      ) : null}

      <ClouvaUniverseBackground variant="access" />

      <section className="relative z-10 my-auto w-full max-w-[480px] animate-[clouvaPortalIn_.42s_ease-out] rounded-[1.75rem] border border-violet-200/15 bg-[linear-gradient(180deg,rgba(12,8,24,.88),rgba(5,3,12,.93))] p-5 shadow-[0_28px_90px_rgba(0,0,0,.62),0_0_70px_rgba(113,43,255,.12)] backdrop-blur-2xl motion-reduce:animate-none sm:p-7">
        <div className="pointer-events-none absolute inset-x-14 -top-px h-px bg-gradient-to-r from-transparent via-violet-300/55 to-transparent" aria-hidden="true" />

        <Link href="/" className="mx-auto grid h-[68px] w-[68px] place-items-center" aria-label="Volver a CLOUVA">
          <OfficialClouvaMark
            tone="light"
            alt="CLOUVA"
            width={64}
            height={64}
            className="h-16 w-16 drop-shadow-[0_0_22px_rgba(180,110,255,.62)] transition hover:brightness-125"
          />
        </Link>

        <div className="mt-4 text-center">
          <p className="text-[10px] font-semibold uppercase tracking-[0.42em] text-violet-200/75">CLOUVA</p>
          <h1 className="mt-3 text-[clamp(1.75rem,7vw,2.35rem)] font-semibold tracking-[-0.035em]">Entrá a tu universo</h1>
          <p className="mt-2 text-sm text-white/55">Tu identidad. Tu Player. Tu mundo.</p>
        </div>

        <div className="mt-7 space-y-4">
          <div ref={googleButtonRef} className="flex min-h-[44px] w-full justify-center overflow-hidden rounded-full [&>div]:!w-full" />

          <div className="flex items-center gap-3 py-1 text-[9px] uppercase tracking-[0.24em] text-white/30">
            <span className="h-px flex-1 bg-white/10" />
            o con correo
            <span className="h-px flex-1 bg-white/10" />
          </div>

          <form onSubmit={onSubmit} className="space-y-3">
            <label className="sr-only" htmlFor="clouva-login-email">Correo</label>
            <input
              id="clouva-login-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Correo"
              className="min-h-12 w-full rounded-2xl border border-white/10 bg-black/35 px-4 text-[15px] text-white outline-none transition placeholder:text-white/35 hover:border-white/20 focus:border-violet-300/60 focus:shadow-[0_0_0_3px_rgba(139,92,246,.10)]"
            />

            <div className="relative">
              <label className="sr-only" htmlFor="clouva-login-password">Contraseña</label>
              <input
                id="clouva-login-password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Contraseña"
                className="min-h-12 w-full rounded-2xl border border-white/10 bg-black/35 px-4 pr-16 text-[15px] text-white outline-none transition placeholder:text-white/35 hover:border-white/20 focus:border-violet-300/60 focus:shadow-[0_0_0_3px_rgba(139,92,246,.10)]"
              />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                className="absolute inset-y-0 right-3 my-auto h-9 rounded-lg px-2 text-xs font-medium text-violet-200/70 transition hover:text-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60"
                aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              >
                {showPassword ? "Ocultar" : "Ver"}
              </button>
            </div>

            <button
              disabled={loading}
              className="min-h-12 w-full rounded-2xl border border-violet-200/25 bg-[linear-gradient(135deg,rgba(106,42,216,.96),rgba(130,55,246,.96),rgba(89,40,194,.96))] px-4 font-semibold text-white shadow-[0_12px_36px_rgba(87,34,184,.25)] transition hover:-translate-y-0.5 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/70 disabled:translate-y-0 disabled:cursor-wait disabled:opacity-60"
            >
              {loading ? "Procesando..." : "Entrar"}
            </button>
          </form>

          <p className="text-center text-xs text-white/45">
            ¿No tenés cuenta?{" "}
            <Link
              href={searchParams.toString() ? `/registro?${searchParams.toString()}` : "/registro"}
              className="font-medium text-violet-200 transition hover:text-white"
            >
              Crear cuenta
            </Link>
          </p>

          {error ? (
            <p role="alert" className="rounded-2xl border border-red-300/20 bg-red-400/[.08] px-4 py-3 text-sm leading-5 text-red-100">
              {error}
            </p>
          ) : null}

          <div className="border-t border-white/[.08] pt-5">
            <div className="rounded-2xl border border-violet-300/10 bg-violet-300/[.035] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-violet-200/70">Creá tu Player desde Instagram</p>
              <p className="mt-2 text-xs leading-5 text-white/45">Importá tu identidad y contenido para empezar.</p>
              <button
                disabled={loading}
                type="button"
                onClick={() => void onInstagram()}
                className="mt-3 min-h-11 w-full rounded-xl border border-violet-200/20 bg-black/25 px-4 text-sm font-semibold text-violet-100 transition hover:border-violet-200/40 hover:bg-violet-400/[.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60 disabled:cursor-wait disabled:opacity-50"
              >
                Importar desde Instagram
              </button>
              <p className="mt-2 text-center text-[10px] leading-4 text-white/30">Disponible para cuentas Creator y Business.</p>
            </div>
          </div>

          <div className="flex items-center justify-center gap-4 pt-1 text-[11px] text-white/35">
            <Link href="/legal/privacy" className="transition hover:text-white">Privacidad</Link>
            <span aria-hidden="true">·</span>
            <Link href="/legal/terms" className="transition hover:text-white">Términos</Link>
          </div>
        </div>
      </section>

      <style jsx global>{`
        @keyframes clouvaPortalIn {
          from {
            opacity: 0;
            transform: scale(0.98) translateY(8px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
      `}</style>
    </main>
  );
}