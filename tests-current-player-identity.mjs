import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  resolveAccountDisplayName,
  resolveCurrentPlayerStatus,
  resolveHomeDisplayName,
} from "./lib/identity-names.ts";
import { isCurrentPlayerMutation } from "./lib/current-player-events.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

const user = {
  email: "sergio@example.com",
  user_metadata: { full_name: "Sergio Google", name: "Sergio" },
};

const profile = {
  display_name: "Clover NLB",
  username: "@clover",
  full_name: "Sergio Espejo",
};

const publishedPlayer = {
  display_name: "CLOUVA",
  is_published: true,
  publication_status: "published",
};

test("Home identity follows Player > display name > username > full name > OAuth > email", () => {
  assert.equal(resolveHomeDisplayName({ currentPlayer: publishedPlayer, profile, user }), "CLOUVA");
  assert.equal(resolveHomeDisplayName({ currentPlayer: null, profile, user }), "Clover NLB");
  assert.equal(resolveHomeDisplayName({ currentPlayer: null, profile: { ...profile, display_name: null }, user }), "clover");
  assert.equal(resolveHomeDisplayName({ currentPlayer: null, profile: { display_name: null, username: null, full_name: "Nombre completo" }, user }), "Nombre completo");
  assert.equal(resolveHomeDisplayName({ currentPlayer: null, profile: null, user }), "Sergio Google");
  assert.equal(resolveHomeDisplayName({ currentPlayer: null, profile: null, user: { email: "correo@example.com", user_metadata: {} } }), "correo");
  assert.equal(resolveHomeDisplayName({ currentPlayer: null, profile: null, user: null }), "CLOUVA");
});

test("Account identity never substitutes the artistic Player identity", () => {
  assert.equal(resolveAccountDisplayName({ profile, user }), "Clover NLB");
  assert.equal(resolveAccountDisplayName({ profile: { display_name: null, username: "@cuenta", full_name: "Legal" }, user }), "cuenta");
  assert.equal(resolveAccountDisplayName({ profile: null, user }), "Sergio Google");
});

test("Current Player lifecycle distinguishes none, draft and published", () => {
  assert.equal(resolveCurrentPlayerStatus(null), "none");
  assert.equal(resolveCurrentPlayerStatus({ display_name: "Borrador", is_published: false, publication_status: "draft" }), "draft");
  assert.equal(resolveCurrentPlayerStatus({ display_name: "Despublicado", is_published: false, publication_status: "unpublished" }), "draft");
  assert.equal(resolveCurrentPlayerStatus(publishedPlayer), "published");
});

test("Only successful canonical Player mutations are eligible to trigger a refresh", () => {
  assert.equal(isCurrentPlayerMutation("/api/players/me"), false);
  assert.equal(isCurrentPlayerMutation("/api/players/me", { method: "POST" }), true);
  assert.equal(isCurrentPlayerMutation("https://clouva.com.ar/api/players/me?source=editor", { method: "PATCH" }), true);
  assert.equal(isCurrentPlayerMutation("/api/players/me/other", { method: "PATCH" }), false);
  assert.equal(isCurrentPlayerMutation("/api/studios/me", { method: "POST" }), false);
});

test("CurrentPlayerProvider reuses the canonical endpoint and clears state by authenticated user", () => {
  const provider = read("./components/current-player-provider.tsx");
  const fetcher = read("./lib/authenticated-fetch.ts");

  assert.match(provider, /authenticatedFetch\("\/api\/players\/me"\)/);
  assert.doesNotMatch(provider, /method:\s*["']POST["']/);
  assert.match(provider, /resolvedUserIdRef\.current !== user\.id/);
  assert.match(provider, /clearCurrentPlayer\(\)/);
  assert.match(provider, /CURRENT_PLAYER_CHANGED_EVENT/);
  assert.match(fetcher, /response\.ok && isCurrentPlayerMutation/);
});

test("Home and account surfaces consume the centralized identity helpers", () => {
  const home = read("./components/clouva/HomeDashboard.tsx");
  const nav = read("./components/layout.tsx");
  const accountMenu = read("./components/account/AccountMenu.tsx");
  const profilePage = read("./app/perfil/page.tsx");

  assert.match(home, /useCurrentPlayer\(\)/);
  assert.match(home, /resolveHomeDisplayName/);
  assert.match(home, /<AccountMenu variant="home"/);
  assert.match(nav, /<AccountMenu \/>/);
  assert.match(accountMenu, /resolveAccountDisplayName/);
  assert.match(accountMenu, /resolveCurrentPlayerStatus/);
  assert.match(profilePage, /Nombre visible en CLOUVA/);
  assert.match(profilePage, /display_name:\s*data\?\.display_name/);
  assert.match(profilePage, /Nombre completo \(opcional\)/);
});

test("Public Player keeps Spotify listening and likes inside CLOUVA", () => {
  const profile = read("./components/public/PlayerPublicView.tsx");
  const spotifyPlayer = read("./components/public/PublicSpotifyPlayer.tsx");
  const libraryRoute = read("./app/api/integrations/spotify/library/route.ts");

  assert.match(profile, /href="#musica"/);
  assert.match(profile, /<PublicSpotifyPlayer/);
  assert.match(spotifyPlayer, /open\.spotify\.com\/embed\/iframe-api\/v1/);
  assert.match(spotifyPlayer, /authenticatedFetch\("\/api\/integrations\/spotify\/library"/);
  assert.match(spotifyPlayer, /pendingAction:\s*\{\s*type:\s*"save_track",\s*uri\s*\}/);
  assert.match(libraryRoute, /isSpotifyUriSaved/);
  assert.match(libraryRoute, /saveSpotifyUri/);
  assert.match(libraryRoute, /removeSpotifyUri/);
});

test("Spotify for Artists bridge separates professional workspace, public artist and imported analytics", () => {
  const page = read("./app/profile/spotify-artist/page.tsx");
  const artistRoute = read("./app/api/integrations/spotify/artist-link/route.ts");
  const importRoute = read("./app/api/integrations/spotify/artist-import/route.ts");
  const migration = read("./supabase/migrations/20260824011000_spotify_for_artists_bridge.sql");

  assert.match(page, /Spotify \+ Spotify for Artists/);
  assert.match(page, /spotify_for_artists_url/);
  assert.match(page, /mode=\$\{mode\}/);
  assert.match(page, /Importar CSV/);
  assert.match(artistRoute, /for_artists_workspace/);
  assert.match(artistRoute, /spotify_for_artists_id/);
  assert.match(artistRoute, /spotify_artist_data/);
  assert.match(artistRoute, /type=track&limit=10/);
  assert.match(importRoute, /spotify_for_artists_imports/);
  assert.match(importRoute, /MAX_ROWS = 5_000/);
  assert.match(migration, /spotify_for_artists_status/);
  assert.match(migration, /spotify_for_artists_imports/);
});
