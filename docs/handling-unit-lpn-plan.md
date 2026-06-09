# Handling-unit (LPN) plan — boxes that decouple from the receipt

Status: plan / not started · Owner: receiving + testing
Related: [receiving-triage-streamline-plan.md](./receiving-triage-streamline-plan.md) (supersedes the redundant `receiving.lpn` alias)

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
H1  migration: handling_units + serial_units.handling_unit_id        (additive)
H2  scan routing H- class + resolveTestingScan 'lpn' branch          (no UI yet)
H3  /api/handling-units CRUD                                          (+ tests)
H4  receiving UI: assign-to-box + H- label print + LPN chip
H5  testing UI: H- scan → box picker + rollup status
H6  drop receiving.lpn (the redundant RC-{id} alias)                 (cleanup)
```

Feature-flag `HANDLING_UNITS` (default off) gates the scan-routing branch + UI so
H1–H3 can land dark. No interaction with the STN/`shipment_id` work — orthogonal.

## 8. Open questions / future

- **Reusable totes (Option C):** allow `handling_units.code` = a scanned external
  barcode + a "release/empty" action. The schema already supports it (code is a
  column); only the assign UI + a status lifecycle change. Defer to v2.
- **Movement history:** add `handling_unit_events` if box-to-box moves need an
  audit trail (mirrors `inventory_events`).
- **Pallet→carton hierarchy:** a `parent_handling_unit_id` self-FK if nesting is
  ever needed. Not in v1.
