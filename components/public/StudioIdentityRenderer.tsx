import { PreciseStudioLayoutRenderer } from "./PreciseStudioLayoutRenderer";
import { StudioLayoutRenderer } from "./StudioLayoutRenderer";
import { StudioPublicView } from "./StudioPublicView";
import type { StudioIdentityData } from "@/lib/server/public-identity-data";

/** The live page and its authorized proposal preview share this renderer.
 * Only the canonical version snapshot changes; the component tree does not. */
export function StudioIdentityRenderer({
  data,
  joined = false,
}: {
  data: StudioIdentityData;
  joined?: boolean;
}) {
  if (data.layoutConfig?.layout_kind === "precise") {
    return (
      <PreciseStudioLayoutRenderer
        studio={data.studio}
        players={data.players}
        media={data.media}
        projects={data.projects}
        matrixDiscoveryProjects={data.matrixDiscoveryProjects}
        services={data.services}
        membershipPlans={data.membershipPlans}
        joined={joined}
        layout={data.layoutConfig}
      />
    );
  }

  if (data.layoutConfig) {
    return (
      <StudioLayoutRenderer
        studio={data.studio}
        players={data.players}
        media={data.media}
        projects={data.projects}
        matrixDiscoveryProjects={data.matrixDiscoveryProjects}
        services={data.services}
        membershipPlans={data.membershipPlans}
        joined={joined}
        layout={data.layoutConfig}
      />
    );
  }

  return (
    <StudioPublicView
      studio={data.studio}
      players={data.players}
      media={data.media}
      projects={data.projects}
      services={data.services}
      membershipPlans={data.membershipPlans}
      joined={joined}
    />
  );
}
