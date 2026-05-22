"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const next = searchParams.get("next") || "/cuenta";

    const handleCallback = async () => {
      const code = searchParams.get("code");
      if (code) {
        const { supabase } = await import("@/lib/supabase");
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          router.replace(`/login?error=${encodeURIComponent(error.message)}`);
          return;
        }
      }

      router.replace(next);
    };

    void handleCallback();
  }, [router, searchParams]);

  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-3xl items-center justify-center px-4 py-12">
      <p className="text-white/80">Completando inicio de sesión...</p>
    </main>
  );
}
