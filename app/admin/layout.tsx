import { MainNav } from "@/components/layout";
import Link from "next/link";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const links = [
    "/admin",
    "/admin/tiendas",
    "/admin/productos",
    "/admin/ventas",
    "/admin/stock",
    "/admin/clientes",
    "/admin/empleados",
    "/admin/musica",
    "/admin/lanzamientos",
    "/admin/contenido",
    "/admin/youtube",
    "/admin/emails",
    "/admin/configuracion",
  ];

  return (
    <main>
      <MainNav />
      <div className="mx-auto grid max-w-7xl gap-4 p-6 md:grid-cols-[220px_1fr]">
        <aside className="panel p-3">
          {links.map((l) => (
            <Link key={l} href={l} className="block py-1 text-sm">
              {l}
            </Link>
          ))}
        </aside>
        <section>{children}</section>
      </div>
    </main>
  );
}
