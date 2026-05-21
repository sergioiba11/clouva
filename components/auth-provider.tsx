"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  error: string | null;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signInWithMagicLink: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const supabase = getSupabaseBrowserClient();

  useEffect(() => {
    const bootstrap = async () => {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) setError(sessionError.message);
      setSession(data.session ?? null);
      setUser(data.session?.user ?? null);
      setLoading(false);
    };

    bootstrap();

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, [supabase.auth]);

  const withErrorHandling = useCallback(async (action: () => Promise<void>) => {
    try {
      setLoading(true);
      setError(null);
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado de autenticación.");
    } finally {
      setLoading(false);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      session,
      loading,
      error,
      signInWithPassword: async (email, password) => {
        await withErrorHandling(async () => {
          const { error } = await supabase.auth.signInWithPassword({ email, password });
          if (error) throw error;
        });
      },
      signUp: async (email, password) => {
        await withErrorHandling(async () => {
          const { error } = await supabase.auth.signUp({ email, password });
          if (error) throw error;
        });
      },
      signInWithMagicLink: async (email) => {
        await withErrorHandling(async () => {
          const { error } = await supabase.auth.signInWithOtp({ email });
          if (error) throw error;
        });
      },
      signOut: async () => {
        await withErrorHandling(async () => {
          const { error } = await supabase.auth.signOut();
          if (error) throw error;
        });
      }
    }),
    [user, session, loading, error, withErrorHandling, supabase.auth]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return context;
}
