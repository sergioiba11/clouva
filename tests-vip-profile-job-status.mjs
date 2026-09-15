import assert from "node:assert/strict";
import test from "node:test";
import {
  isVipProfileFidelityStatus,
  isVipProfileJobActive,
  isVipProfileJobPolling,
  selectVipProfileJobState,
} from "./lib/vip-profile-job-status.ts";

test("historical failed job is not operationally active", () => {
  const failed = { id: "failed-old", status: "failed" };
  const state = selectVipProfileJobState([failed]);
  assert.equal(state.activeJob, null);
  assert.equal(state.latestJob, failed);
  assert.equal(state.lastFailedJob, failed);
});

test("active generation wins over older terminal history", () => {
  const active = { id: "active", status: "generating_assets" };
  const failed = { id: "failed-old", status: "failed" };
  const state = selectVipProfileJobState([active, failed]);
  assert.equal(state.activeJob, active);
  assert.equal(state.latestJob, active);
  assert.equal(state.lastFailedJob, failed);
});

test("review_ready is terminal and does not remain GENERATING", () => {
  assert.equal(isVipProfileJobActive("review_ready"), false);
  assert.equal(isVipProfileJobPolling("review_ready"), false);
});

test("all Reference Fidelity stages remain pollable active states", () => {
  for (const status of [
    "rendering_reference_preview",
    "capturing_reference_render",
    "comparing_reference",
    "applying_visual_corrections",
    "regenerating_structure",
    "validating_visual_fidelity",
  ]) {
    assert.equal(isVipProfileFidelityStatus(status), true, status);
    assert.equal(isVipProfileJobActive(status), true, status);
    assert.equal(isVipProfileJobPolling(status), true, status);
  }
});

test("interactive states block duplicate generation without pretending to auto-generate", () => {
  for (const status of ["awaiting_variant_selection", "needs_user_input"]) {
    assert.equal(isVipProfileJobActive(status), true, status);
    assert.equal(isVipProfileJobPolling(status), false, status);
  }
});

test("failed, cancelled and blocked budget states permit a new generation", () => {
  for (const status of ["failed", "cancelled", "blocked_budget"]) {
    assert.equal(isVipProfileJobActive(status), false, status);
  }
});
