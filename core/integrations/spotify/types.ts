export type MusicProviderName = "spotify";

export type SpotifyPendingAction =
  | { type: "save_track"; uri: string }
  | { type: "follow_artist"; uri: string };

export type SpotifyPublicConnection = {
  connected: boolean;
  provider: "spotify";
  displayName: string | null;
  externalUsername: string | null;
  avatarUrl: string | null;
  scopes: string[];
  status: string | null;
  connectedAt: string | null;
  lastSyncedAt: string | null;
};

export type NormalizedArtist = {
  provider: "spotify";
  id: string;
  uri: string;
  name: string;
  externalUrl: string;
  imageUrl: string | null;
};

export type NormalizedMusicTrack = {
  provider: "spotify";
  id: string;
  uri: string;
  albumId: string | null;
  title: string;
  artist: string;
  album: string | null;
  coverUrl: string | null;
  externalUrl: string;
  releaseDate: string | null;
};

export type MusicActionResult =
  | { ok: true; saved?: boolean; followed?: boolean }
  | {
      ok: false;
      code:
        | "spotify_connection_required"
        | "spotify_reconnect_required"
        | "spotify_rate_limited"
        | "spotify_permission_missing"
        | "spotify_api_error"
        | "spotify_disabled"
        | "unauthorized"
        | "invalid_request";
    };

export type SpotifyTokenResponse = {
  access_token: string;
  token_type: string;
  scope?: string;
  expires_in: number;
  refresh_token?: string;
};

export type SpotifyMe = {
  id: string;
  display_name?: string | null;
  email?: string | null;
  images?: Array<{ url: string; height?: number | null; width?: number | null }>;
  external_urls?: { spotify?: string };
};
