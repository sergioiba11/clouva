import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  DEFAULT_MOBILE_HOME_CONFIG,
  configCssVariables,
  sanitizeMobileHomeConfig,
} from "./lib/clouva-lab/mobile-home-config.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("CLOUVA Lab sanitizes visual input and rejects unsafe navigation", () => {
  const config = sanitizeMobileHomeConfig({
    theme: { pagePadding: 999, glowStrength: -4, accentColor: "javascript:alert(1)" },
    hero: {
      title: "Nueva Home",
      imageUrl: "javascript:alert(1)",
      primaryHref: "https://evil.example",
      height: 9999,
    },
    sections: ["features", "hero", "features", "unknown"],
  });

  assert.equal(config.theme.pagePadding, 28);
  assert.equal(config.theme.glowStrength, 0);
  assert.equal(config.theme.accentColor, DEFAULT_MOBILE_HOME_CONFIG.theme.accentColor);
  assert.equal(config.hero.imageUrl, DEFAULT_MOBILE_HOME_CONFIG.hero.imageUrl);
  assert.equal(config.hero.primaryHref, DEFAULT_MOBILE_HOME_CONFIG.hero.primaryHref);
  assert.equal(config.hero.height, 620);
  assert.deepEqual(config.sections, ["features", "hero", "music"]);
});

test("CLOUVA Lab produces bounded CSS variables", () => {
  const variables = configCssVariables(sanitizeMobileHomeConfig({ theme: { glowStrength: 1 }, hero: { height: 400 } }));
  assert.equal(variables["--lab-hero-height"], "400px");
  assert.equal(variables["--lab-glow-size"], "36px");
  assert.match(variables["--lab-music-progress"], /^\d+(?:\.\d+)?%$/);
});

test("Mobile Home reads published config and keeps Player image in bottom navigation", () => {
  const home = read("./components/clouva/MobileHomeDashboard.tsx");
  assert.match(home, /usePublishedUiPage\(/);
  assert.match(home, /configOverride/);
  assert.match(home, /data-ui-page="mobile-home"/);
  assert.match(home, /currentPlayer\?\.profile_image_url/);
  assert.match(home, /className=\{styles\.profileNav\}/);
  assert.doesNotMatch(home, /backgroundImage:\s*`url\(\$\{playerImage\}/);
});

test("Admin routes require CLOUVA CONTROL admin identity", () => {
  const routes = [
    "./app/api/admin/clouva-lab/pages/route.ts",
    "./app/api/admin/clouva-lab/pages/[slug]/route.ts",
    "./app/api/admin/clouva-lab/pages/[slug]/publish/route.ts",
    "./app/api/admin/clouva-lab/pages/[slug]/restore/route.ts",
  ];
  for (const path of routes) {
    assert.match(read(path), /requireClouvaControlAdmin\(request\)/, path);
  }
});

test("Migration enables RLS and atomic versioned publication", () => {
  const migration = read("./supabase/migrations/20260806101821_clouva_lab_v1.sql");
  for (const table of ["ui_pages", "ui_page_versions", "ui_blocks", "ui_assets", "ui_feature_flags"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(migration, /private\.is_clouva_admin\(\)/);
  assert.match(migration, /create or replace function public\.ui_save_page_draft/);
  assert.match(migration, /create or replace function public\.ui_publish_page/);
  assert.match(migration, /for update/);
  assert.match(migration, /create or replace function public\.ui_restore_page_version/);
  assert.match(migration, /insert into public\.admin_audit_logs/);
});
