import Link from "next/link";
import { ThemeToggle } from "./theme-toggle";

export function MainNav() {
  const links = ["/","/tienda","/lookbook","/sobre-clouva","/carrito"];
  return <header className="sticky top-0 z-30 border-b border-white/10 bg-[#050505]/80 p-4 backdrop-blur-xl light:bg-white/80">
    <div className="mx-auto flex max-w-7xl items-center justify-between"><div className="font-bold tracking-[.2em]">CLOUVA</div><nav className="flex gap-3 text-sm">{links.map((l)=><Link key={l} href={l}>{l.replace('/','')||'home'}</Link>)}</nav><ThemeToggle/></div>
  </header>;
}
