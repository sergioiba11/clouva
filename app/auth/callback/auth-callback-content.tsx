"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { normalizeRole } from "@/lib/auth";

export default function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const handleCallback = async () => {
      const next = searchParams.get("next");
      const code = searchParams.get("code");
      const { supabase } = await import("@/lib/supabase");

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          router.replace(`/login?error=${encodeURIComponent(error.message)}`);
          return;
        }
      }

      if (next) {
        router.replace(next);
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user?.id;

      if (!userId) {
        router.replace("/");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .maybeSingle();

      if (!profile?.role) {
        router.replace("/");
        return;
      }

      const role = normalizeRole(profile.role);
      if (role === "admin") {
        router.replace("/admin");
        return;
      }

      router.replace("/cuenta");
    };

    void handleCallback();
  }, [router, searchParams]);

  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-3xl items-center justify-center px-4 py-12">
      <p className="text-white/80">Completando inicio de sesión...</p>
    </main>
  );
}
