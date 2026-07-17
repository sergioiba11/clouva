"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
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
const AUTH_TIMEOUT_MS = 10000;
const PROFILE_COLUMNS = "id, role, display_name, full_name, avatar_url, avatar_3d_url, spotify_url, username";

function withTimeout<T>(promise: PromiseLike<T>, label: string, timeoutMs = AUTH_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error(`${label} tardó demasiado`)), timeoutMs);
    }),
  ]);
}

function defaultDisplayName(user: User) {
  return (
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    (user.email ? user.email.split("@")[0] : "Usuario")
  );
}

async function loadOrCreateProfile(user: User): Promise<Profile> {
  const { supabase } = await import("@/lib/supabase");
  const name = defaultDisplayName(user);

  const existing = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", user.id)
    .maybeSingle();

  if (existing.error) throw existing.error;

  if (!existing.data) {
    const created = await supabase
      .from("profiles")
      .insert({
        id: user.id,
        role: "cliente",
        display_name: name,
        full_name: name,
      })
      .select(PROFILE_COLUMNS)
      .single();
    if (created.error || !created.data) throw created.error ?? new Error("No se pudo crear el perfil");
    return created.data as Profile;
  }

  if (!existing.data.display_name || !existing.data.full_name) {
    const updated = await supabase
      .from("profiles")
      .update({
        display_name: existing.data.display_name || name,
        full_name: existing.data.full_name || name,
      })
      .eq("id", user.id)
      .select(PROFILE_COLUMNS)
      .single();
    if (updated.error || !updated.data) throw updated.error ?? new Error("No se pudo completar el perfil");
    return updated.data as Profile;
  }

  return existing.data as Profile;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<Role>("cliente");
  const [loading, setLoading] = useState(true);
  const [hydrationReady, setHydrationReady] = useState(false);
  const [profileReady, setProfileReady] = useState(false);

  const profileRef = useRef<Profile | null>(null);
  const resolvedUserIdRef = useRef<string | null>(null);
  const pendingUserIdRef = useRef<string | null>(null);
  const runRef = useRef(0);

  useEffect(() => {
    let alive = true;
    let unsubscribe: (() => void) | undefined;

    const clearAuth = () => {
      runRef.current += 1;
      pendingUserIdRef.current = null;
      resolvedUserIdRef.current = null;
      profileRef.current = null;
      setSession(null);
      setUser(null);
      setProfile(null);
      setRole("cliente");
      setProfileReady(true);
      setLoading(false);
    };

    const resolveSession = async (nextSession: Session | null, event: AuthChangeEvent | "INITIAL_SESSION") => {
      if (!alive) return;

      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setHydrationReady(true);

      const nextUser = nextSession?.user;
      if (!nextUser) {
        clearAuth();
        setHydrationReady(true);
        return;
      }

      const userId = nextUser.id;

      // Renovar el token no debe volver a borrar ni recargar un perfil que ya está listo.
      if (resolvedUserIdRef.current === userId && profileRef.current?.id === userId) {
        setProfile(profileRef.current);
        setRole(normalizeRole(profileRef.current.role));
        setProfileReady(true);
        setLoading(false);
        return;
      }

      // Supabase puede emitir SIGNED_IN y TOKEN_REFRESHED casi juntos. Si el mismo
      // usuario ya se está cargando, conservamos esa tarea en vez de cancelarla.
      if (pendingUserIdRef.current === userId) return;

      const runId = ++runRef.current;
      pendingUserIdRef.current = userId;
      setLoading(true);
      setProfileReady(false);

      try {
        const profileData = await withTimeout(loadOrCreateProfile(nextUser), "Cargar el perfil de CLOUVA");
        if (!alive || runId !== runRef.current) return;

        profileRef.current = profileData;
        resolvedUserIdRef.current = userId;
        const nextRole = normalizeRole(profileData.role);
        setProfile(profileData);
        setRole(nextRole);

        if (nextUser.email) {
          saveAccount({
            id: userId,
            email: nextUser.email,
            display_name: profileData.full_name ?? profileData.display_name ?? nextUser.email.split("@")[0],
            avatar_url: profileData.avatar_url ?? null,
            role: nextRole,
          });
        }
        setActiveAccountId(userId);
      } catch (error) {
        console.error(`Auth profile bootstrap failed during ${event}`, error);
        if (!alive || runId !== runRef.current) return;
        profileRef.current = null;
        resolvedUserIdRef.current = userId;
        setProfile(null);
        setRole("cliente");
      } finally {
        if (pendingUserIdRef.current === userId) pendingUserIdRef.current = null;
        if (alive && runId === runRef.current) {
          setProfileReady(true);
          setLoading(false);
        }
      }
    };

    const bootstrap = async () => {
      try {
        const { supabase } = await import("@/lib/supabase");
        const sessionResult = await withTimeout(supabase.auth.getSession(), "Cargar sesión");
        if (!alive) return;

        await resolveSession(sessionResult.data.session ?? null, "INITIAL_SESSION");

        const subscription = supabase.auth.onAuthStateChange((event, nextSession) => {
          if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
            void resolveSession(nextSession ?? null, event);
          }
        });
        unsubscribe = () => subscription.data.subscription.unsubscribe();
      } catch (error) {
        console.error("Auth bootstrap failed", error);
        if (!alive) return;
        clearAuth();
        setHydrationReady(true);
      }
    };

    void bootstrap();

    return () => {
      alive = false;
      runRef.current += 1;
      unsubscribe?.();
    };
  }, []);

  const refreshSession = async () => {
    const { supabase } = await import("@/lib/supabase");
    const refreshed = await withTimeout(supabase.auth.refreshSession(), "Actualizar sesión");
    if (refreshed.error) throw refreshed.error;
    setSession(refreshed.data.session ?? null);
    setUser(refreshed.data.session?.user ?? null);
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
