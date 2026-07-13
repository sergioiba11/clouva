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
      await ensureProfile(nextSession.user);
      const profileData = await loadProfileByUserId(nextSession.user.id);
      if (!alive || currentRun !== runId) return;
      if (oauthHashDetectedRef.current && !profileData) {
        setProfile(null);
        setRole("cliente");
        setProfileReady(true);
        setLoading(false);
        oauthHashDetectedRef.current = false;
        window.history.replaceState(null, "", "/login?error=auth_callback");
        return;
      }

      const nextRole = normalizeRole(profileData?.role);
      setProfile(profileData);
      setRole(nextRole);
      if (nextSession.user.email) {
        saveAccount({ id: nextSession.user.id, email: nextSession.user.email, display_name: profileData?.full_name ?? profileData?.display_name ?? nextSession.user.email.split("@")[0], avatar_url: profileData?.avatar_url ?? null, role: nextRole });
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
      const { supabase } = await import("@/lib/supabase");

      if (typeof window !== "undefined" && window.location.hash.includes("access_token")) {
        oauthHashDetectedRef.current = true;
        const { data: callbackData } = await supabase.auth.getSession();
        if (!callbackData.session?.user) {
          oauthHashDetectedRef.current = false;
          window.history.replaceState(null, "", "/login?error=auth_callback");
          setHydrationReady(true);
          setProfileReady(true);
          setLoading(false);
          return;
        }
        await supabase.auth.refreshSession();
      }

      const timeoutId = setTimeout(() => {
        if (!alive) return;
        setHydrationReady(true);
        setProfileReady(true);
        setLoading(false);
      }, 5000);

      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      setHydrationReady(true);
      clearTimeout(timeoutId);
      await resolveFromSession(data.session ?? null);

      const { data: subscription } = supabase.auth.onAuthStateChange((event, nextSession) => {
        if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "TOKEN_REFRESHED") {
          void resolveFromSession(nextSession ?? null);
        }
      });

      return () => subscription.subscription.unsubscribe();
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
    await supabase.auth.refreshSession();
    const { data } = await supabase.auth.getSession();
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
