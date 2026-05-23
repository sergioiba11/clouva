"use client";

import { useAuth } from "@/components/auth-provider";
import { canAccessAdmin, canAccessAdminLoose, normalizeRoleLoose } from "@/lib/auth";
import { usePathname } from "next/navigation";

export default function DebugAuthPage() {
  const { user, session, profile, role, loading, hydrationReady, profileReady } = useAuth();
  const pathname = usePathname();
  const normalizedRole = normalizeRoleLoose(profile?.role);
  const adminAccess = canAccessAdmin(role);

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-3xl font-semibold">Debug Auth</h1>
      <p className="mt-2 text-white/70">Panel temporal para diagnosticar estado de auth y acceso admin.</p>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <section className="rounded-2xl border border-white/15 p-4">
          <h2 className="mb-2 font-medium">Resumen</h2>
          <ul className="space-y-1 text-sm text-white/80">
            <li>pathname: <b>{pathname}</b></li>
            <li>loading: <b>{String(loading)}</b></li>
            <li>hydrationReady: <b>{String(hydrationReady)}</b></li>
            <li>profileReady: <b>{String(profileReady)}</b></li>
            <li>role: <b>{role}</b></li>
            <li>normalizedRole: <b>{normalizedRole ?? "null"}</b></li>
            <li>canAccessAdmin: <b>{String(adminAccess)}</b></li>
            <li>canAccessAdmin(raw): <b>{String(canAccessAdminLoose(profile?.role))}</b></li>
          </ul>
        </section>
        <section className="rounded-2xl border border-white/15 p-4"><h2 className="mb-2 font-medium">User</h2><pre className="overflow-auto rounded-xl bg-black/30 p-3 text-xs text-white/80">{JSON.stringify(user, null, 2)}</pre></section>
        <section className="rounded-2xl border border-white/15 p-4 md:col-span-2"><h2 className="mb-2 font-medium">Session</h2><pre className="overflow-auto rounded-xl bg-black/30 p-3 text-xs text-white/80">{JSON.stringify(session, null, 2)}</pre></section>
        <section className="rounded-2xl border border-white/15 p-4 md:col-span-2"><h2 className="mb-2 font-medium">Profile</h2><pre className="overflow-auto rounded-xl bg-black/30 p-3 text-xs text-white/80">{JSON.stringify(profile, null, 2)}</pre></section>
      </div>
    </main>
  );
}
