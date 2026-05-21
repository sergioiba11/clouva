import { canAccessFlow, mockCurrentUser } from "@/lib/auth";
import { MainNav } from "@/components/layout";
import Link from "next/link";

export default function FlowLayout({children}:{children:React.ReactNode}){
  if(!canAccessFlow(mockCurrentUser.role)) return <main><MainNav/><div className="p-8">Mi Flow solo owner</div></main>;
  const links=["/mi-flow","/mi-flow/avatar","/mi-flow/ideas","/mi-flow/tareas","/mi-flow/finanzas","/mi-flow/contenido","/mi-flow/roadmap","/mi-flow/music","/mi-flow/drops"];
  return <main><MainNav/><div className="mx-auto grid max-w-7xl gap-4 p-6 md:grid-cols-[220px_1fr]"><aside className="panel neon p-3">{links.map(l=><Link key={l} href={l} className="block py-1 text-sm">{l}</Link>)}</aside><section>{children}</section></div></main>;
}
