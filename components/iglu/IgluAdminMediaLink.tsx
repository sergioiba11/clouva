"use client";

import Link from "next/link";
import { Music2 } from "lucide-react";
import { useEffect, useState } from "react";
import { authenticatedFetch } from "@/lib/authenticated-fetch";

export function IgluAdminMediaLink({ href, className }: { href: string; className?: string }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let alive = true;
    authenticatedFetch("/api/iglu/media/manage", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as { canManage?: boolean };
        if (alive) setVisible(response.ok && body.canManage === true);
      })
      .catch(() => {
        if (alive) setVisible(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!visible) return null;

  return (
    <Link className={className} href={href} aria-label="Administrar música de IGLÚ">
      <Music2 aria-hidden="true" size={18} />
      <span>BIBLIOTECA / SUBIR MÚSICA</span>
    </Link>
  );
}
