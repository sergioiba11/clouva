import assert from "node:assert/strict";
import { test } from "node:test";

const { ClouvaDomainExecutor } = await import("./lib/clouva-ai/clouva-domain-executor.ts");
const { ToolConfirmationGate } = await import("./lib/clouva-ai/tool-confirmation.ts");
const { ToolRouter } = await import("./lib/clouva-ai/tool-router.ts");
const {
  createClouvaDomainService,
  sanitizeStudioPlayerChanges,
} = await import("./lib/server/clouva-domain-service.ts");
const {
  sanitizeReferenceImageUrls,
  startVipProfileGeneration,
} = await import("./lib/server/vip-profile-generation.ts");

function fakeAdmin(plans = {}) {
  const queues = Object.fromEntries(Object.entries(plans).map(([table, values]) => [table, [...values]]));
  const calls = [];

  return {
    calls,
    from(table) {
      const response = queues[table]?.shift() ?? { data: null, error: null };
      const call = { table, operations: [] };
      calls.push(call);

      const builder = {
        select(...args) { call.operations.push(["select", ...args]); return builder; },
        eq(...args) { call.operations.push(["eq", ...args]); return builder; },
        in(...args) { call.operations.push(["in", ...args]); return builder; },
        order(...args) { call.operations.push(["order", ...args]); return builder; },
        update(...args) { call.operations.push(["update", ...args]); return builder; },
        insert(...args) { call.operations.push(["insert", ...args]); return builder; },
        maybeSingle() { call.operations.push(["maybeSingle"]); return Promise.resolve(response); },
        single() { call.operations.push(["single"]); return Promise.resolve(response); },
        then(resolve, reject) { return Promise.resolve(response).then(resolve, reject); },
      };
      return builder;
    },
  };
}

function fakeDomainService() {
  const calls = [];
  return {
    calls,
    async getStudio() { calls.push(["getStudio"]); return { studio: { id: "studio-1" } }; },
    async getStudioPlayers() { calls.push(["getStudioPlayers"]); return { players: [] }; },
    async getStudioIdentityVersions() { calls.push(["getStudioIdentityVersions"]); return { published: { id: "published-1" }, draft: { id: "draft-1" } }; },
    async updateStudioIdentityDraft(versionId, patch) { calls.push(["updateStudioIdentityDraft", versionId, patch]); return { version: { id: versionId, status: "draft" } }; },
    async updatePlayer(playerId, changes) { calls.push(["updatePlayer", playerId, changes]); return { player: { player_id: playerId, ...changes } }; },
    async startPlayerProfileGeneration(playerId) { calls.push(["startPlayerProfileGeneration", playerId]); return { jobId: "job-1", status: "queued" }; },
  };
}

test("ClouvaDomainExecutor exposes only scoped domain verbs with correct risks", () => {
  const executor = new ClouvaDomainExecutor(fakeDomainService());
  const tools = Object.fromEntries(executor.tools().map((tool) => [tool.name, tool]));

  assert.equal(executor.target, "clouva");
  assert.deepEqual(Object.keys(tools), ["getStudio", "getStudioPlayers", "getStudioIdentityVersions", "updateStudioIdentityDraft", "updatePlayer", "startPlayerProfileGeneration"]);
  assert.equal(tools.getStudio.risk, "read");
  assert.equal(tools.getStudioPlayers.risk, "read");
  assert.equal(tools.getStudioIdentityVersions.risk, "read");
  assert.equal(tools.updateStudioIdentityDraft.risk, "write");
  assert.equal(tools.updatePlayer.risk, "write");
  assert.equal(tools.startPlayerProfileGeneration.risk, "sensitive");
  assert.equal("table" in tools.updatePlayer.parameters.properties, false);
  assert.equal("confirm" in tools.updatePlayer.parameters.properties, false);
});

test("Studio identity changes target the draft and cannot use client confirmation", async () => {
  const service = fakeDomainService();
  const router = new ToolRouter([new ClouvaDomainExecutor(service)]);
  const gate = new ToolConfirmationGate({ id: () => "draft-action" });
  const routed = router.resolve("updateStudioIdentityDraft");
  const args = router.normalizeArguments(routed, {
    versionId: "draft-1",
    copyConfigJson: JSON.stringify({ tagline: "Nueva propuesta" }),
    confirm: true,
    status: "published",
  });
  assert.equal("confirm" in args, false);
  assert.equal("status" in args, false);

  const decision = await gate.evaluate(routed, args);
  assert.equal(decision.kind, "confirmation_required");
  assert.equal(service.calls.length, 0);

  await gate.confirm(router, { ...decision.action, status: "executing" });
  assert.deepEqual(service.calls, [["updateStudioIdentityDraft", "draft-1", {
    copyConfigJson: JSON.stringify({ tagline: "Nueva propuesta" }),
    layoutConfigJson: undefined,
    visualConfigJson: undefined,
  }]]);
});

test("domain service refuses to mutate a published Studio identity version", async () => {
  const admin = fakeAdmin({
    player_profile_versions: [{ data: {
      id: "published-1", studio_id: "studio-1", status: "published",
      copy_config: {}, visual_config: {}, layout_config: {}, asset_references: [],
    }, error: null }],
  });
  const service = createClouvaDomainService({
    admin,
    userId: "user-1",
    studioId: "studio-1",
    dependencies: { authorizeStudio: async () => ({ role: "owner", studioOsActive: true, studio: { id: "studio-1" } }) },
  });

  await assert.rejects(
    service.updateStudioIdentityDraft("published-1", { copyConfigJson: JSON.stringify({ tagline: "Ataque" }) }),
    /publicada es inmutable/i,
  );
  assert.equal(admin.calls.some((call) => call.operations.some(([operation]) => operation === "update")), false);
});

test("confirmed Studio identity write updates only the authorized draft and reuses its assets", async () => {
  const layout = {
    mode: "adaptive_layout",
    layout_kind: "template",
    sections: [{ type: "hero", variant: "split", headline: "Actual", subheadline: "Texto" }],
    precise_sections: [],
    image_slots: { cover: "https://storage.googleapis.com/clouva-media/cover.webp" },
  };
  const current = {
    id: "draft-1", studio_id: "studio-1", status: "draft",
    copy_config: { tagline: "Actual" }, visual_config: { palette: ["#111111"] },
    layout_config: layout,
    asset_references: [{ kind: "cover", url: "https://storage.googleapis.com/clouva-media/cover.webp" }],
  };
  const updated = { ...current, copy_config: { tagline: "Propuesta" } };
  const admin = fakeAdmin({
    player_profile_versions: [{ data: current, error: null }, { data: updated, error: null }],
    admin_audit_log: [{ data: null, error: null }],
  });
  const service = createClouvaDomainService({
    admin,
    userId: "user-1",
    studioId: "studio-1",
    dependencies: { authorizeStudio: async () => ({ role: "owner", studioOsActive: true, studio: { id: "studio-1" } }) },
  });

  const result = await service.updateStudioIdentityDraft("draft-1", {
    copyConfigJson: JSON.stringify({ tagline: "Propuesta", owner_id: "otro" }),
    layoutConfigJson: JSON.stringify({ ...layout, sections: [{ ...layout.sections[0], headline: "Propuesta" }] }),
  });
  assert.equal(result.version.status, "draft");
  const updateCall = admin.calls.find((call) => call.operations.some(([operation]) => operation === "update"));
  const updatePayload = updateCall.operations.find(([operation]) => operation === "update")[1];
  assert.deepEqual(updatePayload.copy_config, { tagline: "Propuesta" });
  assert.equal(updatePayload.layout_config.sections[0].headline, "Propuesta");
  assert.deepEqual(updateCall.operations.filter(([operation]) => operation === "eq"), [
    ["eq", "id", "draft-1"],
    ["eq", "studio_id", "studio-1"],
    ["eq", "status", "draft"],
  ]);
});

test("Studio identity draft rejects invented external assets", async () => {
  const current = {
    id: "draft-1", studio_id: "studio-1", status: "draft", copy_config: {}, visual_config: {},
    layout_config: {}, asset_references: [],
  };
  const admin = fakeAdmin({ player_profile_versions: [{ data: current, error: null }] });
  const service = createClouvaDomainService({
    admin,
    userId: "user-1",
    studioId: "studio-1",
    dependencies: { authorizeStudio: async () => ({ role: "owner", studioOsActive: true, studio: { id: "studio-1" } }) },
  });
  const layout = {
    mode: "adaptive_layout", layout_kind: "template",
    sections: [{ type: "hero", variant: "split", headline: "Propuesta" }],
    image_slots: { cover: "https://evil.example/cover.webp" },
  };
  await assert.rejects(
    service.updateStudioIdentityDraft("draft-1", { layoutConfigJson: JSON.stringify(layout) }),
    /assets ya vinculados/i,
  );
});

test("domain reads execute immediately while Player updates wait for review", async () => {
  const service = fakeDomainService();
  const router = new ToolRouter([new ClouvaDomainExecutor(service)]);
  const gate = new ToolConfirmationGate({ id: () => "domain-action" });

  const read = router.resolve("getStudioPlayers");
  const readDecision = await gate.evaluate(read, router.normalizeArguments(read, {}));
  assert.equal(readDecision.kind, "executed");
  assert.deepEqual(service.calls, [["getStudioPlayers"]]);

  const write = router.resolve("updatePlayer");
  const writeArgs = router.normalizeArguments(write, {
    playerId: "player-1",
    role: "Productor",
    table: "players",
    confirm: true,
  });
  assert.deepEqual(writeArgs, { playerId: "player-1", role: "Productor" });

  const proposal = await gate.evaluate(write, writeArgs);
  assert.equal(proposal.kind, "confirmation_required");
  assert.equal(proposal.action.confirmation, "review");
  assert.equal(service.calls.length, 1);

  await gate.confirm(router, { ...proposal.action, status: "executing" });
  assert.deepEqual(service.calls[1], ["updatePlayer", "player-1", {
    role: "Productor",
    secondaryRole: undefined,
    customTitle: undefined,
    description: undefined,
    areaLabel: undefined,
  }]);
});

test("profile generation requires reinforced confirmation before entering the service", async () => {
  const service = fakeDomainService();
  const router = new ToolRouter([new ClouvaDomainExecutor(service)]);
  const gate = new ToolConfirmationGate();
  const routed = router.resolve("startPlayerProfileGeneration");
  const proposal = await gate.evaluate(routed, router.normalizeArguments(routed, { playerId: "player-1" }));

  assert.equal(proposal.kind, "confirmation_required");
  assert.equal(proposal.action.confirmation, "explicit");
  assert.equal(service.calls.length, 0);
  await gate.confirm(router, { ...proposal.action, status: "executing" });
  assert.deepEqual(service.calls, [["startPlayerProfileGeneration", "player-1"]]);
});

test("Studio Player fields are allowlisted, trimmed and clearable", () => {
  assert.deepEqual(sanitizeStudioPlayerChanges({
    role: "  Productor  ",
    secondaryRole: " ",
    customTitle: " Director musical ",
    unknown: "players" ,
  }), {
    role: "Productor",
    secondary_role: null,
    custom_title: "Director musical",
  });
});

test("membership-backed role updates change the canonical membership source", async () => {
  const current = {
    id: "link-1",
    player_id: "player-1",
    studio_id: "studio-1",
    source_membership_id: "membership-1",
    role: "Artista",
  };
  const updated = { ...current, role: "Productor" };
  const admin = fakeAdmin({
    player_studios: [{ data: current, error: null }, { data: updated, error: null }],
    studio_memberships: [{ data: { id: "membership-1" }, error: null }],
    admin_audit_log: [{ data: null, error: null }],
  });
  const service = createClouvaDomainService({
    admin,
    userId: "user-1",
    studioId: "studio-1",
    dependencies: {
      authorizeStudio: async () => ({ role: "owner", studioOsActive: true, studio: { id: "studio-1" } }),
    },
  });

  const result = await service.updatePlayer("player-1", { role: "Productor" });
  assert.equal(result.player.role, "Productor");
  const membershipCall = admin.calls.find((call) => call.table === "studio_memberships");
  assert.deepEqual(membershipCall.operations[0][1].public_role_label, "Productor");
  const directWrites = admin.calls
    .filter((call) => call.table === "player_studios")
    .flatMap((call) => call.operations)
    .filter(([operation]) => operation === "update");
  assert.equal(directWrites.length, 0);
});

test("domain generation verifies Studio linkage then delegates to the canonical pipeline", async () => {
  const current = { id: "link-1", player_id: "player-1", studio_id: "studio-1", source_membership_id: null };
  const admin = fakeAdmin({ player_studios: [{ data: current, error: null }] });
  const starts = [];
  const service = createClouvaDomainService({
    admin,
    userId: "user-1",
    studioId: "studio-1",
    dependencies: {
      authorizeStudio: async () => ({ role: "owner", studioOsActive: true, studio: { id: "studio-1" } }),
      startProfileGeneration: async (args) => { starts.push(args); return { jobId: "job-1", status: "queued", reused: false }; },
    },
  });

  const result = await service.startPlayerProfileGeneration("player-1");
  assert.equal(result.jobId, "job-1");
  assert.equal(starts[0].userId, "user-1");
  assert.equal(starts[0].playerId, "player-1");
  assert.equal("studioId" in starts[0], false);
});

test("reference-image sanitizer keeps only CLOUVA-owned upload URLs", () => {
  const valid = "https://storage.googleapis.com/clouva-media/reference-images/players/123e4567-e89b-12d3-a456-426614174000/123e4567-e89b-12d3-a456-426614174001.webp";
  assert.deepEqual(sanitizeReferenceImageUrls(["https://example.com/attack.png", valid]), [valid]);
});

test("canonical generation service reuses an active job without rebuilding or enqueueing", async () => {
  const admin = fakeAdmin({ vip_profile_generation_jobs: [{ data: { id: "job-existing", status: "generating_copy" }, error: null }] });
  let builds = 0;
  let enqueues = 0;
  const result = await startVipProfileGeneration({
    admin,
    userId: "user-1",
    playerId: "player-1",
    dependencies: {
      requireEntitlement: async () => ({ entitlement: { id: "ent-1" } }),
      buildPlayerBrief: async () => { builds += 1; return { brief: {}, sourceSnapshot: {} }; },
      enqueue: async () => { enqueues += 1; },
    },
  });

  assert.deepEqual(result, { jobId: "job-existing", status: "generating_copy", reused: true });
  assert.equal(builds, 0);
  assert.equal(enqueues, 0);
});

test("canonical generation service snapshots identity, inserts once and dispatches Cloud Tasks", async () => {
  const admin = fakeAdmin({
    vip_profile_generation_jobs: [
      { data: null, error: null },
      { data: { id: "job-new", status: "queued" }, error: null },
    ],
  });
  const enqueued = [];
  const result = await startVipProfileGeneration({
    admin,
    userId: "user-1",
    playerId: "player-1",
    referenceImageUrls: ["https://example.com/not-allowed.png"],
    dependencies: {
      requireEntitlement: async () => ({ entitlement: { id: "ent-1" } }),
      buildPlayerBrief: async () => ({ brief: { player_id: "player-1" }, sourceSnapshot: { display_name: "Player" } }),
      enqueue: async (jobId) => { enqueued.push(jobId); },
    },
  });

  assert.deepEqual(result, { jobId: "job-new", status: "queued", reused: false });
  assert.deepEqual(enqueued, ["job-new"]);
  const insert = admin.calls
    .flatMap((call) => call.operations)
    .find(([operation]) => operation === "insert");
  assert.equal(insert[1].player_id, "player-1");
  assert.deepEqual(insert[1].reference_image_urls, []);
});
