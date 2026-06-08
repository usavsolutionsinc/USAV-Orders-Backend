# Bose Parts Compatibility + Alternative Sourcing Engine — Implementation Plan

**Status:** Proposed · **Owner:** TBD · **Created:** 2026-06-06

## 1. Problem & Goal

**Challenge 1** — too many repair/refurb jobs dead-end at "part unavailable." When a Bose
unit needs a battery, ear cushion, driver, PCB, or power supply and our shelf stock is
empty (or the SKU is EOL/discontinued), the job stalls. We have no systematic way to (a)
know *which* part a given Bose model needs, (b) get warned *before* a part runs out on a
discontinued line, or (c) quickly find an OEM-equivalent / salvaged unit on the secondary
market and pull it into inventory with cost tracking.

**Goal** — a sourcing engine that turns "unavailable" into "here are 3 sourcing options"
and lets us proactively stock/resell hard-to-find parts:

1. **Compatibility database** — searchable Bose model → compatible-part lookup (by model #,
   model name, or serial-decoded model).
2. **Sourcing alerts** — auto-flag EOL/discontinued SKUs and demand-without-stock conditions.
3. **One-click secondary-market search** — eBay Browse search for OEM-equivalent / for-parts
   units, normalized into candidates with condition + price.
4. **Import to inventory** — pull a candidate into the existing receiving pipeline with
   cost + condition captured for margin/resale tracking.
5. **Supplier/vendor module** — track third-party sources (eBay sellers, distributors,
   salvage) and their candidates.

## 2. What already exists (reuse, don't rebuild)

| Capability | Location | Reuse as |
|---|---|---|
| eBay API client + token refresh | `src/lib/ebay/client.ts`, `src/lib/ebay/token-refresh.ts` | Extend with Browse API for sourcing search |
| eBay credentials (per-tenant + env) | `src/lib/integrations/credentials.ts` (`EbayCredentials`) | `getIntegrationCredentials<EbayCredentials>(orgId,'ebay')` |
| SKU catalog | `sku_catalog` (`src/lib/drizzle/schema.ts`) | Add lifecycle/cost columns; FK target for compatibility |
| SKU relationship graph | `sku_relationships` + `src/lib/neon/sku-relationship-queries.ts` | Pattern reference for the cross-ref CRUD slice |
| CRUD route pattern | `src/app/api/sku-catalog/**` (`withAuth` / `requireRoutePerm`, Zod `parseBody`, idempotency, `recordAudit`) | Template for every new route |
| Permission registry | `src/lib/auth/permission-registry.ts` | Add `sourcing.*` / `supplier.*` |
| Audit vocab | `src/lib/audit-logs.ts` (`AUDIT_ACTION`, `AUDIT_ENTITY`, `recordAudit`) | Add new actions/entities |
| Receiving / inventory intake | `receiveLineUnits()` in `src/lib/receiving/receive-line.ts`; `receiving.source_platform` (already supports `'ebay'`) | Import lands here unchanged |
| Job runtime | `src/lib/jobs/*` + `/api/cron/*` + `/api/qstash/*` + `vercel.json` crons | Nightly sourcing scan |
| Sidebar-mode UI | `SidebarShell`, `src/lib/sidebar-navigation.ts`, `HorizontalButtonSlider`, `AdminSidebarShell`, `AdminPickerRow` | Sourcing mode + admin editors |
| Query factories | `src/queries/keys.ts` (`qk.*`), `src/lib/queries/*` | New `qk.sourcing.*`, `qk.suppliers.*`, `qk.boseModels.*` |
| Row/chip primitives | `RowMetaColumns`, `ChipColumns`, `StatusChip`, `Button` | Result rows, condition/lifecycle chips |

**Important scope clarifications**
- The eBay **MCP** tools in this session (`ebay_search`, `ebay_get_compatibilities_by_specification`,
  etc.) are **dev/backfill-only** — MCP is not available in headless cron. Runtime sourcing
  uses the in-repo `EbayClient`. (eBay's parts-compatibility taxonomy is automotive; **Bose
  compatibility is our own data**, not eBay's.)
- eBay **Browse** search (finding items to *buy*) needs an **application access token**
  (client-credentials grant, scope `https://api.ebay.com/oauth/api_scope`) — distinct from
  the *user* refresh token we already store for order search. This is the one genuinely new
  eBay primitive (see Phase 3, Risk R1).

## 3. Data model (new migrations under `src/lib/migrations/`, raw SQL, date-numbered)

**Tenancy decision (settled in P0):** these tables carry **no `organization_id`** — they
match the `sku_catalog` hub (`sku_catalog` / `sku_platform_ids` / `sku_kit_parts` /
`pending_skus` are all un-scoped), so FK joins stay clean and single-tenant like the rest of
the SKU domain. They get `created_at`/`updated_at` and soft-delete `is_active` where rows must
be preserved for audit. (Per-org eBay *credentials* are still resolved via the integrations
layer at request time — that scoping lives in the creds lookup, not these tables.)

### 3.1 Extend `sku_catalog`
```sql
-- 2026-06-XX_sku_catalog_lifecycle.sql
ALTER TABLE sku_catalog
  ADD COLUMN lifecycle_status text NOT NULL DEFAULT 'active',  -- active|eol|discontinued|nrnd|unknown
  ADD COLUMN reorder_threshold integer,                         -- min on-hand before alert
  ADD COLUMN last_known_cost_cents integer,                     -- rolling acquisition cost
  ADD COLUMN sourcing_notes text;
CREATE INDEX sku_catalog_lifecycle_idx ON sku_catalog (lifecycle_status) WHERE lifecycle_status <> 'active';
```

### 3.2 `bose_models` — model catalog (lookup root)
`id, model_number (unique per org), model_name, family (SoundLink|QuietComfort|Wave|Lifestyle|…),
product_type, release_year, eol_date, image_url, notes, is_active, org, timestamps`.

### 3.3 `bose_serial_prefixes` — optional serial→model decode (stretch, Phase 1.5)
`id, prefix, bose_model_id (FK), notes`. Lets the lookup accept a serial number and resolve
the model. Ships empty; populated opportunistically. Lookup degrades gracefully to model search.

### 3.4 `part_compatibility` — model ↔ part cross-reference (the compatibility DB)
```
id, bose_model_id (FK bose_models), sku_id (FK sku_catalog),
part_role text,        -- battery|ear_cushion|driver|pcb|power_supply|remote|antenna|…
is_oem boolean,
fit text,              -- exact|equivalent|salvage
confidence text,       -- confirmed|likely|unverified
source text,           -- manual|csv_import|ebay
notes, org, timestamps
UNIQUE (bose_model_id, sku_id, part_role)
```
This is **separate** from `sku_relationships` (which is assembly BOM, parent→child). Different
semantics: a part can be compatible with many models and a model needs many part roles.

### 3.5 `suppliers` — vendor module
`id, name, supplier_type (ebay_seller|distributor|salvage|oem|marketplace|other),
email, phone, url, ebay_seller_id (nullable, unique-ish), rating, lead_time_days,
notes, is_active, org, timestamps`.

### 3.6 `sourcing_alerts` — auto-flag queue
```
id, sku_id (FK), bose_model_id (FK nullable),
alert_type text,   -- eol|discontinued|low_stock|demand_no_stock
severity text,     -- info|warn|critical
status text,       -- open|sourcing|resolved|dismissed
reason text, opened_at, resolved_at, resolved_by_staff_id, org
UNIQUE (sku_id, alert_type) WHERE status IN ('open','sourcing')  -- idempotent upsert
```

### 3.7 `sourcing_candidates` — normalized secondary-market hits
```
id, sku_id (FK nullable), bose_model_id (FK nullable),
sourcing_alert_id (FK nullable), supplier_id (FK nullable),
source text,            -- ebay|manual
external_id text,       -- eBay item id
title, url, image_url,
condition text,         -- new|refurbished|used|for_parts
price_cents, shipping_cents, currency,
seller_name,
status text,            -- candidate|watching|ordered|imported|rejected
raw jsonb,              -- full normalized eBay payload
captured_at, org, timestamps
UNIQUE (source, external_id, org)   -- dedupe re-searches
```

### 3.8 `part_acquisitions` — cost/condition ledger (bridge to inventory)
```
id, sourcing_candidate_id (FK nullable), supplier_id (FK nullable),
sku_id (FK), receiving_id (FK nullable), serial_unit_id (FK nullable),
acquisition_cost_cents, shipping_cost_cents, condition,
status text,            -- ordered|received|imported|returned
ordered_at, received_at, org, timestamps
```
Set `serial_unit_id`/`receiving_id` when the unit is unboxed through the normal pipeline.
Feeds margin analysis when the refurb is later resold.

## 4. Permissions (add to `permission-registry.ts`, new category `sourcing`)

```ts
{ id: 'sourcing.view',      category: 'sourcing', label: 'View sourcing & compatibility' },
{ id: 'sourcing.manage',    category: 'sourcing', label: 'Edit compatibility, models & alerts' },
{ id: 'sourcing.search',    category: 'sourcing', label: 'Run secondary-market searches' },
{ id: 'sourcing.import',    category: 'sourcing', label: 'Import a candidate into inventory', destructive: true },
{ id: 'supplier.view',      category: 'sourcing', label: 'View suppliers' },
{ id: 'supplier.manage',    category: 'sourcing', label: 'Manage suppliers' },
```
Per the registry guard, the matching update to `route-permission-manifest.test.ts` ships in
the same change and `audit-route-auth` must stay green.

New audit vocab in `audit-logs.ts`: entities `bose_model`, `part_compatibility`, `supplier`,
`sourcing_alert`, `sourcing_candidate`, `part_acquisition`; actions `*.create|update|delete`
plus `sourcing.search`, `sourcing.candidate.import`, `sourcing.alert.resolve`. `sourcing.import`
goes in `AUDIT_REASON_REQUIRED`.

## 5. API surface (App Router, mirrors `sku-catalog` route conventions)

| Route | Methods | Permission | Notes |
|---|---|---|---|
| `/api/bose-models` | GET, POST | view / manage | search `q`, paginate; idempotent POST |
| `/api/bose-models/[id]` | GET, PATCH, DELETE | view / manage | soft-delete |
| `/api/bose-models/lookup` | GET | view | `?serial=` or `?model=` → resolved model + compatible parts (joined to live stock + lifecycle + open alerts) |
| `/api/part-compatibility` | GET, POST | view / manage | filter by `boseModelId` or `skuId` |
| `/api/part-compatibility/[id]` | PATCH, DELETE | manage | |
| `/api/suppliers` | GET, POST | supplier.view / manage | |
| `/api/suppliers/[id]` | GET, PATCH, DELETE | supplier.view / manage | |
| `/api/sourcing/alerts` | GET, PATCH | view / manage | PATCH = resolve/dismiss (reason required) |
| `/api/sourcing/search` | POST | sourcing.search | eBay Browse proxy; normalize → return (no persist unless `save:true`); rate-limited |
| `/api/sourcing/candidates` | GET, POST | view / manage | POST saves a candidate to watchlist |
| `/api/sourcing/candidates/[id]` | PATCH | manage | status transitions |
| `/api/sourcing/candidates/[id]/import` | POST | sourcing.import | **idempotent**: upsert supplier → create `receiving` (`source_platform='ebay'`) → `part_acquisitions(status='ordered')`; returns receiving id to route into unbox |

Every mutation: `parseBody(zodSchema, raw)` → guard → `Idempotency-Key` support → `recordAudit`.
Zod schemas live in `src/lib/schemas/` (e.g. `bose-model.ts`, `part-compatibility.ts`,
`supplier.ts`, `sourcing.ts`).

## 6. eBay sourcing search (the one new external primitive)

- Add `src/lib/ebay/browse-client.ts`: client-credentials app token (cache + refresh, mirror
  `token-refresh.ts`), calling Browse `item_summary/search` with `q`, `category_ids`,
  `filter=conditions:{NEW|USED|FOR_PARTS_OR_NOT_WORKING},price,deliveryCountry:US`.
- `src/lib/sourcing/normalize.ts`: map eBay item summaries → `sourcing_candidates` shape
  (condition enum mapping, price+shipping cents, seller, image, url, `raw`).
- `src/lib/sourcing/search.ts`: `searchSecondaryMarket({ sku, model, query, conditions })`
  — builds the query (prefer model_number + part_role keywords), calls Browse, normalizes,
  dedupes against existing candidates, logs the call to `ebay_api_calls` (existing audit table).
- Respect quotas: Browse default ~5k calls/day. Cache identical searches briefly; never
  auto-fan-out. (Same discipline as the tracking live-sync USPS-quota approach.)

## 7. Auto-flagging job

- `src/lib/jobs/sourcing-scan.ts` → `runSourcingScanJob()`:
  1. `lifecycle_status IN ('eol','discontinued')` + on-hand ≤ `reorder_threshold` (or 0) → upsert `eol`/`low_stock` alert.
  2. Open repair/refurb demand referencing a compatible SKU with **zero** stock → `demand_no_stock` alert.
  3. Resolve alerts whose condition cleared. Idempotent via the partial unique index (§3.6).
- Route `/api/cron/sourcing/scan` (`isVercelCronOrigin` guard, `maxDuration=300`, structured
  `[cron.sourcing.scan]` log) + nightly entry in `vercel.json` `crons`.
- Optional later: candidate-availability refresh job (re-price watchlist, rate-limited).

## 8. UI

Follows the **sidebar-mode** skill: new features are sidebar MODES (`HorizontalButtonSlider`
+ `?mode=` via `SidebarShell`), search lives in the sidebar (`sidebarHeaderSearchRowClass`),
right pane is visual display.

### 8.1 Dashboard — "Sourcing" page/mode on the SKU-stock surface
Register in `src/lib/sidebar-navigation.ts` with sub-modes:
- **Lookup** — sidebar search by model/serial → `bose-models/lookup`; right pane lists
  compatible parts grouped by `part_role`, each row: `RowMetaColumns` title + `StatusChip`
  stock state + lifecycle badge (EOL/Discontinued) + **"Find on eBay"** `Button`.
- **Alerts** — prioritized open `sourcing_alerts` (critical → warn → info); resolve/dismiss.
- **Watchlist** — saved `sourcing_candidates` with condition/price chips and Import action.

**One-click search UX:** "Find on eBay" → `POST /api/sourcing/search` → results sheet with
condition chips (New / Used / For-parts, reusing chip tones) + price/shipping → per result
**Save to watchlist** or **Import to inventory**. Import → `…/import` → returns a `receiving`
row that drops into the normal unbox flow; on unbox, `part_acquisitions` gets
`serial_unit_id` + condition, and `sku_catalog.last_known_cost_cents` updates.

### 8.2 Admin editors (`ADMIN_SECTION_OPTIONS`, `?section=`)
Three sections via `AdminSidebarShell` + `AdminPickerRow` + `qk.*` factories + mutation/invalidate:
- `?section=bose-models` — model catalog CRUD (+ optional serial-prefix sub-editor).
- `?section=compatibility` — model ↔ part editor (add/remove compatible SKUs per role).
- `?section=suppliers` — supplier CRUD.
- CSV import affordance on compatibility (bulk seed from a spreadsheet) — reuse FBA CSV pattern.

## 9. Phasing

- **Phase 0 — Foundations:** migrations §3.1–3.8, permissions + manifest test, audit vocab,
  Zod schemas, `qk` factories. *Gate: tsc + build green, `audit-route-auth` passes.*
- **Phase 1 — Compatibility DB:** `bose_models` + `part_compatibility` CRUD routes + admin
  editors + `/lookup` + dashboard **Lookup** mode (manual/CSV-seeded data).
- **Phase 1.5 (stretch):** serial-prefix decode.
- **Phase 2 — Lifecycle & alerts:** `sku_catalog` lifecycle field in the catalog editor +
  `runSourcingScanJob` + cron + **Alerts** mode.
- **Phase 3 — eBay sourcing search:** Browse app-token client + `/api/sourcing/search` +
  results sheet + `sourcing_candidates` + **Watchlist** mode.
- **Phase 4 — Import + cost/condition + suppliers:** `…/import`, `part_acquisitions`,
  supplier module, wire into `receiveLineUnits` unbox.
- **Phase 5 — Polish & analytics:** margin view (acquisition cost vs resale), candidate
  re-price job, demand-no-stock heuristics.

## 10. Risks & decisions

- **R1 — eBay Browse token.** Browse needs an app (client-credentials) token, separate from
  the stored user refresh token. *Decision:* add a dedicated cached app-token path; don't
  reuse the order-search user token.
- **R2 — eBay quotas.** Browse ~5k/day. *Decision:* user-initiated search only, short-cache
  identical queries, no auto-fan-out; log to `ebay_api_calls`.
- **R3 — Compatibility data cold-start.** No Bose compatibility dataset exists. *Decision:*
  manual entry + CSV bulk import in Phase 1; optionally MCP-assisted backfill in dev only.
- **R4 — Compatibility vs BOM overlap.** Keep `part_compatibility` distinct from
  `sku_relationships` (different cardinality/semantics); cross-link in UI, not in schema.
- **R5 — Tenancy.** New tables are un-scoped to match the SKU hub (settled in P0). The
  per-org boundary that still matters is eBay **credentials**: `/search` resolves creds per-org
  via `getIntegrationCredentials` at request time.
- **R6 — Import idempotency.** `…/import` keyed on `Idempotency-Key` + `(source,external_id)`
  unique to prevent double receiving rows on retry.

## 11. Out of scope (v1)
Auto-purchasing/checkout on eBay (we capture + import, humans buy), non-Bose brands,
automated price negotiation, predictive demand forecasting.
