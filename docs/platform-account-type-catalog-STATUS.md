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

**Migrations applied to live DB:** `2026-06-13g_platform_account_type_catalog`, `2026-06-14_org_id_phase_b_domain_children`, `2026-06-14b_catalog_rls`.

**Phase scorecard:** Phase 1 ✅ · Phase 3 ✅ (platform + type) · RLS ✅ · Phase 4 🟡 (CRUD + settings section built; **nav wiring uncommitted**) · Phase 2 ⬜ · Phase 5 ⬜ · Phase 6 ⬜.

---

## ⬜ What's left (in priority order)

### A. Two loose ends — uncommitted in the working tree, entangled with your WIP
1. **`/settings → Platforms & Types` nav wiring.** `SettingsSidebarPanel.tsx` (`SECTIONS` entry + `SettingsSection` union `'catalog'`) and `settings/page.tsx` (`{active === 'catalog' && <CatalogSection/>}`) are edited in the tree but **not committed** (interleaved with your integrations-section WIP). `CatalogSection.tsx` + the manager components ARE committed. Until these two land, `/settings?section=catalog` won't render.
2. **`repairs-queries.ts` org-fix.** `unit_repairs` + `repair_failure_resolutions` inserts need `organization_id` (Phase B made them NOT NULL). The fix (inherit `(SELECT organization_id FROM serial_units/unit_repairs WHERE id=$1)`) is staged in the tree but **not committed** (interleaved with your repair state-machine WIP `appendInventoryEvent`→`transition()`). **Until committed+deployed, the repair-start flow breaks under Phase B.**

### B. Phase 2 — `type_id` FK + backfill + dual-write *(the big one; prereq now met)*
- Migration: nullable `receiving.type_id` + `orders.type_id` → `types(id)`, indexed.
- One-shot backfill (dry-run reports unmapped rows first): `receiving.type_id` from `(intake_type, is_return, return_platform, source_platform)`; `orders.type_id` from `account_source`.
- Dual-write: every writer that sets `source_platform`/`intake_type`/`account_source` also sets `type_id`; keep text columns as cache.
- **Unlocks the deferred order-channel display** (`orders.account_source` → catalog label; ~12+ surfaces — PackerTable, TechTable, OrdersQueueTable, shipped panels, mobile). That account_source work belongs HERE, not Phase 3.

### C. Phase 4 remainder — `platform_accounts` CRUD
- `platform_accounts` table exists but is **empty/unseeded** and has no CRUD API/UI. Seed from `ebay_accounts` + one default account per single-account platform; add `/api/catalog/platform-accounts` + a manager.

### D. Phase 5 — custom types + bindings
- Type editor exposes optional **account binding** (`platform_account_id`) + **`workflow_node_id`** picker (wires to the node-workflow engine — "own repair-service flow").
- `getOrgPlatformAccounts` / `resolveType(orgId, typeId)` getters in `src/lib/catalog/org-catalog.ts` (deferred until accounts + `type_id` exist).

### E. Phase 6 — cleanup (final, gated)
- Drop the `source_platform`/`intake_type` text columns + CHECK constraints once `grep` proves zero readers (per `dead-code-cleanup-waves`).

### F. Tenancy follow-through for the catalog tables
- RLS is **armed, not FORCEd**. Before Phase E FORCE, the catalog CRUD writers (raw `pool` + explicit `organization_id`) must be **GUC-wrapped** (`tenantQuery`/`withTenantConnection`) so the inserted org matches `app.current_org` — same gate as every other table.

---

## Key files / entry points

- **Plan:** `docs/platform-account-type-catalog-plan.md` (the 6-phase design).
- **DB:** `src/lib/migrations/2026-06-13g_platform_account_type_catalog.sql`, `…/2026-06-14b_catalog_rls.sql`.
- **Backend:** `src/lib/neon/catalog-queries.ts` (queries + `seedOrgCatalog`), `src/lib/schemas/catalog.ts`, `src/app/api/catalog/platforms|types/**`, `src/lib/catalog/org-catalog.ts` (cache layer).
- **Client:** `src/lib/queries/catalog-queries.ts`; `src/hooks/useCatalog.ts` → `usePlatformCatalog`, `useReceivingTypeCatalog`, **`usePlatformMeta`** (tone/label resolver), **`useReceivingTypeLabel`**, `useInvalidateCatalog`.
- **UI:** `src/components/receiving/workspace/line-edit/CatalogManagerList.tsx` (shared CRUD list) + `CatalogManagerPopover.tsx` (overlay) + `src/components/settings/sections/CatalogSection.tsx` (settings page) + `LabelEditPopover.tsx` (pencil → manager).
- **Resolver SoT:** `src/lib/source-platform.ts` is still the platform constant SoT (the hook overlays the catalog on top); `src/lib/print/printReceivingLabel.ts` `receivingLabelPlatformDisplay` reads `receivingTypeLabel`.
- **Built-in lists (seed source):** `SOURCE_PLATFORMS` (source-platform.ts), `RECEIVING_TYPE_OPTS` (`src/components/sidebar/receiving/receiving-sidebar-shared.ts`).

## Recommended next session
1. **Land the two loose ends (A)** with the matching WIP commits — especially `repairs-queries.ts` (active prod break).
2. Then **Phase 2 (B)** — biggest value, unblocks order-channel display + Phases 5–6.

## ⚠ Unrelated pending migrations (do NOT apply as catalog work)
`2026-06-14_fba_fnskus_composite_pk.sql`, `2026-06-14_org_id_phase_b_needs_col.sql`, `2026-06-14_sku_catalog_composite_unique.sql` — these are your concurrent tenancy/FBA/SKU work. Coordinate before `npm run db:migrate` (it applies all pending in order).
