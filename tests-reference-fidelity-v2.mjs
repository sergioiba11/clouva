import test from "node:test";
import assert from "node:assert/strict";

import { sanitizeLayoutConfig } from "./lib/server/layout-config.ts";
import { applyVisualCorrectionPatch, sanitizeVisualCorrectionPatch } from "./lib/server/visual-correction-patch.ts";
import { createReferenceFidelityState, inferReferenceViewport } from "./lib/server/reference-fidelity-v3.ts";

function makeElement(index) {
  return {
    id: `hero-item-${index}`,
    type: index === 0 ? "heading" : "paragraph",
    text: `Elemento ${index}`,
    x: 5 + (index % 4) * 10,
    y: 5 + (index % 8) * 8,
    w: 20,
    h: 7,
    fontSizePx: index === 0 ? 84 : 16,
    radiusPx: 4,
    opacity: 1,
  };
}

function makeLayout(elements = [makeElement(0)]) {
  return {
    schema_version: 2,
    mode: "reference_layout",
    layout_kind: "precise",
    sections: [],
    precise_sections: [
      {
        id: "hero-main",
        type: "hero",
        heightVh: 100,
        widthPct: 100,
        xPct: 0,
        background: { color: "#05080d", overlayOpacity: 0.22 },
        elements,
      },
    ],
    image_slots: {},
    page_style: { theme: "dark", radius: "small", nav_style: "bar", header_overlay: true },
  };
}

test("Reference Fidelity V2 preserves explicit h/id/style fields", () => {
  const layout = sanitizeLayoutConfig(makeLayout());
  assert.ok(layout);
  assert.equal(layout.schema_version, 2);
  const element = layout.precise_sections[0].elements[0];
  assert.equal(element.id, "hero-item-0");
  assert.equal(element.h, 7);
  assert.equal(element.fontSizePx, 84);
  assert.equal(element.radiusPx, 4);
  assert.equal(layout.precise_sections[0].background.overlayOpacity, 0.22);
});

test("precise mode keeps up to 32 elements instead of truncating at 12", () => {
  const elements = Array.from({ length: 32 }, (_, index) => makeElement(index));
  const layout = sanitizeLayoutConfig(makeLayout(elements));
  assert.ok(layout);
  assert.equal(layout.precise_sections[0].elements.length, 32);
});

test("V1 precise layouts without h remain backward compatible", () => {
  const legacy = makeLayout([{ type: "heading", text: "Legacy", x: 10, y: 10, w: 60, fontSizePx: 54 }]);
  delete legacy.schema_version;
  const layout = sanitizeLayoutConfig(legacy);
  assert.ok(layout);
  assert.equal(layout.precise_sections[0].elements[0].h, null);
});

test("visual correction patch updates stable element ids and re-sanitizes", () => {
  const layout = sanitizeLayoutConfig(makeLayout());
  assert.ok(layout);
  const corrected = applyVisualCorrectionPatch(layout, {
    changes: [{ target: "element", id: "hero-item-0", delta: { x: 2, y: -3, w: 5 }, set: { fontSizePx: 96, radiusPx: 2 } }],
  });
  assert.ok(corrected);
  const element = corrected.precise_sections[0].elements[0];
  assert.equal(element.x, 7);
  assert.equal(element.y, 2);
  assert.equal(element.w, 25);
  assert.equal(element.fontSizePx, 96);
  assert.equal(element.radiusPx, 2);
});

test("correction patches reject arbitrary CSS/object paths", () => {
  const patch = sanitizeVisualCorrectionPatch({
    changes: [{ target: "element", id: "hero-item-0", set: { fontSizePx: 88, className: "fixed inset-0", style: "position:fixed", onclick: "alert(1)" } }],
  });
  assert.deepEqual(patch.changes[0].set, { fontSizePx: 88 });
});

test("Reference Fidelity V3 reads the real 1536x1024 viewport instead of a square canvas", () => {
  const png = Buffer.alloc(24);
  png[0] = 0x89;
  png.write("PNG", 1, "ascii");
  png.writeUInt32BE(1536, 16);
  png.writeUInt32BE(1024, 20);
  const viewport = inferReferenceViewport({ mimeType: "image/png", data: png.toString("base64") });
  assert.deepEqual(viewport, { width: 1536, height: 1024, aspectRatio: 1.5 });
});

test("Reference Fidelity V3 starts with a bounded three-pass correction budget", () => {
  const state = createReferenceFidelityState({ width: 1536, height: 1024, aspectRatio: 1.5 }, "version-1");
  assert.equal(state.maxIterations, 3);
  assert.equal(state.iteration, 0);
  assert.equal(state.stage, "rendering_reference_preview");
});
