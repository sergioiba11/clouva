# CLOUVA AI Orchestrator — handoff

> **Actualización 2026-08-25:** el Orchestrator ya incluye Trébol multimodal Live,
> contexto global, el Tool Router compartido, confirmaciones y auditoría. El estado
> actual y los pasos previos a producción están en
> `docs/TREBOL_MULTIMODAL_LIVE_HANDOFF_2026-08-25.md`. Las secciones históricas
> de “not built yet” y “what remains” que aparecen debajo describen el corte del
> 2026-08-09 y no deben interpretarse como el estado vigente.

Written 2026-08-09 by Claude Code, handing off to Codex. If you're picking
this up, read this whole file before touching code — it has facts that took
real investigation to find (protocol details from a second repo, real
Supabase schema, a live deploy-target correction) that aren't obvious from
the diff alone.

## What this is

A unified **CLOUVA AI Conversation Orchestrator** spanning two repos:

- `D:\Clouva\Clouva app\clouva` (**this repo**) — the real production CLOUVA
  web app, Next.js, domain `clouva.com.ar`, GitHub `sergioiba11/clouva`.
  Everything below happened here.
- `D:\Clouva\clouva-workspace` — Electron Desktop app + `mobile/` (Expo) +
  `gateway/` (Cloud Run relay). Not modified by this work — only read, to
  learn its real protocol (pairing, request/response, permissions) so this
  repo's new code could talk to it correctly without changing it.

Original ask: a ChatGPT-like persistent AI chat inside CLOUVA. It grew into:
one CLOUVA conversation, Supabase = source of truth, Gemini in the middle, a
Tool Router (not built yet) dispatching to `GitHubExecutor` (this repo's own
GitHub repo) or `WorkspaceExecutor` (the user's PC, via the Gateway).
Workspace/GitHub are **executors**, not separate conversation engines — this
repo already had three overlapping chat code paths before this work
(`/api/gemini`, `/api/clouva-ai/agent`, `/api/clouva-ai/chat`); the third one
is now the single canonical Orchestrator, the other two are legacy (kept
working, not deleted, not called from the live UI anymore).

## Deploy target — read this before assuming anything about secrets/infra

This app runs on **Google Cloud Run**, not Railway. (Earlier notes on this
project said Railway — that was wrong and got corrected mid-work on
2026-08-09.) Concretely:

- Cloud Run service **`clouva-web`**, project **`gen-lang-client-0737053175`**
  ("CLOUVA AI" — same project as the Gateway, service `clouva-gateway`, both
  region `us-central1`).
- Deployed by `.github/workflows/deploy-gcp-web.yml` on push to `main`
  (path-filtered) — builds via Cloud Build (`cloudbuild-web.yaml`), deploys a
  tagged revision with `--no-traffic`, health-checks `/api/health`, then
  shifts traffic.
- Real runtime secrets (`GEMINI_API_KEY`, `GITHUB_TOKEN`,
  `SUPABASE_SERVICE_ROLE_KEY`, `CLOUVA_ADMIN_EMAILS`, etc.) live directly on
  the Cloud Run **service** — `gcloud run services describe clouva-web
  --project=gen-lang-client-0737053175 --region=us-central1` to list them.
  Not in a `.env` file anywhere; there's no `.env.local` in this repo and it
  has never been run locally on this machine.
- `.github/workflows/railway-direct-deploy.yml`, `railway-web.json`,
  `.railway`, `.railway-deploy-trigger` are **dead leftovers** from before
  the Cloud Run migration — don't treat them as live.
- `gcloud` CLI works directly in whatever environment you're in, already
  authenticated as `sergio.iba.11@gmail.com` against
  `gen-lang-client-0737053175`, if you need to check/change Cloud Run state.
  **Changing the live service's env vars or traffic is a production change —
  confirm with the user first**, don't do it silently.

Supabase project: **`dpawotcignpexkirhfsk`** ("Clouva App", org
`nnlnwadngxhnecsofyde`).

## Real domain facts (don't re-derive these)

- **Studios in CLOUVA** (`studios`/`player_studios`/etc. in Supabase) are
  **not** the same as Workspace's local `projects` with `category:"studio"`.
  Related, not identical.
- A Player without an account can already get a visual profile ("PJ") via
  `vip_profile_generation_jobs` → `player_profile_versions` (both FK
  `player_id` directly, `subject_shape` CHECK enforces `player_id` XOR
  `studio_id`). `user_avatars` is a **different** thing — the personal 3D
  wearable avatar tied to a logged-in `user_id`. Don't confuse them.
- El Iglú (`studios.id = aabd5413-9f00-475c-aff4-33eee90fc24b`, slug
  `el-iglu`) is Sergio's real Studio, used as the running example throughout
  this work.
- The Gateway's protocol needed **zero changes** for this repo to become a
  new kind of paired client. `clientType` on an `/mobile` auth frame
  (`"mobile"` vs `"desktop-relay"`) is declared in the type but genuinely
  never read by Desktop's own auth handler
  (`clouva-workspace/electron/controlServer/dispatcher.ts`) — only
  `deviceToken` matters. Confirmed by reading that file directly, not
  assumed.
- `/studio-dashboard/[studioId]`'s "Proyectos"/"Identidad IA" tabs and the
  admin `CLOUVA-CONTROL` nav item are **unrelated** to this work (different
  features, a naming collision in the QA-app case) — don't confuse with
  anything here.

## What's done (Tasks 1–10 of a 15-task plan)

Everything below is real, working code with real tests, verified with
`npm run typecheck` and `npx eslint <files>` after each task — not just
written and hoped to compile. None of it has been committed to git yet (see
"Current git state" below).

1. **Fixed `isAuthorized`** in the *other* repo
   (`clouva-workspace/electron/toolsRegistry.ts`) — was a stub ignoring
   per-device permissions. Now checks the real `deviceId`'s
   `ManagedDevice.permissions`. 9 vitest tests added there.
2. **`studio_id` on `ai_conversations`** (Supabase migration, nullable,
   FK→`studios`, indexed). RLS split per-action: read/write use
   `is_active_studio_participant()` (participation, not admin), delete uses
   `can_manage_studio()` (real admin + Studio OS active).
3. **Canonical Orchestrator** — `app/api/clouva-ai/chat/route.ts` rewritten
   into the single server-side writer of `ai_conversations`/`ai_messages`.
   `components/clouva-ai/ClouvaAIChat.tsx` no longer writes Supabase
   directly or calls the legacy routes. Extracted
   `lib/clouva-ai/repository-context.ts` (GitHub repo-context gathering) and
   `lib/clouva-ai/gemini-text.ts` (non-streaming Gemini + fallback) so the
   legacy `/api/clouva-ai/agent` route reuses them instead of duplicating.
4. **Context Resolver** — `lib/clouva-ai/context-resolver.ts`,
   `resolveStudioContext()`: compact Studio/members/Players summary, not a
   full-table dump. Explicit deferred seams marked inline (Studio-scoped
   memory needs Task 13, a linked local Workspace project needs Task 10 —
   done now, see below).
5. **Gemini streaming** — `lib/clouva-ai/gemini-stream.ts`, real SSE
   parsing, never silently retries once real text already reached the
   caller. Orchestrator now returns NDJSON frames
   (`{type:"chunk"|"done"|"error"}`).
6. **`ClouvaAIChat` made reusable + Studio-aware** — optional
   `studioId`/`studioSlug`/`studioName` props (unset = today's personal
   chat, byte-identical). Added conversation history panel, markdown
   rendering (`react-markdown`+`remark-gfm`, new deps), stop-generation,
   retry-on-failure, per-message timestamps. **Not done**: no Studio
   dashboard tab actually renders `<ClouvaAIChat studioId=... />` yet — a
   small follow-up, not its own numbered task.
7. **`ToolExecutor` contract + `GitHubExecutor`** —
   `lib/clouva-ai/tool-executor.ts` (`ToolDefinition{name,description,risk,
   parameters,execute}`, `ToolExecutor{target,tools(),getTool()}`,
   `BaseToolExecutor`) + `lib/clouva-ai/github-executor.ts` (4 tools:
   status/list/read = read-risk, `github_write_file` = write-risk requiring
   `confirm:true`). Wraps `lib/clouva-ai/github.ts` as-is.
8. **`workspace_links` table** (Supabase — applied via the Supabase MCP's
   `apply_migration`, not saved as a local migration file; `list_migrations`
   is the source of truth for what's actually applied remotely). Columns:
   `user_id, workspace_id, device_id, label, permissions[],
   device_token_ciphertext/iv/auth_tag/key_version, created_at,
   last_used_at, revoked_at`. **RLS enabled with zero policies** — mirrors
   `social_connections`' existing lockdown pattern exactly (anon/authenticated
   get denied on every operation unconditionally; only `service_role`
   touches this table; every route enforces `user_id` scoping itself in
   application code). Encryption: `core/crypto/secret-box.ts` (generic
   AES-256-GCM, parameterized by env-var name — same algorithm as
   `core/integrations/instagram/crypto.ts` but its own key,
   `WORKSPACE_DEVICE_TOKEN_ENCRYPTION_KEY`, so a leaked key for one secret
   never implicates the other).
9. **"Conectar mi Workspace" pairing** —
   `lib/clouva-ai/workspace-gateway.ts`'s `pairOverGateway()` (mirrors
   `clouva-workspace/mobile/src/transport/pairing.ts`'s handshake exactly:
   `{kind:"pair",code,deviceName}` → `pairing:success`/`pairing:error`
   event, or the Gateway's 4004 close code when the workspace is offline).
   `app/api/clouva-ai/workspace-link/route.ts` (GET/POST/DELETE,
   admin-gated) runs the handshake, encrypts the token, revoke-then-inserts
   into `workspace_links`. `components/clouva-ai/WorkspaceLinkPanel.tsx` on
   `/clouva-ai` — silently hides for non-admins. Added `ws`+`@types/ws` as
   real deps (Next on Node 20 doesn't have a reliable global `WebSocket`).
10. **`WorkspaceExecutor`** — the second `ToolExecutor`. `workspace-gateway.ts`
    grew `WorkspaceGatewayConnection`: connects, sends
    `{kind:"auth",deviceToken,clientType:"mobile"}`, then
    `.request(tool,args)` (id-correlated) and `.onEvent()` (unsolicited
    `{kind:"event"}` frames — the non-blocking long-op mechanism the plan
    asked for; not exercised by any tool yet, see below).
    `lib/clouva-ai/workspace-executor.ts`'s `WorkspaceExecutor(userId, deps?)`
    resolves the user's active `workspace_links` row, decrypts the token,
    opens **one** connection and reuses it across every tool call. Tool
    selection: the **exact same 7 read-only tools** Desktop's own
    `clouva-workspace/electron/ai/toolRuntime.ts` already calls
    `SAFE_TOOL_DEFINITIONS` — "the tools an agent is allowed to call
    automatically" — not a separately invented subset:
    `workspace.projects.list`/`.projects.inspect`/`.git.status`/`.git.log`/
    `.process.list`/`.analyzer.status`/`.activity.list`.

**Neither `GitHubExecutor` nor `WorkspaceExecutor` is wired into the live
Orchestrator yet.** `chat/route.ts`'s "project" mode still uses the older
`repository-context.ts` prefetch approach. This is deliberate — real Gemini
function-calling wiring needs Task 11 (the confirmation gate) to exist
first; handing a write-capable tool straight to the model with no approval
step in between would be a real regression versus today's explicit "Aplicar
cambio" button flow.

### Tests

Every new `lib/` module has real tests (`node --import tsx --test
tests-*.mjs`), not just typecheck. Network/socket boundaries are exercised
for real, not mocked, where practical:

- `tests-gemini-stream.mjs` — mocks `global.fetch` with a real
  `ReadableStream`.
- `tests-tool-executor.mjs` — mocks `global.fetch` for `GitHubExecutor`.
- `tests-secret-box.mjs` — real AES-256-GCM round trips.
- `tests-workspace-gateway.mjs` — a **real** `ws.WebSocketServer` standing in
  as a fake Desktop, driving both `pairOverGateway` and
  `WorkspaceGatewayConnection` (13+5 tests: auth accept/reject, id-correlated
  concurrent requests, timeouts, `onEvent` delivery, offline/4004, dropped
  connection rejecting pending requests).
- `tests-workspace-executor.mjs` — a hand-written fake Supabase query chain
  (injected via `WorkspaceExecutor`'s `deps.supabase`) + the same fake-ws
  Desktop, covering the full decrypt→connect→auth→dispatch path and
  connection reuse across calls.

Run everything new from this work:

```bash
node --import tsx --test tests-gemini-stream.mjs tests-tool-executor.mjs tests-secret-box.mjs tests-workspace-gateway.mjs tests-workspace-executor.mjs
npm run typecheck
npx eslint app components core lib tests-*.mjs
```

## What's next (Tasks 11–15, not started)

The approved plan order — don't reorder without a real contradiction, same
as the two architecture corrections already worked through in this project
(see "Why this exists" reasoning above: don't build a second conversation
engine, Studios ≠ Workspace projects).

11. **Confirmation gate**: reads = no confirm; writes = show action/diff;
    destructive/sensitive = explicit confirm required. Separate layer from
    Task 1's device-permission authorization — both apply. This is the
    prerequisite for actually wiring `GitHubExecutor`/`WorkspaceExecutor`
    into `chat/route.ts`'s real Gemini function-calling.
12. CLOUVA domain tools on real services (`getStudio`, `getStudioPlayers`,
    `updatePlayer`, `startPlayerProfileGeneration`, etc.) — never raw table
    writes from Gemini; always through the real pipelines already in this
    codebase.
13. Memory: replace `captureMemory`'s silent auto-save (still live today,
    untouched, in `chat/route.ts`) with propose→approve. Distinguish
    structured domain data (Player fields) from conversational memory
    (`project_memory`).
14. Give CLOUVA Mobile its own CLOUVA/Supabase identity — it currently only
    has Workspace-device-pairing auth, no CLOUVA user session, so it can't
    "continue the same Supabase conversation" yet.
15. Full verification (typecheck/build/tests across both repos + Gateway) +
    a scripted end-to-end test: pair CLOUVA Cloud → Studios→El Iglú→AI →
    members → Player role update → profile generation → local project
    review → typecheck → errors → same conversation continued from Mobile.

## Known gaps to check before relying on any of this live

- **Two env vars confirmed NOT set on the live Cloud Run service** (checked
  via `gcloud run services describe clouva-web`):
  - `WORKSPACE_DEVICE_TOKEN_ENCRYPTION_KEY` — 32 random bytes, base64 or
    hex (see `core/crypto/secret-box.ts`'s `loadKey()`).
  - `CLOUVA_CONTROL_GATEWAY_URL` — the Gateway's `/relay` URL, same value
    Desktop's own Devices page shows (likely
    `wss://clouva-gateway-37640598175.us-central1.run.app/relay` — confirm
    against what Desktop is actually configured with, don't just assume).
  - Typecheck/tests don't need these; a real pairing or tool call against
    production does. Setting them is a live-production change — confirm
    with the user first.
- The Desktop app (`clouva-workspace`) hasn't been restarted since the
  Task 1 permission fix landed there — rebuild + restart before relying on
  it live.
- No Gemini API key was available locally to live-test the actual streaming
  HTTP round trip through a real browser — verified via unit tests mocking
  only the network boundary instead.
- **A background task was in flight as of this handoff**: extracting the
  now-4x-duplicated `CLOUVA_ADMIN_EMAILS` gate check
  (`agent`/`github`/`chat`/`workspace-link` routes) into
  `lib/server/supabase.ts`'s `isAdminEmail()`. Check `git status`/`git diff`
  before assuming any given route still has its own inline copy.

## Current git state (as of this handoff)

Nothing from this work has been committed — everything is a working-tree
diff on top of `main`. Run `git status` and `git diff --stat` to see exactly
what's changed before doing anything destructive. New files worth knowing
about: `lib/clouva-ai/{tool-executor,github-executor,workspace-gateway,
workspace-executor,context-resolver,gemini-stream,gemini-text,
repository-context}.ts`, `core/crypto/secret-box.ts`,
`app/api/clouva-ai/workspace-link/route.ts`,
`components/clouva-ai/WorkspaceLinkPanel.tsx`, and the `tests-*.mjs` files
listed above. `package.json`/`package-lock.json` gained `react-markdown`,
`remark-gfm`, `ws`, `@types/ws`.

Two stray untracked files (`.gitignore.bak.orphan`, `Untitled`) predate this
work and aren't related to it — not created by this effort, safe to ignore
or ask the user about separately.
