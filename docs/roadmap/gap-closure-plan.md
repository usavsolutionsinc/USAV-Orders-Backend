# Gap-Closure Plan — Reaching Best-in-Class for Refurb / Multi-Channel Resale

> Status: Draft v1 · Owner: TBD · Scope: closes the gaps identified in the
> industry comparison (listing/cross-listing, repricing, channel breadth,
> forecasting, Zoho decoupling, data-layer consolidation, refurb compliance).
>
> Framing: this platform is already **tier 3–4** (a custom WMS + refurb ERP).
> Its moat is the receiving → testing → grading → repair → serialized-unit →
> label pipeline. The gaps below are mostly on the **commercial/outbound** side
> (listing, pricing, channels) plus **platform hygiene** (Zoho coupling, data
> layer). The plan deliberately builds shared foundations first so the
> outbound features don't each reinvent a channel/catalog/pricing layer.

## Guiding principles
1. **Build the moat, buy/integrate the commodity.** Keep building refurb/QC.
   For listing/repricing, build a thin engine but lean on channel APIs and
   consider best-of-breed integrations (List Perfectly/Vendoo) as an interim.
2. **One Channel abstraction.** Listing, repricing, channel breadth, and order
   sync all flow through a single `channel_connector` contract — never N
   bespoke integrations.
3. **Serialized truth stays authoritative.** `serial_units` + `inventory_events`
   + `sku_stock_ledger` remain the source of truth; channels are projections.
4. **Event-sourced + idempotent.** Every outbound mutation (publish, reprice,
   relist) is an idempotent job with an audit event, mirroring the existing
   inventory-event pattern.
5. **Anti-corruption at every external edge.** Zoho, eBay, Amazon, etc. sit
   behind adapters that map to internal domain types — no external shape leaks
   into core tables.

---

## Workstream 0 — Platform Foundations (KEYSTONE, do first)

Everything else depends on this. Without it, listing/repricing/channels each
grow their own half-baked connector + price model (the trap that produced the
current Zoho coupling).

### 0.1 Channel Connector framework
A uniform contract every marketplace adapter implements.

```ts
// src/lib/channels/types.ts
interface ChannelConnector {
  key: ChannelKey;                       // 'ebay' | 'amazon' | 'ecwid' | 'walmart' | ...
  capabilities: ChannelCapability[];     // 'list' | 'reprice' | 'orders' | 'inventory' | 'fulfilment'
  // Listings
  publishOffer(offer: InternalOffer, account: ChannelAccount): Promise<ChannelOfferRef>;
  updateOffer(ref: ChannelOfferRef, patch: OfferPatch): Promise<void>;
  endOffer(ref: ChannelOfferRef, reason: EndReason): Promise<void>;
  // Pricing / inventory
  setPrice(ref: ChannelOfferRef, price: Money): Promise<void>;
  setQuantity(ref: ChannelOfferRef, qty: number): Promise<void>;
  // Orders (already exists for eBay — refactor into this)
  pullOrders(account: ChannelAccount, since: Date): Promise<InternalOrder[]>;
}
```

- Adapters live in `src/lib/channels/<key>/`. Refactor existing
  `src/lib/ebay/*`, `src/lib/ecwid/*`, FBA, Square into adapters.
- Capability flags drive UI (don't show "Relist" for a channel that can't).
- A `channel_jobs` queue (QStash-backed, already in stack) runs every outbound
  mutation as a retryable, idempotent job keyed by `client_event_id`.

### 0.2 Integration secrets / credential vault (security must-fix)
- **Current gap (from ops memory): eBay tokens are stored plaintext;
  `INTEGRATION_KMS_KEY` is unset; DRAGON/MEKONG accounts need reauth.** This
  blocks safe channel expansion.
- Build `src/lib/secrets/` — envelope encryption (AES-GCM) keyed by
  `INTEGRATION_KMS_KEY` (KMS/Vercel env), with `readSecret/writeSecret`.
- Migrate `readEbayToken/writeEbayToken` shim onto it; extend to every channel
  account. Add token-health surface (expiry, last-refresh, reauth-needed).

### 0.3 Catalog · Offer · Pricing data model
Today pricing is scattered (`default_price` text, `offer_price`, `price` text).
Introduce a clean model layered on `sku_catalog` (the existing hub).

```sql
-- One row per (sku, channel, account) the SKU is or could be listed on.
CREATE TABLE channel_listings (
  id                BIGSERIAL PRIMARY KEY,
  sku_catalog_id    INTEGER REFERENCES sku_catalog(id) ON DELETE CASCADE,
  serial_unit_id    INTEGER REFERENCES serial_units(id) ON DELETE SET NULL, -- for 1-of-1 refurb units
  channel_key       TEXT NOT NULL,            -- 'ebay' | 'amazon' | ...
  channel_account_id INTEGER,                 -- which connected account
  external_listing_id TEXT,                   -- the marketplace listing/offer id
  status            TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT|QUEUED|ACTIVE|ENDED|ERROR
  condition_grade   TEXT,                     -- mirrors serial_units grade at publish
  title             TEXT,
  list_price        NUMERIC(12,2),
  quantity          INTEGER,
  last_published_at TIMESTAMPTZ,
  last_error        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (channel_key, channel_account_id, external_listing_id)
);

-- Channel-agnostic pricing rules + computed prices (drives repricer).
CREATE TABLE pricing_rules (
  id              BIGSERIAL PRIMARY KEY,
  scope_type      TEXT NOT NULL,   -- 'sku' | 'category' | 'global'
  scope_ref       TEXT,            -- sku / category key
  channel_key     TEXT,            -- null = all channels
  strategy        TEXT NOT NULL,   -- 'fixed' | 'cost_plus' | 'match_buybox' | 'beat_lowest' | 'velocity_curve'
  params          JSONB NOT NULL DEFAULT '{}', -- margins, floor, ceiling, decrement, comp source
  floor_price     NUMERIC(12,2),
  ceiling_price   NUMERIC(12,2),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Append-only price history (audit + analytics), mirrors inventory_events.
CREATE TABLE price_events (
  id              BIGSERIAL PRIMARY KEY,
  channel_listing_id BIGINT REFERENCES channel_listings(id) ON DELETE CASCADE,
  prev_price      NUMERIC(12,2),
  new_price       NUMERIC(12,2),
  reason          TEXT,            -- 'rule:beat_lowest' | 'manual' | 'floor_clamp'
  rule_id         BIGINT REFERENCES pricing_rules(id) ON DELETE SET NULL,
  actor_staff_id  INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- `channel_jobs`, `channel_accounts` tables round out the framework.
- Reuse the **inventory-event discipline**: every publish/reprice writes a
  `price_event` / `channel_job` row with a `client_event_id` for idempotency.

**Effort:** 3–4 eng-weeks. **Unblocks:** WS1, WS2, WS3.

---

## Workstream 1 — Listing & Cross-Listing Engine (largest commercial gap)

**Current state:** eBay integration is **order-sync only** (`syncAccountOrders`,
no Inventory/Offer API). No listing creation, relist, or end-of-life. This is
the #1 revenue lever most eBay resellers optimize first.

**Target:** create, publish, sync, and end listings across channels from the
serialized inventory, with refurb-aware templates (grade, tested-OK, photos).

### Scope
1. **Listing composer** (UI): from a `serial_unit` or `sku_catalog` row →
   draft a listing (title, item-specifics, condition grade, price suggestion,
   photo set from `inventory_photos`, description template). Refurb-specific:
   pull QC results / grade into the description automatically.
2. **eBay Sell API**: implement Inventory + Offer + Fulfillment policies in the
   eBay adapter (`publishOffer/updateOffer/endOffer/setPrice/setQuantity`).
3. **Cross-listing**: one draft → publish to N channels via the connector;
   `channel_listings` tracks each. Quantity sync so a sale on one channel
   ends/decrements the others (critical for 1-of-1 refurb units — prevents
   double-sell).
4. **Lifecycle automation**: unit ships/sold → auto-end sibling listings;
   unit fails QC / RMA'd → auto-end. Driven by `inventory_events` subscriptions.
5. **Templates & item-specifics**: per-category title/aspect templates;
   AI-assisted title/description (Gemini is already in the stack) seeded from
   `sku_catalog` + `product_manuals` + QC data.

### Data / APIs
- Tables: `channel_listings` (WS0), `listing_templates`, `listing_drafts`.
- Routes: `POST /api/listings/draft`, `POST /api/listings/{id}/publish`,
  `POST /api/listings/{id}/end`, `GET /api/listings?status=`,
  `POST /api/listings/{id}/sync`. All permission-gated (`listings.manage`).
- Cron/webhook: marketplace order webhook → mark sold → end siblings.

### Phasing
- **M1**: eBay single-channel publish from a unit + quantity/price sync + auto-end on sale. (Highest ROI; eBay is the primary channel.)
- **M2**: Listing composer UI + templates + AI title/description.
- **M3**: Cross-listing to a 2nd channel (Ecwid/Square already connected) + unified quantity sync.

**Effort:** 8–12 eng-weeks (M1 ~4). **Risk:** eBay business-policy/category
nuance; 1-of-1 oversell race (mitigate with `order_unit_allocations` +
optimistic end). **Interim option:** integrate List Perfectly/Vendoo for
manual cross-listing while M1 ships, to capture revenue sooner.

---

## Workstream 2 — Repricing & Pricing Intelligence

**Current state:** no repricer, no comp/price intelligence. Prices are static
text fields.

**Target:** rule-driven, channel-aware repricing with floors/ceilings, comp
ingestion, and a velocity-based markdown curve for aging refurb stock.

### Scope
1. **Pricing rules engine** (`pricing_rules`, WS0): strategies — `cost_plus`
   (from receiving cost), `match_buybox`/`beat_lowest` (Amazon/eBay comps),
   `velocity_curve` (auto-markdown as a unit ages — ties into existing
   dead-stock/velocity reports).
2. **Comp ingestion**: eBay `getItemSummaries` / Amazon pricing / completed-
   sales data → `price_comps` table; refresh via cron.
3. **Repricer worker**: cron evaluates active `channel_listings` against rules,
   clamps to floor/ceiling, writes `price_events`, dispatches `channel_jobs`
   to `setPrice`. Idempotent; rate-limit aware per channel.
4. **Margin guardrails**: floor derived from landed cost (receiving) + fees +
   target margin; never reprice below floor. Surface margin per listing.
5. **Velocity markdown**: stock aging > N days → step-down price on a curve
   (a major refurb profit/cash-flow lever; reduces dead stock).

### Data / APIs
- Tables: `pricing_rules`, `price_events`, `price_comps` (WS0 + this).
- Routes: `GET/POST /api/pricing/rules`, `POST /api/pricing/simulate`
  (dry-run a rule against current listings), `GET /api/pricing/listings`
  (current vs suggested + margin).
- Cron: `/api/cron/repricer` (per-channel, rate-limited), `/api/cron/comps`.

### Phasing
- **M1**: cost-plus + floor/ceiling + manual-approve repricing (safe).
- **M2**: comp ingestion + match/beat strategies (auto, gated by margin floor).
- **M3**: velocity markdown curve + dead-stock automation.

**Effort:** 6–9 eng-weeks. **Risk:** racing-to-the-bottom (mitigate: hard
floor + approval mode first); marketplace pricing-API rate limits.

---

## Workstream 3 — Channel Breadth Expansion

**Current state:** eBay, Amazon FBA, Ecwid, Square. Missing the high-volume
reseller channels: **Walmart, Etsy, Shopify, Poshmark/Mercari, Facebook/Meta**.

**Target:** add channels as connectors against the WS0 framework — each is now
"just an adapter" implementing the contract, not a new subsystem.

### Approach (priority order by reseller ROI + API maturity)
1. **Walmart Marketplace** — robust API, high AOV, good for refurb electronics.
2. **Shopify** — own-storefront margin; strong API; pairs with existing Ecwid.
3. **Etsy** — if product mix fits (less for electronics; defer/skip).
4. **Poshmark / Mercari / Facebook** — limited/no official listing APIs →
   integrate via **List Perfectly / Vendoo / Flyp** rather than build. Treat
   these as "assisted" channels (push draft → human finishes).
5. **Google/Meta shopping feeds** — feed export (`channel_listings` → feed),
   low effort, demand-gen.

### Pattern per channel
- Adapter `src/lib/channels/<key>/` implementing `ChannelConnector`.
- `channel_accounts` row + OAuth/credentials via the secrets vault (WS0.2).
- Order pull → `InternalOrder` (reuse existing order ingestion).
- Capability flags gate listing/reprice UI per channel.

**Effort:** ~2–3 eng-weeks per API-based channel (Walmart, Shopify) once WS0
exists; assisted channels ~1 week (integration only). **Risk:** per-channel
policy/category mapping; OAuth lifecycle (handled once via vault).

---

## Workstream 4 — Demand Forecasting & Replenishment Intelligence

**Current state:** replenishment exists (`/api/replenish/bulk-create-po`,
FIFO, receiving-lines) + velocity/dead-stock reports. No forecasting.

**Target:** sell-through forecasting → suggested buys/quantities, sourcing ROI,
and aging/liquidation signals. For a sourcing-driven reseller this drives
purchasing decisions and cash flow.

### Scope
1. **Sell-through model**: per-SKU/category velocity from `inventory_events`
   (SHIPPED) + order history. Start statistical (moving average / EWMA +
   seasonality), not ML — cheaper, explainable, good enough.
2. **Forecast tables**: `demand_forecasts` (sku, horizon, predicted_units,
   confidence), refreshed via cron from the event/ledger history.
3. **Replenishment suggestions**: reorder point + safety stock from forecast +
   lead time (receiving data already has PO→receive timing). Feed into the
   existing replenishment PO flow.
4. **Sourcing ROI & liquidation**: rank inventory by margin × velocity; flag
   dead stock for markdown (ties to WS2 velocity curve) or liquidation
   channel. Surface "what to buy more of / stop buying."
5. **Dashboards**: forecast vs actual, sell-through, GMROI, days-of-supply.

### Data / APIs
- Tables: `demand_forecasts`, `replenishment_suggestions`.
- Cron: `/api/cron/forecast` (nightly), reuses `inventory_events` +
  `sku_stock_ledger` (no new instrumentation needed — the event sourcing pays
  off here).
- Routes: `GET /api/forecast/suggestions`, `GET /api/reports/sell-through`.

**Effort:** 5–7 eng-weeks (statistical v1). **Later:** ML upgrade once data
volume justifies. **Risk:** sparse data for 1-of-1 refurb SKUs — forecast at
**category** level, not unique-SKU, for those.

---

## Workstream 5 — Zoho Decoupling / Anti-Corruption Layer

**Current state:** ~2,790 Zoho references; 18 lib files; `ZohoInventoryClient`,
`po-mirror-sync`, webhooks. Zoho is the accounting/inventory backbone and the
single largest external-coupling + sync-complexity surface (source of recurring
sync bugs).

**Target:** isolate Zoho behind a domain-typed anti-corruption layer so core
tables never carry Zoho shapes, sync is observable/idempotent, and Zoho becomes
swappable (or reducible to accounting-only).

### Scope
1. **Define the internal contract**: `Purchase`, `Vendor`, `Item`, `Bill`,
   `StockSync` domain types owned by us, independent of Zoho field names.
2. **Adapter boundary**: all Zoho I/O goes through `src/lib/integrations/zoho/`
   exposing only domain types; map at the edge. Forbid `zoho_*` columns leaking
   into new core tables (lint rule).
3. **Sync as idempotent jobs**: replace ad-hoc sync with a `sync_jobs` table +
   QStash workers (matches WS0 `channel_jobs`); each job idempotent, retryable,
   observable (last-sync, drift, errors).
4. **Drift detection & reconciliation**: scheduled reconcile of stock/PO state;
   surface divergence instead of silently overwriting.
5. **Reduce surface**: evaluate whether Zoho stays as ERP or shrinks to
   accounting-only with our system as inventory system-of-record (we already
   have a superior serialized model).

### Phasing
- **M1**: introduce the adapter boundary + domain types; route NEW code through
  it (stop the bleeding).
- **M2**: migrate `po-mirror-sync` + receiving sync onto `sync_jobs` + drift
  detection.
- **M3**: incrementally strangle direct Zoho calls elsewhere.

**Effort:** 6–10 eng-weeks (incremental; high leverage on reliability). **Risk:**
touching the financial backbone — do behind feature flags + reconciliation
before cutover.

---

## Workstream 6 — Data-Layer Consolidation & Schema Modularization

**Current state:** **187 hand-written SQL migrations** running alongside Drizzle
(dual source of truth), a **~2,000-line monolithic `schema.ts`**, mixed
`pool.query` raw SQL + Drizzle. Classic organic-growth tech debt; raises the
cost of every change above and contributed to the Neon CU-hour pain.

**Target:** single migration source, modular schema, consistent data-access
patterns, lower change-cost.

### Scope
1. **One migration pipeline**: pick Drizzle Kit as canonical going forward;
   freeze the 187 hand-written files as the historical baseline (don't rewrite
   history). New changes → Drizzle migrations only. Document in
   `MIGRATION_GUIDE.md` (already exists — extend).
2. **Modularize schema**: split `schema.ts` into domain files
   (`schema/inventory.ts`, `schema/receiving.ts`, `schema/channels.ts`,
   `schema/people.ts`, …) re-exported from an index. No behavior change.
3. **Data-access conventions**: standardize on repositories (the
   `src/lib/repositories/` pattern already exists for inventory) — wrap raw SQL
   hotspots; reserve raw `pool.query` for performance-critical paths only.
4. **Query-cost guardrails**: extend the Neon-cost discipline — a lint/CI check
   for N+1 and unbounded polling (ties to the existing CU-hour optimization
   work); standardize React Query `staleTime`/`refetchOnWindowFocus` defaults
   (the testing-workspace fix is the template).
5. **Type-safety sweep**: replace ad-hoc `as Record<string,unknown>` casts in
   route handlers with Zod-validated DTOs (Zod already a dep).

**Effort:** 4–6 eng-weeks (mostly mechanical, low risk if done module-by-module
with typecheck gates). **Risk:** low; do incrementally, never big-bang.

---

## Workstream 7 — Refurb Compliance, Grading & Data-Wipe Audit (the differentiator)

**Current state:** strong serialized + QC foundation (`serial_units`,
`qc_check_templates`, `tech_verifications`, `testing_results`, condition grades)
— ahead of SaaS. Missing the **formalized grading scale + compliance/audit**
layer that lets the business sell into higher-trust channels and pursue
certification (R2v3 / RIOS / e-Stewards) — a genuine moat-widener for
electronics refurb.

### Scope
1. **Formal grading rubric**: codify the condition-grade scale (cosmetic +
   functional) with published criteria; bind grade assignment to QC results so
   a grade is *derived and defensible*, not free-typed.
2. **Data sanitization / wipe audit**: capture wipe method (NIST 800-88 clear/
   purge), tool, verification, operator, timestamp per `serial_unit` →
   `data_sanitization_records`. Generate a **Certificate of Data Destruction**
   (PDF) — sellable assurance + compliance requirement.
3. **Chain-of-custody export**: per-unit lifecycle report from `inventory_events`
   (receive → test → grade → wipe → list → ship) — auditable for R2v3.
4. **Compliance dashboards**: wipe coverage, grade distribution, QC pass rates,
   non-conformance tracking (ISO 9001 CAPA-style).
5. **Warranty / return-reason analytics**: feed RMA reasons back into QC to
   tighten test checklists (closed-loop quality).

### Data / APIs
- Tables: `data_sanitization_records`, `grading_rubrics`, `non_conformances`.
- Routes: `POST /api/units/{id}/sanitization`, `GET /api/units/{id}/certificate`
  (PDF), `GET /api/compliance/dashboard`.

**Effort:** 5–7 eng-weeks. **Strategic value: high** — unlocks premium channels,
B2B/government buyers, and certification; competitors can't match it.

---

## Cross-cutting concerns (apply to every workstream)
- **Security**: secrets vault (WS0.2) is a prerequisite for any new channel;
  fix the plaintext-token / unset-KMS gap first. Permission-gate every new
  route via the `permission-registry` (+ the existing route-permission manifest
  test). Remember perms resolve from `staff_roles × roles` — every new role
  needs a `staff_roles` row.
- **Observability**: structured job logs + a `channel_jobs`/`sync_jobs` admin
  surface (status, retries, last error). Don't repeat the "silent catch"
  pattern.
- **Cost (Neon)**: every new cron/poller and React Query usage follows the
  CU-hour discipline (bounded intervals, `refetchOnWindowFocus:false` defaults,
  cache tags). Forecasting/repricer crons must be batched, not per-row.
- **Testing**: schema/route changes get Zod DTOs + the permission manifest test;
  pricing/forecasting get golden-file/simulation tests (dry-run before live).
- **Idempotency**: every outbound mutation carries a `client_event_id`.

---

## Sequenced roadmap

| Phase | Duration | Workstreams | Outcome |
|---|---|---|---|
| **P0 — Foundations** | ~6–8 wks | WS0 (connector + vault + catalog/offer/pricing model), WS6 M1 (migration freeze + module split start) | Security fixed; channel/catalog/pricing platform ready; tech-debt brake engaged |
| **P1 — Revenue engine** | ~8–10 wks | WS1 M1–M2 (eBay publish + composer), WS2 M1 (cost-plus + floors) | Listing creation + safe repricing live on the primary channel |
| **P2 — Scale out** | ~8–10 wks | WS1 M3 (cross-list), WS2 M2–M3 (comps + velocity markdown), WS3 (Walmart/Shopify) | True cross-listing, intelligent repricing, +2 channels |
| **P3 — Intelligence & reliability** | ~8–10 wks | WS4 (forecasting), WS5 M1–M2 (Zoho ACL + sync jobs) | Demand-driven purchasing; Zoho sync reliable/observable |
| **P4 — Moat & compliance** | ~6–8 wks | WS7 (grading + wipe audit + certs), WS5 M3, WS6 finish | Certification-ready differentiation; debt paid down |

Total: roughly **9–12 months** at a small team's pace; each phase ships
independently valuable increments. P0 is non-negotiably first.

## Effort summary

| Workstream | Effort (eng-weeks) | Priority | Depends on |
|---|---|---|---|
| WS0 Foundations | 3–4 (+vault 1–2) | **P0** | — |
| WS1 Listing/Cross-list | 8–12 | **P1** | WS0 |
| WS2 Repricing | 6–9 | P1–P2 | WS0, WS1 |
| WS3 Channel breadth | 2–3 per channel | P2 | WS0, WS1 |
| WS4 Forecasting | 5–7 | P3 | inventory_events (exists) |
| WS5 Zoho decoupling | 6–10 | P3 | — (parallelizable) |
| WS6 Data-layer | 4–6 | P0→ongoing | — |
| WS7 Compliance/grading | 5–7 | P4 | QC foundation (exists) |

## Top risks
1. **Security debt blocks expansion** — plaintext tokens / unset KMS. *Mitigate:* WS0.2 first, before any new channel.
2. **1-of-1 oversell** across channels for refurb units. *Mitigate:* `order_unit_allocations` + optimistic auto-end + quantity sync as a hard invariant.
3. **Repricer race-to-bottom.** *Mitigate:* hard cost-derived floor + approval mode before auto.
4. **Zoho financial-backbone disruption.** *Mitigate:* ACL behind flags + reconciliation before cutover; never big-bang.
5. **Over-building commodity (OMS/shipping/listing) instead of integrating.** *Mitigate:* interim List Perfectly/Vendoo for assisted channels; build only the differentiated parts.

## KPIs to track
- Listing throughput (units listed/day), time-to-list per unit.
- Cross-listed coverage %, oversell incidents (target 0).
- Sell-through rate, days-to-sale, dead-stock %, GMROI.
- Repricing margin protection (% sold above floor), avg margin.
- Forecast accuracy (MAPE) at category level.
- Zoho sync drift incidents / mean-time-to-detect.
- Wipe-coverage %, certificate issuance, QC pass rate, RMA-from-defect rate.
