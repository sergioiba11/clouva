import Link from "next/link";

const links = [
  { href: "/", label: "Home" },
  { href: "/productos", label: "Productos" },
  { href: "/universo", label: "Universo" },
  { href: "/galeria", label: "Galería" },
  { href: "/login", label: "Login" },
  { href: "/registro", label: "Registro" },
  { href: "/perfil", label: "Perfil" }
];

export function MainNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[#05060a]/70 backdrop-blur-2xl">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 md:px-8">
        <Link href="/" className="text-lg font-semibold tracking-[0.28em] text-white/95">
          CLOUVA
        </Link>
        <nav className="hidden items-center gap-6 text-xs uppercase tracking-[0.2em] text-white/75 md:flex">
          {links.map((item) => (
            <Link key={item.href} href={item.href} className="transition hover:text-[#8f7cff]">
              {item.label}
            </Link>
          ))}
        </nav>
        <Link
          href="/productos"
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
        <p>Deploy Vercel + Supabase Ready</p>
      </div>
    </footer>
  );
}
