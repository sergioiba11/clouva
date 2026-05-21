import { ProShell } from "@/components/pro-shell";

export default function PerfilPage() {
  return (
    <ProShell>
      <section className="mx-auto w-full max-w-5xl px-4 py-12 md:px-8">
        <h1 className="text-3xl">Perfil</h1>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">Datos de usuario (tabla users).</article>
          <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">Favoritos y drops seguidos (favorites + drops).</article>
          <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 md:col-span-2">Panel admin placeholder: control de productos, estado de drops y visibilidad.</article>
        </div>
      </section>
    </ProShell>
  );
}
