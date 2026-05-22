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

      const { data: existing } = await supabase
        .from("profiles")
        .select("id, email, full_name, avatar_url")
        .eq("id", user.id)
        .maybeSingle();

      if (!existing) {
        await supabase.from("profiles").insert({
          id: user.id,
          email: user.email ?? null,
          full_name: defaultName,
          avatar_url: defaultAvatar,
          role: "customer",
          role_v2: "cliente",
        });
      } else {
        const updates: { email?: string; full_name?: string; avatar_url?: string } = {};
        if (!existing.email && user.email) updates.email = user.email;
        if (!existing.full_name && defaultName) updates.full_name = defaultName;
        if (!existing.avatar_url && defaultAvatar) updates.avatar_url = defaultAvatar;
        if (Object.keys(updates).length > 0) {
          await supabase.from("profiles").update(updates).eq("id", user.id);
        }
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role_v2")
        .eq("id", user.id)
        .maybeSingle();

      router.replace(getRedirectByRole(profile?.role_v2));
    };

    void handleCallback();
  }, [router, searchParams]);

  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-3xl items-center justify-center px-4 py-12">
      <p className="text-white/80">Completando inicio de sesión...</p>
    </main>
  );
}
