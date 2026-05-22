"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { roleHome } from "@/lib/auth";

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

  const displayName =
    profile?.full_name ?? (user?.email ? user.email.split("@")[0] : "Mi perfil");
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
        <Link href="/" className="text-lg font-semibold tracking-[0.28em] text-white/95">
          CLOUVA
        </Link>

        <nav className="hidden items-center gap-6 text-xs uppercase tracking-[0.2em] text-white/75 md:flex">
          {guestLinks.map((item) => (
            <Link key={item.href} href={item.href} className="transition hover:text-[#8f7cff]">
              {item.label}
            </Link>
          ))}

          {!loading && user ? (
            <>
              <Link href={roleHome[role]} className="transition hover:text-[#8f7cff]">
                {role === "admin" ? "Admin" : role === "empleado" ? "Empleado" : "Mi Flow"}
              </Link>
              <div className="flex items-center gap-2 text-[10px] normal-case tracking-normal text-white/90">
                {avatarUrl ? (
                  <Image
                    src={avatarUrl as string}
                    alt={displayName}
                    width={24}
                    height={24}
                    className="h-6 w-6 rounded-full border border-white/20 object-cover"
                  />
                ) : (
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/20 text-[10px]">
                    {displayName.charAt(0).toUpperCase()}
                  </span>
                )}
                <span>{displayName}</span>
                {role === "vip" ? (
                  <span className="rounded-full border border-amber-300/40 bg-amber-300/15 px-2 py-0.5 text-[9px] uppercase tracking-[0.18em] text-amber-200">
                    VIP
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onSignOut}
                className="rounded-full border border-white/20 px-3 py-1.5 text-[10px] tracking-[0.14em] transition hover:border-white/40"
              >
                Cerrar sesión
              </button>
            </>
          ) : null}

          {!loading && !user ? (
            <Link href="/login" className="transition hover:text-[#8f7cff]">
              Login
            </Link>
          ) : null}
        </nav>

        <Link
          href="/checkout"
          className="rounded-full border border-[#8f7cff]/40 bg-[#8f7cff]/15 px-4 py-2 text-xs uppercase tracking-[0.16em] text-[#c7c0ff] transition hover:bg-[#8f7cff]/25"
        >
          Drop 001
        </Link>
      </div>
    </header>
  );
}

export function MainFooter() {
  return (
    <footer className="border-t border-white/10 py-12">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 text-xs uppercase tracking-[0.18em] text-white/55 md:flex-row md:items-center md:justify-between md:px-8">
        <p>CLOUVA — Vida de flows.</p>
        <p>Zapala, Patagonia Argentina</p>
      </div>
    </footer>
  );
}
