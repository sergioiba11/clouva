"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import {
  Boxes,
  CircleUserRound,
  LogOut,
  Plus,
  QrCode,
  Repeat2,
  Settings,
  ShieldCheck,
  Sparkles,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { useCurrentPlayer } from "@/components/current-player-provider";
import { getAccounts, switchAccount, type StoredAccount } from "@/lib/account-switcher";
import { resolveAccountDisplayName, resolveCurrentPlayerStatus } from "@/lib/identity-names";
import styles from "./AccountMenu.module.css";

type AccountMenuProps = {
  variant?: "nav" | "home";
  triggerClassName?: string;
  preferUsername?: boolean;
};

type MenuLinkProps = {
  href: string;
  icon: React.ReactNode;
  label: string;
  detail?: string;
  onSelect: () => void;
  tone?: "default" | "accent" | "admin";
};

function MenuLink({ href, icon, label, detail, onSelect, tone = "default" }: MenuLinkProps) {
  return (
    <Link href={href} onClick={onSelect} role="menuitem" className={`${styles.menuItem} ${styles[tone]}`}>
      <span className={styles.itemIcon}>{icon}</span>
      <span><b>{label}</b>{detail ? <small>{detail}</small> : null}</span>
    </Link>
  );
}

export function AccountMenu({ variant = "nav", triggerClassName = "", preferUsername = true }: AccountMenuProps) {
  const { user, profile, role, loading } = useAuth();
  const { currentPlayer } = useCurrentPlayer();
  const pathname = usePathname();
  const router = useRouter();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [openMenu, setOpenMenu] = useState(false);
  const [openSwitch, setOpenSwitch] = useState(false);
  const [accounts, setAccounts] = useState<StoredAccount[]>([]);
  const [avatarBroken, setAvatarBroken] = useState(false);

  const username = currentPlayer?.username?.trim().replace(/^@/, "") || profile?.username?.trim().replace(/^@/, "") || null;
  const accountName = resolveAccountDisplayName({ profile: username ? { username } : null, user: null });
  const clouvaName = currentPlayer?.display_name?.trim() || accountName;
  const primaryName = preferUsername ? username || clouvaName : clouvaName;
  const accountUsername = username ? `@${username}` : "Tu cuenta CLOUVA";
  const accountDetail = accountUsername;
  const avatar = currentPlayer?.profile_image_url ?? currentPlayer?.logo_url ?? profile?.avatar_url ?? user?.user_metadata?.avatar_url;
  const canAdmin = role === "admin";
  const publicProfileHref = resolveCurrentPlayerStatus(currentPlayer) === "published" && currentPlayer ? `/${encodeURIComponent(currentPlayer.slug)}` : "/profile/edit";

  useEffect(() => { if (openSwitch) setAccounts(getAccounts()); }, [openSwitch]);
  useEffect(() => { if (typeof window !== "undefined" && user && new URLSearchParams(window.location.search).get("openAccountSwitcher") === "1") setOpenSwitch(true); }, [user]);
  useEffect(() => { setOpenMenu(false); }, [pathname]);
  useEffect(() => {
    if (!openMenu) return;
    const handlePointer = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpenMenu(false); };
    const handleKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpenMenu(false); triggerRef.current?.focus(); } };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("mousedown", handlePointer); document.removeEventListener("keydown", handleKey); };
  }, [openMenu]);

  if (loading) return <div className={`${styles.skeleton} ${triggerClassName}`} aria-label="Cargando cuenta" />;
  if (!user) return <Link href="/login" className={`${styles.login} ${triggerClassName}`}>Ingresar</Link>;

  const closeMenu = () => setOpenMenu(false);

  return (
    <div ref={rootRef} className={`${styles.root} ${variant === "home" ? styles.homeRoot : ""}`}>
      <button ref={triggerRef} type="button" className={`${styles.trigger} ${variant === "home" ? styles.homeTrigger : ""} ${triggerClassName}`} onClick={() => setOpenMenu((value) => !value)} aria-expanded={openMenu} aria-controls={menuId} aria-haspopup="menu">
        {avatar && !avatarBroken ? <Image src={String(avatar)} alt="" width={32} height={32} className={styles.avatar} onError={() => setAvatarBroken(true)} /> : <span className={styles.avatarFallback}>{primaryName.charAt(0).toUpperCase() || "C"}</span>}
        <span className={styles.triggerCopy}><b>{primaryName}</b><small>{variant === "home" ? "Tu cuenta CLOUVA" : accountDetail}</small></span>
      </button>

      {openMenu ? (
        <section id={menuId} role="menu" aria-label="Tu cuenta CLOUVA" className={styles.popover}>
          <header className={styles.identity}>
            {avatar && !avatarBroken ? <Image src={String(avatar)} alt="" width={48} height={48} className={styles.identityAvatar} /> : <span className={styles.identityFallback}>{primaryName.charAt(0).toUpperCase() || "C"}</span>}
            <div><strong>{primaryName}</strong><span>{accountDetail}</span><small><i /> Conectado</small></div>
          </header>

          <div className={styles.primaryLinks}>
            <MenuLink href="/mi-flow" icon={<UserRound size={17} />} label="MI FLOW" detail="Billetera, ganancias, FLOWS y Diamantes" onSelect={closeMenu} tone="accent" />
            <MenuLink href="/mi-spot" icon={<Boxes size={17} />} label="MI SPOT" detail="Productos, ventas, stock y scanner" onSelect={closeMenu} />
            <MenuLink href={publicProfileHref} icon={<CircleUserRound size={17} />} label="Mi perfil público" detail="Tu identidad dentro de La Matrix" onSelect={closeMenu} />
            <MenuLink href="/mi-qr" icon={<QrCode size={17} />} label="Mi QR" detail="Mostrar, compartir y descargar tu QR CLOUVA" onSelect={closeMenu} />
            {canAdmin ? <MenuLink href="/mi-flow/avatar" icon={<Boxes size={17} />} label="Mi Avatar 3D" detail="Personalizá tu personaje" onSelect={closeMenu} /> : <div role="menuitem" className={`${styles.menuItem} ${styles.disabled}`} aria-disabled="true"><span className={styles.itemIcon}><Boxes size={17} /></span><span><b>Mi Avatar 3D</b><small>Próximamente</small></span></div>}
            <MenuLink href="/perfil/configuracion" icon={<Settings size={17} />} label="Configuración" detail="Privacidad y preferencias" onSelect={closeMenu} />
          </div>

          <div className={styles.secondaryLinks}>
            <MenuLink href="/mi-flow/creative" icon={<Sparkles size={16} />} label="Centro creativo" onSelect={closeMenu} />
            <MenuLink href="/profile/edit" icon={<Sparkles size={16} />} label="Editar identidad" onSelect={closeMenu} />
            <MenuLink href="/profile/memberships" icon={<UsersRound size={16} />} label="Mis Estudios" onSelect={closeMenu} />
            <MenuLink href="/login?addAccount=1" icon={<Plus size={16} />} label="Agregar cuenta" onSelect={closeMenu} />
            {canAdmin ? <MenuLink href="/admin" icon={<ShieldCheck size={16} />} label="Administración" onSelect={closeMenu} tone="admin" /> : null}
            <button type="button" role="menuitem" className={styles.menuItem} onClick={() => { setOpenMenu(false); setOpenSwitch(true); }}><span className={styles.itemIcon}><Repeat2 size={16} /></span><span><b>Cambiar cuenta</b></span></button>
            <button type="button" role="menuitem" className={`${styles.menuItem} ${styles.signOut}`} onClick={async () => { const { supabase } = await import("@/lib/supabase"); await supabase.auth.signOut(); setOpenMenu(false); router.push("/login"); }}><span className={styles.itemIcon}><LogOut size={16} /></span><span><b>Cerrar sesión</b></span></button>
          </div>
        </section>
      ) : null}

      {openSwitch ? (
        <div className={styles.switchBackdrop} role="dialog" aria-modal="true" aria-labelledby={`${menuId}-switch-title`}>
          <section className={styles.switchDialog}>
            <header><div><small>CUENTAS CLOUVA</small><h2 id={`${menuId}-switch-title`}>Cambiar cuenta</h2></div><button type="button" onClick={() => setOpenSwitch(false)} aria-label="Cerrar"><X size={18} /></button></header>
            <div className={styles.accountList}>
              {accounts.length ? accounts.map((account) => <button key={account.id} type="button" onClick={() => { setOpenSwitch(false); void switchAccount(account.id); }}><span>{account.display_name.charAt(0).toUpperCase()}</span><div><b>{account.display_name}</b><small>{account.email}</small></div></button>) : <p>No hay otras cuentas guardadas en este dispositivo.</p>}
            </div>
            <Link href="/login?addAccount=1" onClick={() => setOpenSwitch(false)} className={styles.addAccount}><Plus size={16} /> Agregar otra cuenta</Link>
          </section>
        </div>
      ) : null}
    </div>
  );
}
