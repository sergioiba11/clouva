import assert from "node:assert/strict";
import { test } from "node:test";

const { buildStudioProposal } = await import("./lib/server/studio-version-preview.ts");

function currentIdentity() {
  return {
    studio: {
      id: "studio-1",
      slug: "matrix",
      name: "La Matrix",
      logo_url: "https://storage.googleapis.com/clouva/current-logo.webp",
      cover_url: "https://storage.googleapis.com/clouva/current-cover.webp",
      description: "Actual",
      short_bio: "Bio actual",
      tagline: "Actual",
      categories: [], city: null, country: null, website_url: null, social_links: [], contact_email: null,
      is_published: true, publication_status: "published", studio_os_status: "active",
      seo_title: null, seo_description: null, share_title: null, share_description: null,
      og_image_url: null, accent_color: "#111111", palette: ["#111111"],
    },
    players: [], media: [], projects: [], matrixDiscoveryProjects: [], services: [], membershipPlans: [],
    canonicalAlias: "matrix",
    layoutConfig: {
      mode: "adaptive_layout", layout_kind: "template",
      sections: [{ type: "hero", variant: "split", headline: "Actual", subheadline: null, eyebrow: null, primary_cta: null, secondary_cta: null, background: "cover", align: "left" }],
      precise_sections: [], image_slots: {}, page_style: null, nav_items: null, footer: null,
    },
  };
}

test("Studio proposal is an in-memory clone and leaves ACTUAL byte-for-byte untouched", () => {
  const current = currentIdentity();
  const before = structuredClone(current);
  const proposal = buildStudioProposal(current, {
    id: "draft-2",
    version_number: 2,
    status: "draft",
    copy_config: { tagline: "Propuesta" },
    visual_config: { palette: ["#220044", "#8F7CFF"] },
    layout_config: {
      mode: "adaptive_layout", layout_kind: "template",
      sections: [{ type: "hero", variant: "cover", headline: "Mañana" }],
      image_slots: {},
    },
    asset_references: [{ kind: "cover", url: "https://storage.googleapis.com/clouva/draft-cover.webp" }],
    created_at: "2026-08-10T00:00:00.000Z",
    published_at: null,
  });

  assert.deepEqual(current, before);
  assert.notEqual(proposal, current);
  assert.equal(proposal.studio.tagline, "Propuesta");
  assert.equal(proposal.studio.cover_url, "https://storage.googleapis.com/clouva/draft-cover.webp");
  assert.equal(proposal.layoutConfig.sections[0].headline, "Mañana");
  assert.equal(current.studio.tagline, "Actual");
  assert.equal(current.layoutConfig.sections[0].headline, "Actual");
});

test("invalid draft layout cannot replace the canonical current layout", () => {
  const current = currentIdentity();
  const proposal = buildStudioProposal(current, {
    id: "draft-2", version_number: 2, status: "draft", copy_config: {}, visual_config: {},
    layout_config: { layout_kind: "precise", precise_sections: [] }, asset_references: [],
    created_at: "2026-08-10T00:00:00.000Z", published_at: null,
  });
  assert.deepEqual(proposal.layoutConfig, current.layoutConfig);
});
