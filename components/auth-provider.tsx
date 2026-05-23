"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { normalizeRole, type Role } from "@/lib/auth";
import { saveAccount, setActiveAccountId } from "@/lib/account-switcher";

type Profile = {
  id: string;
  role: string | null;
  display_name?: string | null;
  full_name?: string | null;
  avatar_url?: string | null;
};

type AuthContextType = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  role: Role;
  loading: boolean;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const authDebugEnabled = process.env.NEXT_PUBLIC_DEBUG_AUTH === "1";

function authDebugLog(message: string, payload?: Record<string, unknown>) {
  if (!authDebugEnabled) return;
  console.debug(`[auth-debug] ${message}`, payload ?? {});
}

async function ensureProfile(user: User): Promise<Profile | null> {
  const { supabase } = await import("@/lib/supabase");
  const displayName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.email ? user.email.split("@")[0] : "Usuario") ??
    "Usuario";

  const { data: existing } = await supabase
    .from("profiles")
    .select("id, role, display_name")
    .eq("id", user.id)
    .maybeSingle();

  if (!existing) {
    const { data } = await supabase
      .from("profiles")
      .insert({ id: user.id, role: "cliente", display_name: displayName })
      .select("id, role, display_name")
      .maybeSingle();
    return data ?? null;
  }

  const updates: { display_name?: string } = {};
  if (!existing.display_name && displayName) updates.display_name = displayName;

  if (Object.keys(updates).length > 0) {
    const { data } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", user.id)
      .select("id, role, display_name")
      .maybeSingle();
    return data ?? null;
  }

  return {
    id: existing.id,
    role: existing.role,
    display_name: existing.display_name,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<Role>("cliente");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    let authRunId = 0;

    const bootstrap = async () => {
      const { supabase } = await import("@/lib/supabase");
      const { data } = await supabase.auth.getSession();
      const nextSession = data.session ?? null;
      authDebugLog("bootstrap:getSession", {
        hasSession: Boolean(nextSession),
        userId: nextSession?.user?.id ?? null,
        email: nextSession?.user?.email ?? null,
      });

      if (!alive) return;

      setSession(nextSession);
      setUser(nextSession?.user ?? null);

      if (nextSession?.user) {
        const currentRun = ++authRunId;
        const profileData = await ensureProfile(nextSession.user);
        if (!alive || currentRun !== authRunId) return;
        setProfile(profileData);
        const nextRole = normalizeRole(profileData?.role);
        setRole(nextRole);
        authDebugLog("bootstrap:profileResolved", {
          userId: nextSession.user.id,
          email: nextSession.user.email ?? null,
          profile: profileData,
          detectedRole: nextRole,
          canAccessAdmin: nextRole === "admin",
        });
        if (nextSession.user.email) saveAccount({ id: nextSession.user.id, email: nextSession.user.email, display_name: profileData?.full_name ?? profileData?.display_name ?? nextSession.user.email.split("@")[0], avatar_url: profileData?.avatar_url ?? null, role: nextRole });
        setActiveAccountId(nextSession.user.id);
      } else {
        setProfile(null);
        setRole("cliente");
        authDebugLog("bootstrap:noUser");
      }

      setLoading(false);
    };

    void bootstrap();

    let unsub: (() => void) | null = null;
    import("@/lib/supabase").then(({ supabase }) => {
      const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
        authDebugLog("onAuthStateChange", {
          event: _event,
          hasSession: Boolean(nextSession),
          userId: nextSession?.user?.id ?? null,
          email: nextSession?.user?.email ?? null,
        });
        setSession(nextSession);
        setUser(nextSession?.user ?? null);
        if (!nextSession?.user) {
          setProfile(null);
          setRole("cliente");
          setLoading(false);
          return;
        }

        setLoading(true);
        const currentRun = ++authRunId;
        void ensureProfile(nextSession.user).then((profileData) => {
          if (!alive || currentRun !== authRunId) return;
          setProfile(profileData);
          const nextRole = normalizeRole(profileData?.role);
          setRole(nextRole);
          authDebugLog("onAuthStateChange:profileResolved", {
            userId: nextSession.user.id,
            email: nextSession.user.email ?? null,
            profile: profileData,
            detectedRole: nextRole,
            canAccessAdmin: nextRole === "admin",
          });
          if (nextSession.user.email) saveAccount({ id: nextSession.user.id, email: nextSession.user.email, display_name: profileData?.full_name ?? profileData?.display_name ?? nextSession.user.email.split("@")[0], avatar_url: profileData?.avatar_url ?? null, role: nextRole });
          setActiveAccountId(nextSession.user.id);
          setLoading(false);
        });
      });

      unsub = () => subscription.subscription.unsubscribe();
    });

    return () => {
      alive = false;
      unsub?.();
    };
  }, []);

  const value = useMemo(
    () => ({ session, user, profile, role, loading }),
    [loading, profile, role, session, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
