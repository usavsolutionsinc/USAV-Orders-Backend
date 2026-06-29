# QC Checklist — CRUD endpoint update plan

**STATUS: DONE (100%) — fully complete, nothing pending.** Status verified 2026-06-28 — every deliverable shipped (shared Zod layer, value fields + `deriveStepPassed`, QC_* audit constants, all 5 endpoints on the house pattern, authoring + execution UI). Migrations verified APPLIED & live 2026-06-29 (db ledger 0 pending). Plan is complete and archivable.

> Companion to `docs/condition-grading-repair-qc-plan.md`. Scope: bring **every endpoint that touches `qc_check_templates` / `tech_verifications`** up to the new Phase 1 schema (lifecycle + structured values) **and** onto the house full-CRUD pattern (Zod `parseBody`, idempotency on mutations, `recordAudit`, `withAuth` permission). See the CRUD endpoints initiative for the house pattern reference (sku-catalog pilot).
>
> **Migration status:** `2026-06-06_qc_template_lifecycle.sql` and `2026-06-07_failure_modes.sql` are **APPLIED & live** (verified 2026-06-29 against the live DB: 0 pending). New columns live now:
> - `qc_check_templates`: `status` (draft|published, CHECK), `value_kind`, `value_unit`, `value_enum` (jsonb), `pass_min`, `pass_max` (numeric)
> - `tech_verifications`: `value_num` (numeric), `value_text`
> - unique index `ux_tech_verifications_step (source_kind, source_row_id, step_type, step_id)` already exists → upserts can safely use `ON CONFLICT`.

## ✅ Shipped (2026-06-06) — §0 + endpoints 1–5

- **§0 shared layer:** `src/lib/schemas/qc-checks.ts` (Zod: create/update/delete/result/bulk + `superRefine` for pass band & enum coupling); `createQcCheck`/`updateQcCheck` persist value fields; `upsertVerification` now `ON CONFLICT … DO UPDATE` (+ `value_num/value_text`); new pure `deriveStepPassed`; audit constants `QC_CHECK_CREATE/UPDATE/DELETE/PUBLISH`, `QC_RESULT_RECORD`, entity `QC_CHECK_TEMPLATE`.
- **§1 `sku-catalog/[id]/qc-checks`:** moved to `withAuth`; Zod on all mutations; idempotency on POST; `recordAudit` with before/after on POST/PUT/DELETE (status-only PUT → `QC_CHECK_PUBLISH`); `?publishedOnly=1` on GET; value fields wired. (Closed the no-audit gap.)
- **§2 `receiving-lines/[id]/qc-checks`:** Zod on POST/PUT/DELETE; value fields + status passthrough; audit literals → canonical constants.
- **§3 `serial-units/[id]/checklist`:** GET projects value config + recorded values; POST accepts `valueNum/valueText`, **server-derives `passed`** from the pass band via `deriveStepPassed`, emits `QC_RESULT_RECORD`.
- **§4 `…/checklist/bulk`:** parse via `QcBulkBody`.
- **§5 `testing-bundle`:** projection widened with value config.

Gates: `tsc` 0 errors · `audit-route-auth:check` ✓ (manifest re-emitted) · route-permission-manifest test ✓.

**Structured-value input UI — shipped:**
- **Authoring** (`QcChecklistSection.tsx`): "Captured value" select (Pass/Fail · Percent · Number · Choice list · Free text); numeric kinds reveal pass min/max + unit; ENUM reveals comma-separated choices; row shows a value summary chip (e.g. `≥ 80 %`, `A / B / C`). Wired into POST/PUT via `valuePayload` (sends nulls to clear).
- **Execution** (`SkuTestingPanel.tsx` → `StepValueControl`): per-`value_kind` control — number input (submits `valueNum`, server derives pass/fail from the band, shows `pass ≥ 80 %` hint), ENUM `<select>` and free-text input (submit `valueText`); the pass/fail checkbox is disabled for value steps since the recorded value decides it; re-syncs on reload/unit switch.

**Known v1 nuance:** ENUM/TEXT steps have no automatic pass rule, so recording a value sets `passed=null` (informational) and they don't count toward the done tally; numeric band steps and tap-to-pass steps do. "Check all" still passes everything.

**~~Deferred~~ → DONE 2026-06-28:** both items are now live. Bulk-pass value-kind skip ships (`PASSABLE = value_kind IS NULL OR BOOLEAN`), and the failure-mode migration `2026-06-07_failure_modes.sql` + auto-tag-on-fail (`tagUnitFailure` in the checklist POST) are shipped.

> Note: `QcCheckTemplateRow.value_enum` tightened from `unknown` → `string[] | null` (jsonb arrays deserialize to `string[]`) so the authoring/execution components type-check against it.

## What's already done (Phase 0 + 1)

- `getQcChecks(…, { publishedOnly })`, `createQcCheck`/`updateQcCheck` accept `status`.
- Execution reads filter to `status='published'` (testing-bundle, checklist GET, bulk).
- Authoring UI publish/unpublish toggle (`QcChecklistSection`).
- Bulk settle endpoint `…/checklist/bulk`.

**Still missing:** the new columns are not yet *exposed/validated/written* by the CRUD endpoints beyond `status`. Value fields (`value_kind`, thresholds, recorded `value_num/value_text`) have no write path, and the authoring routes don't follow the house pattern (no Zod, no idempotency, inconsistent audit). This plan closes that, endpoint by endpoint.

---

## 0. Shared layer (do first — every endpoint depends on it)

### 0.1 New Zod module — `src/lib/schemas/qc-checks.ts`
Single source of truth for QC field validation, reused by all routes.

```ts
export const QC_VALUE_KINDS = ['BOOLEAN','PERCENT','NUMBER','ENUM','TEXT'] as const;
export const QC_STATUS = ['draft','published'] as const;

export const QcCheckCreateBody = z.object({
  stepLabel: z.string().trim().min(1).max(200),
  stepType: z.string().trim().max(40).optional(),
  sortOrder: z.number().int().min(0).optional(),
  status: z.enum(QC_STATUS).optional(),            // default 'published' in helper
  valueKind: z.enum(QC_VALUE_KINDS).nullish(),
  valueUnit: z.string().trim().max(20).nullish(),
  valueEnum: z.array(z.string().trim().min(1)).nullish(),
  passMin: z.number().finite().nullish(),
  passMax: z.number().finite().nullish(),
  idempotencyKey: z.string().trim().max(120).optional(),
}).refine(b => b.passMin == null || b.passMax == null || b.passMin <= b.passMax,
  { message: 'passMin must be <= passMax' });

export const QcCheckUpdateBody = QcCheckCreateBody.partial().extend({
  checkId: z.coerce.number().int().positive(),
});

export const QcCheckDeleteBody = z.object({ checkId: z.coerce.number().int().positive() });

export const QcResultBody = z.object({           // per-unit execution record
  stepId: z.coerce.number().int().positive(),
  passed: z.boolean().optional(),                // omitted → server derives from value
  valueNum: z.number().finite().nullish(),
  valueText: z.string().trim().max(2000).nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

export const QcBulkBody = z.object({ action: z.enum(['pass','clear']).default('pass') });
```

### 0.2 Query-helper changes — `src/lib/neon/sku-catalog-queries.ts`
- `createQcCheck` / `updateQcCheck`: accept + persist `valueKind`, `valueUnit`, `valueEnum`, `passMin`, `passMax` (extend the dynamic `SET` builder in `updateQcCheck`; add columns to the `INSERT` in `createQcCheck`).
- `upsertVerification`: accept `valueNum` / `valueText`; switch the insert to `ON CONFLICT (source_kind, source_row_id, step_type, step_id) DO UPDATE` (the unique index exists) — collapses the current insert-then-update seam.
- New helper `deriveStepPassed(step, { valueNum, valueText, passed })`: if the step has a numeric band (`pass_min/max`), compute `passed` from `valueNum`; else fall back to the explicit `passed`. Pure function, unit-tested.
- `QcCheckTemplateRow` already carries the optional new fields (Phase 1).

### 0.3 Audit vocabulary — `src/lib/audit-logs.ts`
Add canonical actions so all routes use the same strings (today receiving-lines uses ad-hoc `'qc_check.create'`):
`QC_CHECK_CREATE='qc_check.create'`, `QC_CHECK_UPDATE='qc_check.update'`, `QC_CHECK_DELETE='qc_check.delete'`, `QC_CHECK_PUBLISH='qc_check.publish'`, `QC_RESULT_RECORD='qc_result.record'`. Entity `QC_CHECK_TEMPLATE='qc_check_template'`. No new permissions needed — reuse `sku_stock.manage` (catalog authoring) and `tech.qc_pass` (tech authoring + execution).

---

## Per-endpoint plan

### 1. `/api/sku-catalog/[id]/qc-checks` — **primary authoring CRUD** (catalog admin)
File: `src/app/api/sku-catalog/[id]/qc-checks/route.ts` · Perm: `sku_stock.view` (GET) / `sku_stock.manage` (mutations)

| Method | Current | Planned |
|---|---|---|
| GET | returns `{ catalog, checks }` (now incl. `status` + value fields via `SELECT *`) | add `?publishedOnly=1` passthrough for callers that want the execution view; otherwise unchanged |
| POST | ad-hoc body; only `stepLabel/stepType/sortOrder` (+`status` added Phase 1) | `parseBody(QcCheckCreateBody)`; persist value fields; **idempotency** (`readIdempotencyKey` + save); `recordAudit(QC_CHECK_CREATE)` |
| PUT | ad-hoc; `stepLabel/stepType/sortOrder/status` | `parseBody(QcCheckUpdateBody)`; persist value fields; `recordAudit(QC_CHECK_UPDATE)`; emit `QC_CHECK_PUBLISH` when only `status` changed (before/after) |
| DELETE | ad-hoc; `checkId` | `parseBody(QcCheckDeleteBody)`; capture `before`; `recordAudit(QC_CHECK_DELETE)` |

Notes: migrate from `requireRoutePerm` to either keep `requireRoutePerm` (fine) but add Zod + audit, or move to `withAuth({ permission })` for consistency with the house pattern — **recommend `withAuth`**. This route currently emits **no audit** — that's the biggest gap.

### 2. `/api/receiving-lines/[id]/qc-checks` — **tech inline authoring CRUD**
File: `src/app/api/receiving-lines/[id]/qc-checks/route.ts` · Perm: `tech.qc_pass` · already uses `withAuth` + `audit` option

| Method | Current | Planned |
|---|---|---|
| POST | `stepLabel/stepType/sortOrder` | `parseBody(QcCheckCreateBody)`; pass value fields + `status` to `createQcCheck`; keep create-on-demand catalog; switch ad-hoc audit string → `AUDIT_ACTION.QC_CHECK_CREATE` |
| PUT | `stepLabel/stepType/sortOrder` | `parseBody(QcCheckUpdateBody)`; pass value fields + `status` through `stepBelongsToCatalog` guard → `updateQcCheck`; add publish-toggle support so techs can settle from the testing screen |
| DELETE | `checkId` | `parseBody(QcCheckDeleteBody)` (logic unchanged) |

Notes: keep the `stepBelongsToCatalog` ownership guard. Category-shared steps (`sku_catalog_id IS NULL`) stay read-only here. Bring the `audit` option actions onto the canonical constants.

### 3. `/api/serial-units/[id]/checklist` — **per-unit execution (GET + record)**
File: `src/app/api/serial-units/[id]/checklist/route.ts` · Perm: `tech.qc_pass`

| Method | Current | Planned |
|---|---|---|
| GET | published steps merged w/ results (Phase 1) | also `SELECT qc.value_kind, qc.value_unit, qc.value_enum, qc.pass_min, qc.pass_max` and `tv.value_num, tv.value_text` so the UI can render structured inputs + recorded values |
| POST | `{ stepId, passed?, notes? }` → `upsertVerification` | `parseBody(QcResultBody)`; accept `valueNum/valueText`; **server derives `passed`** via `deriveStepPassed` when the step has a numeric band; write value fields through `upsertVerification`; `recordAudit(QC_RESULT_RECORD)` (currently none) |

Notes: this is where battery-%/BT capture becomes real. Auto-tag-on-fail (create a `unit_failure_tags` row when `passed=false`) is gated on the failure-mode migration → **deferred**, leave a TODO hook.

### 4. `/api/serial-units/[id]/checklist/bulk` — **bulk settle** ✅ shipped
File: `src/app/api/serial-units/[id]/checklist/bulk/route.ts` · Perm: `tech.qc_pass`
- Already `status='published'`-scoped, transactional, audited. **Change:** swap inline body parse → `parseBody(QcBulkBody)` for consistency. Value-kind steps: bulk "pass" should **skip** steps that require a numeric entry rather than blanket-pass them (once value input lands) — add `AND qc.value_kind IS NULL` to the pass path then, leave a TODO.

### 5. `/api/receiving-lines/[id]/testing-bundle` — **execution read (tech panel)**
File: `src/app/api/receiving-lines/[id]/testing-bundle/route.ts` · Perm: `tech.qc_pass`
- Already `publishedOnly`. **Change:** widen the `checklist.map` projection to include `value_kind`, `value_unit`, `value_enum`, `pass_min`, `pass_max` so `SkuTestingPanel` can render the right input control per step. No write path.

### 6. `/api/sku-catalog/search` — **`hasQc` discovery filter (indirect)**
File: `src/app/api/sku-catalog/search/route.ts` (line ~238)
- `EXISTS (… qc_check_templates …)` currently counts **any** step incl. drafts. **Decision:** keep counting all for authoring discovery (a SKU with only drafts is still "being built") — but document it. If a "has *published* QC" filter is wanted later, add `AND qc.status='published'` behind a query flag. **No change now; documented.**

---

## Client/read surfaces to update alongside (not endpoints, but they consume the shape)
- `src/hooks/useSkuQcChecks.ts` — type `checks` to include new fields (already flows via `SELECT *`).
- `src/components/manuals/sections/QcChecklistSection.tsx` — add value-kind/threshold inputs in the add/edit form (Phase 1 shipped the publish toggle; structured inputs are the next UI slice).
- `src/components/tech/SkuTestingPanel.tsx` — render numeric/enum input per `value_kind`; show recorded `value_num/value_text`.

---

## Cross-cutting acceptance checklist (every mutation route)
- [x] `withAuth({ permission })` or `requireRoutePerm` guard present
- [x] `parseBody(<zod>)` → 400 on invalid; no raw `body.x` reads
- [x] Idempotency key honored on POST creates (catalog authoring route)
- [x] `recordAudit` with canonical `AUDIT_ACTION` + before/after
- [x] `passMin <= passMax`; `value_enum` only when `value_kind='ENUM'`
- [x] Execution reads stay `status='published'`; authoring reads show all
- [x] api-route-reviewer + permission-registry-guard pass (no new perms expected)

## Suggested order
1. **0. Shared layer** (Zod module, helper changes, audit constants) — unblocks all.
2. **1 + 2** authoring CRUD (value fields + house pattern) — makes thresholds authorable.
3. **3 + 5** execution read/record (structured capture) — makes battery/BT real.
4. **4** bulk parse tidy + value-kind skip.
5. UI slices (QcChecklistSection inputs, SkuTestingPanel controls).
6. Later: failure-mode migration → auto-tag-on-fail hook in §3.

---

## Session 2026-06-28 — completion pass

- No code changes — doc-only status reconciliation.
- Audit + completion pass confirmed every deliverable shipped: `src/lib/schemas/qc-checks.ts`, `deriveStepPassed` + value fields in `sku-catalog-queries.ts`, `QC_*` audit constants, all 5 endpoints on the house pattern, and the `QcChecklistSection` + tech/sku-testing UI.
- The two formerly "deferred" items are verified LIVE: bulk-pass value-kind skip (`PASSABLE = value_kind IS NULL OR BOOLEAN`) and the failure-mode migration `2026-06-07_failure_modes.sql` + auto-tag-on-fail (`tagUnitFailure` in the checklist POST).
- UI note: the execution panel moved `SkuTestingPanel` → `src/components/tech/sku-testing` (rename, not a gap).
- Migration status verified 2026-06-29 (db ledger 0 pending): `2026-06-06_qc_template_lifecycle.sql` and `2026-06-07_failure_modes.sql` are both APPLIED & live.

## Remaining work — handoff (2026-06-28)

- **[MIGRATION-VERIFY] VERIFIED APPLIED ✅** — `2026-06-06_qc_template_lifecycle.sql` and `2026-06-07_failure_modes.sql` confirmed applied & live on the DB (verified 2026-06-29: 0 pending). No further code work — plan fully complete, nothing pending; safe to archive out of `docs/partial/`.
