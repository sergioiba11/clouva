import test from "node:test";
import assert from "node:assert/strict";
import { collectUsedIdentityAssets, resolveIdentityAssetState } from "./lib/studio-identity-assets.ts";

const logoV1 = "https://storage.googleapis.com/clouva-generated-media/public-identity/studios/demo/vip-logo/logo-v1.png";
const logoV2 = "https://storage.googleapis.com/clouva-generated-media/public-identity/studios/demo/vip-logo/logo-v2.png";
const cover = "https://storage.googleapis.com/clouva-generated-media/public-identity/studios/demo/vip-cover/cover.jpg";
const discarded = "https://storage.googleapis.com/clouva-generated-media/public-identity/studios/demo/generated/discarded.png";
const pillar = "https://storage.googleapis.com/clouva-generated-media/public-identity/studios/demo/vip-pillar-0/pillar.webp";

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

test("new draft logo is exposed as proposal while published logo stays official", () => {
  const state = resolveIdentityAssetState({
    publishedVersion: {
      asset_references: [{ kind: "logo", url: logoV1 }],
      layout_config: { image_slots: { logo: logoV1 } },
    },
    draftVersion: {
      asset_references: [{ kind: "logo", url: logoV2 }],
      layout_config: { image_slots: { logo: logoV2 } },
      brand_asset_version_id: "11111111-1111-1111-1111-111111111111",
    },
  });

  assert.equal(state.officialLogo?.url, logoV1);
  assert.equal(state.draftLogo?.url, logoV2);
  assert.equal(state.draftLogo?.brandAssetVersionId, "11111111-1111-1111-1111-111111111111");
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
