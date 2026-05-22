import { MainNav } from "@/components/layout";
import Link from "next/link";
import { RequireAuth } from "@/components/route-guard";

export default function AdminLayout({children}:{children:React.ReactNode}){
  const links=["/admin","/admin/productos","/admin/pedidos","/admin/clientes","/admin/ventas","/admin/stock","/admin/envios","/admin/cupones","/admin/configuracion"];
  return <main><MainNav/><RequireAuth adminOnly><div className="mx-auto grid max-w-7xl gap-4 p-6 md:grid-cols-[220px_1fr]"><aside className="panel p-3">{links.map(l=><Link key={l} href={l} className="block rounded-lg px-2 py-1 text-sm hover:bg-white/10">{l}</Link>)}</aside><section>{children}</section></div></RequireAuth></main>;
}
