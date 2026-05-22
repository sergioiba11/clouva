"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { normalizeRole, type Role } from "@/lib/auth";
import { saveAccount } from "@/lib/account-switcher";

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

    const bootstrap = async () => {
      const { supabase } = await import("@/lib/supabase");
      const { data } = await supabase.auth.getSession();
      const nextSession = data.session ?? null;

      if (!alive) return;

      setSession(nextSession);
      setUser(nextSession?.user ?? null);

      if (nextSession?.user) {
        const profileData = await ensureProfile(nextSession.user);
        if (!alive) return;
        setProfile(profileData);
        const nextRole = normalizeRole(profileData?.role);
        setRole(nextRole);
        if (nextSession.user.email) saveAccount({ id: nextSession.user.id, email: nextSession.user.email, display_name: profileData?.full_name ?? profileData?.display_name ?? nextSession.user.email.split("@")[0], avatar_url: profileData?.avatar_url ?? null, role: nextRole });
      } else {
        setProfile(null);
        setRole("cliente");
      }

      setLoading(false);
    };

    void bootstrap();

    let unsub: (() => void) | null = null;
    import("@/lib/supabase").then(({ supabase }) => {
      const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
        setSession(nextSession);
        setUser(nextSession?.user ?? null);
        if (!nextSession?.user) {
          setProfile(null);
          setRole("cliente");
          setLoading(false);
          return;
        }

        setLoading(true);
        void ensureProfile(nextSession.user).then((profileData) => {
          if (!alive) return;
          setProfile(profileData);
          const nextRole = normalizeRole(profileData?.role);
          setRole(nextRole);
          if (nextSession.user.email) saveAccount({ id: nextSession.user.id, email: nextSession.user.email, display_name: profileData?.full_name ?? profileData?.display_name ?? nextSession.user.email.split("@")[0], avatar_url: profileData?.avatar_url ?? null, role: nextRole });
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
