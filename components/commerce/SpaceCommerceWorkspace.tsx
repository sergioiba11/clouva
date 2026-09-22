"use client";

import { CommerceAiProviderCopyBridge } from "@/components/commerce/CommerceAiProviderCopyBridge";
import { ClouvaQrEngineEventBridge } from "@/components/commerce/ClouvaQrEngineEventBridge";
import { ClouvaQrEnginePanel } from "@/components/commerce/ClouvaQrEnginePanel";
import { SpotCommerceDashboard } from "@/components/commerce/SpotCommerceDashboard";
import styles from "./SpaceCommerceWorkspace.module.css";

/**
 * Canonical operational workspace for every CLOUVA Space with commerce enabled.
 * The global CLOUVA shell already owns the primary navigation, so Commerce keeps
 * a single contextual header inside SpotCommerceDashboard instead of stacking
 * another app bar on top of it.
 */
export function SpaceCommerceWorkspace({
  commerceScopeId,
  businessSpaceId,
}: {
  commerceScopeId: string;
  businessSpaceId?: string | null;
}) {
  const directSpotId = commerceScopeId.startsWith("spot:")
    ? commerceScopeId.slice("spot:".length).trim()
    : null;

  return (
    <div className={styles.workspace} data-space-commerce-workspace>
      <CommerceAiProviderCopyBridge>
        <SpotCommerceDashboard
          studioId={commerceScopeId}
          businessSpaceId={businessSpaceId}
          directSpotId={directSpotId}
        />
        <ClouvaQrEnginePanel studioId={commerceScopeId} />
        <ClouvaQrEngineEventBridge />
      </CommerceAiProviderCopyBridge>
    </div>
  );
}
