"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

const POLL_INTERVAL_MS = 60_000;

function timeAgo(value: string) {
  const diffMs = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `hace ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours}h`;
  return `hace ${Math.floor(hours / 24)}d`;
}

/** Campanita real: cuenta no leídas y lista las últimas notificaciones
 * (por ahora, VIP otorgado). Solo se renderiza si hay sesión iniciada. */
export function NotificationBell({ className = "" }: { className?: string }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      const response = await authenticatedFetch("/api/notifications");
      const payload = await readApiJson<{ notifications: NotificationRow[]; unreadCount: number }>(response);
      setItems(payload.notifications);
      setUnreadCount(payload.unreadCount);
    } catch {
      // Silencioso: la campanita no debe romper el resto de la página.
    }
  };

  useEffect(() => {
    if (!user) return;
    void load();
    const interval = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [user]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const markRead = async (id: string) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, read_at: new Date().toISOString() } : item)));
    setUnreadCount((count) => Math.max(0, count - 1));
    try {
      await authenticatedFetch("/api/notifications", { method: "PATCH", body: JSON.stringify({ id }) });
    } catch {
      // best-effort
    }
  };

  if (!user) return null;

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        aria-label="Notificaciones"
        onClick={() => setOpen((value) => !value)}
        className="relative grid h-9 w-9 place-items-center rounded-full text-white/55 transition hover:bg-white/5 hover:text-white"
      >
        <Bell size={17} />
        {unreadCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-violet-500 px-1 text-[9px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-[70] mt-2 w-80 max-w-[92vw] overflow-hidden rounded-2xl border border-white/10 bg-[#0a0810] shadow-2xl">
          <div className="border-b border-white/10 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-white/50">
            Notificaciones
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-white/40">Todavía no tenés notificaciones.</p>
            ) : (
              items.map((item) => {
                const content = (
                  <div className="flex items-start gap-2">
                    {!item.read_at ? <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-violet-400" /> : <span className="mt-1.5 h-2 w-2 shrink-0" />}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">{item.title}</p>
                      {item.body ? <p className="mt-0.5 text-xs text-white/55">{item.body}</p> : null}
                      <p className="mt-1 text-[10px] text-white/35">{timeAgo(item.created_at)}</p>
                    </div>
                  </div>
                );
                return item.link ? (
                  <Link
                    key={item.id}
                    href={item.link}
                    onClick={() => {
                      setOpen(false);
                      if (!item.read_at) void markRead(item.id);
                    }}
                    className="block border-b border-white/[0.04] px-4 py-3 transition hover:bg-white/[0.03]"
                  >
                    {content}
                  </Link>
                ) : (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => !item.read_at && void markRead(item.id)}
                    className="block w-full border-b border-white/[0.04] px-4 py-3 text-left transition hover:bg-white/[0.03]"
                  >
                    {content}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
