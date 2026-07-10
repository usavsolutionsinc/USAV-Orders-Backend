# Per-SKU Packing Checklist — Implementation Plan

**Goal:** Make the packing flow industry-standard for growing small-company tenants by
showing packers a per-SKU **"items needed in the box"** checklist at pack time, letting
them confirm everything matches, and (optionally, per-org) blocking completion or
short-ships until the box is matched — **without bricking tenants who haven't populated
inventory yet.**

Status: Phases 1–3 SHIPPED (2026-07-10) — Phase 1 exceeded:
order-scoped condition-gated `OrderPackChecklist` across desktop + mobile pack surfaces,
`GET /api/orders/[id]/pack-checklist`, kit-readiness `block_until_matched` enforcement
(`src/lib/packing/kit-readiness.ts`), per-org enforcement toggle (`tenancy/settings.ts`),
`/api/packing/policy`. Phase 2 shipped: tick persistence via
`POST /api/orders/[id]/packing-checks` → `tech_verifications` (`source_kind='order'`,
`step_type='PACKING'` for check templates / `'PACKING_PART'` for `sku_kit_parts` rows —
two step_types so the two id namespaces can't collide in the idempotent upsert key;
domain helper `src/lib/packing/packing-checks.ts`, permission `packing.complete_order`,
optimistic ticks with quiet revert wired in `PackChecklist` + `OrderPackChecklist` via
`usePackingCheckPersist`). Phase 3 shipped: order-level N/M lines-packed rollup
(`progress.packedLines` from `packer_logs`, surfaced on the StationPacking active-order
card). Residuals: the §2.1 `checklist_templates` rename migration was NOT needed for
persistence and stays deferred; enforcement gating of completion beyond
`block_until_matched` (block_short_ship) still open. Also shipped alongside (Tier-3 A3):
`PackZendeskSection` — collapsed Zendesk ticket picker + comment box on the packing bench.

---

## 1. Why this is mostly an "expose what exists" job, not a greenfield build

The repo already has ~80% of the substrate:

| Need | Already exists | File |
|---|---|---|
| Per-SKU "what's in the box" (BOM) | `sku_kit_parts` (component_name, qty_required, **required_for** condition-gate, **is_critical**, sort_order) + `getKitParts()` query | `schema.ts:1789`, `lib/neon/sku-catalog-queries.ts` |
| Per-SKU checklist framework (publish/draft, pass/fail + structured values, failure-mode tagging) | `qc_check_templates` | `schema.ts:1961` |
| Polymorphic results store (already keyed `source_kind`/`source_row_id`/`step_type`/`step_id`, idempotent upsert) | `tech_verifications` | `schema.ts:1983` |
| Expected contents for multi-line orders | `order_unit_allocations` (units allocated to an order) | `schema.ts:2418` |
| Pack-time per-SKU surface (ALREADY fetches packNotes + qcFlags before confirm) | `StationPacking` P1-PCK-02 | `components/station/StationPacking.tsx:80-95` |
| Tenant-wide config bag for the enforcement toggle | `organizations.settings` jsonb (zod-policed) | `schema.ts`, `lib/tenancy/settings.ts` |
| Generic checklist UI primitive | `ChecklistBlock` + station block contract | `components/stations/blocks/ChecklistBlock.tsx`, `lib/stations/` |
| CRUD house pattern (withAuth + Zod + idempotency + recordAudit + org-threaded) | qc-checks authoring + serial-units checklist execution | `app/api/sku-catalog/[id]/qc-checks/route.ts`, `app/api/serial-units/[id]/checklist/route.ts` |

**The single highest-leverage gap:** `sku_kit_parts` (the BOM = "items needed") is never
returned by `/api/get-title-by-sku`, so the packer never sees it. Everything else is
composition.

---

## 2. Data model — polymorphic single-table (industry standard)

**Decision:** generalize the existing QC tables into a polymorphic checklist via a **type
discriminator**, rather than forking a parallel `packing_check_templates` table (which
would duplicate ~300 LOC and guarantee schema drift). This is single-table inheritance —
the standard WMS/QMS pattern when columns are near-identical, which they are.

### 2.1 Templates: `qc_check_templates` → `checklist_templates`

- Rename table `qc_check_templates` → `checklist_templates`.
- Add discriminator: `checklist_type text NOT NULL DEFAULT 'QC'` (`'QC' | 'PACKING' | 'ASSEMBLY' | …`).
- Migration is backward-compatible:
  1. `ALTER TABLE qc_check_templates RENAME TO checklist_templates;`
  2. `ALTER TABLE checklist_templates ADD COLUMN checklist_type text NOT NULL DEFAULT 'QC';`
  3. Existing Tech QA rows backfill to `'QC'` via the default — **Tech testing is untouched**;
     its queries just gain a `checklist_type = 'QC'` filter.
- Index: `(organization_id, sku_catalog_id, checklist_type, sort_order)`.

### 2.2 Results: reuse `tech_verifications` as-is

It is already a polymorphic association. Packing executions are simply:
- `step_type = 'PACKING'`
- `source_kind = 'order'` (or `'packer_log'` — see §5 open question)
- `source_row_id = <orders.id>` / `<packer_logs.id>`
- existing idempotent upsert key `(source_kind, source_row_id, step_type, step_id)` prevents dup ticks.

A cosmetic rename to `checklist_results` is **deferred** (touches many call sites; no functional gain).

### 2.3 Polymorphic-FK integrity

`(source_kind, source_row_id)` cannot be a real FK. Enforce in the query helper on write
(verify the parent row exists + belongs to the org) and add partial indexes per
`source_kind` for read performance. This is the accepted trade-off for polymorphic
associations.

---

## 3. The "items needed" checklist = BOM ∪ QC, condition-gated

At pack time, for the active SKU + the order's condition grade, the packer's checklist is
the **union** of:

1. **Kit parts** from `sku_kit_parts` filtered by `required_for` ⊇ the order condition
   (e.g. a part required only for `REFURBISHED` is hidden for a `BRAND_NEW` order).
   Each row → "Main Unit ×1", "Power Cable ×1", "Remote ×1". `is_critical` drives gating.
2. **Packing checks** from `checklist_templates WHERE checklist_type='PACKING'` (published)
   — free-form verify steps ("Cable type matches variant", structured-value counts, etc.).

QC flags (`checklist_type='QC'`) remain shown read-only as today (tech's domain), or can be
folded in as a third advisory group — TBD with the UI pass.

---

## 4. Enforcement toggle (per-org, data-gated, advisory by default)

Stored in `organizations.settings.packing` (zod schema in `lib/tenancy/settings.ts`):

```jsonc
"packing": {
  "enforcement": "advisory" | "block_until_matched" | "block_short_ship"  // default "advisory"
}
```

- **advisory (default):** checklist is informational; a discrepancy is flagged for audit but
  the pack always completes. Matches the repo's "QC never blocks" philosophy.
- **block_until_matched:** the box cannot be marked done until every *critical* expected item
  is ticked/scanned.
- **block_short_ship:** for multi-line orders, completion blocked until N/M lines are all packed.

### 4.1 Graceful degradation — THE load-bearing safety rule

Enforcement only fires when expected items are **known**. Expected = (`sku_kit_parts` BOM
rows for the SKU) ∪ (`order_unit_allocations` for the order). If both are empty — a tenant
who hasn't populated catalog BOMs or adopted inventory allocation — the checklist is empty,
there is nothing to match, and **the pack proceeds regardless of the toggle.** Blocking is
therefore *both* opt-in *and* only active where real data exists to match against. A growing
company flips advisory → block as its catalog matures; it can never brick its own packing by
turning the toggle on early.

This directly answers the requirement: *"if their inventory is not matched yet, will this go
through?"* → **Yes.** No expected data ⇒ no block.

---

## 5. Build phases

### Phase 1 — Surface the BOM as an interactive checklist (highest value)
- Extend `GET /api/get-title-by-sku` to also return `kitParts` (call existing `getKitParts`,
  condition-filtered) and `packingChecks` (`checklist_type='PACKING'`).
- New `<PackChecklist>` component (reuse `ChecklistBlock` styling): renders BOM ∪ packing
  checks as tickable rows, critical items marked. Replaces / augments the static QC-flags
  block in `StationPacking.tsx`. Wire the same component into mobile `WhatToPackCard`
  (`MobilePackerFlow.tsx`).
- Client-only ticking at this phase (no persistence) → fastest visible win.

### Phase 2 — Record verifications + discrepancies
- Migration §2.1 (`checklist_templates` + `checklist_type`).
- New execution route `POST /api/orders/[id]/packing-checks` (copy the
  `serial-units/[id]/checklist` house pattern: withAuth, Zod, idempotency, recordAudit,
  org-threaded). Writes ticks to `tech_verifications` (`step_type='PACKING'`). Discrepancy
  path flags the order instead of silently completing.
- New permission `packing.verify_items` in `permission-registry.ts` (+ manifest test update,
  per the permission-registry-guard).
- Authoring UI: a "What's in the box" editor for `sku_kit_parts` beside the existing QC
  editor in the SKU catalog (`Products ?view=qc` neighbor), reusing the CRUD house pattern.

### Phase 3 — Order rollup + enforcement toggle
- Add `organizations.settings.packing.enforcement` (zod) + an Admin settings control.
- Aggregate by `orders.orderId` → show **N/M lines packed**; surface incomplete state.
- Gate completion per §4 + §4.1 (data-gated). Makes the Fragile/Multi-Item pack-mode rail
  behavioral instead of cosmetic (Multi-Item naturally pairs with `block_until_matched`).

---

## 6. Open questions (resolve during build)

1. **Result anchor:** `source_kind='order'` (`orders.id`) vs `'packer_log'` (`packer_logs.id`).
   Orders anchor better for the N/M multi-line rollup; packer_log anchors better for
   per-scan audit. Likely `order` for the checklist state, with the `packer_logs` row as the
   completion event.
2. Whether QC flags fold into the same panel as a third advisory group, or stay a separate
   read-only block (tech ownership boundary).
3. Whether the enforcement toggle also needs a per-station override (`station_definitions.config`)
   on top of the org default — defer unless a tenant asks.

---

## 7. Files in scope

- `src/lib/drizzle/schema.ts` — rename + `checklist_type`; (toggle lives in `organizations.settings`)
- `src/lib/tenancy/settings.ts` — `packing.enforcement` zod
- `src/app/api/get-title-by-sku/route.ts` — return `kitParts` + `packingChecks`
- `src/app/api/orders/[id]/packing-checks/route.ts` — NEW execution route
- `src/app/api/sku-catalog/[id]/kit-parts/route.ts` — NEW BOM authoring CRUD (if not present)
- `src/lib/neon/sku-catalog-queries.ts` — `getKitParts` (exists), packing-check helpers
- `src/lib/auth/permission-registry.ts` + manifest test — `packing.verify_items`
- `src/components/station/StationPacking.tsx` — `<PackChecklist>` seam (line ~398)
- `src/components/mobile/packer/MobilePackerFlow.tsx` — `WhatToPackCard` seam
- `src/components/products/...` — "What's in the box" authoring editor
