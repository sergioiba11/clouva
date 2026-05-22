export default function Page(){
  return <section className="panel rounded-3xl p-6 space-y-3"><h1 className="text-2xl font-semibold">Configuración de Perfil</h1><div className="grid gap-3 md:grid-cols-2">{["tema","glow intensity","accent color","privacidad","notificaciones","links sociales"].map((x)=><label key={x} className="rounded-xl border border-white/10 p-3 text-sm capitalize">{x}<input className="mt-2 w-full rounded-lg border border-white/10 bg-black/20 p-2" placeholder={`Configurar ${x}`} /></label>)}</div></section>
}
