import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  eventProjectionForConnection,
  isSelectableAgendaMember,
  shouldDeliverAgendaInvitation,
  signedDirection,
} from "./lib/agenda/participation-policy.ts";

test("pending y active se pueden seleccionar para crear evento", () => {
  assert.equal(isSelectableAgendaMember("pending"), true);
  assert.equal(isSelectableAgendaMember("active"), true);
  assert.equal(isSelectableAgendaMember("declined"), false);
  assert.equal(isSelectableAgendaMember("revoked"), false);
  assert.equal(isSelectableAgendaMember(null), false);
});

test("una invitación pendiente o activa no vuelve a disparar canales", () => {
  assert.equal(shouldDeliverAgendaInvitation(null), true);
  assert.equal(shouldDeliverAgendaInvitation("declined"), true);
  assert.equal(shouldDeliverAgendaInvitation("revoked"), true);
  assert.equal(shouldDeliverAgendaInvitation("pending"), false);
  assert.equal(shouldDeliverAgendaInvitation("active"), false);
});

test("la proyección del evento espera aceptación de conexión", () => {
  assert.deepEqual(eventProjectionForConnection("pending"), { rsvpStatus: "pending", projectToAgenda: false });
  assert.deepEqual(eventProjectionForConnection("active"), { rsvpStatus: "accepted", projectToAgenda: true });
  assert.deepEqual(eventProjectionForConnection("declined"), { rsvpStatus: "declined", projectToAgenda: false });
});

test("dirección económica conserva signo", () => {
  assert.equal(signedDirection(10), "credit");
  assert.equal(signedDirection(-10), "debit");
  assert.equal(signedDirection(0), "credit");
});

test("Agenda valida conexión y no duplica economía en agenda_events", () => {
  const agenda = fs.readFileSync("lib/server/agenda/index.ts", "utf8");
  const timeline = fs.readFileSync("lib/server/agenda/timeline.ts", "utf8");
  assert.match(agenda, /AGENDA_CONNECTION_REQUIRED/);
  assert.match(agenda, /participantMembershipStatus/);
  assert.match(agenda, /projectToAgenda/);
  assert.match(agenda, /synchronizedEvents/);
  assert.doesNotMatch(timeline, /\.from\("agenda_events"\).*insert/s);
  assert.match(timeline, /flows_wallet_ledger/);
  assert.match(timeline, /mi_flow_money_ledger/);
});
