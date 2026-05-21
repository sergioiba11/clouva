import { MainNav } from "@/components/layout";
import Link from "next/link";

export default function Home(){return <main><MainNav/><section className="mx-auto max-w-7xl p-6"><div className="panel neon p-8"><p className="text-xs uppercase text-violet-300">Sistema Operativo Humano</p><h1 className="text-4xl font-bold">CLOUVA — Live Different</h1><p className="mt-3 text-white/70 light:text-black/70">Base premium productiva: tienda pública, admin y Mi Flow.</p><div className="mt-6 flex gap-3"><Link href="/tienda" className="rounded-xl bg-violet-600 px-4 py-2">Entrar a tienda</Link><Link href="/mi-flow" className="panel px-4 py-2">Mi Flow</Link></div></div></section></main>}
