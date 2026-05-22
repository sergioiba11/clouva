"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getRedirectByRole } from "@/lib/auth";

export default function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const handleCallback = async () => {
      const code = searchParams.get("code");
      const { supabase } = await import("@/lib/supabase");

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          router.replace(`/login?error=${encodeURIComponent(error.message)}`);
          return;
        }
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData.session?.user;

      if (!user) {
        router.replace("/login?error=No%20se%20pudo%20establecer%20la%20sesión");
        return;
      }

      const defaultName = (user.user_metadata?.full_name as string | undefined) ?? null;
      const defaultAvatar = (user.user_metadata?.avatar_url as string | undefined) ?? null;

      await supabase.from("profiles").upsert(
        {
          id: user.id,
          email: user.email ?? null,
          full_name: defaultName,
          avatar_url: defaultAvatar,
          role: "cliente",
          role_v2: "cliente",
        },
        { onConflict: "id" },
      );

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();

      router.replace(getRedirectByRole(profile?.role));
    };

    void handleCallback();
  }, [router, searchParams]);

  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-3xl items-center justify-center px-4 py-12">
      <p className="text-white/80">Completando inicio de sesión...</p>
    </main>
  );
}
