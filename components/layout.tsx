"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { getAccounts, removeAccount, switchAccount, type StoredAccount } from "@/lib/account-switcher";

const guestLinks = [
  { href: "/", label: "Home" },
  { href: "/tienda", label: "Shop" },
  { href: "/lookbook", label: "Editorial" },
  { href: "/sobre-clouva", label: "Historia" },
  { href: "/carrito", label: "Cart" },
];

export function MainNav() {
  const { user, profile, role, loading } = useAuth();
  const router = useRouter();
  const [openMenu, setOpenMenu] = useState(false);
  const [openSwitch, setOpenSwitch] = useState(false);
  const [accounts, setAccounts] = useState<StoredAccount[]>([]);

  useEffect(() => setAccounts(getAccounts()), [openSwitch, user]);

  const displayName = profile?.full_name ?? profile?.display_name ?? (user?.email ? user.email.split("@")[0] : "Mi perfil");
  const avatarUrl = profile?.avatar_url ?? user?.user_metadata?.avatar_url;

  const onSignOut = async () => {
    const { supabase } = await import("@/lib/supabase");
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[#05060a]/70 backdrop-blur-2xl">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 md:px-8">
        <Link href="/" className="text-lg font-semibold tracking-[0.28em] text-white/95">CLOUVA</Link>
        <nav className="hidden items-center gap-6 text-xs uppercase tracking-[0.2em] text-white/75 md:flex">
          {guestLinks.map((item) => <Link key={item.href} href={item.href} className="transition hover:text-[#8f7cff]">{item.label}</Link>)}
          {!loading && user ? (
            <div className="relative">
              <button type="button" onClick={() => setOpenMenu((v) => !v)} className="flex items-center gap-2 rounded-full border border-[#8f7cff]/50 bg-[#0c0e17] px-2 py-1.5 shadow-[0_0_24px_rgba(143,124,255,0.25)]">
                {avatarUrl ? <Image src={String(avatarUrl)} alt={displayName} width={28} height={28} className="h-7 w-7 rounded-full object-cover" /> : <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#8f7cff]/30">{displayName.charAt(0).toUpperCase()}</span>}
                <span className="text-[10px] normal-case">{displayName}</span>
              </button>
              {openMenu ? <div className="absolute right-0 mt-2 w-56 rounded-2xl border border-[#8f7cff]/35 bg-[#090b12]/95 p-2 text-sm shadow-[0_0_30px_rgba(147,247,255,0.2)]">
                <Link href="/perfil" className="block rounded-lg px-3 py-2 hover:bg-white/10">Perfil</Link>
                <Link href="/mi-flow" className="block rounded-lg px-3 py-2 hover:bg-white/10">Mi Flow</Link>
                {role === "admin" ? <Link href="/admin" className="block rounded-lg px-3 py-2 hover:bg-white/10">Admin</Link> : null}
                <button className="block w-full rounded-lg px-3 py-2 text-left hover:bg-white/10" onClick={() => { setOpenMenu(false); setOpenSwitch(true); }}>Cambiar cuenta</button>
                <Link href="/login?addAccount=1" className="block rounded-lg px-3 py-2 hover:bg-white/10">Agregar cuenta</Link>
                <button type="button" onClick={onSignOut} className="block w-full rounded-lg px-3 py-2 text-left text-rose-200 hover:bg-rose-400/10">Cerrar sesión</button>
              </div> : null}
            </div>
          ) : null}
        </nav>
        <Link href="/checkout" className="rounded-full border border-[#8f7cff]/40 bg-[#8f7cff]/15 px-4 py-2 text-xs uppercase tracking-[0.16em] text-[#c7c0ff]">Drop 001</Link>
      </div>
      {openSwitch ? <div className="fixed inset-0 z-[60] grid place-items-center bg-black/70 p-4"><div className="w-full max-w-md rounded-3xl border border-[#8f7cff]/35 bg-[#0a0d16] p-4"><h3 className="text-lg font-semibold">Cambiar cuenta</h3><div className="mt-3 space-y-2">{accounts.map((a)=><button key={a.id} onClick={()=>void switchAccount(a.id)} className="flex w-full items-center justify-between rounded-xl border border-white/10 p-3 text-left hover:border-[#93f7ff]/40"><span>{a.display_name}<span className="block text-xs text-white/60">{a.email}</span></span><span className="text-xs uppercase">{a.role}</span></button>)}{accounts.length===0?<p className="text-sm text-white/70">No hay cuentas guardadas todavía.</p>:null}</div><div className="mt-3 flex gap-2"><button onClick={()=>setOpenSwitch(false)} className="rounded-full border border-white/20 px-3 py-1">Cerrar</button>{accounts.length>0?<button onClick={()=>{removeAccount(accounts[accounts.length-1].id);setAccounts(getAccounts());}} className="rounded-full border border-rose-300/30 px-3 py-1 text-rose-200">Quitar última</button>:null}</div></div></div> : null}
    </header>
  );
}

export function MainFooter() { return <footer className="border-t border-white/10 py-12"><div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 text-xs uppercase tracking-[0.18em] text-white/55 md:flex-row md:items-center md:justify-between md:px-8"><p>CLOUVA — Vida de flows.</p><p>Zapala, Patagonia Argentina</p></div></footer>; }
