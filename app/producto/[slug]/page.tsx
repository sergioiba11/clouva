import { MainNav } from "@/components/layout";
import { products } from "@/lib/data";

export default async function Page({params}:{params:Promise<{slug:string}>}){
  const {slug}=await params; const p=products.find(x=>x.slug===slug);
  if(!p) return <main><MainNav/><div className="p-8">Producto no encontrado</div></main>;
  const related = products.filter(x=>x.id!==p.id).slice(0,3);
  return <main><MainNav/><section className="mx-auto grid max-w-7xl gap-6 p-6 lg:grid-cols-2"><div className="panel neon h-[460px] p-3"><div className="grid-premium flex h-full items-center justify-center rounded-xl">Galería premium + zoom</div></div><div className="panel p-6"><p className="text-violet-300">{p.category}</p><h1 className="text-3xl font-bold">{p.name}</h1><p className="mt-2 text-2xl">${p.price}</p><p className="mt-4 text-white/70 light:text-black/70">{p.description}</p><div className="mt-4"><p className="text-sm">Talles</p><div className="mt-2 flex gap-2">{p.sizes.map(s=><button key={s} className="panel px-3 py-2">{s}</button>)}</div></div><div className="mt-4"><p className="text-sm">Colores</p><div className="mt-2 flex gap-2">{p.colors.map(c=><button key={c} className="panel px-3 py-2">{c}</button>)}</div></div><button className="mt-6 w-full rounded-xl bg-violet-600 px-4 py-3">Agregar al carrito</button><p className="mt-3 text-sm text-white/60">Envío gratis a todo el país · retiro presencial disponible</p></div></section><section className="mx-auto max-w-7xl px-6 pb-10"><h2 className="mb-3 text-xl">Related products</h2><div className="grid gap-4 md:grid-cols-3">{related.map(r=><a key={r.id} href={`/producto/${r.slug}`} className="panel p-4">{r.name}</a>)}</div></section></main>;
}
