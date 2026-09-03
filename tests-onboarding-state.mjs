import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  completedOnboardingDestination,
  shouldRedirectMissingPlayerToOnboarding,
} from "./lib/onboarding-state.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("completed accounts leave identity onboarding", () => {
  assert.equal(completedOnboardingDestination("published"), "/profile/edit");
  assert.equal(completedOnboardingDestination("player_created"), "/onboarding/instagram");
  assert.equal(completedOnboardingDestination("pending"), null);
  assert.equal(completedOnboardingDestination("exploring"), null);
});

test("a missing Player never restarts completed onboarding", () => {
  assert.equal(shouldRedirectMissingPlayerToOnboarding("published"), false);
  assert.equal(shouldRedirectMissingPlayerToOnboarding("player_created"), false);
  assert.equal(shouldRedirectMissingPlayerToOnboarding("pending"), true);
  assert.equal(shouldRedirectMissingPlayerToOnboarding(null), true);
});

test("Player identity writes can resolve pgcrypto in Supabase", () => {
  const migration = read("./supabase/migrations/20260903015810_fix_clouva_player_event_digest_search_path.sql");
  assert.match(migration, /clouva_player_event_trigger/);
  assert.match(migration, /set search_path = public, extensions/);
});

test("the editor waits for the resolved account before loading its Player", () => {
  const editor = read("./app/profile/edit/page.tsx");
  assert.match(editor, /!authLoading && profileReady && user/);
  assert.match(editor, /shouldRedirectMissingPlayerToOnboarding\(profile\?\.onboarding_status\)/);
});
