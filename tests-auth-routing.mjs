import assert from "node:assert/strict";
import test from "node:test";
import { getPostAuthDestination, isNewlyCreatedAuthUser } from "./lib/auth.ts";

test("a newly created Supabase user enters La Matrix", () => {
  const user = {
    created_at: "2026-07-31T01:00:00.000Z",
    last_sign_in_at: "2026-07-31T01:00:02.000Z",
  };

  assert.equal(isNewlyCreatedAuthUser(user), true);
  assert.equal(getPostAuthDestination("cliente", user), "/matrix");
});

test("an existing user keeps the role destination", () => {
  const user = {
    created_at: "2026-07-01T01:00:00.000Z",
    last_sign_in_at: "2026-07-31T01:00:00.000Z",
  };

  assert.equal(isNewlyCreatedAuthUser(user), false);
  assert.equal(getPostAuthDestination("cliente", user), "/mi-flow");
  assert.equal(getPostAuthDestination("admin", user), "/admin");
});

test("missing or invalid timestamps never classify an existing account as new", () => {
  assert.equal(isNewlyCreatedAuthUser(null), false);
  assert.equal(isNewlyCreatedAuthUser({ created_at: "invalid", last_sign_in_at: "also-invalid" }), false);
});
