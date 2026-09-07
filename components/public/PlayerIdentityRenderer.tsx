import { PlayerPublicView } from "./PlayerPublicView";
import { PrecisePlayerLayoutRenderer } from "./PrecisePlayerLayoutRenderer";
import type { LayoutConfig } from "@/lib/server/layout-config";
import type { Player, PlayerMedia, PlayerStudioAffiliation } from "@/lib/players-data";

/**
 * Canonical Player identity renderer. Public pages and the authorized signed
 * Reference Fidelity preview call this same component tree.
 */
export function PlayerIdentityRenderer({
  player,
  affiliations,
  media,
  isVip,
  layoutConfig,
  hasMerch = false,
}: {
  player: Player;
  affiliations: PlayerStudioAffiliation[];
  media: PlayerMedia[];
  isVip: boolean;
  layoutConfig: LayoutConfig | null;
  hasMerch?: boolean;
}) {
  if (layoutConfig?.layout_kind === "precise") {
    return (
      <PrecisePlayerLayoutRenderer
        player={player}
        affiliations={affiliations}
        media={media}
        layout={layoutConfig}
      />
    );
  }

  return (
    <PlayerPublicView
      player={player}
      affiliations={affiliations}
      media={media}
      isVip={isVip}
      layoutConfig={layoutConfig}
      hasMerch={hasMerch}
    />
  );
}
