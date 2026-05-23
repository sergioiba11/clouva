"use client";

import { useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getRedirectByRole } from "@/lib/auth";

export default function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isAddAccountMode = useMemo(() => searchParams.get("addAccount") === "1", [searchParams]);

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

      const defaultName =
        (user.user_metadata?.full_name as string | undefined) ??
        (user.email ? user.email.split("@")[0] : "Usuario");

      const { data: existing } = await supabase
        .from("profiles")
        .select("id, role, display_name")
        .eq("id", user.id)
        .maybeSingle();

      const isSergio = user.email?.toLowerCase() === "sergio.iba.11@gmail.com";

      if (!existing) {
        await supabase.from("profiles").insert({
          id: user.id,
          display_name: defaultName,
          role: isSergio ? "admin" : "customer",
        });
      } else {
        const updates: { display_name?: string; role?: string } = {};
        if (!existing.display_name && defaultName) updates.display_name = defaultName;
        if (isSergio && existing.role !== "admin" && existing.role !== "owner") updates.role = "admin";
        if (Object.keys(updates).length > 0) {
          await supabase.from("profiles").update(updates).eq("id", user.id);
        }
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("id, role, display_name")
        .eq("id", user.id)
        .maybeSingle();

      const redirectPath = getRedirectByRole(profile?.role);
      if (process.env.NEXT_PUBLIC_DEBUG_AUTH === "1") {
        console.debug("[auth-debug] callback:redirect", {
          userId: user.id,
          email: user.email ?? null,
          profile,
          detectedRole: profile?.role ?? null,
          canAccessAdmin: profile?.role === "admin" || profile?.role === "owner",
          redirectPath,
        });
      }
      router.replace(isAddAccountMode ? `${redirectPath}?openAccountSwitcher=1` : redirectPath);
    };

    void handleCallback();
  }, [isAddAccountMode, router, searchParams]);

  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-3xl items-center justify-center px-4 py-12">
      <p className="text-white/80">Completando inicio de sesión...</p>
    </main>
  );
}
