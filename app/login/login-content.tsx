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

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-current">
      <path d="M13.7 22v-9h3l.45-3.5H13.7V7.3c0-1.01.28-1.7 1.74-1.7h1.86V2.47c-.32-.04-1.43-.14-2.72-.14-2.7 0-4.55 1.65-4.55 4.68V9.5H7v3.5h3.03v9h3.67Z" />
    </svg>
  );
}

function TikTokIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-current">
      <path d="M14.2 2h3.05c.2 1.65 1.12 3.1 2.55 3.96A6.2 6.2 0 0 0 22 6.8v3.12a9.2 9.2 0 0 1-4.74-1.48v7.3A6.26 6.26 0 1 1 11 9.48c.42 0 .84.04 1.24.12v3.18a3.2 3.2 0 1 0 2 2.96L14.2 2Z" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.2 2.8 10 7.4 8.3 9.1c1.45 2.85 3.75 5.15 6.6 6.6l1.7-1.7 4.6 2.8v2.25A2.95 2.95 0 0 1 18.25 22C9.28 22 2 14.72 2 5.75A2.95 2.95 0 0 1 4.95 2.8H7.2Z" />
    </svg>
  );
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
  const [phoneMode, setPhoneMode] = useState(false);
  const [phone, setPhone] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneCodeSent, setPhoneCodeSent] = useState(false);
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
  }, [authLoading, continueMode, hydrationReady, isAddAccountMode, router, searchParams, session, user]);

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

    container.innerHTML = "";
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (response) => handleGoogleCredentialRef.current(response),
    });

    window.google.accounts.id.renderButton(container, {
      type: "icon",
      theme: "outline",
      size: "large",
      shape: "square",
      locale: "es",
    });
  }, [googleScriptReady, checkingSession]);

  const onFacebook = async () => {
    setError(null);
    setLoading(true);
    try {
      const { supabase } = await import("@/lib/supabase");
      const redirectTo = `${window.location.origin}/auth/callback`;
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "facebook",
        options: { redirectTo },
      });
      if (oauthError) throw oauthError;
    } catch (facebookError) {
      setError(facebookError instanceof Error ? facebookError.message : "No se pudo iniciar sesión con Facebook.");
      setLoading(false);
    }
  };

  const onTikTok = () => {
    setError("TikTok ya está contemplado como acceso, pero falta habilitar sus credenciales OAuth en CLOUVA para activarlo sin simular un login.");
  };

  const onPhoneStart = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { supabase } = await import("@/lib/supabase");
      const { error: otpError } = await supabase.auth.signInWithOtp({ phone: phone.trim() });
      if (otpError) throw otpError;
      setPhoneCodeSent(true);
    } catch (phoneError) {
      setError(phoneError instanceof Error ? phoneError.message : "No se pudo enviar el código por SMS.");
    } finally {
      setLoading(false);
    }
  };

  const onPhoneVerify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { supabase } = await import("@/lib/supabase");
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        phone: phone.trim(),
        token: phoneCode.trim(),
        type: "sms",
      });
      if (verifyError || !data.user || !data.session) throw verifyError ?? new Error("No se pudo verificar el código.");
      localStorage.removeItem("clouva.switch_target");
      setPostAuthName(firstName(data.user));
      await redirectAfterLogin(data.user, data.session.access_token, isAddAccountMode);
    } catch (phoneError) {
      setPostAuthName(null);
      setError(phoneError instanceof Error ? phoneError.message : "No se pudo iniciar sesión con teléfono.");
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
          <p className="mt-2 text-sm text-white/55">Elegí cómo entrar. Después conectás tu universo.</p>
        </div>

        <div className="mt-7 space-y-4">
          <div className="grid grid-cols-4 gap-2" aria-label="Métodos de acceso">
            <div className="flex min-h-12 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/[.04] transition hover:border-white/20 hover:bg-white/[.07]">
              <div ref={googleButtonRef} className="grid h-10 w-10 place-items-center overflow-hidden" />
            </div>

            <button
              type="button"
              disabled={loading}
              onClick={() => void onFacebook()}
              className="flex min-h-12 items-center justify-center rounded-xl border border-white/10 bg-[#1877F2] text-white transition hover:-translate-y-0.5 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/70 disabled:translate-y-0 disabled:cursor-wait disabled:opacity-50"
              aria-label="Continuar con Facebook"
              title="Facebook"
            >
              <FacebookIcon />
            </button>

            <button
              type="button"
              onClick={onTikTok}
              className="relative flex min-h-12 items-center justify-center rounded-xl border border-white/10 bg-black text-white transition hover:-translate-y-0.5 hover:border-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
              aria-label="Continuar con TikTok"
              title="TikTok"
            >
              <TikTokIcon />
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-violet-400" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => {
                setPhoneMode((visible) => !visible);
                setError(null);
              }}
              className={`flex min-h-12 items-center justify-center rounded-xl border text-white transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/70 ${phoneMode ? "border-violet-300/45 bg-violet-500/20" : "border-white/10 bg-white/[.04] hover:border-white/20 hover:bg-white/[.07]"}`}
              aria-label="Continuar con teléfono"
              aria-pressed={phoneMode}
              title="Teléfono"
            >
              <PhoneIcon />
            </button>
          </div>

          <div className="grid grid-cols-4 gap-2 text-center text-[9px] font-medium uppercase tracking-[0.08em] text-white/35" aria-hidden="true">
            <span>Google</span>
            <span>Facebook</span>
            <span>TikTok</span>
            <span>Teléfono</span>
          </div>

          {phoneMode ? (
            phoneCodeSent ? (
              <form onSubmit={onPhoneVerify} className="space-y-3 rounded-2xl border border-violet-300/15 bg-violet-400/[.05] p-3">
                <p className="text-xs leading-5 text-white/55">Ingresá el código que enviamos a <span className="text-white/80">{phone}</span>.</p>
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  value={phoneCode}
                  onChange={(event) => setPhoneCode(event.target.value)}
                  placeholder="Código SMS"
                  className="min-h-11 w-full rounded-xl border border-white/10 bg-black/35 px-4 text-sm text-white outline-none placeholder:text-white/30 focus:border-violet-300/60"
                />
                <button disabled={loading} className="min-h-11 w-full rounded-xl bg-white px-4 text-sm font-semibold text-black transition hover:bg-violet-100 disabled:cursor-wait disabled:opacity-60">
                  {loading ? "Verificando..." : "Verificar y entrar"}
                </button>
              </form>
            ) : (
              <form onSubmit={onPhoneStart} className="space-y-3 rounded-2xl border border-violet-300/15 bg-violet-400/[.05] p-3">
                <p className="text-xs leading-5 text-white/55">Ingresá tu número con código de país. Ejemplo Argentina: +54...</p>
                <input
                  type="tel"
                  autoComplete="tel"
                  required
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="+54 9 11..."
                  className="min-h-11 w-full rounded-xl border border-white/10 bg-black/35 px-4 text-sm text-white outline-none placeholder:text-white/30 focus:border-violet-300/60"
                />
                <button disabled={loading} className="min-h-11 w-full rounded-xl bg-white px-4 text-sm font-semibold text-black transition hover:bg-violet-100 disabled:cursor-wait disabled:opacity-60">
                  {loading ? "Enviando..." : "Enviar código"}
                </button>
              </form>
            )
          ) : null}

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

          <div className="border-t border-white/[.08] pt-4 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-200/65">Después de entrar</p>
            <p className="mt-1 text-xs leading-5 text-white/40">Conectá Instagram, TikTok, YouTube, Kick y Spotify a tu identidad CLOUVA.</p>
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
