"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import clsx from "clsx";
import { usePathname } from "next/navigation";

export function PremiumCard({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={clsx("os-card", className)}>{children}</div>;
}

export function StatCard({ label, value }: { label: string; value: string | number }) {
  return <PremiumCard className="p-4"><p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></PremiumCard>;
}

export function GlowButton({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="inline-flex rounded-full border border-[var(--line)] bg-[var(--card)]/80 px-4 py-2 text-sm shadow-[var(--shadow-soft)] transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-glow)]">{children}</Link>;
}

export function ModuleCard({ title, href }: { title: string; href: string }) {
  return <motion.div whileHover={{ y: -3 }} transition={{ duration: 0.2 }}><Link href={href} className="os-card block p-4"><p className="font-medium">{title}</p></Link></motion.div>;
}

export function Sidebar({ links }: { links: string[] }) {
  const pathname = usePathname();
  return <aside className="os-card hidden p-3 md:block">{links.map((l) => <Link key={l} href={l} className={clsx("block rounded-xl px-3 py-2 text-sm transition", pathname===l?"bg-[var(--chip)]":"hover:bg-[var(--chip)]/60")}>{(l.split('/').pop()||'home').toUpperCase()}</Link>)}</aside>;
}

export function ActivityFeed({ items }: { items: string[] }) {
  return <PremiumCard className="p-4"><h3 className="text-sm uppercase tracking-[0.12em] text-[var(--muted)]">Actividad</h3><div className="mt-3 space-y-2">{items.map((i,idx)=><p key={idx} className="rounded-xl border border-[var(--line)] bg-[var(--chip)] px-3 py-2 text-sm">{i}</p>)}</div></PremiumCard>;
}
