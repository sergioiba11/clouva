import { MainNav } from "@/components/layout";
import Link from "next/link";
import { AdminGuard } from "@/components/admin-guard";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const links = ["/admin", "/admin/productos", "/admin/pedidos", "/admin/clientes", "/admin/ventas", "/admin/stock", "/admin/envios", "/admin/cupones", "/admin/configuracion"];

  return (
    <main>
      <MainNav />
      <AdminGuard>
        <div className="mx-auto grid max-w-7xl gap-4 p-6 md:grid-cols-[240px_1fr]">
          <aside className="panel rounded-3xl border border-white/10 bg-gradient-to-b from-[#101624] to-[#090d16] p-4 shadow-[0_0_40px_rgba(98,147,255,0.15)]">
            {links.map((l) => (
              <Link key={l} href={l} className="block rounded-lg px-3 py-2 text-sm text-white/80 transition hover:bg-white/10 hover:text-white">
                {l}
              </Link>
            ))}
          </aside>
          <section>{children}</section>
        </div>
      </AdminGuard>
    </main>
  );
}
