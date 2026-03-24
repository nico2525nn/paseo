# Storage Revamp Plan

Status: working implementation plan

This document is meant to guide implementation and review. It captures the decisions that have already converged, names the sequencing and test gates that should not be skipped, and leaves open the product and implementation details that are still legitimately undecided.

## Goals and scope

The storage revamp moves Paseo from a mixed JSON plus in-memory model to an explicit storage layer backed by Drizzle and PGlite.

In scope:

- durable storage for project records
- durable storage for workspace records
- durable storage for agent snapshot metadata
- durable storage for committed agent timeline history
- a simplified timeline contract: committed canonical history vs provisional live updates
- removal of `epoch`/`reset`/projection-heavy timeline recovery paths
- migration and cutover from existing JSON-backed Paseo homes where source data actually exists

## Non-goals

Out of scope for this plan:

- migrating config, keypairs, server identity, or push-token files into the DB
- persisting raw provider deltas, chunk streams, or other transport-only live updates
- designing a remote/cloud database story beyond keeping the schema portable
- committing durable reasoning history in v1 unless product explicitly asks for it later
- preserving legacy timeline semantics such as `epoch`, projection metadata, or provider-history rehydrate on refresh/load

## Current state and migration hazards

Today the server persists three different kinds of state in three different ways:

- projects in `projects/projects.json`
- workspaces in `projects/workspaces.json`
- agent snapshots in `agents/{cwd}/{agent-id}.json`

Committed timeline history is different. It is still effectively an in-memory `AgentManager` concern:

- rows live in `agent.timelineRows`
- sequence numbers are assigned in memory
- retention trimming can drop older rows
- `fetchAgentTimeline` still carries `epoch`, `reset`, `gap`, projection mode, and seq-range metadata to compensate for that model

There are also two migration hazards that should be treated as foundation work, not cleanup:

1. Agent snapshot persistence is split across multiple writers.
   `attachAgentStoragePersistence()` flushes `agent_state` snapshots, while `Session` also writes agent records directly for archive/unarchive and related flows. The storage revamp should collapse that into clearer ownership before the DB swap broadens the write surface.

2. Agent load and refresh still depend on provider history hydration.
   `Session.ensureAgentLoaded()` resumes or recreates a provider session and then calls `hydrateTimelineFromProvider()`. That makes refresh/load behavior depend on provider-managed history, creates replay and dedup complexity, and blocks a clean storage-owned timeline contract.

The practical implication is that this is not just a database wiring task. The contract and ownership model have to be simplified first.

## Converged decisions and contracts

### Storage choice: Drizzle + PGlite

This plan assumes Drizzle plus PGlite.

Why this is the right default:

- one Postgres-flavored schema and migration pipeline for local and future hosted storage
- no native addon packaging burden in the Electron and local-daemon environment
- Drizzle keeps the schema in TypeScript and fits the existing codebase style better than a heavier codegen-oriented ORM
- PGlite is fast enough for Paseo's local CRUD and timeline query workload

This does not lock the project into every detail of local database lifecycle yet. It does lock the plan onto a Postgres-shaped schema and Drizzle-based migration workflow.

### Storage boundary

The goal is not a grand generic repository framework. The useful seams are:

- `ProjectRegistry`
- `WorkspaceRegistry`
- `AgentSnapshotStore`
- `AgentTimelineStore`
- `WorkspaceReconciliationService`

The refactor should preserve clear domain ownership:

- project and workspace records stay distinct because reconciliation and placement logic are distinct
- agent snapshot metadata stays separate from timeline history
- filesystem reconciliation stays as a service over stored records, not an accidental side effect inside session code

### Timeline contract

The room has converged on a simplified contract:

- `timeline` event with `seq` present means committed canonical history owned by Paseo storage
- `timeline` event with no `seq` means provisional live-only state and is never returned by catch-up fetches
- committed rows must already be in canonical display/history shape, not raw provider chunk shape
- `fetch-after-seq` returns committed rows only
- subscribe may emit the current provisional head once if a turn is active
- that provisional seed must contain current full provisional items, not replayed deltas
- that provisional seed must arrive before later provisional patches for that subscription
- at most one active provisional assistant stream and one active provisional reasoning stream exist per turn
- tool progress continues to correlate by existing `callId`
- reasoning is live-only for v1 unless product explicitly changes that call later

### Why `epoch` is removed

`epoch` exists today because timeline identity is not fully owned by durable storage. It resets when the in-memory window is invalidated or rebuilt, and clients carry that reset logic in public protocol state.

That is the wrong long-term contract for a DB-backed append-only history. Once committed history is storage-owned and no longer trimmed out from under clients:

- catch-up can be `after seq`
- published sequence numbers do not need to be rewritten
- clients do not need `epoch`, `reset`, or projection-derived recovery metadata

Removing `epoch` is not a cosmetic cleanup. It is the public sign that committed history is finally durable and stable.

### Why refresh/load must not rehydrate provider history

Provider history hydration made sense as a stopgap while Paseo did not own durable timeline history. It is now an obstacle.

Refresh/load must stop rehydrating provider history because it:

- makes the public history contract depend on provider-specific retention and replay behavior
- forces user-message dedup rules and other replay suppression into server logic
- creates ambiguity over whether a timeline row is provider-imported history or Paseo-owned committed history
- makes reconnect behavior depend on re-importing old provider state instead of reading committed rows from storage

The replacement contract is simpler:

- refresh/load restores agent snapshot state from Paseo storage
- committed history comes from `AgentTimelineStore`
- provisional in-flight state, if any, is subscription-scoped and may be seeded once per subscription according to the chosen policy

## Timeline consumption contract

The client model is intentionally two-layered:

- committed history is the durable tail, keyed by monotonically increasing `seq`
- provisional live state is the transient head, carried by unsequenced `timeline` events

The client keeps a committed cursor, not a provisional cursor. Provisional streaming never advances that committed cursor.

### Client mental model

The client stores:

- the last committed `seq` it has accepted for a given agent
- the committed history rows needed for the current view
- any current provisional UI state for in-progress assistant, reasoning, or tool activity

It does not store or reason about a second durable sequence space for provisional data.

### `fetch-after-seq`

`fetch-after-seq(agentId, seq)` means:

- return committed canonical history rows with `seq > cursor`
- never return provisional live state
- never return raw chunk rows
- preserve committed order

If there are no committed rows after that cursor yet, the result is empty even if an in-progress message is still streaming live.

### Subscribe-time provisional seed

A subscribe-time provisional seed, if used by the chosen policy, is a one-time delivery of the current full provisional items for that subscription.

It is not:

- a historical replay of provider deltas
- a second committed history fetch
- a second sequence space

If emitted, it must arrive before later provisional patch events for that subscription.

### Reconnect scenarios

Concrete reconnect example:

- the client has accepted committed history through `seq = 120`
- the committed tail includes rows through `120`
- the client UI also shows an in-progress assistant message in the provisional head
- that provisional assistant message has no committed seq yet

Case A: the assistant message finishes while the client is disconnected

1. The client reconnects with last committed `seq = 120`.
2. The client calls `fetch-after-seq(agentId, 120)`.
3. The server returns committed row `121`, containing the full finalized assistant message.
4. The client accepts row `121` into the durable tail and advances its committed cursor to `121`.
5. The stale provisional assistant UI from before disconnect is dropped because the committed row has now superseded it.

Case B: the assistant message has not finished by the time the client reconnects

1. The client reconnects with last committed `seq = 120`.
2. The client calls `fetch-after-seq(agentId, 120)`.
3. The server may legitimately return nothing new yet, because committed row `121` does not exist yet.
4. Live streaming resumes.
5. A subscribe-time provisional seed may repopulate the current in-progress state if that policy is enabled; otherwise the client continues from fresh live updates only.
6. When the assistant message finally completes, it becomes one committed row `121`.

In both cases:

- partial streaming before disconnect never advanced the committed cursor
- `fetch-after-seq` is about committed history only
- provisional streaming is transient UI state, not committed history

If the daemon restarted or the agent is unloaded:

- committed history still comes from `AgentTimelineStore`
- the client can fetch committed history by seq without the provider session being active
- provisional state is absent unless a new live subscription later seeds it

### Replacement rule without a second sequence space

The replacement rule is intentionally simple:

- committed rows are authoritative durable history
- provisional UI is best-effort and disposable
- when a committed row arrives that corresponds to previously shown provisional state, the committed row becomes the durable representation and the provisional UI is cleared

This simplicity depends on the agreed invariant that there is at most one active provisional assistant stream and one active provisional reasoning stream per turn.

This avoids introducing `epoch`, a second durable sequence space, or provider-specific replay semantics.

## Authority and ownership

The storage revamp needs explicit authority boundaries so the model cannot drift during implementation.

- `AgentTimelineStore` owns committed timeline authority
- only the committed-history authority path may assign durable `seq`
- provisional/live buffering is owned by the runtime/session path that is already handling live provider events; it is not owned by the DB
- `AgentSnapshotStore` owns durable agent snapshot persistence
- `WorkspaceReconciliationService` owns filesystem-vs-stored-workspace reconciliation
- `ProjectRegistry` and `WorkspaceRegistry` own durable structured records for those domains
- legacy structured-record import is a bootstrap path owned by the structured-record storage layer, not by ad hoc session code

Practical implications:

- providers do not assign committed seqs
- clients do not infer committed seq advancement from provisional events
- session code may read committed history, but it should not become an alternate authority for committed storage semantics

## Interfaces and module boundaries

These are design-level contracts, not implementation-level signatures.

### `AgentSnapshotStore`

Responsibilities:

- read and write durable agent snapshot metadata
- archive and unarchive snapshot records
- list and fetch stored agent snapshots without requiring an active provider session

Useful method shape:

- `get(agentId)`
- `list(filter?)`
- `upsert(snapshotRecord)`
- `archive(agentId, archivedAt)`
- `unarchive(agentId)`

### `AgentTimelineStore`

Responsibilities:

- append finalized committed history rows
- fetch committed history by tail, before-seq, or after-seq queries
- serve committed history for unloaded or restarted agents
- guarantee ordered committed seq allocation per agent

Useful method shape:

- `appendCommitted(agentId, item, metadata?) -> committedRow`
- `fetchTail(agentId, limit)`
- `fetchBeforeSeq(agentId, beforeSeq, limit)`
- `fetchAfterSeq(agentId, seq, limit?)`
- `getLatestCommittedSeq(agentId)`

Constraints:

- no raw chunk rows in durable history
- no provisional rows in durable history
- seq assignment happens only here or in the narrow authority path directly behind it

### `ProjectRegistry`

Responsibilities:

- store and fetch durable project records
- upsert, archive, and list project records

Useful method shape:

- `get(projectId)`
- `list(filter?)`
- `upsert(projectRecord)`
- `archive(projectId, archivedAt)`

### `WorkspaceRegistry`

Responsibilities:

- store and fetch durable workspace records
- upsert, archive, and list workspace records

Useful method shape:

- `get(workspaceId)`
- `list(filter?)`
- `upsert(workspaceRecord)`
- `archive(workspaceId, archivedAt)`

### `WorkspaceReconciliationService`

Responsibilities:

- own both targeted reconcile-on-register or placement-update checks and broader stale-workspace sweeps
- compare durable workspace records against filesystem reality
- mark stale or missing workspaces according to the chosen policy
- keep reconciliation logic out of session orchestration code

Useful method shape:

- `reconcileTarget(workspaceId | cwd) -> reconcileResult`
- `reconcileSweep() -> reconciliationResult`

### Timeline-facing session/service seam

One session-facing timeline contract is useful so the app/CLI path does not need to know storage internals.

Responsibilities:

- fetch committed history for initial view, older-history pagination, or reconnect
- expose live subscription semantics
- apply the committed-vs-provisional contract consistently for app and CLI consumers

Useful method shape:

- `fetchTail(agentId, limit)`
- `fetchBeforeSeq(agentId, beforeSeq, limit)`
- `fetchAfterSeq(agentId, seq, limit?)`
- `subscribe(agentId, options?)`

This seam is a consumer-facing contract exposed by the session layer so app and CLI callers do not need to know storage internals. It is not a second storage/service authority for committed timeline semantics.

## DB design and query shape

The plan does not need to freeze the final schema, but it should lock the query-driving shape.

### Main tables expected

- `projects`
- `workspaces`
- `agent_snapshots`
- `agent_timeline_rows`

### Fields that matter for core queries

For `agent_timeline_rows`:

- `agent_id`
- committed `seq`
- committed timestamp
- canonical item payload
- optional item kind or type discriminator only if it helps storage ergonomics without expanding the hot-path query surface

For `agent_snapshots`:

- `agent_id`
- provider
- cwd / workspace linkage
- lifecycle/status metadata
- timestamps needed for listing and resume decisions
- archive state

For `projects` and `workspaces`:

- durable IDs
- linkage fields
- display fields
- archive state
- timestamps needed for reconciliation and listing

### Main queries to support efficiently

Hot-path:

- fetch committed tail for an agent
- fetch older committed history before a known seq for scrollback / pagination
- fetch committed rows after a known seq for reconnect/catch-up
- fetch committed history for an unloaded or restarted agent through the same per-agent tail/after-seq path
- append one finalized committed row
- list/fetch agent snapshots for UI and session bootstrap
- list/fetch projects and workspaces for the app shell

Cold-path:

- legacy structured-record import
- archive/unarchive and reconciliation sweeps

### Likely indexes and why

- unique ordered `(agent_id, seq)` constraint/index on timeline rows for per-agent seq uniqueness, ordered append, and after-seq fetch
- index on agent snapshot status/update time for list views
- index on workspace `project_id` for grouped workspace listing
- index on archive state where it materially reduces active-record scans

This is enough to guide implementation without prematurely optimizing secondary filters or analytics-style queries. Per-type filtering is not part of the required v1 hot path.

### Not optimizing yet

The v1 design is intentionally not optimizing for:

- cross-agent global timeline queries
- full-text search over timeline history
- reasoning-history analytics
- provider-specific chunk replay
- multi-tenant or remote-hosted query patterns

## Timeline query scenarios and invariants

Primary timeline queries:

### Fetch tail for initial view

- input: `agentId`, `limit`
- result: latest committed canonical rows only
- invariant: tail fetch does not depend on an active provider session

### Fetch after seq for reconnect/catch-up

- input: `agentId`, last committed `seq`
- result: committed canonical rows with greater seq
- invariant: no provisional rows are returned
- invariant: no gaps or duplicates appear when combined with resumed live streaming

### Fetch before seq for older-history pagination

- input: `agentId`, `beforeSeq`, `limit`
- result: older committed canonical rows with `seq < beforeSeq`
- invariant: older-history pagination uses the same committed-row contract as tail and after-seq reads
- invariant: no provisional rows or raw chunk rows are returned

### Fetch committed history for unloaded or restarted agent

- input: `agentId`
- result: committed history from storage
- invariant: provider-history rehydrate is not required

### Append finalized committed row

- input: finalized logical history item
- result: one committed row with one durable seq
- invariant: no raw chunk rows are written as durable history

Core invariants:

- provisional streaming does not advance the committed seq cursor
- durable history contains finalized canonical rows only
- clients recover from disconnect by fetching committed rows after the last committed seq
- if nothing finalized while disconnected, `fetch-after-seq` may return nothing and live streaming resumes
- if something finalized while disconnected, the returned committed row supersedes stale provisional client UI
- no gaps or duplicates are allowed across catch-up plus live resume

## v1 design non-goals

The design deliberately does not support these in v1:

- durable reasoning history
- historical backfill of timeline data that never existed in Paseo storage
- provider-history rehydrate as a normal refresh/load mechanism
- raw chunk durability
- multiple simultaneous provisional assistant or reasoning streams beyond the agreed single-stream invariant

## Phase plan

Each phase below includes the required goals, sequencing, tests, exit gate, and suggested commit boundary. The phases are intentionally practical rather than over-detailed.

Suggested commit boundaries are approximate. They are there to keep reviewable slices and clear gates, not to force an artificial commit count if two adjacent steps clearly belong together.

### Phase 0: Contract and model cleanup before DB wiring

Goal:
Lock the public and internal timeline contract before introducing a new storage backend.

What changes:

- remove `epoch` from shared timeline cursor/message shapes
- define committed-vs-provisional semantics around `timeline + optional seq`
- remove projection-specific public response baggage such as `reset`, `projection`, seq-range collapse metadata, and related epoch gates
- update server/session/app catch-up logic to use seq-backed committed history plus provisional head seeding
- make reasoning explicitly live-only for v1
- document and enforce the single-provisional-stream invariant per kind

Dependencies:

- none beyond the contract decisions already converged in the room

Tests required:

- shared message parsing tests for the simplified timeline payloads
- app reducer tests for committed append, provisional merge, and subscribe-time provisional seeding
- session/WebSocket tests for `live -> disconnect -> fetch-after-seq -> subscribe -> provisional seed -> resume`
- explicit subscribe-time provisional-seed ordering test

Exit gate:
The client and server can exchange committed and provisional timeline updates without `epoch`, `reset`, or projection metadata, and all timeline catch-up tests pass with the new contract.

Can happen in parallel:

- shared message/schema cleanup
- app reducer and bootstrap policy cleanup
- server session fetch/subscribe cleanup

Must stay sequential:

- final protocol shape must settle before DB schema and timeline store work begin

Suggested commit boundaries:

- protocol and message schema cleanup
- app/session reducer and catch-up logic cleanup
- tests locking the new contract

### Phase 1: Storage boundary refactor with current backends

Goal:
Separate domain ownership and persistence seams while still using the current JSON and in-memory backends.

What changes:

- introduce explicit `AgentSnapshotStore` and `AgentTimelineStore` seams
- keep `ProjectRegistry` and `WorkspaceRegistry` as concrete domain seams rather than wrapping them in a generic repository abstraction
- extract workspace reconciliation into a dedicated `WorkspaceReconciliationService`
- collapse duplicate snapshot-writer paths so snapshot persistence ownership is explicit
- isolate current in-memory timeline logic behind the timeline store interface
- isolate refresh/load dependence on provider history rehydrate behind explicit seams so Phase 4 can remove it cleanly without another structural refactor

Dependencies:

- Phase 0 contract and message-shape cleanup should be settled enough that the extracted seams do not preserve `epoch`-era behavior by accident

Tests required:

- store contract tests for snapshot store and timeline store
- registry contract tests for projects and workspaces
- reconciliation tests using real temp directories and real filesystem mutations
- refresh/load tests proving any remaining provider-history dependency is isolated behind explicit storage/session seams rather than scattered through the runtime

Exit gate:
The server can run unchanged behavior through explicit storage interfaces, duplicate snapshot-writer ownership is collapsed, and any remaining provider-history rehydrate dependency is isolated to a narrow compatibility path that Phase 4 can delete.

Can happen in parallel:

- snapshot-store extraction
- reconciliation extraction
- timeline-store interface extraction

Must stay sequential:

- duplicate snapshot-writer cleanup should land before DB-backed snapshot cutover
- timeline store contract should settle before DB timeline work begins

Suggested commit boundaries:

- snapshot-store ownership cleanup
- reconciliation-service extraction
- timeline-store extraction with in-memory adapter

### Phase 2: DB foundation

Goal:
Land the database runtime, schema, and migration tooling without yet making the DB the source of truth for every domain.

What changes:

- add Drizzle schema and migration workflow
- add PGlite database bootstrap and lifecycle management
- define tables for projects, workspaces, agent snapshots, and committed timeline history
- choose indexes based on the first real query set, especially `agent_id + seq`
- implement DB-backed adapters for the storage seams introduced in Phase 1

Dependencies:

- Phase 1 storage seams should exist before DB adapters become the main implementation path

Tests required:

- migration tests on fresh databases
- migration tests on incremental schema upgrades
- DB adapter tests against a real PGlite database
- startup/shutdown tests for DB bootstrap in the daemon environment

Exit gate:
The repo can create, migrate, and query a real PGlite-backed Drizzle database in tests, and the new adapters satisfy the same contract tests as the current backends.

Suggested commit boundaries:

- Drizzle and PGlite foundation
- schema plus migrations
- DB adapters wired behind existing interfaces

### Phase 3: Structured-record cutover and legacy JSON import

Goal:
Move projects, workspaces, and agent snapshot metadata onto the DB, with explicit import rules from existing Paseo homes.

What changes:

- make the DB-backed project/workspace stores authoritative
- make the DB-backed agent snapshot store authoritative
- import legacy `projects.json`, `workspaces.json`, and agent snapshot JSON into the DB
- run workspace reconciliation against stored records and filesystem state
- keep archive/unarchive and related metadata flows working through the new store ownership model

Dependencies:

- Phase 2 DB bootstrap, migrations, and DB-backed structured-record adapters must be stable first

Tests required:

- import tests from existing JSON files into empty DBs
- idempotent re-import tests where the DB already contains matching rows
- reconciliation tests covering deleted directories and archived-agent edge cases
- agent list/fetch/workspace list session tests against DB-backed stores

Exit gate:
A daemon can start from a legacy Paseo home, import structured records into the DB, restart from the same home again without duplication or state drift, and serve project/workspace/agent metadata without depending on JSON files as the source of truth.

Ordered rollout note:

- first, project/workspace authority plus reconciliation and import harness
- second, restart/idempotence verification on the structured-record path
- third, agent snapshot metadata authority
- structured records should cut over before timeline storage so the timeline phase can rely on stable DB-backed agent identity and metadata

Suggested commit boundaries:

- project/workspace DB cutover plus import harness and reconciliation
- agent snapshot DB cutover and restart/idempotence tests

### Phase 4: Timeline storage and catch-up cutover

Goal:
Move committed timeline history to storage-owned append-only rows and remove provider-history rehydrate from refresh/load.

What changes:

- make `AgentTimelineStore` authoritative for committed history
- write one committed row per finalized history item
- stop storing raw chunk rows as committed history
- keep provisional live updates in memory/subscription scope only
- make fetch/catch-up query committed rows by `agent_id + seq`
- remove provider-history rehydrate from normal refresh/load flows
- remove retention-window timeline trimming and epoch-reset behavior for committed history

Dependencies:

- Phase 0 contract cleanup
- Phase 2 DB foundation
- Phase 3 structured-record cutover, so timeline rows attach to stable DB-backed agent metadata and identity

Tests required:

- timeline store contract tests against real PGlite
- live-to-commit tests for assistant, tool, and reasoning-live-only behavior
- reconnect tests covering committed catch-up plus provisional seed ordering
- migration/cutover tests proving refresh/load do not import provider history
- scenario tests for:
- live stream while connected
- disconnect after committed seq `N`, reconnect, `fetch-after-seq(N)`, then resume live without gaps or duplicates
- daemon restart, then fetch committed history without provider rehydrate
- `attach`/`logs` against an agent with committed stored history but no active provider session

Exit gate:
Committed timeline history survives daemon restart, reconnect from a known committed seq yields ordered history with no gaps or duplicates across catch-up plus live resume, including the provisional-seed case, and refresh/load no longer depend on provider history replay.

Internal sub-gates:

- write-path parity is established before the DB-backed timeline writer becomes authoritative
- `fetch-after-seq` parity is established before legacy committed-history reads are removed
- reconnect no-gap/no-duplicate behavior is proven before timeline cutover is considered complete
- refresh/load de-rehydrate removal lands only after committed-history write and read authority are stable

Can happen in parallel:

- timeline write path
- fetch/catch-up query path
- CLI/app verification against storage-backed committed history behavior

Must stay sequential:

- this phase depends on Phase 0 contract cleanup and Phase 2 DB foundation
- it should land after Phase 3 so agent and workspace identity are already DB-backed

Suggested commit boundaries:

- gated committed timeline store plus write/read parity work, not yet authoritative until matching read-path coverage exists
- authoritative fetch/catch-up cutover together with reconnect scenario coverage
- refresh/load de-rehydrate cleanup and related tests

### Phase 5: Cleanup and removal

Goal:
Delete legacy paths once DB-backed storage and the simplified contract are proven.

What changes:

- remove legacy JSON source-of-truth paths for projects, workspaces, and agent snapshots
- remove in-memory committed timeline ownership and retention trimming
- remove leftover compatibility code and dead reducers from the pre-Phase-0 timeline model
- remove provider-history hydration paths that are no longer part of refresh/load
- update architecture and developer docs to reflect the new ownership model

Dependencies:

- Phase 3 and Phase 4 must both have passed their exit gates

Tests required:

- full server typecheck and existing relevant test suites
- targeted regression tests for deleted legacy branches
- migration tests proving old homes still import correctly into the new model

Exit gate:
There is one durable storage path for structured records and committed timeline history, normal runtime no longer writes legacy JSON or in-memory committed-history branches, and no runtime behavior depends on the removed JSON/in-memory history model.

Suggested commit boundaries:

- legacy path removal
- doc updates and final contract cleanup

## Legacy data and import constraints

The migration story is intentionally narrower than a full historical backfill.

What can be imported from existing Paseo homes:

- projects from `projects/projects.json`
- workspaces from `projects/workspaces.json`
- agent snapshot metadata from agent JSON files

What cannot be broadly backfilled:

- committed timeline history that never existed in Paseo storage
- raw provider history that would need to be rehydrated on refresh/load
- provisional live state from prior daemon lifetimes

That means the honest timeline migration story is:

- existing committed history only exists for whatever Paseo has already written under the new timeline store
- after cutover, timeline history is durable and append-only
- before cutover, old homes do not gain full historical timelines unless a separate import source is defined later

This is a feature, not a gap. It keeps the new contract storage-owned instead of reintroducing provider-specific replay semantics.

## Orchestrator audit plan

Every implementation slice requires an independent audit pass before it is accepted. Audit agents verify; they do not edit files. A phase is not complete until its audit gate passes.

Audit prompts should be checklist-based and evidence-driven. The point of these passes is to catch regressions, hidden behavior changes, missing tests, two-authority drift, and unnecessary complexity before the next phase begins.

### Phase 0 audit

The audit pass must verify:

- the public contract actually removed `epoch`, `reset`, and projection-heavy response baggage where intended
- `timeline` with `seq` vs without `seq` behaves as specified
- the explicit `seq = 120 -> 121` reconnect scenario is covered by tests
- older-history pagination still works under the committed-history contract
- app reducer and session/WebSocket behavior match the agreed contract

### Phase 1 audit

The audit pass must verify:

- no functional behavior changed beyond the intended seam refactor
- duplicate snapshot-writer ownership is actually collapsed
- reconciliation ownership is actually extracted from `Session`
- provider-history dependency is isolated and not still scattered through runtime code
- seam contract tests exist and pass

### Phase 2 audit

The audit pass must verify:

- fresh migrations succeed
- incremental migrations succeed
- DB adapters pass the same contract tests as current backends
- bootstrap and shutdown are stable
- no DB path is prematurely authoritative unless explicitly intended

### Phase 3 audit

The audit pass must verify:

- import from a legacy Paseo home works
- restarting from the same legacy home does not duplicate or drift structured records
- project, workspace, and agent metadata behavior matches prior behavior
- reconciliation still surfaces stale or missing workspaces correctly
- archive, unarchive, list, and fetch flows still work

### Phase 4 audit

The audit pass must verify:

- committed history survives daemon restart
- `fetch-after-seq` and `fetch-before-seq` behave correctly
- no raw chunk rows are persisted
- reconnect satisfies the no-gap/no-duplicate invariant
- the `120 -> 121` reconnect scenario is explicitly verified
- unloaded or restarted agent history reads work without provider rehydrate
- CLI and app history behaviors such as `logs`, `attach`, and timeline fetch still work against committed stored history

### Phase 5 audit

The audit pass must verify:

- normal runtime no longer writes legacy JSON or in-memory committed-history branches
- dead compatibility branches are actually gone
- relevant test suites and typecheck pass
- legacy-home import still works under the final model

## Open questions and risks

Open product or implementation questions:

- should subscribe-time provisional seeding always happen when a turn is active, or only when the client asks for streaming state
- do we want a durable system/error timeline row for failed or canceled turns, or should those remain transport-only
- do any providers require an extra adapter constraint to uphold the single-provisional-stream invariant

Main risks and mitigations:

- risk: the plan quietly recreates projection complexity inside the DB schema
  mitigation: store canonical committed rows only, and keep raw/provisional data out of durable history

- risk: refresh/load still leaks provider-history import back into the committed-history path
  mitigation: make de-rehydrate behavior a named Phase 4 gate with dedicated tests

- risk: legacy import over-promises timeline backfill
  mitigation: keep timeline migration constraints explicit and separate from structured-record import

- risk: the storage refactor turns into a large abstraction exercise
  mitigation: keep the seam list concrete and domain-shaped; avoid generic repository frameworks

- risk: sequencing gets inverted and DB work begins before the protocol and ownership model settle
  mitigation: keep Phase 0 and Phase 1 as hard prerequisites for DB timeline cutover
