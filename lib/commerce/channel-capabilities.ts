export type ChannelCapability = {
  canPublishAutomatically: boolean;
  canSchedule: boolean;
  canReadComments: boolean;
  canReadMessages: boolean;
  canReply: boolean;
  requiresUserAction: boolean;
};

export type CommercePublicationChannel =
  | "clouva"
  | "clouva_market"
  | "facebook_marketplace"
  | "facebook_group"\n  | "facebook_page";

const CLOUVA_INTERNAL_CAPABILITY: ChannelCapability = {
  canPublishAutomatically: true,
  canSchedule: false,
  canReadComments: false,
  canReadMessages: false,
  canReply: false,
  requiresUserAction: false,
};

const CAPABILITIES: Record<CommercePublicationChannel, ChannelCapability> = {
  clouva: CLOUVA_INTERNAL_CAPABILITY,
  clouva_market: CLOUVA_INTERNAL_CAPABILITY,
  facebook_marketplace: {
    canPublishAutomatically: false,
    canSchedule: false,
    canReadComments: false,
    canReadMessages: false,
    canReply: false,
    requiresUserAction: true,
  },
  facebook_group: {
    // Meta removed the Groups API and publish_to_groups on 2024-04-22.
    // CLOUVA therefore prepares the asset/copy/destination and keeps the
    // final publication step explicitly assisted instead of simulating an API.
    canPublishAutomatically: false,
    canSchedule: false,
    canReadComments: false,
    canReadMessages: false,
    canReply: false,
    requiresUserAction: true,
  },
  facebook_page: {
    canPublishAutomatically: true,
    canSchedule: true,
    canReadComments: false,
    canReadMessages: false,
    canReply: false,
    requiresUserAction: false,
  },
};

export function getChannelCapability(channel: string): ChannelCapability | null {
  return channel in CAPABILITIES
    ? CAPABILITIES[channel as CommercePublicationChannel]
    : null;
}

export function publicationModeForChannel(
  channel: string,
  requestedMode?: string | null,
): "automatic" | "assisted" | "manual" {
  const capability = getChannelCapability(channel);
  if (!capability) {
    return requestedMode === "automatic" || requestedMode === "assisted" || requestedMode === "manual"
      ? requestedMode
      : "assisted";
  }

  if (requestedMode === "manual") return "manual";
  if (requestedMode === "assisted") return "assisted";
  if (requestedMode === "automatic" && capability.canPublishAutomatically) return "automatic";
  return capability.canPublishAutomatically ? "automatic" : "assisted";
}
