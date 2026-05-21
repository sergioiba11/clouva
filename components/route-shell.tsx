import { MainNav } from "./layout";
export function RouteShell({title,subtitle,children}:{title:string;subtitle:string;children?:React.ReactNode}){return <main><MainNav/><section className="mx-auto max-w-7xl p-6"><div className="panel p-6"><h1 className="text-3xl font-bold">{title}</h1><p className="mt-2 text-sm text-white/70 light:text-black/70">{subtitle}</p>{children}</div></section></main>}
