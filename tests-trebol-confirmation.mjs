import assert from "node:assert/strict";
import test from "node:test";
import { normalizeVoiceToolDecision } from "./lib/clouva-ai/voice-confirmation.ts";

test("accepts only exact low-risk voice confirmation phrases", () => {
  assert.equal(normalizeVoiceToolDecision("Confirmo el cambio.", false), "confirm");
  assert.equal(normalizeVoiceToolDecision("sí, confirmo", false), "confirm");
  assert.equal(normalizeVoiceToolDecision("sí", false), null);
  assert.equal(normalizeVoiceToolDecision("creo que sí, confirmo", false), null);
});

test("requires the reinforced phrase for sensitive actions", () => {
  assert.equal(normalizeVoiceToolDecision("Confirmo la acción sensible", true), "confirm");
  assert.equal(normalizeVoiceToolDecision("confirmo", true), null);
  assert.equal(normalizeVoiceToolDecision("ejecutar el cambio", true), null);
});

test("cancellation stays explicit and works at every risk level", () => {
  assert.equal(normalizeVoiceToolDecision("Cancelar la acción", false), "cancel");
  assert.equal(normalizeVoiceToolDecision("No ejecutes", true), "cancel");
  assert.equal(normalizeVoiceToolDecision("no", true), null);
});
