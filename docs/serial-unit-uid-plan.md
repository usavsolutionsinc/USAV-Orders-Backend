# Plan — First-class `unit_uid` on `serial_units`

Status: **Phase 1 + Phase 2 implemented (2026-06-06).** Per-unit identity; reprint
reproduces the exact stored id (works from the device serial too). Phase 2:
mint-at-birth in `upsertSerialUnit` (on the txn client, non-fatal), the legacy
off-flag `mark-received` raw INSERT now routes through the canonical writer, and
391 historical rows backfilled (0 collisions; 329 uncataloged rows left NULL by
design). tsc clean; 13 tests green.

**Phase 2 notes**
- **Minting runs on the upsert's own transaction client** via `fn_next_unit_seq`
  (not a second pooled connection — that would self-block under the `FOR UPDATE`
  lock), so a rolled-back upsert also rolls back the sequence (no gaps). It is
  wrapped best-effort: a mint failure never breaks the core upsert.
- **Perf:** mint-at-birth adds one `fn_next_unit_seq` round-trip per *newly
  created* serial that has a `sku_catalog_id` and no uid yet (a fast indexed
  upsert on the same connection). Relabel/already-stamped units skip it. On the
  bulk-receive path this is one extra query per new unit — acceptable, but worth
  remembering if that path is ever tuned.
- **Deliberate exception:** the ON-flag v2 path (`applyInventoryV2Effects` in
  `mark-received`) keeps its own raw `serial_units` upsert — it's a coordinated
  txn (bin/location + ledger + events + `RETURNING`), not a bypass, and routing
  it through `upsertSerialUnit` would flip `SHIPPED→RECEIVED` into return
  detection on the active path. Left as-is intentionally.
- Backfill script: `scripts/backfill-unit-uid.ts` (`--apply` to write; dry-run
  default). Re-runnable — only touches `unit_uid IS NULL AND sku_catalog_id IS NOT NULL`.

## Problem recap

The printed unit identity `{SKU_SHORT}-{YYWW}-{SEQ6}` (e.g. `00098-2621-000142`) is the
human/QR identity of a physical unit, but it is **never persisted as a column**. Today it
lives only in:

- `station_activity_logs.metadata->>'unit_id'` (audit snapshot)
- `inventory_events.scan_token` / `payload->>'unit_id'` (audit snapshot)
- the printed DataMatrix

Consequences:

1. **No indexed lookup by printed id.** Scanning the bare unit-id QR routes to
   `/m/u/{unitId}` → `/api/serial-units/[id]`, which only tries `id` (numeric) then
   `normalized_serial`. The printed id matches neither, so it **404s**.
   (`src/app/api/serial-units/[id]/route.ts:32-57`)
2. **`resolve-id` reconstructs instead of looking up.** It string-parses the SKU back out
   (`parseUnitId(...).baseSku`) and rebuilds — it never reads the actual unit row.
   (`src/app/api/units/resolve-id/route.ts:47`)
3. **Identity mismatch.** One unit id is minted per *print batch* (`/api/units/next-id`),
   but each serial gets its own `serial_units` row. The unit id identifies the batch, not
   the unit.

Goal: make `unit_uid` a first-class, indexed, org-unique column on `serial_units` so the
printed QR is a true external primary key, and each physical unit owns exactly one.

## Key design decisions (recommended defaults)

| # | Decision | Recommendation | Why |
|---|----------|----------------|-----|
| D1 | Per-unit vs per-batch identity | **Per-unit** — each serial gets its own `unit_uid` | Forced by a per-row UNIQUE constraint; also fixes the batch/unit mismatch (improvement #2) |
| D2 | When is `unit_uid` minted | **At first label** (Phase 1), column nullable + partial unique index `WHERE unit_uid IS NOT NULL`. Mint-at-birth for all origins is Phase 2 | Keeps blast radius small; non-labeled units still resolve via `normalized_serial` |
| D3 | Minting authority | **Server-side, in the write path** (`/api/post-multi-sn`), one `allocateNextUnitId` call per serial | Removes the "one id, N labels" bug; client can't mint N ids cleanly |
| D4 | Preview id before print | `/api/units/next-id` becomes a **non-committing peek**; authoritative ids come back from `post-multi-sn` | Avoids double-allocating the sequence (preview + print) |
| D5 | Uniqueness scope | **`(organization_id, unit_uid)`** | `serial_units` is org-scoped with RLS since 2026-05-23 |
| D6 | Backfill | Backfill **labeled rows only**, in a separate migration, after the column ships | Partial unique index tolerates NULLs; avoids a risky big-bang UPDATE in the same migration |

Two decisions worth an explicit sign-off before building: **D1** (changes "same QR on every
label in a batch" → "unique QR per label") and **D4** (changes the `next-id` contract). Both
are recommended but visible behavior changes.

## Current writer map (everywhere a `serial_units` row is born)

Only the **label path** has a unit id today. Phase 1 touches just that path; Phase 2 extends
to the rest.

| Flow | Entry | Calls `upsertSerialUnit` at | Has a unit id today? |
|------|-------|-----------------------------|----------------------|
| **Label print (products/inventory)** | `/api/post-multi-sn` | `route.ts:150` | yes (`next-id`) — **Phase 1 target** |
| Receiving: attach serial | `/api/receiving/serials` → `attachSerialToLine` | `serial-attach.ts:149` | no |
| Receiving: bulk receive | `/api/receiving/mark-received-po` → `receiveLineUnits` | `receive-line.ts:287` | no |
| Tech / returns / RMA | `recordUnitEvent` | `unit-events.ts:105` | no |
| TSN → serial sync | `syncTsnToSerialUnit` | `serial-units-queries.ts:519` | no |
| SKU → serial sync | `syncSkuToSerialUnit` | `serial-units-queries.ts:599` | no |
| **Legacy raw INSERT (bypass)** | `/api/receiving/mark-received` (singular) | `route.ts:401` | no — **bypasses `upsertSerialUnit`; flag for removal** |

`upsertSerialUnit` is the single canonical writer (`src/lib/neon/serial-units-queries.ts:333`):
find-or-create by `normalized_serial` (UNIQUE), `FOR UPDATE` lock, COALESCE fill-in on update
(never clobbers). Adding a `unit_uid` field is mechanical: set on INSERT, `COALESCE(existing, new)`
on UPDATE so a later label stamps a previously-received unit without overwriting.

---

## Phase 1 — column + label write path + lookup (the payoff)

### Step 1 — Migration: add column + org-scoped partial unique index
File: `src/lib/migrations/2026-06-06h_serial_units_unit_uid.sql`
(naming: date prefix + suffix to sort after the existing `2026-06-06d..g` files; runner =
`scripts/run-pending-migrations.mjs`, applied via `npm run db:migrate`, tracked in
`schema_migrations` by sha256 — never edit an applied migration, add a new one)

```sql
-- serial_units.unit_uid — first-class persisted unit identity ({SKU}-{YYWW}-{SEQ6}).
-- Why: make the printed QR a true external key so scans/reprints resolve in one
-- indexed lookup instead of string-parsing or 404ing. Org-scoped because
-- serial_units carries organization_id + RLS (2026-05-23). Nullable + partial
-- unique so legacy/non-labeled rows (which have no minted id yet) coexist.
BEGIN;

ALTER TABLE serial_units
  ADD COLUMN IF NOT EXISTS unit_uid TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_serial_units_org_unit_uid
  ON serial_units (organization_id, unit_uid)
  WHERE unit_uid IS NOT NULL;

COMMENT ON COLUMN serial_units.unit_uid IS
  'USAV-minted unit identity {SKU_SHORT}-{YYWW}-{SEQ6}, stamped at first label. '
  'Org-unique. NULL until a unit is labeled.';

COMMIT;
```

### Step 2 — Drizzle schema
File: `src/lib/drizzle/schema.ts` (`serialUnits`, ~line 1771)

```ts
unitUid: text('unit_uid'),
```
Add the table-level index in the second `pgTable` arg (matching the `ebayAccounts` pattern):
```ts
}, (table) => ({
  orgUnitUidIdx: uniqueIndex('ux_serial_units_org_unit_uid')
    .on(table.organizationId, table.unitUid)
    .where(sql`${table.unitUid} IS NOT NULL`),
}));
```

### Step 3 — `upsertSerialUnit` accepts + persists `unit_uid`
File: `src/lib/neon/serial-units-queries.ts`
- Add `unit_uid?: string | null` to `UpsertSerialUnitInput` (~line 58) and `SerialUnitRow` (~line 36).
- INSERT path (~366-413): include `unit_uid`.
- UPDATE path (~416-479): `unit_uid = COALESCE(serial_units.unit_uid, $new)` — stamp once, never overwrite (so receive-then-label works).
- Add reader `findByUnitUid(unitUid: string)` mirroring `findByNormalizedSerial` (~128), `WHERE unit_uid = $1` (org filter applied by the RLS GUC / `withTenantConnection`).

### Step 4 — Server-side minting in the label write path
File: `src/app/api/post-multi-sn/route.ts`
- Import `allocateNextUnitId` (`src/lib/inventory/unit-id.ts`).
- Inside the per-serial loop (~143): mint one id per serial:
  ```ts
  const minted = await allocateNextUnitId(catalogId, skuForStorage);
  // pass minted.unitId into upsertSerialUnit({ ..., unit_uid: minted.unitId })
  ```
- Stop trusting the client `unitId` for storage; keep accepting it only for back-compat logging.
- Return the mint results so the client can print them:
  ```ts
  return NextResponse.json({ success: true, serialUnitIds, units: [{ serial, unitUid }], ... });
  ```
- `scan_ref` / `scan_token` (station_activity_logs, inventory_events) → use the per-unit `unit_uid` instead of a shared payload, so the audit trail points at the right unit.
- Note: `allocateNextUnitId` requires a `sku_catalog_id`. When `catalogId` is null (Ecwid-only SKU), skip minting and leave `unit_uid` NULL (unit still created; just no printed identity). Surface this to the client so the label falls back to encoding the bare serial.

### Step 5 — Client prints the returned ids
File: `src/components/MultiSkuSnBarcode.tsx`
- `issueLabels()` currently returns `data.success`; change it to return `{ success, units }`.
- `handleFinalAction` (print branch): build `qrPayloads` from the returned `units[].unitUid`
  (index-aligned to `serialNumbers`) instead of `Array(n).fill(uniqueSku)`. Each label now
  carries its **own** unit id. (This supersedes the per-batch fill added today.)
- Live preview: show the provisional next id from the peek (Step 6) — illustrative only.

### Step 6 — `next-id` → non-committing peek (preview only)
Files: `src/lib/migrations/...` (new `fn_peek_unit_seq`), `src/app/api/units/next-id/route.ts`
- Add `fn_peek_unit_seq(p_sku_catalog_id, p_year)` = `SELECT next_seq` without the
  `INSERT ... ON CONFLICT ... +1` (read-only).
- `next-id` returns the **peeked** next id for the preview and no longer advances the sequence.
- Sole caller is `MultiSkuSnBarcode` (confirmed), so the contract change is contained.
- Drop `qrUrl`/GS1 from the response (already unused after today's change).

### Step 7 — `resolve-id` does a real lookup
File: `src/app/api/units/resolve-id/route.ts`
- First try `findByUnitUid(unitId)`; if found, return the row's `sku_catalog_id` + title
  directly (one indexed query). Fall back to the existing `parseUnitId` path for legacy ids
  with no stored `unit_uid`. Drop the GS1 `qrUrl` from the response.

### Step 8 — `/api/serial-units/[id]` resolves by `unit_uid`
File: `src/app/api/serial-units/[id]/route.ts` (~32-57)
- Add a third resolution branch: numeric `id` → `normalized_serial` → **`unit_uid`**.
- This is what makes scanning the printed QR (`/m/u/00098-2621-000142`) resolve instead of 404.

### Step 9 — Scan routing recognizes the bare unit id
Files: `src/lib/barcode-routing.ts`, `src/app/api/scan/resolve/route.ts`
- `routeScan` already falls through unknown strings to `type:'sku'`. Add a unit-id shape match
  (`/^[A-Z0-9]+-\d{4}-\d{6}$/`) → `type:'serial-unit'`, `redirect:/m/u/{value}` so a typed/scanned
  bare unit id lands on the unit page (which now resolves via Step 8).
- Verify `/m/u/[id]` (`src/app/m/u/[id]/page.tsx:128`) passes the raw param through to the
  updated `[id]` endpoint — no change expected, just confirm.

---

## Phase 2 — universal mint-at-birth + backfill (later, optional)

Once Phase 1 is proven, give **every** unit a `unit_uid` at creation, not just labeled ones.

- Move minting into `upsertSerialUnit` on INSERT when `origin_source` ≠ legacy and
  `sku_catalog_id` is present (mint via `fn_next_unit_seq` + `formatUnitId`). All seven writer
  paths then get a `unit_uid` for free.
- Backfill migration for historical rows:
  ```sql
  UPDATE serial_units su
  SET unit_uid = shortsku(su.sku) || '-' || to_char(su.created_at,'YYIW') || '-'
                 || lpad(fn_next_unit_seq(su.sku_catalog_id,
                         extract(year from su.created_at)::int)::text, 6, '0')
  WHERE su.unit_uid IS NULL AND su.sku_catalog_id IS NOT NULL;
  ```
  (Needs a SQL `shortsku()` or backfill in a TS script that reuses `shortSku()` from
  `unit-id-format.ts` to match the printed form exactly. Prefer the TS script for fidelity.)
- Remove the legacy raw-INSERT bypass in `/api/receiving/mark-received` (singular) so no unit
  is born outside `upsertSerialUnit`.

## Out of scope (noted, not in this plan)

- **`tech_serial_numbers` ↔ `inventory_events` consolidation.** Both get a per-unit row on
  print; `tech_serial_numbers` predates the unified event log. Folding it in is a separate
  initiative.
- **GTIN retirement on the products label path.** Now that the products QR encodes the bare
  unit id, the minted internal GTIN is dead weight on this path (still useful for marketplace
  serialization). Leave it; revisit separately.

## Tests

- `src/lib/neon/serial-units-queries.test.ts` — add: `unit_uid` set on INSERT, preserved
  (COALESCE) on UPDATE, `findByUnitUid` round-trip, org-scoped uniqueness (two orgs may share a
  `unit_uid` value; one org may not duplicate it).
- New: `unit-id-format` already has format/parse; add a test asserting `formatUnitId` output
  matches the `routeScan` unit-id regex (Step 9) so routing and minting can't drift.
- Route-level: `/api/serial-units/[id]` resolves by `unit_uid` (third branch).
- Manifest/permission tests unaffected (no new routes; permissions unchanged: `print.label`).

## Rollout & safety

1. Ship Steps 1–2 (additive column + index) first — zero behavior change, safe to deploy alone.
2. Ship Steps 3–9 together (write + lookup) behind no flag needed; the column is nullable so
   partial rollout is safe (un-minted rows just fall back to serial lookup).
3. Phase 2 backfill last, off-peak; `fn_next_unit_seq` is atomic so concurrent prints during
   backfill are safe, but prefer a quiet window to keep sequence numbers tidy.
4. Reversibility: drop index + column (`unit_uid` is additive; no destructive change).

## Risk register

| Risk | Mitigation |
|------|------------|
| Per-label unique id changes "same QR per batch" behavior | D1 sign-off; it's the correct model and what the unique constraint requires |
| `next-id` peek contract change breaks a caller | Only `MultiSkuSnBarcode` calls it (verified) |
| Ecwid/uncataloged SKU has no `sku_catalog_id` → can't mint | Leave `unit_uid` NULL; label encodes bare serial; unit still created |
| RLS GUC not set on a write path → NOT NULL/uniqueness surprises | `unit_uid` is nullable; uniqueness is partial; existing `withTenantConnection` already governs `serial_units` |
| Sequence gaps from peek vs mint | Acceptable; sequences are identifiers, not counts |
| Double-stamp race (two labels, same serial) | `normalized_serial` UNIQUE + `FOR UPDATE` in `upsertSerialUnit` serializes; COALESCE keeps the first `unit_uid` |

## File-by-file checklist

- [ ] `src/lib/migrations/2026-06-06h_serial_units_unit_uid.sql` (Step 1)
- [ ] `src/lib/migrations/2026-06-06i_fn_peek_unit_seq.sql` (Step 6)
- [ ] `src/lib/drizzle/schema.ts` (Step 2)
- [ ] `src/lib/neon/serial-units-queries.ts` (Step 3 — input/row types, INSERT, UPDATE, `findByUnitUid`)
- [ ] `src/app/api/post-multi-sn/route.ts` (Step 4)
- [ ] `src/components/MultiSkuSnBarcode.tsx` (Step 5)
- [ ] `src/app/api/units/next-id/route.ts` (Step 6)
- [ ] `src/app/api/units/resolve-id/route.ts` (Step 7)
- [ ] `src/app/api/serial-units/[id]/route.ts` (Step 8)
- [ ] `src/lib/barcode-routing.ts` + `src/app/api/scan/resolve/route.ts` (Step 9)
- [ ] `src/lib/neon/serial-units-queries.test.ts` + new format/routing test
- [ ] Phase 2 (later): mint-in-`upsertSerialUnit`, backfill script, remove legacy raw INSERT
</content>
</invoke>
