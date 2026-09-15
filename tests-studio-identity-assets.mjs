import test from "node:test";
import assert from "node:assert/strict";
import {
  collectUsedIdentityAssets,
  resolveIdentityAssetState,
  resolveOfficialDisplayLogo,
} from "./lib/studio-identity-assets.ts";

const logoV1 = "https://storage.googleapis.com/clouva-generated-media/public-identity/studios/demo/vip-logo/logo-v1.png";
const logoV2 = "https://storage.googleapis.com/clouva-generated-media/public-identity/studios/demo/vip-logo/logo-v2.png";
const logoWhiteSvg = "https://storage.googleapis.com/clouva-generated-media/admin-assets/_other/studio-logo-white.svg";
const logoBlackSvg = "https://storage.googleapis.com/clouva-generated-media/admin-assets/_other/studio-logo-black.svg";
const logoWhitePng = "https://storage.googleapis.com/clouva-generated-media/admin-assets/_other/studio-logo-white.png";
const logoBlackPng = "https://storage.googleapis.com/clouva-generated-media/admin-assets/_other/studio-logo-black.png";
const cover = "https://storage.googleapis.com/clouva-generated-media/public-identity/studios/demo/vip-cover/cover.jpg";
const discarded = "https://storage.googleapis.com/clouva-generated-media/public-identity/studios/demo/generated/discarded.png";
const pillar = "https://storage.googleapis.com/clouva-generated-media/public-identity/studios/demo/vip-pillar-0/pillar.webp";
const brandVersionId = "11111111-1111-1111-1111-111111111111";

test("published identity exposes only assets actually used by its renderer", () => {
  const assets = collectUsedIdentityAssets({
    asset_references: [
      { kind: "logo", url: logoV1 },
      { kind: "cover", url: cover },
      { kind: "background", url: discarded },
    ],
    layout_config: {
      image_slots: { logo: logoV1, cover, unused_background: discarded },
      precise_sections: [{
        type: "hero",
        background: { imageSlot: "cover" },
        elements: [{ type: "image", imageSlot: "logo" }],
      }],
    },
  }, "published");

  assert.deepEqual(assets.map((asset) => [asset.kind, asset.url]), [
    ["cover", cover],
    ["logo", logoV1],
  ]);
  assert.equal(assets.some((asset) => asset.url === discarded), false);
});

test("legacy layouts contribute renderer URLs that predate asset_references", () => {
  const assets = collectUsedIdentityAssets({
    asset_references: [{ kind: "cover", url: cover }],
    layout_config: {
      sections: [{ type: "pillars", items: [{ image: pillar }] }],
      image_slots: { cover },
    },
  }, "published");

  assert.equal(assets.some((asset) => asset.url === pillar && asset.kind === "gallery"), true);
  assert.equal(assets.some((asset) => asset.url === cover), false);
});

test("older template layouts can still use conventional image_slots implicitly", () => {
  const assets = collectUsedIdentityAssets({
    asset_references: [{ kind: "cover", url: cover }, { kind: "logo", url: logoV1 }],
    layout_config: { image_slots: { cover, logo: logoV1 } },
  }, "published");

  assert.equal(assets.some((asset) => asset.url === cover && asset.kind === "cover"), true);
  assert.equal(assets.some((asset) => asset.url === logoV1 && asset.kind === "logo"), true);
});

test("official SVG variants win for dark and light surfaces", () => {
  const variants = {
    primaryLogoUrl: logoV1,
    whiteSvgUrl: logoWhiteSvg,
    blackSvgUrl: logoBlackSvg,
    whiteLogoUrl: logoWhitePng,
    blackLogoUrl: logoBlackPng,
  };

  const dark = resolveOfficialDisplayLogo(variants, "dark");
  const light = resolveOfficialDisplayLogo(variants, "light");

  assert.equal(dark.preferredUrl, logoWhiteSvg);
  assert.equal(dark.darkUrl, logoWhiteSvg);
  assert.equal(dark.source, "brand_asset_svg");
  assert.equal(light.preferredUrl, logoBlackSvg);
  assert.equal(light.lightUrl, logoBlackSvg);
  assert.equal(light.source, "brand_asset_svg");
});

test("same-tone raster variants are used when SVG variants do not exist", () => {
  const variants = {
    primaryLogoUrl: logoV1,
    whiteLogoUrl: logoWhitePng,
    blackLogoUrl: logoBlackPng,
  };

  assert.equal(resolveOfficialDisplayLogo(variants, "dark").preferredUrl, logoWhitePng);
  assert.equal(resolveOfficialDisplayLogo(variants, "light").preferredUrl, logoBlackPng);
});

test("primary logo remains the compatibility fallback", () => {
  assert.equal(
    resolveOfficialDisplayLogo({ primaryLogoUrl: logoV1 }, "dark").preferredUrl,
    logoV1,
  );
  assert.equal(
    resolveOfficialDisplayLogo({ primaryLogoUrl: logoV1 }, "light").preferredUrl,
    logoV1,
  );
});

test("no official logo data resolves to empty", () => {
  const display = resolveOfficialDisplayLogo(null, "dark");
  assert.equal(display.preferredUrl, null);
  assert.equal(display.darkUrl, null);
  assert.equal(display.lightUrl, null);
});

test("same draft logo is reuse, not a replacement proposal", () => {
  const state = resolveIdentityAssetState({
    publishedVersion: {
      asset_references: [{ kind: "logo", url: logoV1 }],
      layout_config: { image_slots: { logo: logoV1 } },
    },
    draftVersion: {
      asset_references: [{ kind: "logo", url: logoV1 }],
      layout_config: { image_slots: { logo: logoV1 } },
    },
  });

  assert.equal(state.officialLogo?.url, logoV1);
  assert.equal(state.draftLogo, null);
});

test("official display variant replaces the published raster in both official UI surfaces", () => {
  const state = resolveIdentityAssetState({
    publishedVersion: {
      asset_references: [{ kind: "logo", url: logoV1 }, { kind: "cover", url: cover }],
      layout_config: { image_slots: { logo: logoV1, cover } },
      brand_asset_version_id: brandVersionId,
    },
    draftVersion: null,
    officialLogoVariants: {
      brandAssetVersionId: brandVersionId,
      primaryLogoUrl: logoV1,
      whiteSvgUrl: logoWhiteSvg,
      blackSvgUrl: logoBlackSvg,
    },
    surface: "dark",
  });

  assert.equal(state.officialLogo?.url, logoWhiteSvg);
  assert.equal(state.displayLogo?.url, logoWhiteSvg);
  assert.equal(state.officialDisplayLogo.darkUrl, logoWhiteSvg);
  assert.equal(state.officialDisplayLogo.lightUrl, logoBlackSvg);
  assert.equal(state.officialAssets.find((asset) => asset.kind === "logo")?.url, logoWhiteSvg);
  assert.equal(state.officialAssets.find((asset) => asset.kind === "cover")?.url, cover);
});

test("legacy published raster reused by a draft is not misclassified after display variant resolution", () => {
  const state = resolveIdentityAssetState({
    publishedVersion: {
      asset_references: [{ kind: "logo", url: logoV1 }],
      layout_config: { image_slots: { logo: logoV1 } },
      brand_asset_version_id: brandVersionId,
    },
    draftVersion: {
      asset_references: [{ kind: "logo", url: logoV1 }],
      layout_config: { image_slots: { logo: logoV1 } },
      brand_asset_version_id: brandVersionId,
    },
    officialLogoVariants: {
      brandAssetVersionId: brandVersionId,
      primaryLogoUrl: logoV1,
      whiteSvgUrl: logoWhiteSvg,
      blackSvgUrl: logoBlackSvg,
    },
  });

  assert.equal(state.officialLogo?.url, logoWhiteSvg);
  assert.equal(state.draftLogo, null);
  assert.equal(state.hasProposedLogo, false);
});

test("new draft logo is exposed as proposal while published logo stays official", () => {
  const state = resolveIdentityAssetState({
    publishedVersion: {
      asset_references: [{ kind: "logo", url: logoV1 }],
      layout_config: { image_slots: { logo: logoV1 } },
      brand_asset_version_id: brandVersionId,
    },
    draftVersion: {
      asset_references: [{ kind: "logo", url: logoV2 }],
      layout_config: { image_slots: { logo: logoV2 } },
      brand_asset_version_id: "22222222-2222-2222-2222-222222222222",
    },
    officialLogoVariants: {
      brandAssetVersionId: brandVersionId,
      primaryLogoUrl: logoV1,
      whiteSvgUrl: logoWhiteSvg,
      blackSvgUrl: logoBlackSvg,
    },
  });

  assert.equal(state.officialLogo?.url, logoWhiteSvg);
  assert.equal(state.draftLogo?.url, logoV2);
  assert.equal(state.displayLogo?.url, logoV2);
  assert.equal(state.draftLogo?.brandAssetVersionId, "22222222-2222-2222-2222-222222222222");
  assert.equal(state.hasProposedLogo, true);
});

test("unrelated active brand version cannot override a versioned published identity", () => {
  const state = resolveIdentityAssetState({
    publishedVersion: {
      asset_references: [{ kind: "logo", url: logoV1 }],
      layout_config: { image_slots: { logo: logoV1 } },
      brand_asset_version_id: brandVersionId,
    },
    draftVersion: null,
    officialLogoVariants: {
      brandAssetVersionId: "33333333-3333-3333-3333-333333333333",
      primaryLogoUrl: logoV2,
      whiteSvgUrl: logoWhiteSvg,
      blackSvgUrl: logoBlackSvg,
    },
  });

  assert.equal(state.officialLogo?.url, logoV1);
  assert.equal(state.officialAssets.find((asset) => asset.kind === "logo")?.url, logoV1);
});

test("subject logo is a safe legacy fallback when no published identity exists", () => {
  const state = resolveIdentityAssetState({
    publishedVersion: null,
    draftVersion: null,
    subjectLogoUrl: logoV1,
  });

  assert.equal(state.officialLogo?.url, logoV1);
  assert.equal(state.officialLogo?.source, "subject");
  assert.equal(state.officialAssets.length, 1);
});
