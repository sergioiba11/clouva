"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Activity,
  BadgeDollarSign,
  Banknote,
  BellRing,
  Boxes,
  Building2,
  CalendarClock,
  ChevronDown,
  CircleDollarSign,
  Coins,
  CreditCard,
  FileBox,
  FlaskConical,
  FolderOpen,
  Gauge,
  Image as ImageIcon,
  Landmark,
  LayoutDashboard,
  Menu,
  PackageCheck,
  PackagePlus,
  ScanFace,
  Settings2,
  ShieldCheck,
  Smartphone,
  Store,
  Tags,
  TicketPercent,
  Truck,
  UserCog,
  UserRound,
  Users,
  X,
} from "lucide-react";

export type AdminNavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  status?: "no_config";
};

type AdminNavGroup = {
  title: string;
  items: AdminNavItem[];
};

const groups: AdminNavGroup[] = [
  {
    title: "Control",
    items: [
      { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
      { label: "Actividad", href: "/admin#actividad", icon: Activity },
      { label: "Alertas", href: "/admin#alertas", icon: BellRing },
    ],
  },
  {
    title: "Personas",
    items: [
      { label: "Usuarios", href: "/admin/clientes", icon: Users },
      { label: "Players", href: "/admin/clientes", icon: UserRound },
      { label: "Estudios", href: "/admin/estudios", icon: Building2 },
      { label: "Empleados", href: "/admin/empleados", icon: UserCog },
    ],
  },
  {
    title: "Experiencia",
    items: [
      { label: "CLOUVA Lab", href: "/admin/clouva-lab", icon: FlaskConical },
      { label: "CLOUVA Control", href: "/admin/clouva-control", icon: Smartphone },
      { label: "Assets", href: "/admin/assets", icon: FolderOpen },
      { label: "Avatar Oficial", href: "/admin/avatar-oficial", icon: ScanFace },
    ],
  },
  {
    title: "Dinero",
    items: [
      { label: "Ingresos", href: "/admin#finanzas", icon: CircleDollarSign },
      { label: "Suscripciones", href: "/admin/suscripciones", icon: CreditCard },
      { label: "FLOWS", href: "/admin/flows", icon: Coins },
      { label: "Tesorería FLOW", href: "/admin/flows/tesoreria", icon: Landmark },
      { label: "Pagos manuales", href: "/admin/flows/pagos-manuales", icon: Banknote },
    ],
  },
  {
    title: "Comercio",
    items: [
      { label: "Marketplace", href: "/admin/marketplace", icon: Store },
      { label: "Pedidos", href: "/admin/pedidos", icon: PackageCheck },
      { label: "Reservas", href: "/admin/reservas", icon: CalendarClock },
      { label: "Envíos", href: "/admin/envios", icon: Truck, status: "no_config" },
      { label: "Stock", href: "/admin/stock", icon: Boxes, status: "no_config" },
    ],
  },
  {
    title: "Catálogo",
    items: [
      { label: "Productos", href: "/admin/productos", icon: PackagePlus },
      { label: "Categorías", href: "/admin/categorias", icon: Tags },
      { label: "Banners", href: "/admin/banners", icon: ImageIcon },
      { label: "Cupones", href: "/admin/cupones", icon: TicketPercent, status: "no_config" },
    ],
  },
  {
    title: "Estudios",
    items: [
      { label: "Estudios", href: "/admin/estudios", icon: Building2 },
      { label: "Membresías", href: "/admin/estudios/membresias", icon: BadgeDollarSign },
      { label: "Studio OS", href: "/admin/estudios/studio-os", icon: Gauge },
    ],
  },
  {
    title: "Sistema",
    items: [
      { label: "Compatibilidad", href: "/admin/marketplace/compatibilidad", icon: FileBox },
      { label: "Configuración", href: "/admin/configuracion", icon: Settings2 },
      { label: "Estado del sistema", href: "/admin#sistema", icon: ShieldCheck },
    ],
  },
];

function isActive(pathname: string, href: string) {
  const cleanHref = href.split("#")[0];
  if (cleanHref === "/admin") return pathname === "/admin";
  return pathname === cleanHref || pathname.startsWith(`${cleanHref}/`);
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname() || "/admin";
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-4 p-3">
      <div className="px-2 pb-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-violet-200/65">CLOUVA Admin</p>
        <p className="mt-1 text-xs text-white/35">Control total de la plataforma</p>
      </div>

      {groups.map((group) => {
        const closed = collapsed[group.title] === true;
        return (
          <section key={group.title}>
            <button
              type="button"
              onClick={() => setCollapsed((current) => ({ ...current, [group.title]: !closed }))}
              className="flex w-full items-center justify-between px-2 pb-1 text-left text-[9px] font-bold uppercase tracking-[0.19em] text-white/28 transition hover:text-white/50"
            >
              <span>{group.title}</span>
              <ChevronDown className={`h-3 w-3 transition ${closed ? "-rotate-90" : ""}`} />
            </button>

            {!closed ? (
              <div className="grid gap-0.5">
                {group.items.map((item) => {
                  const active = isActive(pathname, item.href);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={`${group.title}:${item.label}`}
                      href={item.href}
                      onClick={onNavigate}
                      className={`group relative flex min-h-9 items-center gap-2.5 rounded-xl px-2.5 text-[12px] transition ${
                        active
                          ? "bg-violet-500/15 text-white shadow-[inset_2px_0_0_rgba(167,139,250,.9),0_0_24px_rgba(124,58,237,.08)]"
                          : "text-white/58 hover:bg-white/[0.045] hover:text-white/88"
                      }`}
                    >
                      <Icon className={`h-4 w-4 shrink-0 ${active ? "text-violet-300" : "text-white/40 group-hover:text-violet-300/80"}`} />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.badge ? (
                        <span className="rounded-full bg-red-500/90 px-1.5 py-0.5 text-[9px] font-bold text-white">{item.badge}</span>
                      ) : null}
                      {item.status === "no_config" ? (
                        <span className="rounded-full border border-amber-300/15 bg-amber-300/[0.06] px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-[0.08em] text-amber-200/70">No config</span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

export function AdminSidebar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <aside className="sticky top-20 hidden max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-[20px] border border-white/[0.07] bg-[#080914]/88 shadow-[0_18px_60px_rgba(0,0,0,.28)] backdrop-blur-xl md:block">
        <SidebarContent />
      </aside>

      <div className="md:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-white"
        >
          <Menu className="h-4 w-4" /> Admin
        </button>
      </div>

      {mobileOpen ? (
        <div className="fixed inset-0 z-[120] md:hidden">
          <button type="button" aria-label="Cerrar menú" onClick={() => setMobileOpen(false)} className="absolute inset-0 bg-black/75 backdrop-blur-sm" />
          <aside className="absolute inset-y-0 left-0 w-[min(88vw,320px)] overflow-y-auto border-r border-white/10 bg-[#070811] shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-end border-b border-white/[0.06] bg-[#070811]/95 p-3 backdrop-blur-xl">
              <button type="button" onClick={() => setMobileOpen(false)} className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-white/70">
                <X className="h-4 w-4" />
              </button>
            </div>
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      ) : null}
    </>
  );
}
