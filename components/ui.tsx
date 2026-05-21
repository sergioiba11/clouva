"use client";

import Link from "next/link";
import { motion } from "framer-motion";

export function SectionTitle({ overline, title, subtitle }: { overline: string; title: string; subtitle?: string }) {
  return (
    <div className="space-y-3">
      <p className="text-xs uppercase tracking-[0.22em] text-[#74c5ff]">{overline}</p>
      <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">{title}</h2>
      {subtitle ? <p className="max-w-2xl text-sm text-white/65 md:text-base">{subtitle}</p> : null}
    </div>
  );
}

export function ProductCard({ name, price, href, category }: { name: string; price: number; href: string; category: string }) {
  return (
    <motion.div whileHover={{ y: -6, scale: 1.01 }} transition={{ duration: 0.3 }}>
      <Link
        href={href}
        className="group relative block overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.08] to-white/[0.02] p-5 shadow-[0_12px_30px_rgba(0,0,0,.45)]"
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(122,97,255,.2),transparent_45%)] opacity-0 transition group-hover:opacity-100" />
        <p className="relative text-[11px] uppercase tracking-[0.2em] text-white/55">{category}</p>
        <h3 className="relative mt-3 text-2xl">{name}</h3>
        <p className="relative mt-6 text-lg text-[#95d8ff]">${price.toLocaleString("es-AR")}</p>
      </Link>
    </motion.div>
  );
}
