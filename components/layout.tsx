"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { getAccounts, switchAccount, type StoredAccount } from "@/lib/account-switcher";
import { ThemeToggle } from "@/components/theme-toggle";

export function MainNav() {
  const { user, profile, role, loading } = useAuth();
  const router = useRouter();
  const [openMenu, setOpenMenu] = useState(false);
  const [openSwitch, setOpenSwitch] = useState(false);
  const [accounts, setAccounts] = useState<StoredAccount[]>([]);
  const [avatarBroken, setAvatarBroken] = useState(false);

  useEffect(() => setAccounts(getAccounts()), [openSwitch]);

  useEffect(() => {
    if (typeof window === "undefined" || !user) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("openAccountSwitcher") === "1") setOpenSwitch(true);
  }, [user]);

  const displayName = profile?.full_name ?? profile?.display_name ?? user?.email?.split("@")[0] ?? "Flow";
  const avatar = profile?.avatar_url ?? user?.user_metadata?.avatar_url;

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--card)]/80 backdrop-blur-2xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 md:px-8">
        <Link href="/" className="text-sm font-semibold tracking-[0.3em]">CLOUVA OS</Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {loading ? (
            <div className="h-9 w-28 animate-pulse rounded-full border border-[var(--line)] bg-white/[0.03]" />
          ) : user ? (
            <div className="relative">
              <button onClick={() => setOpenMenu((v) => !v)} className="flex items-center gap-2 rounded-full border border-[var(--line)] px-2 py-1">
                {avatar && !avatarBroken ? (
                  <Image src={String(avatar)} alt={displayName} width={28} height={28} className="h-7 w-7 rounded-full border border-white/20 object-cover" onError={() => setAvatarBroken(true)} />
                ) : (
                  <span className="inline-grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-violet-500/60 to-cyan-400/40 text-xs font-semibold">{displayName.charAt(0).toUpperCase()}</span>
                )}
                <span className="text-xs font-medium">{displayName}</span>
              </button>
              {openMenu ? (
                <>
                  <button
                    aria-label="Cerrar menú"
                    className="fixed inset-0 z-[55] cursor-default"
                    onClick={() => setOpenMenu(false)}
                  />
                  <div className="absolute right-0 top-full z-[60] mt-2 w-60 rounded-2xl border border-[var(--line)] p-2 text-sm shadow-[var(--shadow-glow)] max-sm:right-[-8px] max-sm:w-[min(92vw,18rem)]" style={{ background: "var(--bg)" }}>
                    <Link href="/perfil" className="block rounded-lg px-3 py-2 hover:bg-[var(--chip)]" onClick={() => setOpenMenu(false)}>Perfil</Link>
                    <Link href="/mi-flow" className="block rounded-lg px-3 py-2 hover:bg-[var(--chip)]" onClick={() => setOpenMenu(false)}>Mi Flow</Link>
                    {role === "admin" ? <Link href="/admin" className="block rounded-lg px-3 py-2 hover:bg-[var(--chip)]" onClick={() => setOpenMenu(false)}>Admin</Link> : null}
                    <Link href="/login?addAccount=1" className="block rounded-lg px-3 py-2 hover:bg-[var(--chip)]" onClick={() => setOpenMenu(false)}>Agregar cuenta</Link>
                    <button className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[var(--chip)]" onClick={() => { setOpenMenu(false); setOpenSwitch(true); }}>
                      Cambiar cuenta
                    </button>
                    <button onClick={async () => { const { supabase } = await import("@/lib/supabase"); await supabase.auth.signOut(); router.push("/login"); }} className="block w-full rounded-lg px-3 py-2 text-left text-rose-400 hover:bg-rose-500/10">
                      Cerrar sesión
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          ) : (
            <Link href="/login" className="rounded-full border border-[var(--line)] px-3 py-1 text-xs">Login</Link>
          )}
          <Link href="/checkout" className="rounded-full bg-[#8f7cff] px-3 py-1 text-xs text-black">Drop</Link>
        </div>
      </div>
      {openSwitch ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
          <div className="os-card w-full max-w-md p-4">
            <h3 className="text-lg font-semibold">Cambiar cuenta</h3>
            <div className="mt-3 space-y-2">
              {accounts.map((a) => (
                <button key={a.id} onClick={() => { setOpenSwitch(false); void switchAccount(a.id); }} className="w-full rounded-xl border border-[var(--line)] px-3 py-2 text-left hover:bg-[var(--chip)]">
                  <p>{a.display_name}</p>
                  <p className="text-xs text-[var(--muted)]">{a.email}</p>
                </button>
              ))}
            </div>
            <button onClick={() => setOpenSwitch(false)} className="mt-3 rounded-full border border-[var(--line)] px-3 py-1 text-sm">Cerrar</button>
          </div>
        </div>
      ) : null}
    </header>
  );
}

export function MainFooter() {
  return <footer className="mx-auto max-w-7xl px-4 py-10 text-xs uppercase tracking-[0.18em] text-[var(--muted)] md:px-8">CLOUVA · Vida de flows</footer>;
}
