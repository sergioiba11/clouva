import assert from "node:assert/strict";
import { test } from "node:test";

const {
  buildRigWorkerFingerprint,
  isRigJobActive,
  isRigJobTerminal,
  normalizeRigJobStatus,
  normalizeRigProgress,
  sanitizeRigLogMessage,
} = await import("./lib/creator-studio/rig-persistence.ts");

test("normaliza estados heterogéneos del worker", () => {
  assert.equal(normalizeRigJobStatus("pending"), "queued");
  assert.equal(normalizeRigJobStatus("in_progress"), "processing");
  assert.equal(normalizeRigJobStatus("succeeded"), "completed");
  assert.equal(normalizeRigJobStatus("timeout"), "failed");
  assert.equal(normalizeRigJobStatus("canceled"), "cancelled");
});

test("un estado desconocido conserva el fallback persistido", () => {
  assert.equal(normalizeRigJobStatus("estado-nuevo", "queued"), "queued");
  assert.equal(normalizeRigJobStatus(null, "processing"), "processing");
});

test("limita el progreso al rango aceptado por PostgreSQL", () => {
  assert.equal(normalizeRigProgress(-20), 0);
  assert.equal(normalizeRigProgress(50.6), 51);
  assert.equal(normalizeRigProgress(200), 100);
  assert.equal(normalizeRigProgress("sin progreso"), 0);
});

test("la huella cambia únicamente cuando cambia el estado observable", () => {
  const base = buildRigWorkerFingerprint({
    status: "processing",
    progress: 40,
    stage: "Transfiriendo pesos",
  });
  const same = buildRigWorkerFingerprint({
    status: "processing",
    progress: 40,
    stage: "Transfiriendo pesos",
  });
  const changed = buildRigWorkerFingerprint({
    status: "processing",
    progress: 41,
    stage: "Transfiriendo pesos",
  });

  assert.equal(base, same);
  assert.notEqual(base, changed);
});

test("clasifica estados activos y terminales", () => {
  assert.equal(isRigJobActive("creating"), true);
  assert.equal(isRigJobActive("processing"), true);
  assert.equal(isRigJobActive("completed"), false);
  assert.equal(isRigJobTerminal("completed"), true);
  assert.equal(isRigJobTerminal("failed"), true);
  assert.equal(isRigJobTerminal("queued"), false);
});

test("limpia y limita stdout o stderr antes de persistirlo", () => {
  assert.equal(sanitizeRigLogMessage("  Blender\u0000 listo  "), "Blender listo");
  assert.equal(sanitizeRigLogMessage("", 10), "Evento de rig sin mensaje.");

  const truncated = sanitizeRigLogMessage("123456789012345", 10);
  assert.match(truncated, /^1234567890/);
  assert.match(truncated, /log truncado por CLOUVA/);
});
