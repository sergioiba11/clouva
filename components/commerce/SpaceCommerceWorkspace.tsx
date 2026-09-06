"use client";

import Link from "next/link";
import { Megaphone } from "lucide-react";
import { GlobalFlowBalance } from "@/components/GlobalFlowBalance";
import { OfficialClouvaMark } from "@/components/clouva/OfficialClouvaMark";
import { ClouvaQrEngineEventBridge } from "@/components/commerce/ClouvaQrEngineEventBridge";
import { ClouvaQrEnginePanel } from "@/components/commerce/ClouvaQrEnginePanel";
import { SpotCommerceDashboard } from "@/components/commerce/SpotCommerceDashboard";
import styles from "./SpaceCommerceWorkspace.module.css";

/**
 * Canonical operational workspace for every CLOUVA Space with commerce enabled:
 * Studio, business, Spot, club, brand or any future Space that activates Commerce.
 *
 * `commerceScopeId` can be either a Studio id or the direct Spot scope
 * `spot:<uuid>`. The commerce API resolves both through requireManagedSpot(),
 * so scanner, catalog, inventory, POS, orders, codes and QR stay on one engine.
 */
export function SpaceCommerceWorkspace({ commerceScopeId }: { commerceScopeId: string }) {
  const directSpotId = commerceScopeId.startsWith("spot:") ? commerceScopeId.slice("spot:".length).trim() : null;

  return (
    <div className={styles.workspace} data-space-commerce-workspace>
      <header className={styles.clouvaBar} aria-label="CLOUVA · Centro Operativo">
        <Link href="/" className={styles.brand} aria-label="Ir al inicio de CLOUVA">
          <span className={styles.mark}>
            <OfficialClouvaMark width={34} height={34} tone="light" />
          </span>
          <span className={styles.brandCopy}>
            <strong>CLOUVA</strong>
            <small>Centro Operativo</small>
          </span>
        </Link>
        <div className="flex items-center gap-2">
          {directSpotId ? <Link href={`/mi-spot/${directSpotId}/publicaciones`} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white/65 transition hover:border-violet-400/30 hover:text-white"><Megaphone size={14} /> Publicaciones</Link> : null}
          <GlobalFlowBalance variant="header" />
        </div>
      </header>

      <SpotCommerceDashboard studioId={commerceScopeId} />
      <ClouvaQrEnginePanel studioId={commerceScopeId} />
      <ClouvaQrEngineEventBridge />
    </div>
  );
}
