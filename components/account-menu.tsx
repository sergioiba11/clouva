"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { getAccounts, switchAccount, type StoredAccount } from "@/lib/account-switcher";

// The account avatar + dropdown from MainNav (components/layout.tsx),
// extracted so public studio/player pages (PublicShell) can show it too --
// those pages have their own branded header and previously had zero path
// back to the viewer's own account (no way to reach "Editar mi perfil" or
// "Administrar estudio" while browsing a studio's public page).
export function AccountMenu() {
  const { user, profile, role, loading } = useAuth();
  const router = useRouter();
  const [openMenu, setOpenMenu] = useState(false);
  const [openSwitch, setOpenSwitch] = useState(false);
  const [accounts, setAccounts] = useState<StoredAccount[]>([]);
  const [avatarBroken, setAvatarBroken] = useState(false);

  useEffect(() => setAccounts(getAccounts()), [openSwitch]);

  const displayName = profile?.full_name ?? profile?.display_name ?? user?.email?.split("@")[0] ?? "Flow";
  const avatar = profile?.avatar_url ?? user?.user_metadata?.avatar_url;
  const canAdmin = role === "admin";

  if (loading) return <div className="h-9 w-28 animate-pulse rounded-full border border-white/10 bg-white/[0.03]" />;
  if (!user) return <Link href="/login" className="rounded-full border border-white/15 px-3 py-1 text-xs">Login</Link>;

  return (
    <div className="relative">
      <button onClick={() => setOpenMenu((v) => !v)} className="flex items-center gap-2 rounded-full border border-white/15 px-2 py-1">
        {avatar && !avatarBroken ? (
          <Image src={String(avatar)} alt={displayName} width={28} height={28} className="h-7 w-7 rounded-full border border-white/20 object-cover" onError={() => setAvatarBroken(true)} />
        ) : (
          <span className="inline-grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-violet-500/60 to-cyan-400/40 text-xs font-semibold">{displayName.charAt(0).toUpperCase()}</span>
        )}
        <span className="hidden text-xs font-medium sm:inline">{displayName}</span>
      </button>
      {openMenu ? (
        <>
          <button aria-label="Cerrar menú" className="fixed inset-0 z-[55] cursor-default" onClick={() => setOpenMenu(false)} />
          <div className="absolute right-0 top-full z-[60] mt-2 w-60 rounded-2xl border border-white/10 bg-[#07060b] p-2 text-sm shadow-2xl max-sm:right-[-8px] max-sm:w-[min(92vw,18rem)]">
            <Link href="/perfil" className="block rounded-lg px-3 py-2 hover:bg-white/5" onClick={() => setOpenMenu(false)}>Perfil</Link>
            <Link href="/profile/edit" className="block rounded-lg px-3 py-2 hover:bg-white/5" onClick={() => setOpenMenu(false)}>Editar mi perfil</Link>
            <Link href="/profile/memberships" className="block rounded-lg px-3 py-2 hover:bg-white/5" onClick={() => setOpenMenu(false)}>Mis Estudios</Link>
            <Link href="/matrix" className="block rounded-lg px-3 py-2 hover:bg-white/5" onClick={() => setOpenMenu(false)}>La Matrix</Link>
            <Link href="/mi-flow" className="block rounded-lg px-3 py-2 hover:bg-white/5" onClick={() => setOpenMenu(false)}>Mi Flow</Link>
            {canAdmin ? <Link href="/admin" className="block rounded-lg px-3 py-2 text-amber-200 hover:bg-amber-500/10" onClick={() => setOpenMenu(false)}>Admin</Link> : null}
            <Link href="/login?addAccount=1" className="block rounded-lg px-3 py-2 hover:bg-white/5" onClick={() => setOpenMenu(false)}>Agregar cuenta</Link>
            <button className="block w-full rounded-lg px-3 py-2 text-left hover:bg-white/5" onClick={() => { setOpenMenu(false); setOpenSwitch(true); }}>Cambiar cuenta</button>
            <button onClick={async () => { const { supabase } = await import("@/lib/supabase"); await supabase.auth.signOut(); router.push("/login"); }} className="block w-full rounded-lg px-3 py-2 text-left text-rose-400 hover:bg-rose-500/10">Cerrar sesión</button>
          </div>
        </>
      ) : null}
      {openSwitch ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#07060b] p-4">
            <h3 className="text-lg font-semibold">Cambiar cuenta</h3>
            <div className="mt-3 space-y-2">
              {accounts.map((a) => (
                <button key={a.id} onClick={() => { setOpenSwitch(false); void switchAccount(a.id); }} className="w-full rounded-xl border border-white/10 px-3 py-2 text-left hover:bg-white/5">
                  <p>{a.display_name}</p>
                  <p className="text-xs text-white/40">{a.email}</p>
                </button>
              ))}
            </div>
            <button onClick={() => setOpenSwitch(false)} className="mt-3 rounded-full border border-white/10 px-3 py-1 text-sm">Cerrar</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
