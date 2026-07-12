"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MainFooter, MainNav } from "@/components/layout";
import { ActivityFeed, GlowButton, ModuleCard } from "@/components/os-ui";
import { ProductCard } from "@/components/store/product-card";
import { supabase } from "@/lib/supabase";
import { productSelect, type Banner, type Product } from "@/lib/store-data";

export default function Home() {
  const [products, setProducts] = useState<Product[]>([]);
  const [banner, setBanner] = useState<Banner | null>(null);

  useEffect(() => {
    void (async () => {
      const [ps, bs] = await Promise.all([
        supabase.from("products").select(productSelect).eq("active", true).eq("featured", true).limit(3),
        supabase.from("banners").select("*").eq("active", true).order("sort_order").limit(1),
      ]);
      setProducts((ps.data ?? []) as Product[]);
      setBanner((bs.data ?? [])[0] ?? null);
    })();
  }, []);

  const explore = ["Flows", "Studio", "Vault", "Launch", "Visual", "Money"];

  return (
    <main className="pb-20 md:pb-0">
      <MainNav />

      {/* Destacado */}
      <section className="mx-auto max-w-7xl px-4 pt-6 sm:pt-10 md:px-8">
        <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.03]">
          <div
            className="grid min-h-[280px] items-end bg-cover bg-center p-6 sm:min-h-[360px] sm:p-10"
            style={{
              backgroundImage: banner?.image_url
                ? `linear-gradient(90deg, rgba(0,0,0,.8), rgba(0,0,0,.2)), url(${banner.image_url})`
                : "radial-gradient(circle at top right, rgba(149,216,255,.2), transparent 45%)",
            }}
          >
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Destacado</p>
            <h1 className="mt-2 font-stencil text-3xl tracking-wide sm:text-5xl">{banner?.title ?? "CLOUVA OS"}</h1>
            <p className="mt-3 max-w-xl text-sm text-[var(--muted)] sm:text-base">
              {banner?.subtitle ?? "Música, negocio y vida de flows — todo en un solo lugar."}
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <GlowButton href="/mi-flow">Entrar a Mi Flow</GlowButton>
              <GlowButton href="/tienda">Explorar Store</GlowButton>
            </div>
          </div>
        </div>
      </section>

      {/* Para vos / explorar */}
      <section className="mx-auto max-w-7xl px-4 pt-8 md:px-8">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Para vos</h2>
        </div>
        <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
          {explore.map((m) => (
            <div key={m} className="flex-shrink-0">
              <ModuleCard title={m} href="/mi-flow" />
            </div>
          ))}
        </div>
      </section>

      {/* Merch destacado */}
      <section className="mx-auto max-w-7xl px-4 pt-8 md:px-8">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Merch destacado</h2>
          <Link href="/tienda" className="text-xs text-[var(--muted)] underline">
            Ver todo
          </Link>
        </div>
        {products.length > 0 ? (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-[var(--muted)]">Todavía no hay productos destacados — marcalos desde /admin.</p>
        )}
      </section>

      {/* Actividad */}
      <section className="mx-auto max-w-7xl px-4 pb-10 pt-8 md:px-8">
        <h2 className="text-lg font-semibold">Actividad</h2>
        <div className="mt-3">
          <ActivityFeed items={["Nuevo flow guardado · hace 2h", "Drop actualizado · hace 5h", "Sesión Studio programada · mañana"]} />
        </div>
      </section>

      <MainFooter />

      {/* Bottom tab bar (mobile) */}
      <nav className="fixed bottom-0 left-0 z-40 flex w-full items-center justify-around border-t border-[var(--line)] bg-[var(--bg)] py-2 md:hidden">
        <Link href="/" className="flex flex-col items-center gap-0.5 px-3 py-1 text-[10px] text-[var(--muted)]">
          <span>🏠</span>Inicio
        </Link>
        <Link href="/tienda" className="flex flex-col items-center gap-0.5 px-3 py-1 text-[10px] text-[var(--muted)]">
          <span>🛍️</span>Tienda
        </Link>
        <Link href="/mi-flow" className="flex flex-col items-center gap-0.5 px-3 py-1 text-[10px] text-[var(--muted)]">
          <span>⚡</span>Mi Flow
        </Link>
        <Link href="/perfil" className="flex flex-col items-center gap-0.5 px-3 py-1 text-[10px] text-[var(--muted)]">
          <span>👤</span>Cuenta
        </Link>
      </nav>
    </main>
  );
}
