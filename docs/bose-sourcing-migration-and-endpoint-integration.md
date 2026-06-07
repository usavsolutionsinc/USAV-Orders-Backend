# Bose Sourcing Engine — Migration & Endpoint Integration Runbook

**Status:** Backend COMPLETE (2026-06-06) — all endpoints, jobs, permissions, audit
vocab, sku_catalog opt-in + `qk` factories built; `tsc` clean, `npm run build` green,
`audit-route-auth --check` passing, end-to-end DB smoke verified. · **Owner:** TBD
**Companion docs:** `docs/bose-parts-sourcing-engine-plan.md` (feature plan),
`docs/bose-parts-sourcing-engine-plan.md §9` (phasing).

This doc is the operational runbook for the schema change: **what moved, why nothing
existing breaks, exactly which endpoints to add/update, and the order to do it in so every
CRUD endpoint — old and new — keeps working as intended.**

---

## 0. Current state (done)

- Migrations applied via `npm run db:migrate` (runner: `scripts/run-pending-migrations.mjs`,
  tracked in `schema_migrations` by filename+sha):
  - `2026-06-06d_sku_catalog_lifecycle.sql` — +4 columns on `sku_catalog`
  - `2026-06-06e_bose_models_compatibility.sql` — `bose_models`, `bose_serial_prefixes`, `part_compatibility`
  - `2026-06-06f_suppliers.sql` — `suppliers`
  - `2026-06-06g_sourcing.sql` — `sourcing_alerts`, `sourcing_candidates`, `part_acquisitions`
- Drizzle defs + `$inferSelect/Insert` types added to `src/lib/drizzle/schema.ts`.
- `tsc --noEmit` clean; `npm run build` green; DB verified (7 tables + 4 columns live).

**Done (this runbook):** audit vocab, `sourcing.*`/`supplier.*` permissions (+ category),
Zod schemas (`bose-model`, `part-compatibility`, `supplier`, `sourcing`), query layers
(`bose-model`/`part-compatibility`/`suppliers`/`sourcing` -queries), eBay Browse app-token
client + `sourcing/{normalize,search}` + `jobs/sourcing-scan`, every route in §3, the
`sku_catalog` lifecycle opt-in (§5), `qk` factories (§6), and the `/api/cron/sourcing/scan`
cron (nightly `0 6 * * *` in `vercel.json`). A new migration
`2026-06-06h_receiving_source_sourcing_import.sql` widens `receiving_source_chk` to allow
the import's `source='sourcing_import'`. Manifest regenerated; route-auth `--check` green.

**Remaining (out of this runbook's scope):** dashboard/admin **UI** wiring (Phase 9 / feature
plan Phases 1–5) — partially started under `src/components/admin/sourcing/`. Compatibility +
serial-prefix data is empty and seeded manually/CSV.

---

## 1. Backward-compatibility guarantee (why existing CRUD is safe)

The migration is **purely additive** and the codebase is structured so the additions are
invisible until explicitly opted into. Three independent reasons existing endpoints keep
working unchanged:

1. **Every new column is nullable or defaulted.** `lifecycle_status text NOT NULL DEFAULT
   'active'`, the other three nullable. Existing `INSERT INTO sku_catalog (...)` statements
   that don't mention them get the defaults. No existing write needs to change.

2. **The `sku_catalog` write bodies are `.strict()` and don't list the new fields.**
   `SkuCatalogCreateBody` / `SkuCatalogUpdateBody` in `src/lib/schemas/sku-catalog.ts` reject
   unknown keys — so no client is sending `lifecycle_status` today, and none can until we add
   it. (Precedent: `gtin` was added to the table earlier and is *still* absent from these
   bodies — the table can carry columns the CRUD body doesn't expose.)

3. **Reads are explicit-column, not shape-coupled.** The `sku_catalog` touchpoints
   (audited below) use explicit column lists in raw SQL or the Drizzle query builder. Adding
   columns doesn't widen any existing `SELECT`. The few `select *` / `$inferSelect` consumers
   just gain extra typed fields they can ignore.

**Net:** zero changes required to existing endpoints for them to keep functioning. Updating
the `sku_catalog` CRUD to *expose* lifecycle is a deliberate, isolated opt-in (§5).

---

## 2. Impact audit — `sku_catalog` call sites

`skuCatalog` (Drizzle symbol) is referenced in only 4 files; the rest reach `sku_catalog`
via explicit-column raw SQL. Verdicts:

| Call site | Operation | Verdict |
|---|---|---|
| `src/lib/drizzle/schema.ts` | table def | ✅ updated (new cols + types) |
| `src/queries/keys.ts` | `qk.skuCatalog.*` | ✅ no change; add `qk.sourcing.*` etc. (§6) |
| `src/app/api/sku-catalog/route.ts` (GET/POST) | list + create | ✅ unaffected; POST opt-in later (§5) |
| `src/app/api/sku-catalog/[id]/route.ts` (PATCH/DELETE) | update + soft-delete | ✅ unaffected; PATCH opt-in later (§5) |
| `src/app/api/tech/scan/route.ts`, `src/lib/receiving/*`, `src/app/api/scan/resolve/route.ts`, `src/lib/repositories/*`, `src/app/api/cron/sku-catalog/refresh-suggestions/route.ts`, et al. | explicit-column reads/joins | ✅ no change — added columns aren't in their projections |
| `ProductDetailsSection.tsx`, `inventory/types.ts`, admin inventory pages | display | ✅ no change; can surface lifecycle later |

**Action items from the audit:** none are *required*. Optional later: surface
`lifecycle_status` as a badge in `ProductDetailsSection` / admin inventory (Phase 2 UI).

---

## 3. New endpoints to build (per-table CRUD + actions)

All follow the **house route pattern** verified against `src/app/api/sku-catalog/**`:
- Collection routes: `withAuth(handler, { permission })`.
- `[id]` routes: `const { denied, ctx } = await requireRoutePerm(req, perm); if (denied) return denied;`
- Validate with `parseBody(ZodSchema, raw)` (400 on fail).
- Mutations honor `Idempotency-Key` (header or body) via the existing idempotency helper.
- Every mutation calls `recordAudit(pool, ctx, req, { source, action, entityType, entityId, before, after })`.
- Responses: `{ success: true, ... }` + correct status (201/200/400/404/409/500); soft-delete only.

| Route | Methods | Permission | Notes |
|---|---|---|---|
| `/api/bose-models` | GET, POST | `sourcing.view` / `sourcing.manage` | `q` search, paginate, idempotent POST on `model_number` |
| `/api/bose-models/[id]` | GET, PATCH, DELETE | view / manage | soft-delete (`is_active=false`) |
| `/api/bose-models/lookup` | GET | `sourcing.view` | `?serial=` (decode via `bose_serial_prefixes`, longest-prefix-wins) or `?model=`; returns model + compatible parts joined to live stock + `lifecycle_status` + open alerts |
| `/api/part-compatibility` | GET, POST | view / manage | filter `boseModelId` \| `skuId`; POST upserts on the `(model,sku,role)` unique key |
| `/api/part-compatibility/[id]` | PATCH, DELETE | manage | hard-delete OK (edge row, not audited entity history) — or soft if preferred |
| `/api/suppliers` | GET, POST | `supplier.view` / `supplier.manage` | eBay sellers auto-created elsewhere; manual create here |
| `/api/suppliers/[id]` | GET, PATCH, DELETE | view / manage | soft-delete |
| `/api/sourcing/alerts` | GET, PATCH | `sourcing.view` / `sourcing.manage` | PATCH = resolve/dismiss; **reason required** (add to `AUDIT_REASON_REQUIRED`) |
| `/api/sourcing/search` | POST | `sourcing.search` | eBay Browse proxy → normalize → return (persist only if `save:true`); rate-limited; logs to `ebay_api_calls` |
| `/api/sourcing/candidates` | GET, POST | view / manage | POST = save to watchlist |
| `/api/sourcing/candidates/[id]` | PATCH | manage | status transitions |
| `/api/sourcing/candidates/[id]/import` | POST | `sourcing.import` | **idempotent**; upsert supplier → create `receiving` (`source_platform='ebay'`) → `part_acquisitions(status='ordered')`; returns `receiving.id` for unbox |

**Zod schemas** (new files in `src/lib/schemas/`): `bose-model.ts`, `part-compatibility.ts`,
`supplier.ts`, `sourcing.ts`. Mirror the `sku-catalog.ts` style: `.strict()` bodies,
`optNullableText`, idempotency-key field on creates, partial update bodies with a
"≥1 field" refine.

---

## 4. The guarded path — permissions, manifest test, audit vocab

These three move **together in the same change as the routes that use them** — the
`permission-registry-guard` requires a registry edit to be paired with a
`route-permission-manifest.test.ts` update, and `audit-route-auth` must stay green. Adding
orphan permissions ahead of routes would trip the guard, which is why P0 deliberately
deferred them.

**4.1 `src/lib/auth/permission-registry.ts`**
- Add category: `{ id: 'sourcing', label: 'Sourcing' }` to `PERMISSION_CATEGORY_DEFS`.
- Append to `PERMISSIONS`:
  ```ts
  { id: 'sourcing.view',   category: 'sourcing', label: 'View sourcing & compatibility' },
  { id: 'sourcing.manage', category: 'sourcing', label: 'Edit compatibility, models & alerts' },
  { id: 'sourcing.search', category: 'sourcing', label: 'Run secondary-market searches' },
  { id: 'sourcing.import', category: 'sourcing', label: 'Import a candidate into inventory', destructive: true },
  { id: 'supplier.view',   category: 'sourcing', label: 'View suppliers' },
  { id: 'supplier.manage', category: 'sourcing', label: 'Manage suppliers' },
  ```
  The `RegistryPermissionString` union, `REGISTRY_ALL_PERMISSIONS`, and the Roles-editor
  grouping all derive automatically.

**4.2 `src/lib/auth/route-permission-manifest.test.ts`**
- Add one manifest entry per new route mapping path → required permission. Run
  `node scripts/audit-route-auth*` (the `audit-route-auth` script) — it must pass, proving
  every new `route.ts` declares a known permission. Add routes + manifest entries in the same
  commit so the guard sees them paired.

**4.3 `src/lib/audit-logs.ts`**
- `AUDIT_ENTITY`: add `BOSE_MODEL`, `PART_COMPATIBILITY`, `SUPPLIER`, `SOURCING_ALERT`,
  `SOURCING_CANDIDATE`, `PART_ACQUISITION`.
- `AUDIT_ACTION`: add `*.create|update|delete` for each, plus `sourcing.search`,
  `sourcing.candidate.import`, `sourcing.alert.resolve`.
- `AUDIT_REASON_REQUIRED`: add `sourcing.alert.resolve` and `sourcing.candidate.import`.

---

## 5. Updating the existing `sku_catalog` CRUD (the one existing endpoint that changes)

This is the *only* existing endpoint we deliberately touch, and only to **expose** lifecycle
for the admin editor. It stays backward-compatible because we add **optional** fields to a
`.strict()` body — existing callers that omit them are unchanged.

`src/lib/schemas/sku-catalog.ts`:
```ts
// add to SkuCatalogCreateBody AND SkuCatalogUpdateBody:
lifecycleStatus: z.enum(['active','eol','discontinued','nrnd','unknown']).optional(),
reorderThreshold: z.number().int().nonnegative().nullable().optional(),
lastKnownCostCents: z.number().int().nonnegative().nullable().optional(),
sourcingNotes: optNullableText,
```
`src/app/api/sku-catalog/route.ts` + `[id]/route.ts`:
- Thread the new fields into the insert/update column maps (only when present in the body).
- Keep the existing `before`/`after` audit payloads — they'll now include the new fields
  automatically if you spread the row.
- GET list/detail: include the new columns in the projection so the admin editor can render
  them. (List endpoint stays the same shape otherwise; additive fields only.)

**Verification:** existing create/update calls that don't send the new fields must still
return 201/200 identically — add a regression test asserting an old-shaped body still works.

---

## 6. Client wiring (TanStack Query)

`src/queries/keys.ts` — add factories mirroring `qk.skuCatalog`:
```ts
boseModels:        { all: ['bose-models'] as const,
                     list: (q: string) => ['bose-models','list',q] as const,
                     detail: (id: number) => ['bose-models','detail',id] as const,
                     lookup: (key: string) => ['bose-models','lookup',key] as const },
partCompatibility: { all: ['part-compatibility'] as const,
                     forModel: (id: number) => ['part-compatibility','model',id] as const },
suppliers:         { all: ['suppliers'] as const,
                     list: (q: string) => ['suppliers','list',q] as const,
                     detail: (id: number) => ['suppliers','detail',id] as const },
sourcing:          { alerts: (status: string) => ['sourcing','alerts',status] as const,
                     candidates: (skuId: number) => ['sourcing','candidates',skuId] as const,
                     search: (q: string) => ['sourcing','search',q] as const },
```
Mutations invalidate the broad `.all` prefix (house convention), e.g. after a
compatibility edit: `queryClient.invalidateQueries({ queryKey: qk.partCompatibility.all })`
and `qk.boseModels.lookup(...)`.

---

## 7. Cross-cutting review gates (must pass before merge)

The repo runs these reviewers automatically; each new route must satisfy them:
- **`api-route-reviewer`** (fires on `src/app/api/**/route.ts`): every handler needs an
  auth/permission guard, Zod input validation, idempotency on mutations, and an audit-log
  emission. Our route template (§3) is built to satisfy all four — don't skip any.
- **`permission-registry-guard`** (fires on `src/lib/auth/**`): registry edit ⇒ manifest
  test edit ⇒ `audit-route-auth` green (§4).
- **`neon-cost-reviewer`** (fires on db/`src/app/api`/cache/polling edits): the `/lookup`
  and `/search` joins should be single round-trips; the watchlist re-price job (later) must
  be rate-limited and not introduce per-row N+1 or tight polling. Keep `sourcing/search`
  user-initiated + short-cached (Browse quota ~5k/day).

---

## 8. Rollout order (each step independently shippable + verifiable)

1. **Schema + types** — DONE. Gate: `tsc` + `build` green; DB verified. ✅
2. **Audit vocab** (`audit-logs.ts`) — additive constants, no guard. Gate: `tsc`.
3. **Zod schemas** (`src/lib/schemas/*`) — pure additions. Gate: `tsc`.
4. **`bose-models` + `part-compatibility` CRUD + `/lookup`** — routes + permissions +
   manifest test together. Gate: `audit-route-auth`, `api-route-reviewer`, build.
5. **`suppliers` CRUD** — same shape. Gate: same.
6. **`sku_catalog` CRUD opt-in** (§5) + regression test. Gate: old-body regression passes.
7. **`sourcing/alerts` + scan job** (`src/lib/jobs/sourcing-scan.ts` + `/api/cron/sourcing/scan`
   + `vercel.json` cron). Gate: dry-run the job locally; idempotent re-run = no dupes.
8. **`sourcing/search`** (eBay Browse app-token client `src/lib/ebay/browse-client.ts` +
   normalize) → **`sourcing/candidates`** → **`/import`**. Gate: import is idempotent
   (`Idempotency-Key` + `(source,external_id)` unique); creates exactly one `receiving` row.
9. **Client wiring + UI** (Phase 1–5 of the feature plan).

After each step: `tsc --noEmit` then `npm run build`. Never edit an applied migration file
(the runner rejects sha drift) — ship a new dated migration instead.

---

## 9. Rollback

- **Code:** each step is additive; revert the route/schema files. No existing endpoint
  depends on the new ones, so reverting forward work can't break the running app.
- **DB:** the migrations are additive and non-destructive; they don't need to be rolled back
  to revert code. If a hard rollback is ever required, a new dated migration drops the new
  tables and columns (`DROP TABLE IF EXISTS ...`, `ALTER TABLE sku_catalog DROP COLUMN IF
  EXISTS ...`) — `lifecycle_status` etc. are unreferenced by existing code, so dropping them
  is safe once the opt-in (§5) is also reverted.
- **Never** delete an already-applied migration file; write a compensating one.

---

## 10. Test checklist

- [ ] `sku_catalog` create/update with an **old-shaped** body → 201/200 unchanged (regression).
- [ ] `sku_catalog` create/update with new lifecycle fields → persisted + audited.
- [ ] Each new collection route: 401 without permission, 400 on bad body, 201 + audit on create.
- [ ] Each `[id]` route: 404 unknown id, soft-delete sets `is_active=false`.
- [ ] `part_compatibility` POST twice for same `(model,sku,role)` → single row (upsert), 200/idempotent.
- [ ] `/lookup?serial=` with a known prefix resolves the model; unknown prefix falls back to model search.
- [ ] `sourcing.alert.resolve` without a reason → 400 (reason-required).
- [ ] `/import` retried with same `Idempotency-Key` → one `receiving` row, replayed response.
- [ ] `runSourcingScanJob` run twice → no duplicate live alerts (partial unique index holds).
