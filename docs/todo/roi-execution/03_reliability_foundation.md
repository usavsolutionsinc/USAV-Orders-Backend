# Tier 2 — Reliability Foundation

> **STATUS (2026-07-10 — all three items SHIPPED, adversarially verified):**
> - **#8 decompose** — GET slimmed ~1,500 → 240 lines; `src/lib/receiving/lines/{query,build-sql}.ts`
>   + a **mechanically-extracted legacy-SQL fixture**; 88/88 tests assert byte-identical `{sql,
>   params}` across 55+ filter combos (every view/sort/search/delivery-state/facet). No new 400s;
>   dead `search_scope=zoho_po` branch preserved + pinned.
> - **#9 replenishment** — `orgId` REQUIRED on all 15 exported fns (unscoped-pool defaults deleted;
>   file 1,310 → ~800 lines); 17/17 Deps-injected tests (PO-creation, need-recalc, transitions,
>   zero/negative/garbage quantities, org threading). Bonus: reversibility 5.7 shipped —
>   `POST /api/replenishment/tasks/[id]/release` (IN_PROGRESS→REQUESTED, 409 on wrong state,
>   `REPLENISH_TASK_RELEASE` audit). Known residual: `pick-face.ts` siblings still take optional
>   orgId (same treatment recommended); need-to-order internal-token routes ride the explicit
>   transitional service-org shim (guard-ledgered).
> - **#10 taps** — `tapWorkflow` now Deps-injected, captures `AdvanceOutcome`, and emits
>   `workflow_tap_dropped` ops_events with 8 typed reasons on every drop path (22/22 tests);
>   intended-tap outbox behind `WORKFLOW_TAP_OUTBOX` (default OFF, inert) + reconcile cron route;
>   migration `2026-07-09b_workflow_tap_outbox.sql` **authored, NOT applied**; cron NOT added to
>   vercel.json (owner). Watch: drop-event volume once live (per-scan unenrolled units emit).
> - **Also-worth-doing residuals:** untouched this run except F11/F13/F15 raw `current_status`
>   writes → `transition()` (state-machine 14/14; F12/F16 documented out-of-scope with rationale).

De-risks the highest-churn hot path and the untested money module. Do after Tier 0 and
alongside/after the Path-to-Sellable work.

---

## #8 — Decompose `receiving-lines/route.ts` GET  ·  Effort L

**Now:** `src/app/api/receiving-lines/route.ts` is 2463 lines; the **GET handler alone is
~1455 lines (L173–1628)** in one function. It hand-builds a dynamic SQL `WHERE` (127
concat/push sites), reads 27 `searchParams`, inlines correlated-subquery fragments
(`currentLineIsMatchSql` L34, `viewedParamIdx` juggling L791/1003/1144), and has **zero
Zod validation**. It's the primary operator view and the highest-churn hot path — every
filter/sort change is a landmine, and it's re-run on each poll.

**Do (incremental, behavior-preserving):**
1. Extract a typed **filter parser**: `searchParams` → a validated `ReceivingLinesQuery`
   (Zod) in `src/lib/receiving/lines/query.ts`. Add unit tests (pure, Deps-free).
2. Extract a **query builder**: `ReceivingLinesQuery` → `{ sql, params }` in
   `src/lib/receiving/lines/build-sql.ts`. Test the builder against known filter combos
   (assert generated SQL shape + param order) — no DB needed.
3. Slim the route to the house skeleton: `withAuth → parse(Zod) → buildSql → run → map`.
   Keep behavior byte-identical; snapshot a few real query outputs before/after.

**Acceptance:** GET handler < ~200 lines; filter parser + builder unit-tested; a
before/after diff of generated SQL for a matrix of filter combos shows no change.
Per `.claude/rules/code-review` this also stops a 2.4k-line file from growing further.

**Neon bonus:** once the builder is isolated, add missing indexes for the hottest filter
predicates and cap any unbounded branches — the real per-invocation cost lever.

---

## #9 — Test + org-require `replenishment.ts`  ·  Effort M

**Now:** `src/lib/replenishment.ts` (1289 lines, 18 exported fns incl.
`createDraftPurchaseOrders`, `recalculateNeed`, `reconcilePOStatus`,
`transitionReplenishmentStatus`) has **0 tests** and every fn defaults
`client: DbClient = pool, orgId?: OrgId` — the **unscoped** pool + **optional** tenancy.
Money/inventory-critical, untested, and a tenancy footgun.

**Do:**
1. Add Deps-injection unit tests (the repo's `fakes()` pattern — used in 58 lib tests) for
   the PO-creation, need-recalc, and status-transition paths. Cover zero/negative/edge
   quantities.
2. Make `orgId` **required** on the public fns; thread it through; route callers through
   `withTenantTransaction` so RLS applies. (Aligns with the in-flight
   `tier0-tenant-isolation-sweep`.)

**Acceptance:** core replenishment paths unit-tested DB-free; `orgId` required; no public
fn defaults to the unscoped pool.

---

## #10 — Surface the fire-and-forget workflow taps  ·  Effort M

**Now:** `src/app/api/pack/ship/route.ts` runs the pack→ship workflow transition inside
`after(async …)` with no try/catch (also `photos/[id]/reassign`, `serial-units/[id]/list`).
`tapWorkflow` is designed never to throw (`src/lib/workflow/tap.ts:14,95-153`) and only
logs `[workflow-tap]` — so if it fails, the unit is **shipped in the DB but never advanced
in the graph**, and the divergence is invisible (log-only, no retry, no alert).

**Do:**
1. Emit a **divergence metric/event** when a tap drops or errors (count by node), so
   shipped-not-advanced is observable.
2. Add a lightweight **retry/outbox**: record intended taps; a periodic reconciler
   re-drives ones that never landed (idempotent — taps already no-op on re-entry).

**Acceptance:** a forced tap failure produces an alertable signal and is reconciled on the
next pass; no silent shipped-not-advanced drift.

---

## Also worth doing (from the reliability scan)
- **#5 (scan) — test `audit-log/receiving-aggregator.ts`** (1006 lines, 0 tests — the audit
  ledger itself is unverified). Effort M.
- **#6 (scan) — incremental Zod at route boundaries** — only ~57/755 routes validate input;
  add to the big receiving/lookup routes first (folds into #8). Effort M, incremental.
- **#7 (scan) — type `neon/orders-queries.ts` row shapes** (1612 lines, 16 `any`, feeds the
  dashboard, untested). Effort M.
- **#8 (scan) — add `recordAudit` to `work-orders/route.ts`** (3 mutating handlers, 0 audit
  calls). Effort S — quick skeleton-compliance fix.

**Deprioritize:** the 8 madge cycles (cosmetic, local), `drizzle/schema.ts` size
(declarative), the `as any` long-tail (44 files, and `@ts-ignore` count is 0 — good
discipline).

## Cross-references
- [00 — Index](00_INDEX_ROI_EXECUTION.md) · [02 — Path to Sellable](02_path_to_sellable.md) (#9 aligns with the tenancy sweep)
- `.claude/rules/backend-patterns.md` (route skeleton, Deps injection), `domain-unit-test` skill.
