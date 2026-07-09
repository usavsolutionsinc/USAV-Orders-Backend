# Handling-unit (LPN) plan — boxes that decouple from the receipt

**FINAL STATUS: DONE & LIVE.** Migration applied & verified 2026-06-29 (db ledger 0 pending); feature fully active. Status verified 2026-06-28.

Status: **H1–H3 + H5 built, always-on (no feature flag)** · Owner: receiving + testing
Related: [receiving-triage-streamline-plan.md](./receiving-triage-streamline-plan.md) (supersedes the redundant `receiving.lpn` alias)

> **Build status (2026-06-09)**
> - **No toggle.** The feature is unconditional — there is no `HANDLING_UNITS`
>   env var. The only activation step is applying the migration (below); until a
>   box is minted the `H-` scan class is simply a no-op, so it's safe always-on.
> - **H1 ✅ (APPLIED 2026-06-29)** migration `src/lib/migrations/2026-06-08_handling_units_lpn.sql` —
>   `handling_units` + `serial_units.handling_unit_id` + `H-{id}` auto-mint
>   trigger + indexes. Applied & live (db:migrate:dry → 0 pending); routes + `/m/h` no longer 500.
> - **H2 ✅** `H-` scan class + `handlingUnitHandle()` in `lib/barcode-routing.ts`;
>   `scan/resolve` routes `H-` → `/m/h/{id}`; testing `lpn` branch +
>   `looksLikeHandlingUnit()` in `lib/testing/resolve-testing-scan.ts`.
> - **H3 ✅** CRUD under `/api/handling-units` (list/mint, `[id]` detail,
>   `[id]/assign`, `[id]/unassign`) — perm-guarded (`handling_unit.view` /
>   `handling_unit.manage`), Zod-validated, idempotent, audit-emitting. Queries
>   in `lib/neon/handling-unit-queries.ts`; schemas in `lib/schemas/handling-unit.ts`.
> - **H5 ✅ (core)** `/m/h/[id]` box page — one scan → every unit + `k/n tested`
>   rollup, add/remove units, print label. Status rolls up
>   OPEN→IN_TEST→CLOSED via `refreshHandlingUnitStatus()`.
> - **H4 ✅ (DONE 2026-06-28)** reusable pieces shipped: `HandlingUnitChip` (LPN chip,
>   teal/Package) + `printHandlingUnitLabel`. Now WIRED into the workspace —
>   `BoxTab` in `CartonAddPopover` + line-edit `CartonAddInline`; `HandlingUnitChip`
>   in `PoLinesAccordion` / `UnmatchedItemsSection`. (The earlier "workspace wiring
>   TODO" note was stale.)
> - **H6 ⬜** drop `receiving.lpn` — deferred to end of rollout (the column is
>   still referenced by the flag-gated `RECEIVING_UNIFIED_INBOUND` Phase 3 work).

## 0. The decision & why

`R-{id}` already identifies an **inbound carton** (one receiving row) and already
groups its lines and flows into testing (`resolveTestingScan` resolves the `R-`
handle to a `multi` picker). It does NOT decouple from the receipt — it's 1:1
with a `receiving` row.

The real need: after unboxing, items get **re-sorted into testing boxes/trays**
(by type/condition), and a tray can draw from more than one inbound carton. That
physical grouping — the **handling unit** — is distinct from the receipt and is
what should carry a license plate (LPN). So:

- **Scope (recommended):** a handling unit groups **serial_units across any
  receipts/POs** — full decouple. (`R-####` stays the receipt identity;
  `H-####` is the box identity.)
- **Label:** auto-mint **`H-{id}`** ZPL label on assign (reuse
  `printReceivingLabel.ts`), operator sticks it on the box.
- **Atom:** the **serial_unit** is what an LPN groups (units are what testing
  works on). Receiving lines get a derived rollup, not their own membership.
- **Supersedes:** the `receiving.lpn` (`RC-{id}`) column added earlier — it was a
  redundant alias of `receiving.id`. Drop it; this model replaces it.

## 1. Data model

```sql
CREATE TABLE handling_units (
  id            bigserial PRIMARY KEY,
  code          text UNIQUE NOT NULL,         -- 'H-{id}' (auto) — or an external tote code later
  status        text NOT NULL DEFAULT 'OPEN', -- OPEN | STAGED | IN_TEST | CLOSED
  location_id   bigint REFERENCES locations(id) ON DELETE SET NULL,
  created_by    integer REFERENCES staff(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz,
  notes         text
);

ALTER TABLE serial_units
  ADD COLUMN handling_unit_id bigint REFERENCES handling_units(id) ON DELETE SET NULL;
CREATE INDEX idx_serial_units_handling_unit ON serial_units(handling_unit_id)
  WHERE handling_unit_id IS NOT NULL;
```

- `serial_units.handling_unit_id` is the decouple: a unit keeps
  `origin_receiving_line_id` (where it came from) **and** gets `handling_unit_id`
  (what box it's in now), independent of `receiving`.
- `code` defaults to `'H-' || id` so it shares the prefix-class scan model; making
  it a column (not derived) leaves room for external tote barcodes later (Option C).
- Membership is **current**, not historical — moving a unit to another box
  reassigns `handling_unit_id`. (A `handling_unit_events` audit table is a later
  add if movement history is needed.)

## 2. Scan routing — new `H-` class (`src/lib/barcode-routing.ts`)

- Add `ScanRoute` type `'handling-unit'`.
- In `routeScan`, next to the `R-/L-/U-/REP-` block: `^H-(\d+)$` →
  `{ type: 'handling-unit', value, redirect: '/m/h/' + id }`.
- `scanKind()` returns `'handling-unit'` for it. No change to existing classes.

## 3. Testing integration (`src/lib/testing/resolve-testing-scan.ts`)

- Add `ResolvedVia = 'lpn'`.
- New resolver branch: an `H-{id}` (or bound external code) → load **all
  `serial_units WHERE handling_unit_id = X`**, map to their `receiving_lines`
  rows, return `kind: 'multi'` (the existing multi-picker shape — no new UI
  primitive needed). The tech scans the box once, gets every unit in it.
- `looksLikeHandlingUnit(value)` helper mirrors `looksLikeReceivingRef`.
- Per-unit test flow is unchanged — only the *entry* (one box scan → N units).

## 4. Receiving UI/UX — acknowledge the LPN

- **Assign-to-box action** in the unbox/carton workspace: "Add to box" →
  mint `H-{id}` (or pick an open one), assign the carton's units (or a selected
  subset) to it, **print the `H-` label** (ZPL via `printReceivingLabel`).
- **LPN chip** on carton + line rows + unit rows: `Box H-123 · 4 units`, visually
  distinct from the `R-` receipt chip (different tone), so the operator always
  sees both "which receipt" and "which physical box."
- Multi-select on the carton's units → "Move to box H-…" for re-sorting during
  unbox (the by-condition sort that motivates this feature).

## 5. Testing UI/UX — one scan, the whole box

- Tech scans `H-123` → workspace opens a **box picker**: every unit in the box
  with its test status, a `k/n tested` progress chip, work through them without
  re-scanning each. Reuses the existing `multi` picker.
- Box status rolls up: `OPEN → IN_TEST` on first verdict, `CLOSED` when all units
  reach a terminal test state.

## 6. CRUD — `/api/handling-units`

| Method | Path | Action |
|---|---|---|
| POST | `/api/handling-units` | mint a box (`H-{id}`), optional initial units |
| GET | `/api/handling-units/[id]` | box + contents (units, rollup status) |
| POST | `/api/handling-units/[id]/assign` | add units (by id / serial / `U-` scan) |
| POST | `/api/handling-units/[id]/unassign` | remove units |
| GET | `/api/handling-units?status=&location=` | list (staging board) |

Cross-cutting per repo norms: permission guard, Zod input, idempotency on the
mutations, audit-log emission.

## 7. Migration / rollout (additive, phased)

```
H1  migration: handling_units + serial_units.handling_unit_id        (additive)   ✅ APPLIED 2026-06-29 (0 pending)
H2  scan routing H- class + resolveTestingScan 'lpn' branch          (no UI yet)   ✅
H3  /api/handling-units CRUD                                          (+ tests)     ✅
H4  receiving UI: assign-to-box + H- label print + LPN chip                        ✅ DONE 2026-06-28 (BoxTab/CartonAddInline + HandlingUnitChip wired)
H5  testing UI: H- scan → box picker + rollup status                               ✅ (/m/h box page)
H6  drop receiving.lpn (the redundant RC-{id} alias)                 (cleanup)      ⬜ deferred
```

**Activation: DONE.** `2026-06-08_handling_units_lpn.sql` is APPLIED & live
(verified 2026-06-29, db:migrate:dry → 0 pending). No env toggle. The
`/api/handling-units` routes + `/m/h` no longer 500; everything works.

No feature flag — the feature is unconditional. It's additive and inert until a
box is minted, so there's nothing to toggle: applying the migration is the only
activation step. No interaction with the STN/`shipment_id` work — orthogonal.

## 8. Open questions / future

- **Reusable totes (Option C):** allow `handling_units.code` = a scanned external
  barcode + a "release/empty" action. The schema already supports it (code is a
  column); only the assign UI + a status lifecycle change. Defer to v2.
- **Movement history:** add `handling_unit_events` if box-to-box moves need an
  audit trail (mirrors `inventory_events`).
- **Pallet→carton hierarchy:** a `parent_handling_unit_id` self-FK if nesting is
  ever needed. Not in v1.

## Session 2026-06-28 — completion pass

- Flipped H4 to done: confirmed the receiving-UI wiring already shipped — `BoxTab`
  in `CartonAddPopover` + line-edit `CartonAddInline`, and `HandlingUnitChip` in
  `PoLinesAccordion` / `UnmatchedItemsSection`. The doc's "workspace wiring TODO"
  marker was stale.
- Added the DB-free tests the plan claimed with "(+ tests)" but were missing:
  `src/lib/schemas/handling-unit.test.ts` (13 tests) and
  `src/lib/neon/handling-unit-queries.test.ts` (`rollupMembers`, 5 tests). Both pass.
- DB-bound CRUD coverage belongs in Playwright e2e (suggested spec
  `tests/e2e/handling-units-crud.spec.ts`) — not yet written.
- Migration status verified 2026-06-29 (db ledger 0 pending): `2026-06-08_handling_units_lpn.sql`
  is APPLIED & live — feature fully active, routes + `/m/h` no longer 500. (H6 drop `receiving.lpn` stays deferred-by-design.)

## Remaining work — handoff (2026-06-28)

- **[MIGRATION-DEPLOY-COUPLED] APPLIED ✅ (2026-06-29)** `2026-06-08_handling_units_lpn.sql`
  is applied & live (verified: db:migrate:dry → 0 pending). `/api/handling-units` + `/m/h`
  no longer 500; feature fully active. Owner handoff complete.
- **[CODE]** add the DB-bound CRUD e2e spec `tests/e2e/handling-units-crud.spec.ts`
  (mint → assign → unassign → rollup) once the migration is applied in the e2e env.
- **[DEFERRED-BY-DESIGN]** H6 — drop `receiving.lpn`. Still referenced by the
  flag-gated `RECEIVING_UNIFIED_INBOUND` Phase 3 work; defer to end of that rollout.
