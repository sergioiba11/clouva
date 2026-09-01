export type YoutubeTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

export type YoutubeChannel = {
  id: string;
  snippet?: {
    title?: string;
    customUrl?: string;
    thumbnails?: Record<string, { url?: string }>;
  };
  contentDetails?: {
    relatedPlaylists?: { uploads?: string };
  };
};

export type YoutubePlaylistItem = {
  id: string;
  snippet?: {
    title?: string;
    publishedAt?: string;
    thumbnails?: Record<string, { url?: string }>;
    resourceId?: { videoId?: string };
  };
  contentDetails?: { videoId?: string };
};

export type YoutubePublicConnection = {
  connected: boolean;
  provider: "youtube";
  displayName: string | null;
  externalUsername: string | null;
  channelUrl: string | null;
  thumbnailUrl: string | null;
  status: string | null;
  connectedAt: string | null;
  lastSyncedAt: string | null;
};
