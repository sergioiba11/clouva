"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { normalizeRole, type Role } from "@/lib/auth";
import { saveAccount, setActiveAccountId } from "@/lib/account-switcher";

type Profile = {
  id: string;
  role: string | null;
  display_name?: string | null;
  full_name?: string | null;
  avatar_url?: string | null;
  avatar_3d_url?: string | null;
  spotify_url?: string | null;
  username?: string | null;
};

type AuthContextType = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  role: Role;
  loading: boolean;
  hydrationReady: boolean;
  profileReady: boolean;
  refreshSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AUTH_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = AUTH_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error(`${label} tardó demasiado`)), timeoutMs);
    }),
  ]);
}

async function ensureProfile(user: User): Promise<Profile | null> {
  const { supabase } = await import("@/lib/supabase");
  const displayName = (user.user_metadata?.full_name as string | undefined) ?? (user.email ? user.email.split("@")[0] : "Usuario") ?? "Usuario";
  const { data: existing } = await supabase.from("profiles").select("id, role, display_name").eq("id", user.id).maybeSingle();
  if (!existing) {
    const { data } = await supabase.from("profiles").insert({ id: user.id, role: "cliente", display_name: displayName }).select("id, role, display_name").maybeSingle();
    return data ?? null;
  }
  if (!existing.display_name) {
    const { data } = await supabase.from("profiles").update({ display_name: displayName }).eq("id", user.id).select("id, role, display_name").maybeSingle();
    return data ?? null;
  }
  return existing;
}

async function loadProfileByUserId(userId: string): Promise<Profile | null> {
  const { supabase } = await import("@/lib/supabase");
  const { data } = await supabase.from("profiles").select("id, role, display_name, full_name, avatar_url, avatar_3d_url, spotify_url, username").eq("id", userId).maybeSingle();
  return data ?? null;
}

function getPostAuthRedirect(roleValue: string | null | undefined) {
  return normalizeRole(roleValue) === "admin" ? "/admin" : "/mi-flow";
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<Role>("cliente");
  const [loading, setLoading] = useState(true);
  const [hydrationReady, setHydrationReady] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const oauthHashDetectedRef = useRef(false);

  useEffect(() => {
    let alive = true;
    let runId = 0;

    const resolveFromSession = async (nextSession: Session | null) => {
      const currentRun = ++runId;
      setSession(nextSession);
      setUser(nextSession?.user ?? null);

      if (!nextSession?.user) {
        if (!alive || currentRun !== runId) return;
        setProfile(null);
        setRole("cliente");
        setProfileReady(true);
        setLoading(false);
        return;
      }

      setLoading(true);
      setProfileReady(false);

      let profileData: Profile | null = null;
      try {
        await withTimeout(ensureProfile(nextSession.user), "Crear o validar el perfil");
        profileData = await withTimeout(loadProfileByUserId(nextSession.user.id), "Cargar el perfil");
      } catch (error) {
        console.error("Auth profile bootstrap failed", error);
        // La sesión sigue siendo válida aunque Supabase tarde o falle al leer profiles.
        // Dejamos entrar con rol cliente y permitimos que la app continúe cargando.
      }

      if (!alive || currentRun !== runId) return;

      if (oauthHashDetectedRef.current && !profileData) {
        oauthHashDetectedRef.current = false;
      }

      const nextRole = normalizeRole(profileData?.role);
      setProfile(profileData);
      setRole(nextRole);

      if (nextSession.user.email) {
        saveAccount({
          id: nextSession.user.id,
          email: nextSession.user.email,
          display_name: profileData?.full_name ?? profileData?.display_name ?? nextSession.user.email.split("@")[0],
          avatar_url: profileData?.avatar_url ?? null,
          role: nextRole,
        });
      }
      setActiveAccountId(nextSession.user.id);

      if (oauthHashDetectedRef.current) {
        const redirectPath = getPostAuthRedirect(profileData?.role);
        window.history.replaceState(null, "", redirectPath);
        oauthHashDetectedRef.current = false;
      }

      setProfileReady(true);
      setLoading(false);
    };

    const bootstrap = async () => {
      try {
        const { supabase } = await import("@/lib/supabase");

        if (typeof window !== "undefined" && window.location.hash.includes("access_token")) {
          oauthHashDetectedRef.current = true;
          const { data: callbackData } = await withTimeout(supabase.auth.getSession(), "Leer callback de acceso");
          if (!callbackData.session?.user) {
            oauthHashDetectedRef.current = false;
            window.history.replaceState(null, "", "/login?error=auth_callback");
            return;
          }
          await withTimeout(supabase.auth.refreshSession(), "Actualizar sesión");
        }

        const { data } = await withTimeout(supabase.auth.getSession(), "Cargar sesión");
        if (!alive) return;
        setHydrationReady(true);
        await resolveFromSession(data.session ?? null);

        const { data: subscription } = supabase.auth.onAuthStateChange((event, nextSession) => {
          if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "TOKEN_REFRESHED") {
            void resolveFromSession(nextSession ?? null);
          }
        });

        return () => subscription.subscription.unsubscribe();
      } catch (error) {
        console.error("Auth bootstrap failed", error);
        if (!alive) return;
        setSession(null);
        setUser(null);
        setProfile(null);
        setRole("cliente");
      } finally {
        if (alive) {
          setHydrationReady(true);
          setProfileReady(true);
          setLoading(false);
        }
      }
    };

    let unsub: (() => void) | undefined;
    void bootstrap().then((u) => {
      unsub = u;
    });

    return () => {
      alive = false;
      unsub?.();
    };
  }, []);

  const refreshSession = async () => {
    const { supabase } = await import("@/lib/supabase");
    await withTimeout(supabase.auth.refreshSession(), "Actualizar sesión");
    const { data } = await withTimeout(supabase.auth.getSession(), "Leer sesión actualizada");
    setSession(data.session ?? null);
    setUser(data.session?.user ?? null);
  };

  const value = useMemo(
    () => ({ session, user, profile, role, loading, hydrationReady, profileReady, refreshSession }),
    [session, user, profile, role, loading, hydrationReady, profileReady],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
