# Condition Grading + Repair History QC System — Implementation Plan

> Status: **IN PROGRESS** · Author: planning pass 2026-06-06 · Scope: **Full system**, eBay quality = **compute + display only** (no live reverse push in v1).
>
> **Decision update (2026-06-06):** QC is **advisory, never blocking**. There is **no `required` flag and no grade gating** — checklists are still being authored, so a hard gate would be unusable. Completion is a *signal*, not a lock. Two mechanics replace enforcement: a template **draft → published** lifecycle (author quietly, publish to "settle"), and a unit-level **bulk "Check all / Clear all"** action. The bulk action is **shipped** (see §12).

## 1. Why (business framing)

Closes **Challenge 3** — buyer confidence in refurbished/used Bose stock and return-rate from quality issues. We make every serialized unit carry a defensible, auditable quality record: a condition grade backed by a **mandatory inspection checklist** (battery health, Bluetooth test, cosmetic flags), a **repair history** with root-cause failure tags, an automatic **risk warning** for third-party-sourced items, and a derived **quality score** that feeds eBay listing condition.

This is a **gap-closing** effort, not greenfield: ~60% of the substrate already exists. The plan extends existing tables and follows the house route conventions rather than introducing parallel systems.

## 2. What already exists (do not rebuild)

| Capability | Location | Reuse as |
|---|---|---|
| 7-grade enum `BRAND_NEW…USED_C, PARTS` | `schema.ts:324` `conditionGradeEnum` | grade vocabulary (unchanged) |
| Per-unit grade + append-only history (cosmetic/functional notes) | `serial_units.condition_grade`; `serial_unit_condition_history` `schema.ts:1972` | grade timeline |
| Grade write (event + history + PARTS auto-sort) | `api/serial-units/[id]/grade/route.ts` | extend with gate |
| QC **templates** (per-SKU + category fallback) | `qc_check_templates` `schema.ts:1679`; `QcChecklistWorkspace.tsx` | extend with `required`, `value_schema` |
| QC **execution** per-unit (pass/fail/notes) | `api/serial-units/[id]/checklist`; `tech_verifications` `schema.ts:1688` | extend with structured value |
| Testing verdicts | `testing_results` `schema.ts:1995`; `[id]/test` | feed gate input |
| Inventory event timeline (`GRADED`, `REPAIR_STARTED/COMPLETED`, `TEST_*`) | `inventoryEvents` `schema.ts:1846` | single audit timeline |
| RMA + dispositions + shipped↔returned pairing | `lib/rma/authorizations.ts`; `lib/inventory/returns.ts`; `resolvePriorOutbound()` | repair intake source |
| Sourcing/provenance + cost + condition | `suppliers`, `sourcing_candidates`, `part_acquisitions.serial_unit_id` `schema.ts:1596+` | risk-score inputs |
| eBay inbound condition | `lib/ebay/sync.ts:89` → `orders.condition` | listing condition map ref |
| Audit + permissions (`serial_units.grade`, `repair.*`, `tech.qc_pass`) | `lib/audit-logs.ts`; `permission-registry.ts:85` | guards + audit |

## 3. The 7 gaps this plan closes

1. **Tedious + half-built checklists** — no bulk "check all", and steps under authoring nag techs. *Fix: advisory model + draft/published + bulk-settle (NOT a `required` gate).*
2. **No structured step values** — `step_type` is free text; no capture of battery %, BT pass/fail, measurement numbers.
3. **No failure-mode taxonomy** — defects are free-text only; no tags, no analytics.
4. **Orphaned repair history** — `repair_service` matches by *text* serial; no FK, parts, cost, or root cause per unit.
5. **No grade↔QC coupling** — a unit can be graded `LIKE_NEW` with a failed battery test.
6. **No third-party risk surfacing** — provenance exists but never becomes a buyer-facing risk warning.
7. **No quality score** — nothing derives a listing quality score or maps grade→eBay condition.

---

## 4. Data model changes

All new tables follow existing conventions: append-only history where a timeline matters, `serial_unit_id` FK with `onDelete cascade`/`set null`, staff FKs `set null`, `inventory_event_id` cross-link, `created_at withTimezone`. Declare in `src/lib/drizzle/schema.ts`; apply via raw SQL migration (the repo's inventory-v2 pattern — declarations mirror raw migrations).

### 4.1 Extend `qc_check_templates` (gap 1, 2) — **no `required` column**

```sql
ALTER TABLE qc_check_templates
  ADD COLUMN status          TEXT NOT NULL DEFAULT 'published', -- 'draft'|'published'
  ADD COLUMN value_kind      TEXT,            -- 'BOOLEAN'|'PERCENT'|'NUMBER'|'ENUM'|'TEXT'
  ADD COLUMN value_unit      TEXT,            -- 'percent'|'V'|'cycles'|null
  ADD COLUMN value_enum      JSONB,           -- allowed values when value_kind='ENUM'
  ADD COLUMN pass_min        NUMERIC,         -- e.g. battery health >= 80
  ADD COLUMN pass_max        NUMERIC,
  ADD COLUMN failure_mode_id INTEGER REFERENCES failure_modes(id) ON DELETE SET NULL;
```
- **`status` is the "pending addition → settle" mechanism.** New steps can be authored as `draft`; **execution views** (the tech checklist + testing-bundle) show only `published` steps and only count those toward progress, while **authoring views** (QcChecklistWorkspace, sku-catalog qc-checks) show all and expose a publish toggle. Default `'published'` = **zero behavior change** for every existing step. Settling a checklist = flipping its steps to `published` (or a per-SKU "publish all").
- **No `required` and no gate** — completion never blocks grading. A finished/published checklist with all steps passed is just a stronger quality signal.
- `value_kind` makes "Battery health (%)", "Bluetooth pairs", "Cosmetic grade" first-class without per-product code.
- `pass_min`/`pass_max` let the **server** decide pass/fail from a recorded number (battery ≥ 80% = pass), not the tester.
- `failure_mode_id` ties a failed step to a default failure tag.

### 4.2 Extend `tech_verifications` (gap 2)

```sql
ALTER TABLE tech_verifications
  ADD COLUMN value_num  NUMERIC,   -- recorded numeric (battery %, voltage)
  ADD COLUMN value_text TEXT,      -- recorded enum/text
  ADD COLUMN failed_mode_id INTEGER REFERENCES failure_modes(id) ON DELETE SET NULL;
```
`passed` stays; for `value_kind` steps the route computes `passed` from value vs `pass_min/max`.

### 4.3 New `failure_modes` taxonomy (gap 3)

```sql
CREATE TABLE failure_modes (
  id              SERIAL PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,        -- 'BATTERY_DEGRADED','BT_NO_PAIR','SPEAKER_RATTLE','CASE_CRACK'
  label           TEXT NOT NULL,
  category        TEXT NOT NULL,               -- 'hardware'|'software'|'cosmetic'|'electrical'|'accessory'
  severity        TEXT NOT NULL DEFAULT 'major', -- 'critical'|'major'|'minor'
  is_repairable   BOOLEAN NOT NULL DEFAULT true,
  typical_cost_cents INTEGER,
  caps_grade_at   condition_grade_enum,        -- e.g. CASE_CRACK caps grade at USED_B
  sort_order      INTEGER NOT NULL DEFAULT 0,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```
Seed a Bose-relevant starter set. `caps_grade_at` powers grade gating (gap 5).

### 4.4 New `unit_failure_tags` (gap 3)

```sql
CREATE TABLE unit_failure_tags (
  id               BIGSERIAL PRIMARY KEY,
  serial_unit_id   INTEGER NOT NULL REFERENCES serial_units(id) ON DELETE CASCADE,
  failure_mode_id  INTEGER NOT NULL REFERENCES failure_modes(id),
  detected_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  detected_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  source           TEXT NOT NULL DEFAULT 'qc',  -- 'qc'|'return'|'manual'|'repair'
  resolution_status TEXT NOT NULL DEFAULT 'open', -- 'open'|'resolved'|'scrapped'|'wontfix'
  resolved_repair_id INTEGER REFERENCES unit_repairs(id) ON DELETE SET NULL,
  inventory_event_id BIGINT REFERENCES inventory_events(id) ON DELETE SET NULL,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_unit_failure_tags_unit ON unit_failure_tags(serial_unit_id);
```

### 4.5 New `unit_repairs` (gap 4) — replaces the orphaned `repair_service` link

```sql
CREATE TABLE unit_repairs (
  id               SERIAL PRIMARY KEY,
  serial_unit_id   INTEGER NOT NULL REFERENCES serial_units(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'pending', -- 'pending'|'in_progress'|'completed'|'failed'|'scrapped'
  summary          TEXT NOT NULL,
  parts_used       JSONB,            -- [{ sku, qty, cost_cents }]
  labor_minutes    INTEGER,
  cost_cents       INTEGER,
  started_at       TIMESTAMPTZ,
  started_by_staff_id   INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  completed_at     TIMESTAMPTZ,
  completed_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  rma_id           INTEGER REFERENCES rma_authorizations(id) ON DELETE SET NULL,
  repair_service_id INTEGER REFERENCES repair_service(id) ON DELETE SET NULL, -- bridge legacy
  start_event_id   BIGINT REFERENCES inventory_events(id) ON DELETE SET NULL,
  done_event_id    BIGINT REFERENCES inventory_events(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_unit_repairs_unit ON unit_repairs(serial_unit_id);

CREATE TABLE repair_failure_resolutions (
  repair_id        INTEGER NOT NULL REFERENCES unit_repairs(id) ON DELETE CASCADE,
  failure_mode_id  INTEGER NOT NULL REFERENCES failure_modes(id),
  PRIMARY KEY (repair_id, failure_mode_id)
);
```
Uses the existing `IN_REPAIR`/`REPAIR_DONE` serial statuses and `REPAIR_STARTED`/`REPAIR_COMPLETED` events — no new lifecycle states.

### 4.6 New `unit_quality_scores` projection (gap 6, 7)

Trigger/route-maintained projection (one row per unit, like `sku_stock`):

```sql
CREATE TABLE unit_quality_scores (
  serial_unit_id   INTEGER PRIMARY KEY REFERENCES serial_units(id) ON DELETE CASCADE,
  quality_score    INTEGER NOT NULL,        -- 0–100
  risk_level       TEXT NOT NULL,           -- 'low'|'medium'|'high'
  risk_reasons     JSONB,                   -- ['third_party_source','open_failure','salvage_supplier']
  ebay_condition_id TEXT,                    -- mapped eBay condition (e.g. '1000','2500','3000')
  grade_at_score   condition_grade_enum,
  computed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 5. Scoring & gating logic (`src/lib/quality/`)

New pure-function module — unit-testable, no DB inside.

### 5.1 `gradeAdvice.ts` (gap 5) — **advisory, non-blocking**
`evaluateGradeAdvice({ grade, publishedSteps, results, openFailures })`:
- Surfaces **warnings**, never blockers: incomplete published checklist, a recorded step failure, or an `open` failure tag whose `caps_grade_at` is stricter than the chosen grade.
- Returns `{ warnings: [...] }`. The `/grade` route does **not** reject on warnings; the UI shows them as a soft confirm ("Grade anyway?"). The grade write always succeeds.

### 5.2 `qualityScore.ts` (gap 6, 7)
`computeQualityScore({ grade, openFailures, repairs, acquisition })` → `{ score, riskLevel, riskReasons, ebayConditionId }`:
- Base score from grade (`BRAND_NEW`=100 … `USED_C`=55, `PARTS`=0).
- Penalties: each open failure (−severity weight), each prior failed repair, salvage/for-parts acquisition.
- Bonus: completed repair that resolved a critical failure (refurb confidence).
- `riskReasons` includes `third_party_source` when `part_acquisitions.supplier_type ∈ {ebay_seller, salvage, marketplace}` (gap 5).
- `ebayConditionId` via a `GRADE_TO_EBAY_CONDITION` map cross-checked against `lib/ebay/browse-client.ts:64` `CONDITION_FILTER`.

### 5.3 `failureSeed.ts`
Static Bose-oriented seed list for `failure_modes` (battery, BT, audio, cosmetic, accessory categories) imported by the migration/seed script.

---

## 6. API routes (house conventions: `withAuth`/`requireRoutePerm` + Zod `parseBody` + idempotency on mutations + `recordAudit`)

| Method + path | Permission | Purpose |
|---|---|---|
| `GET /api/serial-units/[id]/quality` | `sku_stock.view` | unit grade + score + risk + open failures + repair history (one read for the detail pane) |
| `POST /api/serial-units/[id]/failure-tags` | `tech.qc_pass` | tag failure mode(s); idempotent; emits `NOTE`/audit |
| `PATCH /api/serial-units/[id]/failure-tags/[tagId]` | `tech.qc_pass` | resolve/scrap a tag |
| `POST /api/serial-units/[id]/repairs` | `repair.mark_repaired` | open a repair (status `pending`→`in_progress`), `REPAIR_STARTED` event |
| `PATCH /api/serial-units/[id]/repairs/[repairId]` | `repair.mark_repaired` | complete/fail; parts+cost; `REPAIR_COMPLETED` event; auto-resolve linked failure tags |
| `POST /api/serial-units/[id]/checklist/bulk` ✅ **shipped** | `tech.qc_pass` | bulk "check all" / "clear all" for a unit; set-based, transactional, audited |
| `POST /api/serial-units/[id]/checklist` (extend existing) | `tech.qc_pass` | accept `valueNum`/`valueText`; server computes `passed` from `pass_min/max`; auto-create failure tag on fail |
| `POST /api/serial-units/[id]/grade` (extend existing) | `serial_units.grade` | grade write is unconditional; attach `evaluateGradeAdvice` warnings to the response; recompute quality score after |
| `GET/POST/PUT/DELETE /api/qc-check-templates...` (extend existing `sku-catalog/[id]/qc-checks`) | `sku_stock.manage` | author `required`, `value_kind`, thresholds |
| `GET /api/admin/quality/dashboard` | `sku_stock.view` | failure-mode analytics (top failures by SKU, return-driven failures, repair cost rollups) |
| `GET /api/failure-modes` / admin CRUD | `sku_stock.view` / `sku_stock.manage` | taxonomy management |

**Recompute hook:** quality score recomputes (write to `unit_quality_scores`) after grade change, failure-tag change, repair completion. Keep it inside the same request (cheap) — no cron needed for v1; add a backfill script for existing units.

Each new mutation route must satisfy the **api-route-reviewer** checklist: auth guard, Zod input, idempotency key on mutations, audit emission. New audit actions: `SERIAL_UNIT` entity with `serial.failure_tag`, `serial.repair.open`, `serial.repair.complete`, `serial.quality.recompute` added to `AUDIT_ACTION` in `lib/audit-logs.ts`.

## 7. Permissions

Add to `permission-registry.ts` `PERMISSIONS` (category `tech`/`inventory`):
- `qc.template.manage` (author required checks/thresholds) — or reuse `sku_stock.manage`.
- `repair.open`, `repair.complete` — or reuse existing `repair.mark_repaired`.
- Failure-tag write reuses `tech.qc_pass`.

Per the **permission-registry-guard**: any registry edit must update `route-permission-manifest.test.ts` and pass `scripts/audit-route-auth.ts` in the same change.

## 8. UI

Follow the **sidebar-mode** skill — new surfaces become sidebar MODES, not ad-hoc panels.

1. **Unit detail pane** (`UnitDetailWorkspace.tsx`): add three cards next to the existing Conditions card —
   - **Quality card**: score gauge, risk badge + reasons, mapped eBay condition.
   - **Failure tags card**: chips (color by severity), open vs resolved, add/resolve actions.
   - **Repair history card**: timeline of `unit_repairs` with parts/cost/who.
   - Reuse receiving display primitives (slim chips, tone maps) — see `receiving-display-primitives` memory.
2. **Tech testing panel** (`SkuTestingPanel.tsx`): structured inputs per `value_kind` (number field for battery %, toggle for BT), required-step indicators, live "grade-eligible" gate banner, failure-tag-on-fail prompt.
3. **QC template authoring** (`QcChecklistWorkspace.tsx`): `required` toggle, `value_kind` + threshold fields, default failure mode picker.
4. **Quality/risk dashboard** (admin sidebar mode): top failure modes by SKU, repair-cost rollups, third-party risk inventory, return-rate correlation.
5. **eBay listing prep**: surface `quality_score` + mapped condition (display only in v1).

## 9. Phasing

- **Phase 0 — Bulk settle (✅ shipped).** `POST .../checklist/bulk` + "Check all / Clear all" in `SkuTestingPanel`. No schema change; pure convenience. See §12.
- **Phase 1 — Lifecycle + structured-value columns (✅ shipped + applied).** `status` (draft/published) + `value_kind/unit/enum/pass_min/pass_max` on `qc_check_templates`; `value_num/value_text` on `tech_verifications`. Execution views filter to `status='published'`; authoring UI gets a publish/unpublish toggle + DRAFT badge; structured-value input UI shipped. See §13.
- **Phase 1b — Failure-mode taxonomy + auto-tag (✅ shipped + applied).** `failure_modes` (15-row Bose seed) + `unit_failure_tags`; `failure_mode_id` on `qc_check_templates`, `failed_mode_id` on `tech_verifications`. Taxonomy CRUD API, per-unit tag API, and **auto-tag-on-fail** in the checklist record path. See §14.
- **Phase 2 — Advisory grade signals.** `quality/gradeAdvice.ts`; attach warnings to `/grade` response (non-blocking); tech panel soft-warning banner.
- **Phase 3 — Repair history (✅ shipped + applied).** `unit_repairs` + `repair_failure_resolutions` + `unit_failure_tags.resolved_repair_id`; open/update(complete) routes; `IN_REPAIR`/`REPAIR_DONE` transitions + `REPAIR_STARTED`/`REPAIR_COMPLETED` events; completing a repair auto-resolves the unit's open failure tags it addresses; `repair_service_id` bridge column. See §15. (Detail-pane repair card still pending.)
- **Phase 4 — Quality score + risk.** `unit_quality_scores`; `quality/qualityScore.ts`; recompute hooks; backfill script; quality + failure cards in detail pane.
- **Phase 5 — Analytics + eBay map.** Quality dashboard; `GRADE_TO_EBAY_CONDITION`; display score/condition on listing prep. (Live reverse push to eBay deferred — out of v1 scope.)

Each phase is independently shippable and gated by `tsc` + build (per the dead-code-wave protocol). Every API change runs through api-route-reviewer; every permission/schema change through permission-registry-guard and neon-cost-reviewer.

## 10. Out of scope (v1)

- Live reverse push to eBay (revising real listings) — compute + display only.
- Customer-facing quality certificate / public listing badge rendering.
- ML-based grade suggestion (the threshold rules cover v1).

## 11. Risks / watch-items

- **Neon CU-hours**: the quality recompute is per-mutation and cheap; avoid adding polling/refetch loops (neon-cost-reviewer). Backfill script should batch.
- **Grade gating is a workflow change** — ship behind required-step authoring first so SKUs without `required` steps are unaffected (default `required=false` means zero behavior change until a template opts in).
- **`repair_service` bridge**, not replacement — keep legacy intake working; `unit_repairs.repair_service_id` links the two.

---

## 12. Phase 0 — shipped (bulk settle)

**Files**
- `src/app/api/serial-units/[id]/checklist/bulk/route.ts` — `POST { action?: 'pass' | 'clear' }`. Resolves the unit's in-scope steps exactly like the per-step GET (per-SKU template rows + category-shared rows), then in one transaction: `pass` upserts `passed=true` for every step (UPDATE-existing + INSERT-missing, two set-based statements — no dependence on a named unique index), `clear` deletes the unit's recorded rows so progress returns to 0/N. Returns `{ steps_affected, progress: { completed, total } }`. Guarded by `tech.qc_pass`; emits a `recordAudit` `tech.qc.pass`/`tech.qc.fail` row with `bulk: true`. Advisory only — writes results, never gates grading.
- `src/components/tech/SkuTestingPanel.tsx` — extracted `loadResults()` so the bulk action can refresh attribution after the write; added a header button that reads **"Check all"** when not all steps are done and flips to **"Clear all"** once complete. Only shown when a serial is on the active slot (`canRecord`) and the SKU has steps. Per-step toggling is unchanged.

**Notes / follow-ups**
- ~~The bulk endpoint operates on all in-scope steps today.~~ Done in Phase 1 — bulk now scopes to `status='published'` (see §13).
- Value-kind steps (battery %, etc.) will need bulk to skip numeric entry rather than blanket-pass; revisit when §4.2 input UI lands.

---

## 13. Phase 1 — shipped (lifecycle + structured-value columns)

**Migration** — `src/lib/migrations/2026-06-06_qc_template_lifecycle.sql` (additive, `IF NOT EXISTS`, `status` defaults `'published'` ⇒ zero behavior change). **Pending apply** — not yet run against the DB. Note: a second, unrelated migration (`2026-06-06_warranty_claim_logger.sql`) is also pending; `db:migrate` applies all pending files, so apply deliberately.
- `qc_check_templates` += `status` (CHECK draft|published), `value_kind`, `value_unit`, `value_enum` (jsonb), `pass_min`, `pass_max` (numeric); partial index on `(sku_catalog_id, status)`.
- `tech_verifications` += `value_num` (numeric), `value_text`.

**Drizzle** — `schema.ts` `qcCheckTemplates` / `techVerifications` declarations updated to match.

**Query layer** (`src/lib/neon/sku-catalog-queries.ts`)
- `QcCheckTemplateRow` gains optional `status` + value fields.
- `getQcChecks(skuCatalogId, category, { publishedOnly })` — execution callers pass `publishedOnly: true`; authoring callers omit it.
- `createQcCheck` / `updateQcCheck` accept `status` (sanitized to draft|published).

**Execution views → published only**
- `receiving-lines/[id]/testing-bundle` → `getQcChecks(..., { publishedOnly: true })`.
- `serial-units/[id]/checklist` GET → `AND qc.status = 'published'`.
- `serial-units/[id]/checklist/bulk` → `status='published'` folded into `STEP_SCOPE` (covers pass/clear/tally).

**Authoring → publish toggle**
- `sku-catalog/[id]/qc-checks` POST/PUT accept `status`.
- `QcChecklistSection.tsx` — DRAFT badge, amber-tinted draft rows, hover **Publish / Unpublish** toggle (PUT `{ checkId, status }`). New steps still default `published` so inline tech-adds stay live; author marks a step `draft` while reworking, publishes to "settle".

**Deferred** — ~~`failure_modes` + `unit_failure_tags`~~ (shipped, §14); ~~structured-value input UI + server pass/fail + auto-tag-on-fail~~ (shipped). Remaining: grade-cap advisory wiring (`caps_grade_at` → grade warnings), `unit_repairs` (Phase 3), `unit_quality_scores` (Phase 4).

---

## 14. Phase 1b — shipped (failure-mode taxonomy + auto-tag)

**Migration** `2026-06-07_failure_modes.sql` (**applied**; warranty migration still left pending):
- `failure_modes` — taxonomy (code unique, label, category/severity CHECKs, `is_repairable`, `typical_cost_cents`, `caps_grade_at` condition_grade_enum, sort_order, active). 15-row Bose seed (NO_POWER, BATTERY_DEAD/DEGRADED, BT_NO_PAIR/DROPS, SPEAKER_DEAD/RATTLE, MIC_DEAD, CHARGE_PORT_FAULT, BUTTON_FAULT, FIRMWARE_FAULT, CASE_CRACK, HEAVY_SCRATCH, MISSING_ACCESSORY, WATER_DAMAGE).
- `unit_failure_tags` — per-serial tags; partial unique index `ux_unit_failure_tags_open (serial_unit_id, failure_mode_id) WHERE resolution_status='open'` makes auto-tag idempotent.
- `qc_check_templates.failure_mode_id` (auto-tag target) + `tech_verifications.failed_mode_id` (what a fail mapped to).

**Drizzle** — `failureModes`, `unitFailureTags` + the two FK columns.

**Query layer** — `src/lib/neon/failure-modes-queries.ts`: taxonomy CRUD (`list/create/update/deactivateFailureMode`), `listUnitFailureTags`, idempotent `tagUnitFailure`, `resolveUnitFailureTag`. `upsertVerification` records `failed_mode_id`. `createQcCheck`/`updateQcCheck` accept `failureModeId`.

**API** (Zod `src/lib/schemas/failure-modes.ts`; audit consts `FAILURE_MODE_*`, `FAILURE_TAG_*`):
- `GET/POST /api/failure-modes` (`sku_stock.view` / `sku_stock.manage`; idempotent create).
- `PATCH/DELETE /api/failure-modes/[id]` (`sku_stock.manage`; DELETE = soft deactivate).
- `GET/POST/PATCH /api/serial-units/[id]/failure-tags` (GET `sku_stock.view`; tag/resolve `tech.qc_pass`).

**Auto-tag-on-fail** — the checklist POST loads the step's `failure_mode_id`; when the (server-derived) result is `passed=false` and a mode is set, it opens a `unit_failure_tags` row (`source='qc'`, idempotent) and stamps `tech_verifications.failed_mode_id`. Best-effort — a tag failure never fails the record.

**Bulk-pass value-kind skip** — "Check all" now only blanket-passes pass/fail steps (`value_kind IS NULL OR 'BOOLEAN'`); percent/number/enum/text need a real entry.

Gates: my files `tsc` 0 errors · `audit-route-auth:check` ✓ (536 routes, +3) · manifest test ✓. No new permissions.

**Not yet wired:** authoring UI control to pick a step's `failure_mode_id`; failure-tag display in the unit detail pane; `caps_grade_at` → grade-advice warnings.

---

## 15. Phase 3 — shipped (repair history)

**Migration** `2026-06-07_unit_repairs.sql` (**applied**; warranty migration still left pending):
- `unit_repairs` — per-serial repairs (status CHECK pending|in_progress|completed|failed|scrapped, summary, `parts_used` jsonb, `labor_minutes`, `cost_cents`, started/completed at+by, `rma_id`, `repair_service_id` bridge, `start_event_id`/`done_event_id`).
- `repair_failure_resolutions` — (repair_id, failure_mode_id) PK; which modes a repair addresses.
- `unit_failure_tags.resolved_repair_id` — deferred from Phase 1b, added now.

**Drizzle** — `unitRepairs`, `repairFailureResolutions` + the new tag column.

**Query layer** — `src/lib/neon/repairs-queries.ts`: `listUnitRepairs` (joins staff + resolved modes via `json_agg`), `openRepair` (pg txn: insert + link modes + `serial_units → IN_REPAIR`; then `REPAIR_STARTED` event + back-link `start_event_id`), `updateRepair` (pg txn: update fields; on terminal status set completion + `→ REPAIR_DONE`; on `completed` resolve the unit's open tags whose mode this repair addresses, stamping `resolved_repair_id`; then `REPAIR_COMPLETED` event + `done_event_id`). Events run on neon-http **after** COMMIT (the grade/test standalone-event pattern) so core rows stay atomic.

**API** (Zod `src/lib/schemas/repairs.ts`; audit consts `REPAIR_OPEN/UPDATE/COMPLETE`, entity `UNIT_REPAIR`):
- `GET /api/serial-units/[id]/repairs` (`repair.view`) · `POST` open (`repair.mark_repaired`).
- `PATCH /api/serial-units/[id]/repairs/[repairId]` (`repair.mark_repaired`).

Gates: `tsc` 0 errors · `audit-route-auth:check` ✓ (540 routes) · manifest test ✓. No new permissions (reuses `repair.view` / `repair.mark_repaired`).

**Design note:** serial-status transitions (`IN_REPAIR`/`REPAIR_DONE`) are written by direct UPDATE inside the repair txn (mirrors the grade route's direct `condition_grade` write) rather than routing through `upsertSerialUnit` — these are non-allocation states set by a deliberate tech action. Revisit if allocation invariants ever need to gate repair entry.

**Not yet wired:** repair card + failure-tag list in the unit detail pane; linking a repair to an RMA from the returns flow; `unit_quality_scores` (Phase 4) consuming repair history.
