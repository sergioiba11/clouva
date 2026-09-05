"use client";

import Link from "next/link";
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
        <GlobalFlowBalance variant="header" />
      </header>

      <SpotCommerceDashboard studioId={commerceScopeId} />
      <ClouvaQrEnginePanel studioId={commerceScopeId} />
      <ClouvaQrEngineEventBridge />
    </div>
  );
}
