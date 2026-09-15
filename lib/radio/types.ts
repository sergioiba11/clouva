export type RadioStatus = "IDLE" | "CONNECTING" | "LIVE" | "OFFLINE" | "ERROR";

export type RadioMetadata = {
  title: string;
  artist: string;
  program: string;
  host?: string | null;
  artwork?: string | null;
  startedAt?: string | null;
  endsAt?: string | null;
};

export type RadioOwnerKind = "player" | "space" | "studio";

export type RadioStationConfig = {
  id: string;
  ownerKind: RadioOwnerKind;
  ownerId: string;
  alias: string;
  profileHref: string;
  name: string;
  tagline: string | null;
  streamUrl: string;
  artworkUrl: string | null;
  enabled: boolean;
  published: boolean;
  metadata: RadioMetadata;
};
