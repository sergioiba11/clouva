import assert from "node:assert/strict";
import { test } from "node:test";

const {
  DEFAULT_CLOUVA_AI_MODE,
  endpointForClouvaAIMode,
  normalizeClouvaAIMode,
  projectAccessLabel,
} = await import("./lib/clouva-ai/project-access.ts");

test("Proyecto es el modo predeterminado", () => {
  assert.equal(DEFAULT_CLOUVA_AI_MODE, "project");
  assert.equal(normalizeClouvaAIMode(null), "project");
  assert.equal(normalizeClouvaAIMode("valor-invalido"), "project");
});

test("la preferencia válida del usuario se conserva", () => {
  assert.equal(normalizeClouvaAIMode("chat"), "chat");
  assert.equal(normalizeClouvaAIMode("project"), "project");
});

test("Proyecto siempre usa el agente con acceso al repositorio", () => {
  assert.equal(endpointForClouvaAIMode("project"), "/api/clouva-ai/agent");
  assert.equal(endpointForClouvaAIMode("chat"), "/api/gemini");
});

test("el estado conectado identifica repositorio y rama", () => {
  assert.equal(
    projectAccessLabel({
      state: "connected",
      repository: "sergioiba11/clouva",
      branch: "main",
    }),
    "GitHub conectado · sergioiba11/clouva · main",
  );
});

test("un acceso revocado nunca se presenta como conectado", () => {
  assert.equal(
    projectAccessLabel({ state: "unavailable", message: "Token revocado" }),
    "Token revocado",
  );
  assert.equal(
    projectAccessLabel({ state: "signed_out" }),
    "Iniciá sesión para activar Proyecto",
  );
});
