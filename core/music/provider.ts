import type { SupabaseClient } from "@supabase/supabase-js";
import type { NormalizedArtist, NormalizedMusicTrack } from "@/core/integrations/spotify/types";

export interface MusicProvider {
  readonly name: "spotify";
  getArtist(id: string): Promise<NormalizedArtist>;
  resolveArtist(value: string): Promise<NormalizedArtist>;
  getArtistReleases(artistId: string, artistName: string): Promise<NormalizedMusicTrack[]>;
  saveTrack(admin: SupabaseClient, userId: string, trackUri: string): Promise<void>;
  removeTrack(admin: SupabaseClient, userId: string, trackUri: string): Promise<void>;
  isTrackSaved(admin: SupabaseClient, userId: string, trackUri: string): Promise<boolean>;
  followArtist(admin: SupabaseClient, userId: string, artistUri: string): Promise<void>;
  unfollowArtist(admin: SupabaseClient, userId: string, artistUri: string): Promise<void>;
  isArtistFollowed(admin: SupabaseClient, userId: string, artistUri: string): Promise<boolean>;
}
