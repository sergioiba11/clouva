export type InstagramTokenResponse = {
  access_token: string;
  user_id: string | number;
  permissions?: string[];
};

export type InstagramLongLivedTokenResponse = {
  access_token: string;
  token_type?: string;
  expires_in?: number;
};

export type InstagramProfile = {
  id: string;
  user_id?: string;
  username?: string;
  name?: string;
  account_type?: string;
  profile_picture_url?: string;
  followers_count?: number;
  media_count?: number;
  biography?: string;
};

export type InstagramMedia = {
  id: string;
  caption?: string;
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM" | string;
  media_url?: string;
  permalink?: string;
  thumbnail_url?: string;
  timestamp?: string;
  username?: string;
};

export type InstagramMediaPage = {
  data: InstagramMedia[];
  paging?: {
    cursors?: { before?: string; after?: string };
    next?: string;
  };
};

export type InstagramImportSnapshot = {
  profile: InstagramProfile;
  media: InstagramMedia[];
};
