"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
const MOBILE_CALLBACK = "clouvacontrol://auth/callback";

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

function callbackWithSession(session: Session) {
  const hash = new URLSearchParams({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  return `${MOBILE_CALLBACK}#${hash.toString()}`;
}

export default function ClouvaControlLoginPage() {
  const [scriptReady, setScriptReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLDivElement>(null);
  const credentialHandlerRef = useRef<(response: { credential?: string }) => void>(() => undefined);

  async function handleCredential(response: { credential?: string }) {
    setError(null);
    if (!response.credential) {
      setError("Google no devolvió una credencial válida.");
      return;
    }

    setBusy(true);
    try {
      const { supabase } = await import("@/lib/supabase");
      const signedIn = await supabase.auth.signInWithIdToken({
        provider: "google",
        token: response.credential,
      });
      if (signedIn.error || !signedIn.data.session) {
        throw signedIn.error ?? new Error("No se pudo crear la sesión de CLOUVA.");
      }

      const validation = await fetch("/api/admin/clouva-control/overview", {
        headers: { Authorization: `Bearer ${signedIn.data.session.access_token}` },
        cache: "no-store",
      });
      if (!validation.ok) {
        await supabase.auth.signOut();
        throw new Error("Esta cuenta no tiene acceso administrativo a CLOUVA CONTROL.");
      }

      window.location.replace(callbackWithSession(signedIn.data.session));
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "No se pudo iniciar sesión.");
      setBusy(false);
    }
  }

  useEffect(() => {
    credentialHandlerRef.current = handleCredential;
  });

  useEffect(() => {
    if (!scriptReady || !GOOGLE_CLIENT_ID || !buttonRef.current || !window.google) return;
    const container = buttonRef.current;
    container.replaceChildren();
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (response) => credentialHandlerRef.current(response),
    });
    window.google.accounts.id.renderButton(container, {
      type: "standard",
      theme: "filled_black",
      size: "large",
      shape: "pill",
      text: "continue_with",
      logo_alignment: "left",
      locale: "es",
      width: Math.min(360, container.offsetWidth || 360),
    });
  }, [scriptReady]);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#07060d] px-5 py-10 text-white">
      {GOOGLE_CLIENT_ID ? (
        <Script
          src="https://accounts.google.com/gsi/client"
          strategy="afterInteractive"
          onLoad={() => setScriptReady(true)}
        />
      ) : null}

      <div className="absolute -right-28 -top-40 h-96 w-96 rounded-full bg-violet-700/25 blur-2xl" />
      <section className="relative w-full max-w-md rounded-[2rem] border border-violet-300/15 bg-[#100d1c]/95 p-7 shadow-2xl shadow-violet-950/30">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-500 text-3xl font-black">C</div>
        <p className="mt-7 text-xs font-semibold uppercase tracking-[0.22em] text-violet-300/80">Acceso móvil seguro</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight">CLOUVA CONTROL</h1>
        <p className="mt-4 leading-7 text-white/55">Ingresá con la misma cuenta Google administradora de CLOUVA. Al terminar, esta pantalla vuelve directamente a la aplicación.</p>

        <div className="mt-8 min-h-12">
          {GOOGLE_CLIENT_ID ? (
            <div ref={buttonRef} className={busy ? "pointer-events-none opacity-50" : ""} />
          ) : (
            <p className="rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">Falta configurar el cliente web de Google.</p>
          )}
        </div>

        {busy ? <p className="mt-4 text-sm text-violet-200">Validando tu acceso administrativo…</p> : null}
        {error ? <p className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}</p> : null}
        <p className="mt-7 text-xs leading-5 text-white/35">La app recibe una sesión de usuario. Las claves administrativas no se transfieren ni se incluyen en el APK.</p>
      </section>
    </main>
  );
}
