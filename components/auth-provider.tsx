"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase-client";
import type { Session, User } from "@supabase/supabase-js";

export type AppRole = "owner" | "admin" | "customer";

type AuthContextType = {
  session: Session | null;
  user: User | null;
  role: AppRole;
  loading: boolean;
  hydrated: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadSession() {
      if (!supabase) {
        if (mounted) {
          setLoading(false);
          setHydrated(true);
        }
        return;
      }
      const { data } = await supabase.auth.getSession();
      if (mounted) {
        setSession(data.session ?? null);
        setLoading(false);
        setHydrated(true);
      }
    }

    loadSession();

    if (!supabase) return;

    const { data: listener } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      if (!mounted) return;
      setSession(currentSession ?? null);
      setLoading(false);
      setHydrated(true);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextType>(() => {
    const metadataRole = session?.user?.user_metadata?.role as AppRole | undefined;
    const appMetaRole = session?.user?.app_metadata?.role as AppRole | undefined;
    const role = appMetaRole ?? metadataRole ?? "customer";

    return {
      session,
      user: session?.user ?? null,
      role,
      loading,
      hydrated,
      signOut: async () => {
        if (!supabase) return;
        await supabase.auth.signOut();
      },
    };
  }, [loading, hydrated, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
