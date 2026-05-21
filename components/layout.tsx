import Link from "next/link";
import { ThemeToggle } from "./theme-toggle";

export function MainNav() {
  const links = [
    { href: "/", label: "Home" },
    { href: "/tienda", label: "Tienda" },
    { href: "/lookbook", label: "Lookbook" },
    { href: "/sobre-clouva", label: "Sobre" },
    { href: "/admin", label: "Admin" },
    { href: "/mi-flow", label: "Mi Flow" }
  ];
  return <header className="sticky top-0 z-40 border-b border-white/10 bg-[#050505]/80 p-4 backdrop-blur-xl light:bg-white/80">
    <div className="mx-auto flex max-w-7xl items-center justify-between gap-2"><Link href="/" className="font-semibold tracking-[.35em]">CLOUVA</Link><nav className="hidden gap-4 text-sm md:flex">{links.map((l)=><Link key={l.href} href={l.href} className="text-white/70 transition hover:text-violet-300 light:text-black/70">{l.label}</Link>)}</nav><ThemeToggle/></div>
  </header>;
}
