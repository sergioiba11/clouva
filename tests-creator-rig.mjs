import assert from "node:assert/strict";
import { test } from "node:test";

const { buildBlenderJob } = await import("./lib/creator-studio/blender-job.ts");
const {
  evaluateRigJobWatchdog,
  extractRigJobActivityAt,
  RIG_JOB_INACTIVITY_TIMEOUT_MS,
} = await import("./lib/creator-studio/job-watchdog.ts");

test("objeto crudo usa el worker existente para transferir pesos y vincular Armature", () => {
  const job = buildBlenderJob({ category: "hoodie", templateMode: false, autoWeight: true });
  assert.equal(job.operation, "fit_and_rig_reference");
  assert.equal(job.riggingStrategy, "transfer_from_avatar");
  assert.equal(job.options.transferSkinWeights, true);
  assert.equal(job.options.transferVertexGroups, true);
  assert.equal(job.options.attachArmature, true);
  assert.equal(job.options.preserveExistingSkinning, false);
});

test("plantilla conserva skinning y topología en el worker existente", () => {
  const job = buildBlenderJob({
    category: "hoodie",
    templateMode: true,
    templateId: "hoodie-base-v1",
    sourceStoragePath: "user/hoodie/base.glb",
  });
  assert.equal(job.operation, "fit_and_rig_reference");
  assert.equal(job.riggingStrategy, "preserve_existing_skinning");
  assert.equal(job.options.transferSkinWeights, false);
  assert.equal(job.options.transferVertexGroups, false);
  assert.equal(job.options.attachArmature, false);
  assert.equal(job.options.preserveExistingSkinning, true);
  assert.equal(job.options.preserveTopology, true);
});

test("preserveExistingSkinning activa modo plantilla aunque falte templateMode", () => {
  const job = buildBlenderJob({ preserveExistingSkinning: true, autoWeight: true });
  assert.equal(job.templateMode, true);
  assert.equal(job.options.transferSkinWeights, false);
});

test("la validación exige armature, pesos y poses", () => {
  const job = buildBlenderJob({ category: "baggy" });
  assert.equal(job.options.validation.requireArmature, true);
  assert.equal(job.options.validation.requireWeightedVertices, true);
  assert.deepEqual(job.options.validation.animationTests, ["tpose", "idle", "walk", "run"]);
  assert.equal(job.options.maxBoneInfluences, 4);
});

test("watchdog expira un job processing sin actividad durante cinco minutos", () => {
  const now = Date.parse("2026-07-17T12:10:00.000Z");
  const result = evaluateRigJobWatchdog({
    status: "processing",
    data: { updated_at: "2026-07-17T12:04:59.000Z" },
    now,
  });

  assert.equal(result.enabled, true);
  assert.equal(result.expired, true);
  assert.ok((result.inactivityMs ?? 0) > RIG_JOB_INACTIVITY_TIMEOUT_MS);
});

test("watchdog mantiene vivo un job con heartbeat reciente", () => {
  const now = Date.parse("2026-07-17T12:10:00.000Z");
  const result = evaluateRigJobWatchdog({
    status: "running",
    data: { heartbeatAt: "2026-07-17T12:09:45.000Z" },
    now,
  });

  assert.equal(result.enabled, true);
  assert.equal(result.expired, false);
  assert.equal(result.inactivityMs, 15_000);
});

test("watchdog acepta timestamps Unix en segundos", () => {
  const now = Date.parse("2026-07-17T12:10:00.000Z");
  const timestamp = Math.floor(Date.parse("2026-07-17T12:09:00.000Z") / 1000);

  assert.equal(
    extractRigJobActivityAt({ updatedAt: timestamp }, now),
    Date.parse("2026-07-17T12:09:00.000Z"),
  );
});

test("watchdog no expira estados terminales ni inventa timestamps", () => {
  const completed = evaluateRigJobWatchdog({
    status: "completed",
    data: { updated_at: "2020-01-01T00:00:00.000Z" },
  });
  const missingTimestamp = evaluateRigJobWatchdog({
    status: "processing",
    data: { progress: 20 },
  });

  assert.equal(completed.enabled, false);
  assert.equal(completed.expired, false);
  assert.equal(missingTimestamp.enabled, false);
  assert.equal(missingTimestamp.expired, false);
});
