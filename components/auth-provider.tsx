"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { normalizeRole, type Role } from "@/lib/auth";

type Profile = {
  id: string;
  role: string | null;
  full_name: string | null;
  avatar_url: string | null;
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
  const fullName = (user.user_metadata?.full_name as string | undefined) ?? null;
  const avatarUrl = (user.user_metadata?.avatar_url as string | undefined) ?? null;

  await supabase.from("profiles").upsert(
    {
      id: user.id,
      full_name: fullName,
      avatar_url: avatarUrl,
      role: "cliente",
      role_v2: "cliente",
    },
    { onConflict: "id", ignoreDuplicates: false },
  );

  const { data } = await supabase
    .from("profiles")
    .select("id, role, full_name, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  return data ?? null;
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
        setRole(normalizeRole(profileData?.role));
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
          setRole(normalizeRole(profileData?.role));
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
