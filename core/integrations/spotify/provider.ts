import type { MusicProvider } from "@/core/music/provider";
import { getSpotifyArtist, getSpotifyArtistReleases, resolveSpotifyArtist } from "./catalog";
import { isSpotifyUriSaved, removeSpotifyUri, saveSpotifyUri } from "./service";

export const SpotifyProvider: MusicProvider = {
  name: "spotify",
  getArtist: getSpotifyArtist,
  resolveArtist: resolveSpotifyArtist,
  getArtistReleases: getSpotifyArtistReleases,
  saveTrack: saveSpotifyUri,
  removeTrack: removeSpotifyUri,
  isTrackSaved: isSpotifyUriSaved,
  followArtist: saveSpotifyUri,
  unfollowArtist: removeSpotifyUri,
  isArtistFollowed: isSpotifyUriSaved,
};
