# Universal Feed — Polymorphic Linkage Plan (`feed_links`)

> **Status:** PLAN (2026-07-03). No implementation started.
>
> **Scope:** a new, generic polymorphic table — `feed_links` — that represents *membership in an active work queue*,
> decoupled from the source record. It is the mechanism behind "bulk delete in a triage-style sidebar removes the item
> from the feed, never the underlying record." Designed to serve receiving triage first, and FBA / repairs-warranty /
> orders queues on the same mechanism without a second migration.
>
> **Relationship to the other two plans:** complementary, not blocking. This table's `entity_id` points at whatever
> `receiving_lines`/`receiving` mean *today*; if the `receiving_carton`/`receiving_line` spine split in
> [`polymorphic-tables-database-refactor-plan.md`](./polymorphic-tables-database-refactor-plan.md) happens later, it's a
> one-time repoint of `feed_links` rows, not a redesign. The reference contract, naming rules, and Appendix A gap
> analysis in [`schema-wide-polymorphic-refactor-plan.md`](./schema-wide-polymorphic-refactor-plan.md) apply here
> unchanged.

---

## 0. TL;DR

Today, three different receiving-triage sidebar views (Prioritize / Unfound / Done) are backed by **three unrelated
data sources** — a `view=scanned` filter, a separate `v_unfound_queue` view/table, and a boolean `receiving.triage_complete`
flag — with a fourth column (`receiving.pairing_state`, added 2026-07-01, values `UNFOUND|MATCHED|WAIVED`) sitting in
the schema **already unused by any of them**. This plan replaces that with one generic table, `feed_links`
(`organization_id, feed_key, entity_type, entity_id, state, ...display projection`), synced from each domain's existing
write chokepoints. Bulk-delete in the sidebar becomes a real `DELETE FROM feed_links` — it never touches `receiving`,
`receiving_lines`, or any other source table. The three receiving views become **filters on one feed's `state` column**;
a fourth domain-agnostic mechanism (`feed_key`) is what lets FBA, repairs/warranty, and orders reuse the exact same
table, sidebar rail, and Studio surfacing later without new schema.

---

## 1. Decisions locked in (from the interview)

| Question | Decision |
|---|---|
| Feed scope | **Universal** — one polymorphic mechanism, designed for receiving + FBA + repairs/warranty + orders from the start, not receiving-only. |
| Bulk-delete semantics | **Non-destructive unlink.** Deleting a `feed_links` row never deletes/mutates the source record. |
| Naming | **Generic, domain-decoupled** (`feed_links`, `feed_key`, `entity_type`/`entity_id`) — not `receiving_triage_queue` or similar. No literal obfuscation; the names just aren't coupled to one feature. |
| Migration posture | **Clean, additive-first cutover is acceptable** — this repo is still effectively pre-production for this surface. No dual-write strangler required. |
| Unlink scope | **Org-wide.** One shared feed per org, matching how the triage sidebar already works (everyone sees the same lists). No per-user dismissal axis. |
| Display data | **Denormalize.** `feed_links` carries its own display projection (title/subtitle/tone/priority/occurred_at) rather than joining live per `entity_type` on every read. |
| Studio integration | **Read-only to start.** Studio's inspector/diagnostics reads `feed_links` counts per node; no feed-writing node type yet. |
| Entity vocabulary (day one) | Receiving (carton + line), FBA shipments/items, repairs/warranty, orders. |

---

## 2. The table

```sql
CREATE TABLE feed_links (
  id               BIGSERIAL PRIMARY KEY,
  organization_id  UUID NOT NULL,                    -- enforce_tenant_isolation() installs the loud-fail default
  feed_key         TEXT NOT NULL,                    -- which queue/sidebar this membership belongs to
  entity_type      TEXT NOT NULL,                    -- named CHECK, see §5
  entity_id        BIGINT NOT NULL,                  -- BIGINT default per the reference contract
  -- lifecycle state WITHIN the feed — vocabulary is feed_key-scoped, governed in code (see §4), not a global CHECK
  state            TEXT NOT NULL DEFAULT 'ACTIVE',
  -- denormalized display projection (decision: cache, don't join-live)
  title            TEXT NOT NULL,
  subtitle         TEXT,
  tone             TEXT NOT NULL DEFAULT 'default',  -- reuses the TimelineTone vocabulary — never a new color system
  priority_tier    SMALLINT,
  occurred_at      TIMESTAMPTZ NOT NULL,              -- when it became feed-worthy (sort anchor for "active" views)
  meta             JSONB,                             -- small per-domain extras only (PO#, tracking-last-4); never the whole row
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE feed_links ADD CONSTRAINT feed_links_entity_type_chk
    CHECK (entity_type IN (
      'RECEIVING', 'RECEIVING_LINE',
      'FBA_SHIPMENT', 'FBA_SHIPMENT_ITEM',
      'REPAIR_SERVICE', 'UNIT_REPAIR', 'WARRANTY_CLAIM',
      'ORDER'
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_feed_links_natural
  ON feed_links (organization_id, feed_key, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_feed_links_feed
  ON feed_links (organization_id, feed_key, state, priority_tier, occurred_at DESC);   -- the actual sidebar query
CREATE INDEX IF NOT EXISTS idx_feed_links_entity
  ON feed_links (organization_id, entity_type, entity_id);                            -- reverse lookup for Studio counts

-- Parent-delete integrity: a shared dispatch-on-TG_ARGV[0] trigger family, one CREATE TRIGGER per entity_type's
-- real parent table (receiving, receiving_lines, fba_shipments, fba_shipment_items, repair_service, unit_repairs,
-- warranty_claims, orders), mirroring fn_delete_photos_on_parent_delete(). See §5.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enforce_tenant_isolation') THEN
    PERFORM enforce_tenant_isolation('feed_links');
  END IF;
END $$;
```

This matches `.claude/rules/polymorphic-tables.md` point-for-point: `entity_type`/`entity_id` naming, BIGINT id,
org-led unique + index, named CHECK discriminator, tenant-from-birth. `feed_key` is a **second discriminator axis**,
the same role `photo_entity_links.link_role` plays — it's what lets one entity independently belong to more than one
feed later (e.g. a receiving line in `receiving_triage` today, and in a Studio-surfaced `gaps` feed tomorrow) without
a schema change.

**Why `state` is free TEXT governed in code, not a DB CHECK:** the valid state vocabulary differs per `feed_key`
(receiving's is `NEEDS_MATCH|ACTIVE|DONE`; a future feed might only need `ACTIVE|RESOLVED`). This mirrors
`receiving_line_facts.fact_kind`, which is exactly the same shape of problem and is already solved the same way — a
per-key registry validates the value at write time (§4), not a database-level enumeration.

**Why bulk-delete stays cheap long-term:** `feed_links` is a *working-set* table, not a log — a row exists only while
something is outstanding. Its size is bounded by "how much is currently active across every domain," not by history.
That is the opposite growth shape from `ops_events`/`inventory_events` (which are the actual partitioning candidates
in this schema, not this table). Org-led keys mean a future `PARTITION BY organization_id` is a no-op if it's ever
needed, but nothing about this table's expected size argues for it now.

---

## 3. Feed #1, exactly: `receiving_triage`

This is the concrete, verified mapping — not a guess. Today, the four triage sidebar views are backed by three
**structurally unrelated** sources, confirmed by reading the actual fetchers (`src/lib/receiving/rail/feeds.ts`) and
routes:

| Today's view | Today's actual source | Membership rule |
|---|---|---|
| **Triage** (combined, default) | Union of the two rows below, deduped on `receiving_id`, matched preferred | — |
| **Prioritize** (`TriageRecentRail`) | `GET /api/receiving-lines?view=scanned&sort=priority`, client `postFilter: notUnmatched` | `receiving_source !== 'unmatched'`, sorted by `RECEIVING_PRIORITY_RANK_SQL` over `receiving.priority_tier` |
| **Unfound** (`TriageUnfoundList`) | `GET /api/receiving/unfound-queue?kind=unmatched_receiving&checked=false` | reads `v_unfound_queue` view, `kind='unmatched_receiving' AND checked=false` |
| **Done** (`TriageDoneList`) | `GET /api/receiving/triage/done` | `receiving.triage_complete = true`, ordered by `receiving.triage_completed_at DESC` |

Two things worth naming explicitly because they change the design:

1. **All four operate at carton grain** (`receiving`, not `receiving_lines`) — the combined feed dedups on
   `receiving_id`, and Prioritize's own priority computation joins to `receiving` for `priority_tier`. So feed #1's
   rows are `entity_type='RECEIVING'`, not a mix with `RECEIVING_LINE`.
2. **Unfound → Prioritize is already a real, first-class transition** in the current code (`TriageUnfoundList.tsx`'s
   own doc comment: *"Rows auto-drop once Zoho syncs the PO or the operator links one manually"*; the combined-feed
   dedup logic explicitly encodes it). There's also an already-migrated but **currently unused** `receiving.pairing_state`
   column (`UNFOUND|MATCHED|WAIVED`, `2026-07-01b_receiving_triage_columns.sql`) that none of the three fetchers
   actually query yet — this plan is the thing that finally gives it a job.

**Target mapping — one feed, three states, filtered client-side by the existing views:**

| `feed_links.state` | Replaces | Set when |
|---|---|---|
| `NEEDS_MATCH` | `v_unfound_queue` membership | carton arrives with no PO match, or `pairing_state='UNFOUND'` |
| `ACTIVE` | `view=scanned` + `notUnmatched` filter | carton matches a PO (`pairing_state` flips to `MATCHED`) |
| `DONE` | `receiving.triage_complete = true` | `receiving.triage_complete` flips true |

- **Triage (combined)** = `feed_key='receiving_triage' AND state IN ('NEEDS_MATCH','ACTIVE')`, sorted by
  `priority_tier`/`occurred_at` — replaces the client-side union+dedup entirely with one indexed query.
- **Prioritize** = `... AND state='ACTIVE'`.
- **Unfound** = `... AND state='NEEDS_MATCH'`.
- **Done** = `... AND state='DONE'`, sorted by `updated_at DESC` (the state flip timestamp stands in for
  `triage_completed_at`).
- A `checked=true` unfound row (reviewed but still unmatched, today silently excluded from the unfound query) maps to
  an explicit bulk-delete or a fourth state if you want it visible somewhere — **flagged as a real product decision,
  not resolved here** (see §8).

**Important: transitions between these states are UPDATEs, not deletes.** The sync helper (§4) flips `state` (and
recomputes `tone`/`priority_tier`) when `receiving.pairing_state`/`triage_complete` change on the source row. **Only
an explicit user bulk-delete action removes the `feed_links` row.** This preserves today's actual UX (Done items stay
visible right after completing, they don't vanish) while still keeping "delete" a true non-destructive unlink, per the
locked-in decision in §1. `receiving.pairing_state` and `receiving.triage_complete` remain the source of truth on the
carton; `feed_links` is a synced projection for feed display and filtering, not a replacement for them (at least
initially — collapsing the source columns into `feed_links` outright is a separate, later decision, not part of this
plan).

---

## 4. Sync mechanism

Each domain's projection logic (what counts as `title`, when `state` changes) is a business decision, not a generic
SQL shape — receiving's rules aren't FBA's rules. Per the existing thesis ("share chokepoints, not decision logic"),
this is an **app-level write-through**, not one big trigger:

- `src/lib/feed/registry.ts` — `feed_key → { entityTypes, states: string[], project(source) => { title, subtitle, tone, priorityTier, state, occurredAt, meta } }`. Mirrors `src/lib/workflow/registry.ts` and `src/lib/receiving/facts/registry.ts` exactly.
- `src/lib/feed/sync.ts` — `syncFeedLink(orgId, feedKey, entityType, entityId)` (looks up the registry's `project()`,
  upserts the row) and `unlinkFeedEntry(orgId, feedKey, entityType, entityId)` (used by parent-delete triggers and by
  the bulk-delete route). Deps-injected per `backend-patterns.md`, DB-free unit-testable.
- Each domain's **existing** write chokepoint calls `syncFeedLink` as an `after()` side-effect — for receiving, that's
  wherever `pairing_state`/`priority_tier`/`triage_complete` are written today (the retry-pair handler, the Zoho match
  writer, the triage-complete route). No new writer paths are introduced; the sync call rides along the existing ones.
- **Parent-delete integrity** (contract point 5): one shared `fn_delete_feed_links_on_parent_delete()` function,
  dispatched via `TG_ARGV[0]`, with one `CREATE TRIGGER` per real parent table (`receiving`, `receiving_lines`,
  `fba_shipments`, `fba_shipment_items`, `repair_service`, `unit_repairs`, `warranty_claims`, `orders`) — mirrors
  `fn_delete_photos_on_parent_delete()`'s six-trigger family. Defense-in-depth for the rare physical-delete case;
  the common "item is done/gone" case is already handled by the state-flip sync above.

---

## 5. Entity vocabulary

Day-one `entity_type` CHECK values, one feed_key (`receiving_triage`) fully specified, three feed_keys sketched as
placeholders (their exact state machines need the same fact-finding pass §3 did for receiving before they're built):

| `entity_type` | Real parent table | `feed_key` it's expected to serve |
|---|---|---|
| `RECEIVING` | `receiving` | `receiving_triage` (fully specified, §3) |
| `RECEIVING_LINE` | `receiving_lines` | reserved — not used by `receiving_triage` per the carton-grain finding in §3; available for a future line-grain feed |
| `FBA_SHIPMENT`, `FBA_SHIPMENT_ITEM` | `fba_shipments`, `fba_shipment_items` | `fba_queue` (placeholder — needs its own §3-style pass before building) |
| `REPAIR_SERVICE`, `UNIT_REPAIR`, `WARRANTY_CLAIM` | `repair_service`, `unit_repairs`, `warranty_claims` | `repair_queue` (placeholder) |
| `ORDER` | `orders` | `order_exceptions` (placeholder) |

**Do not build the FBA/repair/order feed_keys' state machines by inference from this table alone** — §3 only came out
correctly *because* the actual fetchers were read first (the naive guess going in, "state = which entity_type," was
wrong). Each new `feed_key` needs the same treatment: read the real current queue-membership logic before designing
its `state` vocabulary and registry entry.

---

## 6. Sidebar & Studio integration

- **Sidebar:** `GET /api/feed/[feedKey]?state=...` returns denormalized rows directly — one indexed query, no
  per-domain fan-out join. A generic `FeedRail` wraps `RecentActivityRailBase` (same "compose, never fork" rule the
  existing triage rails already follow) and becomes the shared engine for receiving triage today, and the FBA/repair/
  order queues later — each domain supplies only its row renderer, exactly like the current six receiving rails do.
  Bulk-delete wires into the **existing** `SelectionActionBar`/`useRailEditMode` mechanism already built for triage
  (`ReceivingBulkActionBar`, `handleRailBulkDelete`) — that UI does not change; only what its delete call hits changes,
  from whatever it hits today to `DELETE /api/feed/[feedKey]/links`.
- **Studio (read-only):** the inspector/gaps lens adds a count tile per node by joining `feed_links` on
  `entity_type`/`feed_key` — e.g. "14 unresolved items routed through this node." No new node type. This is additive
  to the existing diagnostics section in `StudioInspector.tsx`, not a new surface.

---

## 7. Migration & rollout (clean cutover — pre-production posture confirmed)

1. **Migration:** `feed_links` table + CHECK + indexes + `enforce_tenant_isolation` + the 8-parent delete-trigger
   family, authored via the `db-migration-author` skill. Model in Drizzle in the same PR.
2. **Code:** `src/lib/feed/registry.ts` + `sync.ts` (DB-free unit tests, Deps-injected) with the `receiving_triage`
   entry fully implemented per §3.
3. **Backfill:** one-time projection of current `receiving` rows into `feed_links` (`NEEDS_MATCH` from
   `v_unfound_queue`, `ACTIVE` from the scanned+priority query, `DONE` from `triage_complete=true`), dry-run row-count
   report.
4. **Wire the sync calls** into receiving's existing pairing/priority/triage-complete writers.
5. **Cut the sidebar over:** `TriageCombinedList`/`TriageRecentRail`/`TriageUnfoundList`/`TriageDoneList` read
   `feed_links` filtered by `state` instead of their three separate sources; `handleRailBulkDelete` calls the new
   unlink route.
6. **Verify parity** (row-for-row) against the old three-source union before removing the old fetchers — do not
   delete `v_unfound_queue`/the old `view=scanned` arm/`triage_complete` query until `feed_links` is proven at parity,
   same discipline as the existing facts-spine dual-write→parity→cutover precedent.
7. **FBA / repairs / orders** each get their own §3-equivalent research pass, then their own registry entry and rail —
   not built blind from the placeholder table in §5.

Gates: `npx tsc --noEmit`, `next build`, unit tests, and the receiving e2e specs, same as every other change to this
surface.

---

## 8. Open questions (deliberately not resolved here)

- **The `checked=true` unfound row.** Today it's silently excluded from every view. Does it need a visible home in
  the new model (a fourth state, e.g. `REVIEWED`), or does it stay invisible-until-matched-or-deleted? Needs a product
  answer, not an architecture one.
- **`pairing_state`/`triage_complete` consolidation.** This plan syncs `feed_links.state` FROM those columns; it
  doesn't replace them. Worth revisiting once `feed_links` is live and proven — possibly `pairing_state` becomes the
  only source of truth and `triage_complete` folds into it as a fourth enum value.
- **`meta` jsonb schema validation.** No per-`feed_key` Zod schema on `meta` yet — deferred until a second `feed_key`
  actually needs structured extras, same YAGNI default the facts registry started with.
- **FBA / repair / order feed_key state machines** — genuinely unscoped; see §5's warning against inferring them from
  this table.

---

## 9. References

- `.claude/rules/polymorphic-tables.md` — the contract this table follows.
- `.claude/rules/backend-patterns.md` — chokepoints, `Deps` injection, audit.
- `.claude/rules/contextual-display.md` + `.claude/rules/display/workbench.md` — the Workbench archetype rules this
  sidebar work must stay inside (compose the rail, URL-addressable selection, crossfade the right pane only).
- [`polymorphic-tables-database-refactor-plan.md`](./polymorphic-tables-database-refactor-plan.md) — the receiving
  spine split this table's `entity_id` will need to repoint to, if/when that lands.
- [`schema-wide-polymorphic-refactor-plan.md`](./schema-wide-polymorphic-refactor-plan.md) — reference contract,
  Appendix A gap analysis, whole-schema picture.
- Current-state code read for §3: `src/lib/receiving/rail/feeds.ts`, `src/components/sidebar/receiving/{TriageSidebarBody,TriageCombinedList,TriageRecentRail,TriageUnfoundList,TriageDoneList}.tsx`, `src/app/api/receiving/unfound-queue/route.ts`, `src/app/api/receiving/triage/done/route.ts`, `2026-07-01b_receiving_triage_columns.sql`.
- Reusable primitives: `src/components/sidebar/receiving/ReceivingBulkActionBar.tsx` + `useRailEditMode.ts` (bulk-select UI, reused as-is), `src/components/sidebar/receiving/RecentActivityRailBase.tsx` (rail shell, reused as-is), `src/lib/photos/reassign-receiving-photo.ts` (the precedent for "update a link row, never the source record").
