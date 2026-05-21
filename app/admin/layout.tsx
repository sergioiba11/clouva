import { canAccessAdmin, mockCurrentUser } from "@/lib/auth";
import { MainNav } from "@/components/layout";
import Link from "next/link";

export default function AdminLayout({children}:{children:React.ReactNode}){
  if(!canAccessAdmin(mockCurrentUser.role)) return <main><MainNav/><div className="p-8">No autorizado</div></main>;
  const links=["/admin","/admin/productos","/admin/pedidos","/admin/clientes","/admin/ventas","/admin/stock","/admin/envios","/admin/cupones","/admin/configuracion"];
  return <main><MainNav/><div className="mx-auto grid max-w-7xl gap-4 p-6 md:grid-cols-[220px_1fr]"><aside className="panel p-3">{links.map(l=><Link key={l} href={l} className="block py-1 text-sm">{l}</Link>)}</aside><section>{children}</section></div></main>;
}
