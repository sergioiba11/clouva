import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parsePlayerSocialLinks } from "./lib/players-data.ts";
import { getSocialPlatformDefinition, normalizeSocialPlatform, normalizeSocialUsername, sanitizeSocialUrl } from "./lib/social-platforms.ts";

test("Player social platforms normalize twitter to X and expose icons", () => {
  assert.equal(normalizeSocialPlatform("twitter"), "x");
  assert.equal(getSocialPlatformDefinition("twitter").label, "X");
  for (const platform of ["instagram", "spotify", "youtube", "soundcloud", "x", "facebook", "tiktok", "apple_music", "website", "contact"]) {
    assert.ok(getSocialPlatformDefinition(platform).icon);
  }
});

test("Player social usernames avoid duplicate @", () => {
  assert.equal(normalizeSocialUsername("@@clouva"), "@clouva");
  assert.equal(normalizeSocialUsername("clouva"), "@clouva");
});

test("Player public social links reject unsafe URLs and hidden links", () => {
  assert.equal(sanitizeSocialUrl("javascript:alert(1)", "instagram"), null);
  assert.equal(sanitizeSocialUrl("data:text/html,boom", "website"), null);
  const links = parsePlayerSocialLinks([
    { platform: "twitter", url: "https://x.com/clouva", username: "@clouva", is_visible: true },
    { platform: "facebook", url: "javascript:alert(1)", is_visible: true },
    { platform: "instagram", url: "https://instagram.com/clouva", is_visible: false },
  ]);
  assert.equal(links.length, 1);
  assert.equal(links[0].platform, "x");
});

test("YouTube public status does not select or serialize OAuth token columns", () => {
  const status = readFileSync("app/api/integrations/youtube/status/route.ts", "utf8");
  assert.doesNotMatch(status, /access_token_ciphertext|refresh_token_ciphertext|token_auth_tag/);
});

test("YouTube sync uses canonical player_media external IDs and avoids a parallel media store", () => {
  const service = readFileSync("core/integrations/youtube/service.ts", "utf8");
  assert.match(service, /from\("player_media"\)/);
  assert.match(service, /external_id: item\.videoId/);
  assert.match(service, /origin: "youtube"/);
  assert.doesNotMatch(service, /youtube_media|youtube_videos/);
});

test("Player page loads merch once and passes hasMerch into the canonical public view", () => {
  const page = readFileSync("app/[publicAlias]/page.tsx", "utf8");
  assert.match(page, /loadPublicMerchProducts/);
  assert.match(page, /hasMerch=\{merchProducts\.length > 0\}/);
  assert.match(page, /products=\{merchProducts\}/);
});

test("YouTube featured player stays lazy until the user presses play", () => {
  const featured = readFileSync("components/public/PublicYouTubeFeatured.tsx", "utf8");
  assert.match(featured, /playing \? \(/);
  assert.match(featured, /youtube-nocookie\.com\/embed/);
  assert.match(featured, /loading="lazy"/);
});
