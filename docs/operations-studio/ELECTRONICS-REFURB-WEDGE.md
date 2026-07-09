# Electronics/AV Refurb — the wedge build (template + throughput ROI)

**Status: built 2026-06-28.** This document specifies the product wedge decided in the
use-case interview and the two systems built to support it. It is the detailed companion to
[`UNIFIED-ENGINE-MASTER-PLAN.md`](./UNIFIED-ENGINE-MASTER-PLAN.md).

---

## 1. The strategy (from the use-case interview)

| Dimension | Decision |
|---|---|
| **Buyer** | Owner/ops-lead of a **5–30 person electronics/AV refurb shop** |
| **Today they run** | **Spreadsheets + tribal knowledge** ("free" + inertia is the competitor) |
| **Wedge** | **Bench throughput** — units processed per labor-hour (labor is the #1 cost; clearest ROI) |
| **Vertical** | **Electronics / AV refurb** (serial tracking, grading, data-wipe, warranty) |
| **Moat** | **Template-delivered** — clone a prebuilt refurb graph; the workflow engine is invisible until they outgrow the defaults |
| **Goal** | Build the platform moat behind the wedge |

**The thesis:** land with a faster bench (concrete, measurable ROI vs a clipboard), and have the
engine *already underneath* so the shop compounds into the platform without a re-platform. Two
things make or break it, and both are now built:

1. **The prebuilt electronics-refurb template must be excellent** — the shop has to run on it
   untouched from day one, or the moat never forms. → Built (§2).
2. **Throughput lift must be *visible*** — an owner won't pay to replace "free" unless they can
   see "+X% units this week at Y units/labor-hour." → Built (§3).

---

## 2. The best-in-class electronics/AV refurb template

### 2.1 What existed before
`seedDefaultWorkflowForOrg` (`src/lib/studio/seed-org-workflow.ts`) clones the first system
`workflow_templates` row into a new org on signup. The only system template was the **generic
6-node `standard-refurb-and-list`**: `receive → test-grade → list-ebay → pack → ship` + a repair
loop. Solid bones, but missing the steps that *define* electronics refurb.

### 2.2 What was built

**A new engine node type — `data_wipe`** (`src/lib/workflow/nodes/data-wipe.node.ts`, registered in
`src/lib/workflow/index.ts`). Secure erase / factory reset is the **category-defining compliance
gate** for electronics: shipping a device with the prior owner's data is the worst failure in the
business. Ports: `wiped` / `failed` (a non-wipeable device is usually itself faulty → routes to
repair). It's a thin adapter like every node — a future data-wipe **station action** records the
method/certificate and taps `data_wiped`; the node only decides routing. Verified: registers
cleanly, `listNodeMeta()` now returns **10 node types**, full workflow suite green (94/94).

**A new flagship system template — `electronics-av-refurb`** (migration
`2026-06-28m_electronics_refurb_template.sql`, **applied** — 9 nodes, 11 edges, `is_default = true`):

```
receive ─received▶ diagnostic ─pass▶ data-wipe ─wiped▶ grade-route ─resale▶ qc ─verified▶ list ─listed▶ pack ─packed▶ ship
                       │  ▲              │                   │                  │
                    fail  └─repaired─┐ failed             parts             needs_attention
                       ▼             │   │              (salvage,              │
                     repair ◀────────┴───┘◀── terminal/park) ◀─────────────────┘
```

| Node | Type | Why it's here (electronics-specific) |
|---|---|---|
| `receive` | `receiving` | Intake, serial capture |
| `diagnostic` | `inspection` | Full **functional + cosmetic** grade (`gradeDimensions: [functional, cosmetic]`), `producesConditionGrade`, 48h SLA |
| `repair` | `repair` | Fed by failed test **and** failed wipe **and** failed QC — the three ways an electronics unit goes back |
| `data-wipe` | `data_wipe` | **The compliance gate.** `compliance: data_erasure`, methods `factory_reset`/`secure_erase`/`crypto_erase` |
| `grade-route` | `decision` | Condition grade → disposition (**resale** vs **parts/salvage**) — showcases the operator-editable decision node |
| `qc` | `kit_verify` | Final QC + **accessory completeness** (`checkAccessories`: power adapter, cables, remote, stand) + photos (`requirePhotos`). A missing adapter is a return. |
| `list` → `pack` → `ship` | `list_ebay`/`pack`/`ship` | List → fulfill |

**The seed now picks the flagship.** Added `workflow_templates.is_default` (single-default,
enforced by the migration's `UPDATE … SET is_default = (slug = 'electronics-av-refurb')`).
`seedDefaultWorkflowForOrg` selects `ORDER BY is_default DESC, id` — new orgs get the electronics
template; the generic `standard-refurb-and-list` stays in the library for non-electronics tenants.

> **Why a decision node in the default:** it both models real grade→disposition routing *and* makes
> the just-shipped decision-table editor immediately useful — the owner's first taste of "I can
> change how my shop routes work without code."

---

## 3. The throughput ROI proof (the first-week-value system)

### 3.1 What existed before
`workflow_node_stats` (daily snapshot via `src/lib/workflow/node-stats.ts`) captured **WIP only**
(queue depth, blocked, error, aging) per node/day. `OperationsAnalyticsView` already had a
throughput hero chart + KPI strip. `time_punches` captured clocked labor hours; `station_activity_logs`
timestamps every scan with `staff_id`. But **throughput (units *completed*)** was never snapshotted,
and **units/labor-hour** — the headline ROI number — was computed nowhere.

### 3.2 What was built

**(1) Throughput snapshot** — `workflow_node_stats.completed_count` (migration
`2026-06-28n_workflow_node_stats_completed_count.sql`, **applied**). The daily job now finalizes the
**day that just ended** (counts `workflow_runs` node-exits for `CURRENT_DATE - 1`), so each day's
throughput is captured exactly once, losslessly — `SUM(completed_count)` over any range = that
range's throughput, no recompute. Owner-pool/cross-org cron behavior preserved.

**(2) Units / labor-hour** — `src/lib/operations/labor-throughput.ts`,
`computeLaborThroughput(orgId, { from, to })`: org-scoped, `Deps`-injected (DB-free unit-testable,
4/4 tests green). `unitsProcessed` = distinct units that advanced a stage (`inventory_events`);
`laborHours` = Σ `(punched_out − punched_in − break_minutes)` (`time_punches`, org-scoped via
`staff`); `unitsPerLaborHour` guarded against /0; plus a per-staff leaderboard.

**(3) Owner ROI surface** — `GET /api/operations/roi` (`withAuth`, `operations.view`) returns
this-week-vs-last `{ unitsThisWeek, unitsLastWeek, pctChange, unitsPerLaborHour,
avgCycleHoursByStage, unitsStuck }`, all org-scoped. A new **"Throughput & ROI"** section in
`OperationsAnalyticsView` leads with three big tiles — **units this week (+Δ% vs last)**,
**units/labor-hour**, **units stuck** — plus avg cycle-time per stage and the per-staff
leaderboard. TanStack Query, `staleTime: 5min` (no refetch loop), teaching empty state.

This is the literal "first-week ROI proof": after a week of scanning, the owner opens Operations and
sees the throughput lift and the units/labor-hour number that justifies replacing the spreadsheet.

---

## 4. What's next to make the wedge fully sellable — progress

1. **✅ DONE — Data-wipe station action.** The `data_wipe` node now fires in production. Built the
   full bench loop (§4.1): domain helper `recordDataWipe` (records a `DATA_WIPED` event + taps
   `data_wiped` → grade/repair, no status transition — a compliance gate, not a lifecycle change),
   `POST /api/serial-units/[id]/data-wipe` (gated `tech.data_wipe`, granted to the technician +
   admin roles), and a dedicated Station-archetype surface at `/wipe`.
2. **✅ DONE — Dashboard ROI hero card.** `ThroughputRoiCard` is mounted at the top of the main
   dashboard (`DashboardOrdersView`), gated on `operations.view` — units this week (+Δ% vs last),
   units/labor-hour, units stuck, with a teaching empty state for a brand-new shop.
3. **✅ DONE — Onboarding → first-scan + nav.** `FirstScanOnboardingCard` (top of the dashboard,
   shown only when `useOperationsRoi().hasData === false`, mutually exclusive with the ROI card) lands
   a new owner on "Scan your first unit →" (→ Receiving) with a secondary "View your workflow" (→
   Studio). `/wipe` is wired into `APP_SIDEBAR_NAV` + `ROUTE_PERMISSIONS` + `SIDEBAR_PAGE_NAV` +
   the page-access matrix (gated `tech.data_wipe`); all nav/access guard tests pass.
4. **✅ DONE — Grade→channel multichannel routing.** New generic `list` node + a `list-route`
   decision after QC: grade C → wholesale (`list`, channel=wholesale), everything else → eBay
   (`list_ebay`), both converging on pack. The template is now 12 nodes / 15 edges.
5. **✅ DONE — Returns/warranty graph tail.** New `returns` node (triages restock / rtv / scrap);
   restock re-enters QC so a returned-then-refurbished unit re-lists. The full electronics lifecycle
   (receive → diagnose → wipe → grade → QC → multichannel list → pack → ship → returns) is modeled.

**The electronics-refurb wedge plan is COMPLETE.** Final state: whole-repo `tsc` 0 errors; 160/160
tests (workflow + data-wipe + labor + manifest + nav + access); security invariant 0 ungated writes;
the security manifest registers both new gated routes; `electronics-av-refurb` is the seeded default
(12 nodes / 15 edges) and the generic `list` + `returns` node types are registered. Engine node
roster grew receiving·inspection·repair·**data_wipe**·list_ebay·**list**·pack·kit_verify·ship·**returns**·decision.

### 4.1 The data-wipe station action (the node made real)
```
operator scans unit at /wipe → resolves to the unit → picks erase method (factory_reset /
secure_erase / crypto_erase) → "Wiped ✓" or "Wipe failed ✗" → POST /api/serial-units/[id]/data-wipe
  → recordDataWipe: appendInventoryEvent(DATA_WIPED) + tapWorkflow('data_wiped', { wipeSuccess })
      → engine routes  wiped → grade-route   |   failed → repair
  → big pass/fail card + audio cue → auto-clear + refocus for the next scan
```
Per-scan `client_event_id` (`safeRandomUUID`) makes a wedge double-fire an idempotent no-op
(`UNIQUE(client_event_id)`). The tap is position-guarded (`expectNodeType: 'data_wipe'`) and
fire-and-forget, so it advances only a unit actually at the wipe node and never fails the record.

## 5. Files changed/added

**Template / engine (Workstream A):**
- `src/lib/workflow/nodes/data-wipe.node.ts` (new node type)
- `src/lib/workflow/index.ts` (register `data_wipe`)
- `src/lib/migrations/2026-06-28m_electronics_refurb_template.sql` (template + `is_default`) — **applied**
- `src/lib/studio/seed-org-workflow.ts` (seed the default)

**Throughput ROI (Workstream B):**
- `src/lib/migrations/2026-06-28n_workflow_node_stats_completed_count.sql` — **applied**
- `src/lib/workflow/node-stats.ts` (+ `src/lib/drizzle/schema.ts`) — capture throughput
- `src/lib/operations/labor-throughput.ts` (+ `.test.ts`) — units/labor-hour
- `src/app/api/operations/roi/route.ts` — ROI endpoint (`operations.view`)
- `src/features/operations/workspace/useOperationsRoi.ts` + `OperationsAnalyticsView.tsx` — the surface

**Data-wipe station action (§4.1):**
- `src/lib/tech/recordDataWipe.ts` (+ `.test.ts`, 4/4) — domain helper (Deps-injected)
- `src/app/api/serial-units/[id]/data-wipe/route.ts` — gated `tech.data_wipe`
- `src/app/wipe/page.tsx` + `src/components/wipe/{useDataWipeController.ts,DataWipeStation.tsx}` — the station UI
- `tap.ts` (`data_wiped` event), `inventoryEvents.ts` (`DATA_WIPED` type), `timeline/inventory-events.ts` (display), `audit-logs.ts` (`TECH_DATA_WIPE`), `permission-registry.ts` (`tech.data_wipe`, granted to technician+admin roles in DB)

**Dashboard ROI hero card:**
- `src/components/dashboard/ThroughputRoiCard.tsx` — mounted in `DashboardOrdersView.tsx`

**Verification (this build):** whole-repo `tsc` **0 errors**; **112/112** tests (workflow + data-wipe
+ labor); `data_wipe` registers and the electronics template references it; `tech.data_wipe` granted
to technician + admin. Both new gated routes (`/api/operations/roi`, `/api/serial-units/[id]/data-wipe`)
are detected as correctly gated — register them in the security manifest at session end via
`npm run audit-route-auth -- --emit` (after gating the in-flight `beta/waitlist` write, which is the
one pre-existing ungated route).

> **Session follow-up:** a new gated route (`/api/operations/roi`) was added — run
> `npm run audit-route-auth -- --emit` to register it (and the other in-flight routes) in
> `docs/security/route-permissions.json` in one pass.
