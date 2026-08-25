import { ClouvaQrEngineEventBridge } from "@/components/commerce/ClouvaQrEngineEventBridge";
import { ClouvaQrEnginePanel } from "@/components/commerce/ClouvaQrEnginePanel";
import { SpotCommerceDashboard } from "@/components/commerce/SpotCommerceDashboard";

/**
 * Canonical operational workspace for every CLOUVA Space with commerce enabled.
 *
 * `commerceScopeId` can be either a Studio id or the direct Spot scope
 * `spot:<uuid>`. The commerce API resolves both through requireManagedSpot(),
 * so scanner, catalog, inventory, POS, orders, codes and QR stay on one engine.
 */
export function SpaceCommerceWorkspace({ commerceScopeId }: { commerceScopeId: string }) {
  return (
    <>
      <SpotCommerceDashboard studioId={commerceScopeId} />
      <ClouvaQrEnginePanel studioId={commerceScopeId} />
      <ClouvaQrEngineEventBridge />
    </>
  );
}
