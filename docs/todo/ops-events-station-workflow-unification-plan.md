# ops_events / station_activity_logs / workflow_nodes — Unification Plan

> **Status:** PLAN (2026-07-01). No implementation started.
>
> **Scope:** the two competing "what happened, where, to what" event spines (`ops_events`, `station_activity_logs`)
> and the missing link between either one and the tenant-owned Studio graph (`workflow_nodes`). This is a **narrow
> companion** to [`schema-wide-polymorphic-refactor-plan.md`](./schema-wide-polymorphic-refactor-plan.md) §4 ("Events &
> Activity", which flags `station_activity_logs` for slimming but predates this doc's `workflow_node_id` proposal) and
> to [`polymorphic-tables-database-refactor-plan.md`](./polymorphic-tables-database-refactor-plan.md) (same contract,
> different subsystem). The reference contract itself lives in `.claude/rules/polymorphic-tables.md` — read it before
> this doc; nothing here overrides it. Operations Studio / workflow-graph background lives in
> `docs/operations-studio/` (`NODE_WORKFLOW_ARCHITECTURE.md`, `operations-studio-plan.md`) — read those for how
> `workflow_nodes`/`workflow_definitions` work today; this doc only adds the event-logging angle they don't cover.

---

## 0. TL;DR

This app is multi-tenant and tenants build their own operations flow in Studio (`workflow_nodes`/`workflow_definitions`,
already per-org and editable with zero deploy). But the two tables that record staff activity — the legacy
`station_activity_logs` (SAL) and the newer polymorphic `ops_events` — both identify "where this happened" using
**code-level, deploy-time-fixed vocabularies** (a hardcoded TS union for SAL's `station` column; nothing at all for
`ops_events`). That's backwards for a system where a tenant is supposed to be able to add a new station/flow without
us shipping code.

The fix is **not** a big-bang merge of SAL into `ops_events`, and **not** a new link table joining events to entities.
It's three additive, independent moves:

1. **Adopt `ops_events` as the one long-term event spine** for anything new; freeze `station_activity_logs` (it has a
   real dependent FK — `packer_log_enrichments.sal_id` — and 40+ call sites; migrating it is its own project, not a
   prerequisite for anything below).
2. **Give `ops_events` a proper `entity_type` CHECK constraint** (it currently has none — a pre-existing gap against
   its own contract) for *what kind of business object* the event is about. This vocabulary is legitimately fixed at
   deploy time — new entity kinds need real join/trigger code regardless of tenant.
3. **Add a nullable `workflow_node_id TEXT REFERENCES workflow_nodes(id)`** column to `ops_events` for *where in the
   tenant's own flow* the event happened. This is the axis that must never be hardcoded — and the infrastructure for
   it already exists (`workflow_nodes.id` is already a stable, per-org, runtime-created string; `station_definitions`
   already demonstrates binding a station to one). We're wiring existing plumbing together, not inventing a new
   mechanism.

For events that touch several business entities at once (SAL's pattern — one PACK scan links a shipment, an FNSKU, an
FBA shipment item, a tech serial, and a packer log all in one row), the polymorphic answer is to **emit one
`ops_events` row per entity touched**, correlated by `event_type` + a shared key — not to widen one row with five FK
columns, and not to spin up a link table.

---

## 1. Context — why this work, and why now

- **The business requirement:** tenants must be able to customize their operations flow via Studio without a code
  deploy. `workflow_definitions`/`workflow_nodes` already deliver this for the *graph* (`2026-06-03_workflow_graph_layer.sql`)
  — an org can add a node with a client-generated id, bind it to a `station_definitions` composition
  (`2026-06-11_station_definitions.sql`), and it's live. **The event-logging layer does not participate in this
  flexibility yet.**
- **The gap this doc closes:** neither `station_activity_logs.station` nor `ops_events.entity_type` can name a
  tenant-defined station. Both are effectively hardcoded:
  - `station_activity_logs.station VARCHAR(20)` has **no DB constraint**; the sole gate is a hand-maintained TS union
    `StationName` in `src/lib/station-activity.ts:5` (`'TECH' | 'PACK' | 'FBA' | 'RECEIVING' | 'ADMIN' | 'OUTBOUND'`).
    A new tenant flow (say, a `REPAIR_BENCH` station) needs a code change and a deploy to log activity against it.
  - A **second, uncoordinated** station vocabulary already exists for staff assignment: `staff_stations` has a real DB
    CHECK (`src/lib/migrations/2026-06-02_staff_stations.sql:26`) over a *different* fixed list
    (`TECH|PACK|UNBOX|SALES|FBA`, see `src/components/admin/access/staff-access-shared.ts:76`). These two lists already
    drift from each other today — evidence this bifurcation is an active liability, not a hypothetical one.
  - `ops_events.entity_type` is free TEXT with **no CHECK at all** (`2026-06-30_ops_events.sql:24` — the comment says
    "validated app-side," but nothing enforces that). This is a real gap against the table's own governing contract.
- **Why not fix this by extending `work_assignments`'s pattern?** `work_assignments.entity_type` is a pg **ENUM**
  (`work_entity_type_enum`), fixed at deploy time by design — `.claude/rules/polymorphic-tables.md` explicitly calls
  this out as the one blessed exception for a *small, stable, rarely-extended* set, and warns `ALTER TYPE ADD VALUE`
  is awkward. A tenant-extensible "where" column is the opposite of small/stable/rare — an ENUM is the wrong tool
  here, which is why the fix below is a **foreign key to an existing tenant-owned table**, not a bigger enum.

---

## 2. Current-state inventory (facts, not proposals)

| Table | Discriminator / "where" column | Constraint | Tenant-extensible? | Dependents |
|---|---|---|---|---|
| `station_activity_logs` | `station VARCHAR(20)` | none (DB); TS union only | No — code deploy required | `packer_log_enrichments.sal_id` (hard FK, `ON DELETE CASCADE`); 40+ reader/writer files across tech/pack/orders/audit-log/timeline |
| `ops_events` | `entity_type TEXT` | **none** (gap) | Nominally yes, unenforced | 6 files (`src/lib/ops-events.ts`, `src/lib/timeline/ops-events.ts`, `src/lib/receiving/{rail/feeds,receiving-views,record-scan,unbox-scan-opened}.ts`, 2 API routes) |
| `staff_stations` | `station` | real CHECK, fixed list | No | staff-station assignment (separate concern, not activity logging) |
| `work_assignments` | `entity_type` (pg ENUM) | ENUM, 5 values, `ALTER TYPE` to extend | No (deliberately) | precedent for "don't do this for a tenant-extensible axis" |
| `workflow_nodes` | `id TEXT PRIMARY KEY` (client-generated), `type TEXT` (matched against code registry) | none on `id` (it's a PK); `type` unconstrained, validated against `src/lib/workflow/registry.ts` | **Yes** — org-scoped via `workflow_definitions.organization_id`, created at runtime by Studio, zero deploy | `station_definitions.workflow_node_id` already references it (soft, no formal FK) |
| `station_definitions` | `workflow_node_id TEXT` (nullable, soft-linked to `workflow_nodes.id`) | none | Yes (inherits from `workflow_nodes`) | proves the binding pattern works; **not wired to any event table today** |

**The one sentence version:** the tenant-extensible station identity already exists (`workflow_nodes.id`), but neither
event table points at it — they invented their own fixed vocabularies instead.

---

## 3. Target architecture

### 3.1 `ops_events` becomes the one long-term event spine

No new table. `ops_events` already matches the polymorphic contract's shape (`entity_type`/`entity_id`, org-led
indexes, `client_event_id` idempotency) better than SAL does. New domains — anything not already deeply wired into
SAL — log here going forward.

### 3.2 Two independent axes, not one

Keep them orthogonal; don't conflate "what" with "where":

- **`entity_type`/`entity_id`** — *what business object* (`receiving`, `receiving_line`, `serial_unit`, `shipment`,
  `fnsku`, …). Legitimately deploy-time-fixed: a new kind needs real join code and (per the contract) parent-delete
  integrity, so a CHECK constraint is correct here, not a limitation.
- **`workflow_node_id`** (new, nullable) — *where in the tenant's own flow*. Must stay a soft-but-real FK to
  `workflow_nodes(id)`, because that id space is exactly the "not hard-locked to station names" identity the business
  requires. Nullable because plenty of events (e.g. a receiving-line scan before any Studio graph exists for that org,
  or a system-generated event with no station) have no node to point at.

### 3.3 DDL sketch (additive, backfill-free — both columns are new)

```sql
BEGIN;

-- 1. Close the pre-existing contract gap: entity_type has no CHECK today.
DO $$ BEGIN
  ALTER TABLE ops_events ADD CONSTRAINT ops_events_entity_type_chk
    CHECK (entity_type IN (
      'receiving', 'receiving_line', 'serial_unit', 'shipment',
      'fnsku', 'fba_shipment', 'fba_shipment_item', 'tech_serial',
      'packer_log', 'order'
      -- exact list = a real audit of every entity_type string in use today
      -- (src/lib/ops-events.ts + the 6 current call sites), not invented here.
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. The tenant-customizable "where" axis.
ALTER TABLE ops_events
  ADD COLUMN IF NOT EXISTS workflow_node_id TEXT REFERENCES workflow_nodes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ops_events_org_node_time
  ON ops_events (organization_id, workflow_node_id, occurred_at DESC)
  WHERE workflow_node_id IS NOT NULL;

COMMIT;
```

`ON DELETE SET NULL` (not CASCADE): deleting a Studio node must never destroy history — the event still happened, it
just loses its "which node" annotation, same as `actor_staff_id`'s existing `ON DELETE SET NULL` for a deleted staff
member.

### 3.4 Multi-entity events (the SAL pattern) without a link table

SAL packs `shipment_id` + `fnsku` + `fba_shipment_id` + `fba_shipment_item_id` + `tech_serial_number_id` +
`packer_log_id` onto one row because one physical scan touches several business objects at once. `ops_events`'
single `entity_type`/`entity_id` shape doesn't have room for that on one row, and it shouldn't grow one — that's
exactly the "five FK columns on a fact table" shape the polymorphic contract exists to replace.

**Chosen approach: emit sibling rows, correlated, not one wide row.** One scan → N `ops_events` rows, one per entity
touched, sharing `event_type` and a correlation key (reuse `client_event_id`'s prefix, or a `payload.correlation_id`).
Each row gets its own `entity_type`/`entity_id`, its own index hit, and its own place in that entity's timeline. This
mirrors the already-established pattern in `.claude/rules/display/reference-timeline.md` — multiple spines merged and
sorted at read time (`OrderTimelineSection` does exactly this for audit + inventory + SAL today). We are not inventing
a new merge technique, just applying the existing one one layer earlier (write time → still N rows, not 1).

**Rejected: a `entity_type`/`entity_id` per row is already the "link" — a separate `ops_event_links` table would just
duplicate that column pair one hop away, creating two things that must stay consistent for zero benefit.** If a
future event genuinely needs a *second relationship kind* to the *same* entity (not a second entity), the contract's
answer is a second discriminator axis on the same table (`link_role`, as `photo_entity_links` does) — not a new table.
That case hasn't appeared yet; don't build it speculatively.

### 3.5 `station_activity_logs` — freeze, don't migrate (for now)

SAL stays exactly as it is. Reasons this is the right call today, not a punt:

- `packer_log_enrichments.sal_id INTEGER PRIMARY KEY REFERENCES station_activity_logs(id) ON DELETE CASCADE`
  (`2026-06-29f_packer_log_enrichment.sql:51`) is a hard, 1:1, cascading FK built *weeks ago* — unwinding it means
  either re-keying that table to a new event id space or keeping a compatibility shim, neither of which this doc
  should hand-wave.
- 40+ files read or write SAL directly (aggregators, hooks, timeline adapters, tech/pack/orders routes) — see the
  full list surfaced during discovery. That's a dedicated migration project (mirror the phased strangler in
  `polymorphic-tables-database-refactor-plan.md`), not a side effect of adding two columns to `ops_events`.
- Nothing about the tenant-customization goal requires touching SAL immediately. New tenant-defined stations can log
  to `ops_events` with a real `workflow_node_id` from day one; SAL keeps serving the stations it already knows about
  (PACK/TECH/FBA/RECEIVING/ADMIN/OUTBOUND) exactly as before. The two systems coexisting is an acceptable steady
  state for as long as it takes to plan SAL's retirement properly — it is not required to unblock tenant flow
  customization.

### 3.6 Unified read view (the only "combine them" that's in scope now)

If/when a single "all staff activity" surface is needed (e.g. an Operations Monitor view spanning both spines), build
it the same way `OrderTimelineSection` already merges audit + inventory + SAL: a `*ToTimeline` adapter per spine
(`opsEventsToTimeline` already exists in `src/lib/timeline/ops-events.ts`; add nothing new for SAL —
`stationActivityToTimeline` already exists too), merged + sorted + `collapseTimeline`'d at read time per
`.claude/rules/display/reference-timeline.md`. This is a **read-side** merge — no write-side table change, no
migration risk, ships independently of everything above.

---

## 4. Phased plan

**Phase 0 — Audit (no schema change)**
- Enumerate every `entity_type` string actually written today across `src/lib/ops-events.ts` and its 6 call sites;
  turn that into the real CHECK list (the sketch in §3.3 is illustrative, not final).
- Confirm no code path relies on `ops_events.entity_type` accepting an arbitrary/未-enumerated value (the "validated
  app-side" comment implies not, but verify before adding the CHECK — a CHECK that rejects a live write path is a
  worse regression than the gap it closes).

**Phase 1 — Additive schema**
- Land the CHECK (§3.3 item 1) and the `workflow_node_id` column + index (§3.3 item 2) in one migration, following
  `db-migration-author` conventions (idempotent DDL, tenant-from-birth already satisfied — `ops_events.organization_id`
  is NOT NULL from birth).
- Model the new column in `src/lib/drizzle/schema.ts` in the same PR (contract point 8).
- No backfill needed — existing rows simply have `workflow_node_id = NULL`, which is valid (nullable, and most
  historical events predate any Studio graph for their org anyway).

**Phase 2 — New writers adopt `workflow_node_id`**
- Any *new* event-emitting code path that runs inside a Studio-composed station (i.e. has a `workflow_node_id` in
  scope via `station_definitions`) threads it through to `recordOpsEvent`/whatever the `src/lib/ops-events.ts` writer
  is called. Existing writers are untouched — this is additive, not a required update to every call site.
- Confirm `src/lib/ops-events.ts`'s writer signature grows an optional `workflowNodeId` param (Deps-injectable per
  `backend-patterns.md`), not a required one — most callers today have no node in scope and that's fine.

**Phase 3 (optional, unscheduled) — Unified read view**
- Build the merged timeline adapter described in §3.6, only when a concrete surface needs it. Not a prerequisite for
  Phases 0–2.

**Phase 4 (explicitly NOT scheduled by this doc) — SAL retirement**
- Out of scope here. If/when it's undertaken, it is its own plan doc following the `polymorphic-tables-database-refactor-plan.md`
  strangler shape (backfill → dual-write → reader cutover → cleanup), because of the `packer_log_enrichments` FK and
  the 40+ dependent files. Do not fold that project into this one.

---

## 5. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Adding a CHECK to `ops_events.entity_type` breaks a live write with an un-audited value | Phase 0 audit is a hard gate before Phase 1 ships; run the migration against a staging copy first |
| `workflow_node_id` FK adds a join-time cost to hot event-write paths | Column is nullable and the index is partial (`WHERE workflow_node_id IS NOT NULL`) — zero cost for the (currently 100%) of writes that omit it |
| Two station vocabularies (SAL's TS union vs `staff_stations`' CHECK) keep drifting silently | Out of scope for this doc's schema change, but flag it: worth a follow-up ticket to either unify or explicitly document why they're allowed to differ (staff *assignment* vs activity *logging* may be a legitimate reason — verify, don't assume) |
| Someone reads this doc as "go migrate SAL now" | §3.5 and §4 Phase 4 say explicitly: not in scope, not scheduled, separate plan doc required |

## 6. Open questions

- Does every `entity_type` value currently written to `ops_events` map cleanly onto a real parent table with
  delete-integrity (contract point 5)? Phase 0's audit should surface this — if not, some values may need the
  "document the gap, skip explicitly" treatment the contract allows (`polymorphic-tables.md` point 5, last bullet).
- Should `workflow_node_id` also get parent-delete integrity beyond `ON DELETE SET NULL` (e.g. an audit trail note
  when a node a lot of history points at gets deleted)? Likely no — SET NULL matches `actor_staff_id`'s existing
  precedent and the event itself is the durable record, not the node reference.
- Is there a case, once tenants have real Studio-composed stations live, where an org wants its *own* CHECK-enumerated
  `entity_type` values (not just node identity)? If so, `entity_type` may eventually need the same "code-fixed
  business-object kind, per-org node for placement" split reconsidered — flag for a future revision, not answered here.

## 7. Non-goals (explicit)

- **Not** merging `station_activity_logs` into `ops_events` now, or ever, without its own dedicated plan.
- **Not** building a link/junction table for polymorphic references — `entity_type`/`entity_id` on the fact table
  already is the link.
- **Not** making `entity_type` tenant-extensible — only `workflow_node_id` (the "where," not the "what") gets that
  property.
- **Not** a requirement to update all 6 existing `ops_events` writers to pass `workflow_node_id` — additive only.

## 8. References

- `.claude/rules/polymorphic-tables.md` — the governing contract this doc applies.
- `.claude/rules/display/reference-timeline.md` — the read-time merge pattern §3.6 reuses.
- `docs/todo/schema-wide-polymorphic-refactor-plan.md` §4 (Events & Activity), §6 (Workflow / Studio Config).
- `docs/todo/polymorphic-tables-database-refactor-plan.md` — sibling deep-dive, same contract, receiving subsystem.
- `docs/operations-studio/NODE_WORKFLOW_ARCHITECTURE.md`, `operations-studio-plan.md` — `workflow_nodes`/`workflow_definitions` background.
- `src/lib/migrations/2026-06-30_ops_events.sql`, `2026-06-03_workflow_graph_layer.sql`, `2026-06-11_station_definitions.sql`,
  `2026-06-29f_packer_log_enrichment.sql`, `0000_baseline_through_2026-03.sql` (SAL + `work_assignments` origin).
- `src/lib/station-activity.ts`, `src/lib/ops-events.ts`, `src/lib/timeline/{ops-events,station-activity-events}.ts`.
