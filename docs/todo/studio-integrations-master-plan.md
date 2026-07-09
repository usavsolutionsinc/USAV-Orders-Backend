# Studio Integrations Master Plan — Connection-Driven Ops + Studio-Native Feeds

> **Status:** PLAN (2026-07-01). No implementation started.
>
> **Goal:** Ship the highest-ROI integration stack for **all tenants** — connection-driven
> ingestion, per-tenant credential safety, universal Incoming, label-buying shipping, and
> multi-channel expansion — with every provider surfacing through **Operations Studio**
> (data sources, actions, workflow nodes, diagnostics) instead of one-off settings cards
> and manual sync buttons.
>
> **Audience:** implementers. This is the **execution umbrella** that sequences work already
> specced in sibling docs into one build order with file paths, migrations, exit criteria,
> and Studio wiring checklists.

**Related docs (read before building a workstream)**

| Doc | Role in this plan |
|---|---|
| [integrations-oauth-connection-plan.md](./integrations-oauth-connection-plan.md) | Connector contract, connection-driven sync, entitlement enforcement |
| [nango-additive-integration-plan.md](./nango-additive-integration-plan.md) | Nango sidecar deployment, Shopify/Square recipe |
| [../incoming-universal-purchase-orders-plan.md](../incoming-universal-purchase-orders-plan.md) | Polymorphic Incoming spine, eBay buyer purchases, dedup merge |
| [ops-events-station-workflow-unification-plan.md](./ops-events-station-workflow-unification-plan.md) | `workflow_node_id` on `ops_events` for Live lens |
| [../operations-studio/station-builder-ui-plan.md](../operations-studio/station-builder-ui-plan.md) | Block / data-source / action registries |
| [../operations-studio/operations-studio-plan.md](../operations-studio/operations-studio-plan.md) | Studio laws (lenses, diagnostics, draft/publish) |
| [../integrations/README.md](../integrations/README.md) | Per-provider status index |
| [../integrations/shopify.md](../integrations/shopify.md) | Shopify Nango recipe |
| `.claude/skills/integration-connector/SKILL.md` | Canonical connector implementation steps |
| `.claude/skills/ops-studio/SKILL.md` | Studio layer routing + laws |
| `.claude/rules/polymorphic-tables.md` | DDL contract for Incoming tables |

---

## 0. Executive summary

### 0.1 The problem

Integrations today are **partially built** but **not composable**:

1. **Ingestion is decoupled from connections** — operators click "Import Latest Orders" / backfill buttons; cron sync exists for eBay via the orchestrator but Ecwid/Square/Zoho incoming are still ad-hoc.
2. **Multi-tenant holes** — Zoho tokens partially live in global Upstash KV; env-var fallback is USAV-only transitional.
3. **Incoming is Zoho-only** — eBay buyer purchases are invisible until accounting creates a Zoho PO (documented production blind spot).
4. **Shipping labels are fragmented** — carrier integrations (UPS/FedEx/USPS) do tracking only; ShipStation client exists but is not a tenant-facing integration card or Studio feed.
5. **Studio registries are sparse** — only **3 data sources** and **4 actions** in `src/lib/stations/`; integrations do not auto-surface on the canvas, in station blocks, or in the Gaps lens.

### 0.2 The target

Every integration follows one pattern:

```
Settings connect  →  Connector (auth + sync)  →  Domain tables
                              ↓
                    Station data sources + actions
                              ↓
                    Workflow nodes + diagnostics rules
                              ↓
                    Studio Live / Flow² / Gaps lenses
```

**Build order (do not reorder without cause):**

| Phase | Workstream | Weeks (est.) | Unblocks |
|---|---|---|---|
| **P0** | Platform foundation — sync columns, Zoho per-tenant, entitlements, refresh sweep | 1–2 | Safe multi-tenant + automatic ingestion |
| **P1** | Studio-native layer — integration diagnostics, connector→registry convention, `ops_events` node link | 1–2 | Studio observes integration health |
| **P2** | Universal Incoming + eBay buyer purchases | 2–3 | Receiving spine for all channels |
| **P3** | ShipStation shipping engine | 1–2 | Fulfill node + pack station labels |
| **P4** | Nango sidecar + Shopify + Square | 1 + 1/provider | Multi-channel tenants |
| **P5** | Extend — Amazon/Zendesk/Ecwid station feeds, retire legacy buttons | ongoing | Full catalog parity |

### 0.3 What already exists (do not rebuild)

| Asset | Location | Status |
|---|---|---|
| Encrypted per-tenant vault | `organization_integrations`, `credentials.ts` | ✅ Live |
| Connector registry + types | `src/lib/integrations/connectors/` | ✅ Phase 0 contract shipped |
| Sync orchestrator + cron route | `orchestrator.ts`, `/api/cron/integrations/sync` | ✅ eBay wired |
| Per-provider "Sync now" | `/api/integrations/[provider]/sync` | ✅ Live |
| eBay / Amazon OAuth + sync adapters | `connectors/ebay.ts`, `connectors/amazon.ts` | ✅ Live |
| Nango seam (no sidecar yet) | `nango.ts`, `nango-providers.ts`, `/api/integrations/nango/*` | 🛠 Built, dormant |
| ShipStation v2 client + types | `src/lib/shipping/shipstation/` | 🛠 Lib only, no provider card |
| Station registries | `src/lib/stations/{data-sources,actions,blocks}/` | 🛠 3 sources, 4 actions |
| Workflow engine + ship node | `src/lib/workflow/`, `nodes/ship.node.ts` | ✅ Engine live; ship tap not wired |
| Incoming universal plan (DDL + merge) | `docs/incoming-universal-purchase-orders-plan.md` | 📝 Plan only |
| Zoho KV→vault migration script | `scripts/migrate-zoho-to-vault.ts` | 🛠 Script exists, not run |

---

## 1. Architecture — Studio integration contract

### 1.1 Three hooks per provider

Every provider that touches floor operations MUST implement all three hooks (or explicitly document why one is N/A):

#### Hook A — Connector (behavior SoT)

Registered in `src/lib/integrations/connectors/registry.ts`:

```ts
{
  provider: 'ebay',
  authKind: 'oauth' | 'nango' | 'vault',
  capabilities: ['orders' | 'inventory' | 'tracking' | 'payments' | 'voice'],
  authorizeStartPath?: string,
  healthPath?: string,
  sync?: (orgId) => import('./ebay').then(m => m.ebaySync(orgId)),
  refresh?: …,
  validate?: …,
}
```

**Rules** (from `integration-connector` skill):

- Tokens **only** in `organization_integrations` via `credentials.ts` — no new token homes.
- `orgId` from auth context, never request body.
- Order sync upserts uniform `orders` shape (`account_source`, `sale_amount`, `currency`, `idx_orders_unique_account_order`).
- Incoming sync upserts `receiving_lines` + polymorphic link rows (P2) — never a per-channel queue table.

#### Hook B — Station data sources + actions (composition SoT)

Registered in:

- `src/lib/stations/data-sources.ts` — read feeds wrapping **existing GET routes**
- `src/lib/stations/actions.ts` — mutations wrapping **existing POST/PATCH routes**

Naming convention:

```
<integration>.<feed_name>     — data source id
<integration>.<action_name>   — action id
```

Each data source declares:

- `integration` string matching the connector key (or domain alias: `receiving`, `sourcing`)
- `shape[]` with semantic `FieldKind` (`po_ref`, `order_ref`, `tracking_ref`, …)
- `permission` gating the feed
- `buildUrl(filters)` — never a bespoke query inside the block

Each action declares `appliesTo` field kinds so the Config Sheet only offers compatible mutations.

**Registration pattern (new file per integration cluster):**

```
src/lib/stations/integrations/
  ebay.ts          — registerEbayStationFeeds()
  zoho.ts          — registerZohoStationFeeds()
  shipstation.ts   — registerShipStationStationFeeds()
  index.ts         — registerIntegrationStationFeeds() called from stations/index.ts
```

#### Hook C — Workflow + diagnostics (graph SoT)

- **Workflow nodes** — process steps in `src/lib/workflow/nodes/*.node.ts`; integrations that represent a *step* get a node (e.g. `list-ebay`, `ship`). Data-only integrations (Google Sheets import lane) do not need nodes.
- **Diagnostics rules** — `src/lib/workflow/diagnostics.ts`; new rule family `integration-*`:

| Rule id | Severity | Trigger |
|---|---|---|
| `integration-disconnected` | `error` | Active graph node or station binding references provider X; org has no active connection |
| `integration-sync-stale` | `warning` | Connection `last_synced_at` > `slaHours` (node config or default 24h) |
| `integration-capability-mismatch` | `error` | Node requires `inventory` capability; connection only has `orders` |

Diagnostics receive a new optional input:

```ts
interface DiagnosticsContext {
  // existing graph + station summaries…
  connections: ConnectionStatus[];  // from connectors/connections.ts
}
```

Publish gate (Studio law #6): `integration-disconnected` at `error` severity **blocks publish** when the node's `config.requiredIntegration` is set.

### 1.2 Connector metadata extension

Extend `IntegrationConnector` in `connectors/types.ts`:

```ts
export interface StationFeedMeta {
  /** Data-source ids this connector registers on connect. */
  dataSourceIds: string[];
  /** Action ids this connector registers. */
  actionIds: string[];
  /** Workflow node types that require this provider when present in graph. */
  requiredByNodeTypes?: string[];
}

export interface IntegrationConnector {
  // …existing fields…
  stationFeeds?: StationFeedMeta;
}
```

The Studio Gaps lens and station palette read `stationFeeds` from the connector registry — single source, no duplicated provider→feed maps.

### 1.3 Live lens dependency

`ops_events.workflow_node_id` (companion plan) is required for integration events to light up on **tenant-custom** nodes. Sequence: land P1 diagnostics first with graph-level rules; add `workflow_node_id` in the same phase or immediately after so Live lens shows "3 items stuck at List eBay — eBay disconnected."

---

## 2. Phase P0 — Platform foundation (1–2 weeks)

**Goal:** Every connected provider drives ingestion automatically; Zoho is per-tenant; entitlements enforced. No Studio work yet beyond reading `last_synced_at` on integration cards.

### 2.1 Migration — `organization_integrations` operational columns

**File:** `src/lib/migrations/2026-07-XX_organization_integrations_sync.sql`

```sql
ALTER TABLE organization_integrations
  ADD COLUMN IF NOT EXISTS capabilities  text[]        DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS enabled       boolean       NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS expires_at    timestamptz,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS sync_cursor   jsonb;

CREATE INDEX IF NOT EXISTS idx_org_integrations_expires
  ON organization_integrations (expires_at)
  WHERE expires_at IS NOT NULL AND enabled = true AND status = 'active';
```

**Drizzle:** mirror columns on `organizationIntegrations` in `schema.ts`.

**Domain helpers:** extend `upsertIntegrationCredentials` to accept optional `expiresAt`, `syncCursor`, `lastSyncedAt`; add `touchSyncCursor(orgId, provider, cursor)`.

### 2.2 Zoho per-tenant migration

**Prerequisite:** `INTEGRATION_KMS_KEY` set in prod.

**Steps:**

1. Run `scripts/migrate-zoho-to-vault.ts` against USAV org (dry-run first).
2. Update `src/lib/zoho/client.ts` (and any `zoho-kv.ts` readers) to read **only** from `getIntegrationCredentials(orgId, 'zoho')`.
3. Delete or gate `src/lib/zoho-kv.ts` global KV reads behind `transitionalUsavOrgId()` with a `console.warn` + removal date.
4. Zoho OAuth callback: persist token envelope to vault with `expiresAt`; stop writing Upstash KV.
5. Add `zoho` to `connectors/registry.ts` `sync` when Zoho incoming PO sync is ready (P2); until then `capabilities: ['inventory']` + `validate` only.

**Exit:** second test org connects Zoho; USAV and test org tokens are isolated; no cross-tenant KV reads in hot path.

### 2.3 Unified refresh sweep

**New route:** `src/app/api/cron/integrations/refresh/route.ts`

- Auth: `Bearer ${CRON_SECRET}`
- Query: `organization_integrations WHERE enabled AND status='active' AND expires_at < now() + interval '30 minutes'`
- For each row: `connector.refresh?.(orgId, scope)` → `upsertIntegrationCredentials` with new envelope
- Schedule in `vercel.json`: `0 */6 * * *` (or hourly; coordinate with existing eBay/Amazon refresh crons)

**Phase-out:** once stable, remove dedicated `/api/cron/ebay/refresh` and `/api/cron/amazon/refresh` (or make them thin wrappers).

### 2.4 Entitlement enforcement

**File:** `src/lib/integrations/entitlements.ts` (new)

```ts
export async function assertCanConnect(orgId: OrgId, provider: IntegrationProvider): Promise<void>
export async function countActiveIntegrations(orgId: OrgId): Promise<number>
```

- Call `assertCanConnect` from: OAuth start routes, Nango session mint, vault upsert API.
- Compare against `entitlementsForPlan(plan).maxIntegrations` (`0` = unlimited).
- Return `409 INTEGRATION_LIMIT` with `{ used, max, upgradePlan }`.

**UI:** `src/app/settings/integrations/page.tsx` header — "X of N integrations used" + upgrade CTA.

### 2.5 Connection-driven sync — finish the pilot matrix

| Provider | `sync()` status | Action |
|---|---|---|
| eBay | ✅ wired | Wire `last_synced_at` + `sync_cursor` persistence in `ebaySync` |
| Amazon | ✅ wired | Add to orchestrator cron `?providers=ebay,amazon`; deprecate duplicate cron when stable |
| Square | stub | P4 |
| Ecwid | none | P5 — wrap existing `transfer-orders` logic |
| Zoho | none | P2 — incoming PO sync, not orders table |
| Google Sheets | none | Keep manual import lane; optional `sync()` later |

**Orchestrator enhancement** (`orchestrator.ts`):

- After each successful `sync()`, `UPDATE organization_integrations SET last_synced_at = now(), sync_cursor = $cursor`.
- On failure, `markIntegrationError(orgId, provider, error)`.

**UI:** `IntegrationCard.tsx` — show `lastSyncedAt`, capability badges from connector, "Sync now" button (calls existing `/api/integrations/[provider]/sync`).

### 2.6 Retire ad-hoc buttons (soft)

Keep `OrdersSyncPopover` as fallback behind `INTEGRATIONS_LEGACY_SYNC_BUTTONS=true` env until P0 exit criteria met, then remove in P5.

### P0 exit criteria

- [ ] Migration applied; Drizzle + types updated
- [ ] Zoho tokens per-tenant; KV path dead for prod orgs
- [ ] eBay + Amazon auto-sync on cron; `last_synced_at` visible on cards
- [ ] Trial org blocked at `maxIntegrations` with upgrade CTA
- [ ] Refresh sweep rotates tokens without manual cron per provider
- [ ] `npx tsc --noEmit` clean; route auth audit passes

---

## 3. Phase P1 — Studio-native integration layer (1–2 weeks)

**Goal:** Studio Gaps lens and station builder understand integrations; ops events can anchor to tenant workflow nodes.

### 3.1 Integration diagnostics (v2 rules)

**File:** `src/lib/workflow/diagnostics.ts`

Add rules (pure functions, unit-tested):

```ts
function ruleIntegrationDisconnected(ctx: DiagnosticsContext): Diagnostic[]
function ruleIntegrationSyncStale(ctx: DiagnosticsContext): Diagnostic[]
```

**Node config extension** (`workflow_nodes.config` JSON, no migration):

```ts
interface NodeIntegrationConfig {
  requiredIntegration?: IntegrationProvider;
  requiredCapability?: Capability;
  syncSlaHours?: number;  // default 24
}
```

Seed templates (`src/lib/studio/templates/`) set `requiredIntegration` on `list-ebay`, `ship`, receiving nodes.

**Server:** `/api/studio/graph` diagnostics endpoint loads `listConnections(orgId)` and passes to `runDiagnostics`.

**UI:** Issues rail shows fix link → `/settings/integrations?focus=<provider>`.

### 3.2 Station feed registration convention

**New directory:** `src/lib/stations/integrations/`

**Index wiring** (`src/lib/stations/index.ts`):

```ts
import { registerIntegrationStationFeeds } from './integrations';

export function registerAllStationPrimitives(): void {
  registerBuiltinBlocks();
  registerBuiltinDataSources();
  registerBuiltinActions();
  registerIntegrationStationFeeds();  // NEW
}
```

**Per-provider feed tables (implement incrementally):**

| Provider | Data source id | Wraps | Phase |
|---|---|---|---|
| receiving | `receiving.incoming_expected` | `GET /api/receiving-lines?view=incoming&state=EXPECTED` | P2 |
| receiving | `receiving.awaiting_tracking_pos` | exists ✅ | — |
| ebay | `ebay.open_orders` | `GET /api/orders?account_source=ebay&status=open` (or dedicated route) | P0/P1 |
| zoho | `zoho.open_purchase_orders` | Zoho mirror query route (new thin GET) | P2 |
| shipstation | `shipstation.awaiting_labels` | `GET /api/shipping/awaiting-labels` (new) | P3 |
| shopify | `shopify.open_orders` | orders query filtered | P4 |
| square | `square.recent_orders` | orders query filtered | P4 |
| zendesk | `zendesk.open_warranty_tickets` | existing warranty feed | P5 |

**Actions to add:**

| Action id | Provider | Wraps |
|---|---|---|
| `receiving.attach_tracking` | receiving | exists ✅ |
| `ebay.sync_now` | ebay | `POST /api/integrations/ebay/sync` |
| `shipstation.buy_label` | shipstation | `POST /api/shipping/labels` (P3) |
| `incoming.merge_duplicate_po` | receiving | merge route from P2 |

### 3.3 `ops_events.workflow_node_id` (companion plan — P1 slice)

**Migration:** `src/lib/migrations/2026-07-XX_ops_events_workflow_node_id.sql`

```sql
ALTER TABLE ops_events
  ADD COLUMN IF NOT EXISTS workflow_node_id text REFERENCES workflow_nodes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ops_events_org_node
  ON ops_events (organization_id, workflow_node_id, created_at DESC)
  WHERE workflow_node_id IS NOT NULL;
```

**Emitters to update (incremental):**

- `src/lib/receiving/record-scan.ts` — resolve active graph node for receiving station
- `src/lib/pack/` ship mutation — set node id for `ship` type
- Integration sync completion — optional `ops_events` row `event_type = 'integration.sync_completed'`

**Studio Live lens:** subscribe to `ops_events` db-events channel filtered by `workflow_node_id` (extend existing Ably subscription in `useStudioLensState`).

### 3.4 Studio sidebar — integration palette section

**File:** `src/components/studio/StudioSidebarPanel.tsx` (or sidebar section registry)

When lens = Build and depth = L2 (station detail):

- **Sources** section lists `listDataSourceMeta()` filtered to integrations referenced by the focused node's `station_definitions.config`.
- Disconnected source shows amber chip + link to settings.

Do **not** build a separate integrations page under `/admin` (Studio law #1).

### P1 exit criteria

- [ ] Graph with `list-ebay` node shows `integration-disconnected` error when eBay not connected
- [ ] Publish blocked when error-severity integration diagnostic present
- [ ] At least **2 new data sources** (`ebay.open_orders`, `receiving.incoming_expected` stub) registered
- [ ] `workflow_node_id` column live; at least one emitter (receiving scan) populates it
- [ ] Unit tests for new diagnostic rules in `diagnostics.test.ts`

---

## 4. Phase P2 — Universal Incoming + eBay buyer (2–3 weeks)

**Goal:** `receiving_lines` is the universal Incoming spine; eBay buyer purchases appear before Zoho PO; dedup merge when Zoho catches up.

> **Canonical DDL and merge algorithm:** `docs/incoming-universal-purchase-orders-plan.md`.
> This section sequences that plan against P0/P1 and adds Studio wiring only.

### 4.1 Database (P2a — polymorphic spine)

Execute migrations from universal incoming plan §3 (in order):

1. `inbound_purchase_order_links`
2. `inbound_purchase_order_mirror` (generalize from `zoho_po_mirror`)
3. `inbound_purchase_order_equivalence`
4. `receiving_line_facts` kind `ebay_purchase` (if not already registered)
5. Spine cache columns on `receiving_lines` (`inbound_source_type`, …) — dual-write period

Each migration: `enforce_tenant_isolation`, Drizzle model, registry entry in `src/lib/inbound/source-registry.ts`.

### 4.2 Zoho incoming sync adapter (P2b)

**New:** `src/lib/integrations/connectors/zoho-incoming.ts`

- `zohoIncomingSync(orgId)` — pulls open POs → upsert spine + links + mirror (existing `zoho-receiving-sync` logic extracted)
- Wire as `zoho.sync` OR separate capability `inventory` + dedicated cron resource `zoho_incoming`
- Incremental via `sync_cursor.po_modified_since`

### 4.3 eBay buyer purchase connector (P2c)

**OAuth extension:**

- New scope set on eBay connect: buyer purchase read (document exact scope in `docs/integrations/ebay-connect.md` addendum)
- May require separate eBay account linkage row or `scope` on `ebay_accounts` distinguishing seller vs buyer

**New:** `src/lib/integrations/connectors/ebay-buyer.ts`

- `ebayBuyerPurchaseSync(orgId)` — fetch purchase orders → upsert `receiving_lines` + `inbound_purchase_order_links` (`source_type='ebay'`) + `receiving_line_facts` (`fact_kind='ebay_purchase'`)
- Per `platform_account_id` when multiple buyer accounts

**Cron:** `/api/cron/integrations/sync?providers=ebay_buyer` or extend eBay connector with `capabilities: ['orders', 'purchases']`

### 4.4 Dedup merge service (P2d)

**New:** `src/lib/receiving/inbound-merge.ts`

- `linkEquivalentPurchases(orgId, opts)` — when Zoho PO mirror matches eBay order# / tracking / SKU qty, merge rows per universal plan §4
- Emit `ops_events` + `recordAudit` on merge
- Idempotent via `client_event_id`

**Trigger:** end of `zohoIncomingSync` and on manual "Link PO" station action.

### 4.5 Incoming API + UI reader cutover (P2e)

- `GET /api/receiving-lines?view=incoming` — filter on spine queue predicate from universal plan (not `zoho_purchaseorder_id IS NOT NULL` alone)
- Badge `inbound_source_type` on rows (Zoho / eBay / Manual chips via `source-platform.ts` pattern)

### 4.6 Studio wiring (P2f)

**Data sources:**

```ts
// src/lib/stations/integrations/receiving.ts
registerDataSource({
  id: 'receiving.incoming_expected',
  label: 'Expected incoming (all sources)',
  integration: 'receiving',
  endpoint: '/api/receiving-lines',
  buildUrl: () => '/api/receiving-lines?view=incoming&state=EXPECTED&limit=50',
  shape: [
    { key: 'po_number', label: 'PO / Order #', kind: 'po_ref' },
    { key: 'inbound_source_type', label: 'Source', kind: 'source_platform' },
    { key: 'vendor_name', label: 'Vendor', kind: 'text' },
    { key: 'sku', label: 'SKU', kind: 'sku_ref' },
  ],
  permission: 'receiving.view',
});

registerDataSource({
  id: 'receiving.incoming_ebay_only',
  label: 'eBay purchases awaiting Zoho PO',
  integration: 'ebay',
  buildUrl: () => '/api/receiving-lines?view=incoming&source=ebay&limit=50',
  // …
});
```

**Diagnostics:**

- `integration-disconnected` for `requiredIntegration: 'ebay'` on Incoming nodes when buyer sync enabled in node config

**Workflow template:** update default receiving graph in `src/lib/studio/templates/` to include Incoming → Unbox edge with `requiredIntegration: 'zoho'` on accounting step only, not on visibility step.

### P2 exit criteria

- [ ] eBay purchase creates `receiving_lines` row within 15 min of connect + cron
- [ ] Zoho PO created later merges into same row (manual test script)
- [ ] Incoming page shows eBay-only rows with correct badge
- [ ] Station Checklist can bind `receiving.incoming_expected`
- [ ] No duplicate Incoming rows for same physical shipment in acceptance test
- [ ] All new tables have RLS policies (coordinate with `phase-1-rls-plan.md` if landed)

---

## 5. Phase P3 — ShipStation shipping engine (1–2 weeks)

**Goal:** Tenants connect ShipStation API key; pack station buys labels in-app; `ship` workflow node fires on label purchase; tracking flows back to orders.

### 5.1 Provider registration

**`IntegrationProvider`:** add `'shipstation'`

**Vault payload:**

```ts
interface ShipStationCredentials {
  apiKey: string;
  /** Optional v1 API key if different from v2 */
  v1ApiKey?: string;
}
```

**Connector** (`connectors/registry.ts`):

```ts
shipstation: {
  provider: 'shipstation',
  authKind: 'vault',
  capabilities: ['tracking'],  // labels are actions, not cron sync
  healthPath: '/api/integrations/shipstation/health',
  validate: (orgId) => import('./shipstation').then(m => m.validateShipStation(orgId)),
},
```

**Display catalog** (`registry.ts`): category **Shipping carriers**, `connect: 'vault'`, paste API key UI.

### 5.2 Config + client wiring

**New:** `src/lib/shipping/shipstation/config.ts`

- `getShipStationClient(orgId)` — reads vault, returns configured `ShipStationClient`
- Reuse existing `client.ts` (credential-injected — no changes to core client)

**Health route:** `GET /api/integrations/shipstation/health` — list carriers call.

### 5.3 Label purchase API

**New routes:**

| Route | Purpose |
|---|---|
| `POST /api/shipping/rates` | Rate shop from `ShipmentSpec` |
| `POST /api/shipping/labels` | Buy label from rate id |
| `POST /api/shipping/labels/[id]/void` | Void label |
| `GET /api/shipping/awaiting-labels` | Orders ready to ship (station feed) |

All routes: `withAuth`, permissions `shipping.manage` or `pack.scan`, `withTenantTransaction`.

**Wire ship node:** in label purchase success handler:

```ts
await tapWorkflow({
  serialUnitId,
  event: 'shipped',
  data: { trackingNumber },
  workflowNodeId: resolvedShipNodeId,
});
```

### 5.4 Station feeds + actions

```ts
// src/lib/stations/integrations/shipstation.ts
registerDataSource({ id: 'shipstation.awaiting_labels', … });
registerAction({
  id: 'shipstation.buy_label',
  label: 'Buy label',
  integration: 'shipstation',
  appliesTo: ['order_ref'],
  endpoint: { method: 'POST', path: '/api/shipping/labels' },
  permission: 'shipping.manage',
});
```

Pack station template: Checklist on `shipstation.awaiting_labels` + row action buy label.

### 5.5 Diagnostics

- `integration-disconnected` when graph has `ship` node and no `shipstation` vault row
- Optional `warning` when ShipStation connected but no carriers returned from health

### 5.6 Tracking write-back

On label purchase: update `shipments` + `orders.tracking_number`; enqueue carrier tracking subscription if UPS/FedEx/USPS connected.

### P3 exit criteria

- [ ] Tenant pastes API key → health green → rates returned for test order
- [ ] Label PDF downloads; tracking number on order row
- [ ] `ship` node advance fires; Live lens shows item exiting fulfill
- [ ] Studio Gaps clear when ShipStation connected
- [ ] USAV env `SHIPSTATION_API_KEY` fallback deprecated behind org vault

---

## 6. Phase P4 — Nango sidecar + Shopify + Square (1 week infra + 1 week/provider)

**Goal:** Deploy Nango once; onboard Shopify and Square with connection-driven order sync and Studio feeds.

### 6.1 Nango sidecar deployment

Follow `nango-additive-integration-plan.md` Option B:

1. Provision Postgres branch for Nango storage
2. Deploy `nango-server` + Redis (Fly.io / Render / Docker — not Vercel)
3. Set env: `NANGO_HOST`, `NANGO_SECRET_KEY`, `NANGO_PUBLIC_KEY` on Vercel
4. Verify `isNangoConfigured()` true in prod

**Acceptance:** Square connect UI opens; connection id `org_<uuid>` visible in Nango dashboard.

### 6.2 Square (pilot completion)

Already stubbed in `connectors/square.ts` + `nango-providers.ts`.

- [ ] Enable `NANGO_BACKED_PROVIDERS.square = 'squareup'`
- [ ] Confirm `squareSync` writes `orders` rows
- [ ] Add `square.recent_orders` data source
- [ ] Cron: `?providers=ebay,amazon,square`

### 6.3 Shopify

Follow `docs/integrations/shopify.md` checklist exactly.

Additional Studio wiring:

- `shopify.open_orders` data source
- Workflow template node `list-shopify` with `requiredIntegration: 'shopify'`
- `SOURCE_PLATFORMS` entry

### P4 exit criteria

- [ ] Two test orgs connect Shopify + Square independently
- [ ] Orders appear within one cron cycle
- [ ] Studio diagnostics fire when Shopify node present but disconnected
- [ ] Each counts against `maxIntegrations`

---

## 7. Phase P5 — Extend + retire legacy (ongoing)

### 7.1 Provider parity matrix

| Provider | Connector sync | Station sources | Studio node | Priority |
|---|---|---|---|---|
| Amazon | ✅ orders | `amazon.open_orders`, FBA feed | `list-amazon` | Medium |
| Ecwid | wrap transfer | `ecwid.open_orders` | — | Medium |
| Zendesk | — | `zendesk.warranty_open` | `returns` context | Low |
| Google Sheets | optional | keep import lane | — | Low |
| Carriers | tracking only | `shipments.in_transit` | — | Low |

### 7.2 Legacy removal

- Remove `OrdersSyncPopover` transfer/backfill buttons
- Remove USAV env fallback from `credentials.ts` (feature flag per org migration)
- Consolidate Amazon dedicated cron into orchestrator
- Delete `src/lib/zoho-kv.ts` when KV empty

### 7.3 Platform accounts wiring

When `platform-account-type-catalog-plan.md` lands, map each connection → `platform_accounts` row so `inbound_source_type` badges and order chips share one account id space.

---

## 8. Cross-cutting requirements

### 8.1 Multi-tenancy

Every new query/mutation:

- `withTenantTransaction(orgId, …)` or `tenantQuery`
- RLS policies on new tables (coordinate `phase-1-rls-plan.md`)
- Cron routes iterate orgs via `connectedOrgsForProvider` — never global queries without org filter

### 8.2 Permissions

New permissions (add to `permission-registry.ts` + manifest test):

| Permission | Routes |
|---|---|
| `integrations.shipstation` | connect, health, label routes |
| `integrations.shopify` | Nango session (if not covered by `integrations.manage`) |
| `shipping.manage` | rate/label purchase |

### 8.3 Audit + idempotency

- Connection connect/disconnect/sync: `recordAudit()` with `AUDIT_ACTION` constants
- Sync adapters: idempotent upserts; use `client_event_id` on merge/link mutations
- Never log tokens in audit `extra`

### 8.4 Observability

- Structured log per sync: `{ orgId, provider, imported, updated, durationMs, error? }`
- `markIntegrationError` on sync failure; clear on success
- Studio Flow²: optional `workflow_node_stats` dimension `integration_blocked_count` (future)

### 8.5 Testing

| Layer | What to test |
|---|---|
| Unit | `diagnostics` integration rules; merge logic; connector sync with mocked fetch |
| Integration | OAuth callback state decryption; vault round-trip |
| E2E | `tests/e2e/receive-to-zoho.spec.ts` pattern — extend for eBay buyer → Incoming |
| Manual | Studio publish blocked without eBay; label buy on staging ShipStation sandbox |

### 8.6 Feature flags

| Flag | Purpose |
|---|---|
| `STUDIO_ENTITLEMENT_ENFORCED` | existing studio gate |
| `INCOMING_UNIVERSAL_ENABLED` | per-org rollout of P2 reader cutover |
| `INTEGRATIONS_LEGACY_SYNC_BUTTONS` | P0 fallback for popover buttons |
| `isNangoConfigured()` | Nango cards hidden when false |

---

## 9. File touch index (master checklist)

### New files (expected)

```
src/lib/migrations/2026-07-XX_organization_integrations_sync.sql
src/lib/migrations/2026-07-XX_ops_events_workflow_node_id.sql
src/lib/migrations/2026-07-XX_inbound_purchase_order_links.sql   (per universal plan)
src/lib/integrations/entitlements.ts
src/lib/integrations/connectors/zoho-incoming.ts
src/lib/integrations/connectors/ebay-buyer.ts
src/lib/integrations/connectors/shipstation.ts
src/lib/integrations/connectors/shopify.ts
src/lib/receiving/inbound-merge.ts
src/lib/inbound/source-registry.ts
src/lib/stations/integrations/{index,ebay,zoho,receiving,shipstation,shopify,square}.ts
src/lib/shipping/shipstation/config.ts
src/app/api/cron/integrations/refresh/route.ts
src/app/api/integrations/shipstation/health/route.ts
src/app/api/shipping/{rates,labels,awaiting-labels}/route.ts
```

### Modified files (expected)

```
src/lib/integrations/connectors/registry.ts
src/lib/integrations/credentials.ts                    (shipstation, shopify providers)
src/lib/integrations/connectors/orchestrator.ts        (last_synced_at writes)
src/lib/workflow/diagnostics.ts                        (integration rules)
src/lib/stations/index.ts
src/lib/zoho/client.ts                                 (vault-only tokens)
src/app/settings/integrations/{registry,IntegrationCard,page}.tsx
src/components/studio/*                                (Issues rail fix links, source palette)
vercel.json                                            (cron schedules)
src/lib/auth/permission-registry.ts
src/lib/auth/route-permission-manifest.test.ts
```

---

## 10. Risks & dependencies

| Risk | Mitigation |
|---|---|
| Zoho KV migration breaks USAV prod | Dry-run script; dual-read period; rollback = restore KV write |
| eBay buyer scope approval delayed | Ship P2a–b (Zoho universal spine) without P2c; feature-flag eBay buyer |
| Nango sidecar ops burden | Start with Square pilot only; Shopify after 2 weeks stable |
| ShipStation API key in vault — user error | Validate on upsert; health check before save |
| RLS not enforced | Do not onboard stranger tenants until `phase-1-rls-plan.md` Phase 1 or accept risk explicitly |
| Studio publish gate too aggressive | `integration-sync-stale` = warning only; disconnected = error |
| Neon CU cost from sync cron | Incremental cursors; `MAX_PAGES` caps; stagger provider cron offsets |

**Hard dependency:** `INTEGRATION_KMS_KEY` in production before any new tenant connects integrations.

**Soft dependency:** `phase-1-rls-plan.md` before GA multi-tenant; P0–P3 can proceed on staging with RLS flagged.

---

## 11. Success metrics (90 days post-P4)

| Metric | Target |
|---|---|
| % orders ingested via cron vs manual button | > 95% |
| Incoming rows with `inbound_source_type != 'zoho'` | > 0 for eBay-buyer tenants |
| Median time eBay purchase → Incoming row | < 30 min |
| Studio graphs with integration diagnostics | 100% of templates with `requiredIntegration` |
| Label purchase without leaving pack station | enabled for ShipStation tenants |
| Second-tenant Zoho isolation | verified penetration test |

---

## 12. Implementation checklist (copy per PR)

Every integration PR must confirm:

- [ ] Provider in `IntegrationProvider` union + `CONNECTORS` record (compile gate)
- [ ] Display card in `PROVIDER_CATALOG` (if customer-facing)
- [ ] Tokens only via `credentials.ts`
- [ ] `sync()` or explicit N/A documented
- [ ] Data sources + actions registered in `src/lib/stations/integrations/`
- [ ] `stationFeeds` metadata on connector
- [ ] Diagnostics rule if graph/station depends on provider
- [ ] Permissions in registry + manifest test
- [ ] Org-scoped queries; audit on connect/disconnect
- [ ] Docs row in `docs/integrations/README.md`
- [ ] No new `/admin` integration UI — Settings + Studio only
