import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { extractSpotifyArtistId } from "./core/integrations/spotify/catalog.ts";
import { getSpotifyConfig } from "./core/integrations/spotify/config.ts";
import { decryptSpotifySecret, encryptSpotifySecret } from "./core/integrations/spotify/crypto.ts";
import { parseSpotifyPendingAction, sanitizeSpotifyReturnPath } from "./core/integrations/spotify/state.ts";
import { SpotifyProvider } from "./core/integrations/spotify/provider.ts";

test("Spotify return paths stay local to CLOUVA", () => {
  assert.equal(sanitizeSpotifyReturnPath("/settings/connections"), "/settings/connections");
  assert.equal(sanitizeSpotifyReturnPath("https://evil.example"), "/settings/connections");
  assert.equal(sanitizeSpotifyReturnPath("//evil.example"), "/settings/connections");
  assert.equal(sanitizeSpotifyReturnPath("/safe\\evil"), "/settings/connections");
});

test("pending Spotify actions only accept typed track/artist URIs", () => {
  assert.deepEqual(parseSpotifyPendingAction({ type: "save_track", uri: "spotify:track:abc123" }), { type: "save_track", uri: "spotify:track:abc123" });
  assert.deepEqual(parseSpotifyPendingAction({ type: "follow_artist", uri: "spotify:artist:abc123" }), { type: "follow_artist", uri: "spotify:artist:abc123" });
  assert.equal(parseSpotifyPendingAction({ type: "save_track", uri: "https://example.com" }), null);
  assert.equal(parseSpotifyPendingAction({ type: "follow_artist", uri: "spotify:track:abc123" }), null);
});

test("Spotify Artist input resolves IDs without confusing names", () => {
  assert.equal(extractSpotifyArtistId("spotify:artist:1234567890abcdefghijkl"), "1234567890abcdefghijkl");
  assert.equal(extractSpotifyArtistId("https://open.spotify.com/artist/1234567890abcdefghijkl?si=x"), "1234567890abcdefghijkl");
  assert.equal(extractSpotifyArtistId("Clouva"), null);
});

test("Spotify secrets use authenticated AES encryption", () => {
  const previous = process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY;
  process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  try {
    const encrypted = encryptSpotifySecret("super-secret-token");
    assert.notEqual(encrypted.ciphertext, "super-secret-token");
    assert.equal(decryptSpotifySecret(encrypted), "super-secret-token");
  } finally {
    if (previous === undefined) delete process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY;
    else process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY = previous;
  }
});

test("Spotify configuration is runtime-resolved and keeps secrets server-side", () => {
  const previous = {
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirect: process.env.SPOTIFY_REDIRECT_URI,
  };
  process.env.SPOTIFY_CLIENT_ID = "client";
  process.env.SPOTIFY_CLIENT_SECRET = "secret";
  process.env.SPOTIFY_REDIRECT_URI = "https://clouva.com.ar/api/integrations/spotify/callback";
  try {
    const config = getSpotifyConfig();
    assert.equal(config.clientId, "client");
    assert.equal(config.clientSecret, "secret");
    assert.ok(config.scopes.includes("user-library-modify"));
    assert.ok(config.scopes.includes("user-follow-modify"));
  } finally {
    for (const [name, value] of [["SPOTIFY_CLIENT_ID", previous.clientId], ["SPOTIFY_CLIENT_SECRET", previous.clientSecret], ["SPOTIFY_REDIRECT_URI", previous.redirect]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("MusicProvider contract is implemented by Spotify", () => {
  assert.equal(SpotifyProvider.name, "spotify");
  for (const method of ["getArtist", "resolveArtist", "getArtistReleases", "saveTrack", "removeTrack", "isTrackSaved", "followArtist", "unfollowArtist", "isArtistFollowed"]) {
    assert.equal(typeof SpotifyProvider[method], "function", method);
  }
});

test("migration creates cache tables and keeps personal tokens in social_connections", () => {
  const sql = fs.readFileSync("supabase/migrations/20260823210000_spotify_music_engine.sql", "utf8");
  assert.match(sql, /create table if not exists public\.player_music_connections/i);
  assert.match(sql, /create table if not exists public\.external_music_tracks/i);
  assert.match(sql, /enable row level security/i);
  assert.doesNotMatch(sql, /access_token/i);
  assert.doesNotMatch(sql, /refresh_token/i);
});

test("mobile Home no longer has a local fake favorite source of truth", () => {
  const source = fs.readFileSync("components/clouva/MobileHomeDashboard.tsx", "utf8");
  assert.doesNotMatch(source, /setFavorite\(/);
  assert.match(source, /SpotifyLikeButton/);
  assert.match(source, /\/api\/music\/home/);
});
