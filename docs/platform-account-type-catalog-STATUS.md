# Platform / Type Catalog — Status & What's Left

**Handoff doc — written 2026-06-14.** Self-contained: a fresh session needs only this + the plan
(`docs/platform-account-type-catalog-plan.md`) + `git log`. Goal of the initiative: promote the
hardcoded platform + receiving-type lists into a **per-org, CRUD-able catalog** so each org edits its
own sales channels and receiving flow types without a code change.

> ⚠ The repo working tree is heavily concurrent (GitHub Desktop mid-session). **Trust `git`/the live
> DB, not assumptions.** There are unrelated pending migrations (see bottom) — do **not** apply them
> as part of catalog work.

---

## ✅ Done (committed to `main`)

| Commit | What |
|---|---|
| `c358b77a` | **Phase 1 core** — migration `2026-06-13g_platform_account_type_catalog.sql` (tables `platforms`, `platform_accounts`, `types`, org_id NOT NULL + FK, seeded per org); CRUD API `/api/catalog/{platforms,types}` (`route.ts` GET/POST, `[id]/route.ts` PATCH/DELETE, withAuth + Zod + audit + idempotency, soft-delete; reads `receiving.view`, writes `admin.manage_features`); query layer `src/lib/neon/catalog-queries.ts` + Zod `src/lib/schemas/catalog.ts`; React Query `src/lib/queries/catalog-queries.ts` + hooks `src/hooks/useCatalog.ts`; `CatalogManagerPopover` opened by a pencil in `LabelEditPopover`; carton-bar pills append custom; `seedOrgCatalog()` on org create. `is_system` flag protects built-ins (hide-only, slug immutable). |
| `8bb53a0d` | **Phase 1 cache + Phase 3 platform reads** — `src/lib/catalog/org-catalog.ts` (cached `getOrgPlatforms`/`getOrgTypes` + `invalidateCatalogCache`, called from all 6 CRUD handlers). `usePlatformMeta()` resolver (catalog label/tone wins, falls back to `sourcePlatformMeta`; custom slug → its label, no "Unknown"). `CartonContextCard` pills now **catalog-driven** (rename/hide/reorder propagate; order = `sort_order`). `/api/receiving/[id]` PATCH validates `source_platform`/`intake_type` against catalog ∪ hardcoded sets. |
| `4d7f9ce1` | **Phase 4 groundwork** — extracted `CatalogManagerList` (shared by popover + a `/settings` `CatalogSection`). |
| `4cdea7db` | **Phase 3 type reads** — `useReceivingTypeLabel()` + `ReceivingLabelPayload.receivingTypeLabel`; `receivingLabelPlatformDisplay` prefers it → renamed/custom types print correctly (preview + both print paths). |
| `22546475` | **RLS armed** — migration `2026-06-14b_catalog_rls.sql`: `ENABLE ROW LEVEL SECURITY` + `<t>_tenant_isolation` policy on all 3 tables. **ARMED, NOT FORCEd** (inert under the BYPASSRLS owner). Tenancy guard green. |
| `69cd4131` | **Phase B writer fix** (tenancy, not catalog) — `organization_id` on 9 child-table inserts (inherit-from-parent / thread ctx). See loose end #2. |
| _(uncommitted, this session 2026-06-14)_ | **Phase 2 + Phase 4-remainder + Phase 5** — see "Built this session" below. |

**Migrations applied to live DB:** `2026-06-13g_platform_account_type_catalog`, `2026-06-14_org_id_phase_b_domain_children`, `2026-06-14b_catalog_rls`.

**Migration WRITTEN, NOT YET APPLIED:** `2026-06-14f_catalog_type_fk_accounts_seed.sql` (adds `receiving.type_id` + `orders.type_id` FKs; seeds `platform_accounts`). Apply with care — `npm run db:migrate` runs ALL pending including the unrelated ones (see bottom). All dual-write is column-existence-guarded, so the app is safe before/after it applies.

**Phase scorecard:** Phase 1 ✅ · Phase 2 ✅ (built; migration unapplied) · Phase 3 ✅ (platform + type; order-channel *resolver* ✅, surface wiring 🟡) · Phase 4 ✅ (platforms + types + **accounts**) · RLS ✅ · Phase 5 ✅ (account + workflow-node bindings) · Phase 6 ⬜ (gated).

### Built this session (2026-06-14) — uncommitted working tree

| Area | What |
|---|---|
| **Loose ends A1/A2** | Both already landed in the tree (settings `catalog` nav section + `repairs-queries.ts` `organization_id` on both inserts). No action needed. |
| **Phase 2 — migration** | `2026-06-14f_catalog_type_fk_accounts_seed.sql`: additive `receiving.type_id` + `orders.type_id` → `types(id)` (`ON DELETE SET NULL` + partial indexes); seeds `platform_accounts` (eBay ← `ebay_accounts`, one `<platform>-main` per non-eBay platform). Drizzle: `typeId` on `receiving`/`orders` + `platforms`/`platformAccounts`/`types` tables now declared. |
| **Phase 2 — backfill** | `scripts/backfill-catalog-type-id.mjs` — dry-run default, `--apply`, org-by-org. Maps `receiving.type_id` from effective `intake_type` (`receivingTypeSlug` mirror); reports `orders` counts by `account_source` (no clean "sale" type to map to yet — no silent drops). |
| **Phase 2 — dual-write** | `/api/receiving/[id]` PATCH writes `type_id` alongside `intake_type` (guarded by the cached `getReceivingSchema()` column probe → no-op pre-migration). `/api/receiving-entry` POST sets `type_id` via the schema-driven insert (auto-skips if column absent), resolved from `is_return`. |
| **Phase 2 — resolvers** | `org-catalog.ts`: `resolveType` (type→account→platform→provider→workflow), `resolveReceivingTypeId` + pure `receivingTypeSlug`, `resolveOrderChannel` (account_source → catalog platform), `getOrgPlatformAccounts`. Cache invalidation now clears accounts too. |
| **Phase 4 — accounts** | `platform_accounts` CRUD: query layer (`list/get/create/updatePlatformAccount`), Zod (`PlatformAccountCreate/UpdateBody`), `/api/catalog/platform-accounts` + `[id]` routes (withAuth + idempotency + audit + soft-delete), `seedOrgCatalog` now seeds accounts. Client: `platformAccountsQuery`, `usePlatformAccountCatalog`, `PlatformAccountsManager` (grouped-by-platform), wired into the `/settings` catalog section. |
| **Phase 5 — bindings** | `types` editor exposes optional `platform_account_id` + `workflow_node_id`. Schema/query/route pass-through (null = clear, distinct from unchanged). `/api/catalog/workflow-nodes` lists the org's graph nodes (label-enriched). UI: `TypeBindingsEditor` (account + workflow-node selects) behind a gear on each type row in `CatalogManagerList` when `enableTypeBindings` (settings only; popover unchanged). `useWorkflowNodeOptions`. |
| **Order-channel display** | `useOrderChannelLabel(orderId, accountSource)` resolver hook built (overlays catalog on `getOrderPlatformLabel`). Surface wiring (PackerTable/TechTable/OrdersQueueTable/shipped panels/mobile) left as the incremental reader-migration step — see What's-left B. |

---

## ⬜ What's left (in priority order)

### A. Apply + run Phase 2 (operational, not code)
1. **Apply `2026-06-14f`.** It's written but unapplied. `npm run db:migrate` applies ALL pending in order (incl. the unrelated ones at the bottom) — coordinate, or apply this one file deliberately. Until applied, the new columns don't exist; the dual-write is column-guarded so nothing breaks meanwhile.
2. **Run the backfill.** `node scripts/backfill-catalog-type-id.mjs` (dry-run) → review the unmapped-slug + orders-by-account_source report → `--apply` to write `receiving.type_id`.

### B. Wire the order-channel display (incremental reader migration)
- The resolver is built (`useOrderChannelLabel(orderId, accountSource)` in `src/hooks/useCatalog.ts`) — it overlays the catalog (renamed/custom platforms + eBay account→platform) on the built-in `getOrderPlatformLabel` and falls back identically.
- Remaining: swap `getOrderPlatformLabel(...)` → `useOrderChannelLabel()(...)` across the ~12 order surfaces (PackerTable, TechTable, OrdersQueueTable, shipped detail panels, mobile order rows, AddTrackingPopover, up-next cards). Each is a per-component hook + call-site swap; watch rules-of-hooks (place the hook above early returns). The text cache keeps unwired surfaces correct, so this is safe to do a few at a time.
- Optional deeper step: populate `orders.type_id` (needs a `shipping`-kind "sale" type to map onto — create one in Phase 5, then extend the backfill + add dual-write to the cleanly org-scoped order writers: `/api/orders/add`, amazon `order-sync.ts`, `sync-sheets`).

### C. Phase 6 — cleanup (final, gated)
- Drop the `source_platform`/`intake_type` text columns + CHECK constraints once `grep` proves zero readers (per `dead-code-cleanup-waves`). **Not yet** — `account_source`/`intake_type`/`source_platform` still have a large live read footprint (incl. `'fba'` checks + `ILIKE` filters). The `type_id` columns are additive; the text columns stay the cache until readers move to the resolvers.

### D. ~~Tenancy follow-through~~ — DONE
- The catalog CRUD writers already go through `tenantQuery`/`withTenantTransaction` (GUC-wrapped) — `src/lib/neon/catalog-queries.ts`. The new `platform_accounts` writers do too. RLS stays **armed, not FORCEd** (inert under the BYPASSRLS owner) until the org-wide FORCE flip.

---

## Key files / entry points

- **Plan:** `docs/platform-account-type-catalog-plan.md` (the 6-phase design).
- **DB:** `src/lib/migrations/2026-06-13g_platform_account_type_catalog.sql`, `…/2026-06-14b_catalog_rls.sql`, **`…/2026-06-14f_catalog_type_fk_accounts_seed.sql`** (type_id FKs + account seed; unapplied). Drizzle: `platforms`/`platformAccounts`/`types` + `receiving.typeId`/`orders.typeId` in `src/lib/drizzle/schema.ts`.
- **Backend:** `src/lib/neon/catalog-queries.ts` (queries + `seedOrgCatalog` + **`*PlatformAccount`**), `src/lib/schemas/catalog.ts`, `src/app/api/catalog/{platforms,types,platform-accounts,workflow-nodes}/**`, `src/lib/catalog/org-catalog.ts` (cache + **`resolveType`/`resolveReceivingTypeId`/`resolveOrderChannel`/`getOrgPlatformAccounts`**).
- **Backfill:** `scripts/backfill-catalog-type-id.mjs` (dry-run default, `--apply`).
- **Client:** `src/lib/queries/catalog-queries.ts`; `src/hooks/useCatalog.ts` → `usePlatformCatalog`, `useReceivingTypeCatalog`, **`usePlatformAccountCatalog`**, **`useWorkflowNodeOptions`**, **`usePlatformMeta`**, **`useReceivingTypeLabel`**, **`useOrderChannelLabel`** (order-channel resolver), `useInvalidateCatalog`.
- **UI:** `CatalogManagerList.tsx` (shared CRUD list; `enableTypeBindings` reveals **`TypeBindingsEditor.tsx`**) + **`PlatformAccountsManager.tsx`** + `CatalogManagerPopover.tsx` (overlay) + `src/components/settings/sections/CatalogSection.tsx` (now platforms + accounts + types-with-bindings) + `LabelEditPopover.tsx` (pencil → manager).
- **Resolver SoT:** `src/lib/source-platform.ts` is still the platform constant SoT (the hook overlays the catalog on top); `src/lib/print/printReceivingLabel.ts` `receivingLabelPlatformDisplay` reads `receivingTypeLabel`.
- **Built-in lists (seed source):** `SOURCE_PLATFORMS` (source-platform.ts), `RECEIVING_TYPE_OPTS` (`src/components/sidebar/receiving/receiving-sidebar-shared.ts`).

## Verification (this session)
- The catalog changeset is **type-clean** — two full `npx tsc --noEmit` passes (before concurrent edits landed) were exit-0 across the repo, and a targeted pass confirms **zero errors in any catalog/Phase-2 file**. `npm run build` **compiled successfully** (28.2s).
- A repo-wide build/`tsc` is currently **red on unrelated concurrent-WIP files** (`sku/*`, `serial-units/*`, `tech/*`, `orders-queries.ts` — all mid-edit; the failing set shifts between runs). None are catalog files. Re-run `npx tsc --noEmit` once that WIP settles to confirm green.
- Migrations were **not** applied (`npm run db:migrate` would run the unrelated pending ones too).

## Recommended next session
1. **Apply `2026-06-14f`** (deliberately, not via blind `db:migrate`) and **run the backfill** (A).
2. **Wire `useOrderChannelLabel`** across the order surfaces (B) — the deferred order-channel display, now a per-call-site swap.
3. Create a `shipping`-kind "sale" type, then populate `orders.type_id` (B, optional deeper step).

## ⚠ Unrelated pending migrations (do NOT apply as catalog work)
`2026-06-14_fba_fnskus_composite_pk.sql`, `2026-06-14_org_id_phase_b_needs_col.sql`, `2026-06-14_sku_catalog_composite_unique.sql` — these are your concurrent tenancy/FBA/SKU work. Coordinate before `npm run db:migrate` (it applies all pending in order).
