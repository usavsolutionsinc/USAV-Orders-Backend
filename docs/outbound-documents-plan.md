# Outbound Documents — Packing Slips & Shipping Labels

**Status:** Planned (not started)  
**Created:** 2026-07-01  
**Last ground-truthed:** 2026-07-01 (verified against `main`)  
**Owner:** TBD  
**Related:** [media-library-modernization-plan.md](./media-library-modernization-plan.md), [platform-account-type-catalog-plan.md](./todo/platform-account-type-catalog-plan.md), [multi-tracking-po-plan.md](./partial/multi-tracking-po-plan.md) (STN / `shipment_links` SoT)

> **How to read this doc.** Each phase has a **Reality check** block stating what already
> exists on `main`, so you build the delta, not a duplicate. Decisions marked **LOCKED**
> came from the 2026-07-01 design interview.

---

## 1. Vision & goals

### Vision

Give outbound staff a **single, durable document layer** for marketplace packing slips and
carrier shipping labels — linked correctly to **orders** and **shipments** (STN), browsable
from **Outbound** and the **Media Library**, with marketplace PDFs fetched server-side and
stored for reprint/audit.

### Primary goals

| Goal | Success looks like |
|------|-------------------|
| **Correct linkage** | Every label has `SHIPMENT` (STN) + `ORDER` links; slips have at least `ORDER`, optionally `SHIPMENT` |
| **Multi-box safe** | Split orders with multiple `shipment_links` rows attach the right label to the right STN |
| **Marketplace fetch** | Opening an Amazon/eBay order can pull slip + label PDFs without manual download |
| **Discoverability** | Staff find docs from Outbound order panel **and** Media Library `outbound` scope |
| **Migration-safe** | Existing NAS-attached labels keep working; backfill adds STN links |

### Non-goals (initial rollout)

- Replacing pack-station **photos** (`photos` + `PACKER_LOG`) — those stay photographic evidence
- Adding `packing_slip` / `shipping_label` to `photo_image_types` (document roles ≠ image types)
- Full DAM for arbitrary file types (Phase 4 media library scope)
- Platform catalog FK (`orders.type_id`) as a hard dependency — use `account_source` first
- Auto-print workflows (fetch + attach only; print is a follow-on button)

---

## 2. Decisions **LOCKED**

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Storage model | **`documents` table only** | Labels are already PDF/PNG on NAS; not raster photos |
| D2 | Packing slip granularity | **Both ORDER and SHIPMENT** | Marketplace varies; link to whichever entity the API returns |
| D3 | Shipping label linkage | **STN primary, ORDER secondary** | 1 label = 1 tracking number; order queue stays fast |
| D4 | Document source (v1) | **Marketplace fetch** (+ manual upload fallback) | Primary creation path; NAS drop for gaps |
| D5 | UI surfaces | **Outbound panel + Media Library** | Both day-to-day triage and historical search |
| D6 | Legacy label migration | **Dual-link backfill** | Keep ORDER link; add `SHIPMENT` when resolvable |
| D7 | Media type naming | **`document_type` enum**, not `photo_image_types` | Honest taxonomy; library filters on `document_type` |

### Label linkage — read resolution order

```
1. document_entity_links WHERE entity_type = 'SHIPMENT' AND entity_id = stn.id
2. document_entity_links WHERE entity_type = 'ORDER' AND entity_id = orders.id
3. Legacy: documents WHERE entity_type = 'SHIPPING_LABEL' AND entity_id = orders.id
   (retired after backfill + bake)
```

---

## 3. Current state inventory (ground-truthed)

### 3.1 Shipment / tracking SoT

| Artifact | Role | Verified location |
|----------|------|-------------------|
| `shipping_tracking_numbers` | Canonical tracking row (`id`, normalized number, carrier, poll state) | Baseline + STN consolidation migrations |
| `shipment_links` | Polymorphic ORDER \| RECEIVING ↔ STN; many boxes per owner | `src/lib/shipping/shipment-links.ts`, schema L1083–1115 |
| `orders.shipment_id` | Denormalized **primary** STN cache | `schema.ts` L923–924 |
| `packer_logs.shipment_id` | Pack scan → STN | `schema.ts` L963–964 |

### 3.2 Documents today

| Fact | Detail |
|------|--------|
| Table | `documents` — `entity_type`, `entity_id`, `document_type`, `document_data` JSONB |
| `organization_id` | Present on INSERT from `order-labels` route; tenant isolation enforced (`2026-06-22e`) |
| Shipping labels | `entity_type = 'SHIPPING_LABEL'`, `entity_id = orders.id`, `document_type = 'shipping_label'` |
| Storage | NAS WebDAV — browser PUT, server stores URL only (`src/app/api/order-labels/route.ts`) |
| UI | `OrderLabelsSection` in `ShippedDetailsPanel` / Outbound Labels context |
| **Smell** | `entity_type` misused as document kind (`SHIPPING_LABEL`) instead of owner (`ORDER`) |

### 3.3 Photos / media library (orthogonal)

| Fact | Detail |
|------|--------|
| Pack photos | `photo_entity_links` → `PACKER_LOG`; built-in library scope `packing` |
| Link hub | `photo_entity_links` — mirror pattern for documents (`2026-06-18_photos_platform_side_tables.sql`) |
| Image types | `photo_image_types` — custom raster types; **not** for PDF slips/labels |
| Library filters | `library-filter-state.ts` — `sourceScope`, `imageType`, business-ID filters via links |
| Saved views | `media_library_saved_views` + hooks shipped (in-flight on `main`) |

### 3.4 Outbound UI

| File | Role |
|------|------|
| `src/app/outbound/page.tsx` | Route shell |
| `src/components/outbound/OutboundWorkspace.tsx` | Labels queue + Scan-out modes |
| `src/components/outbound/labels/LabelsOrderWorkspace.tsx` | Right pane → `ShippedDetailsPanel` context `labels` |
| `src/components/shipped/OrderLabelsSection.tsx` | Label drop zone + list |

### 3.5 Marketplace integrations (fetch prerequisites)

| Platform | Existing client | Notes for documents |
|----------|-----------------|---------------------|
| eBay | `EbayClient.getOrderShippingFulfillments()` | Fulfillment API; label PDF availability varies |
| Amazon | SP-API modules under `src/lib/` | Needs Orders API + shipping label / document endpoints per MFN flow |
| ECWID | `src/lib/ecwid/` | Order export; slip generation may be internal |
| Walmart | Limited | Phase 2+ adapter |
| Zoho | `sales_orders` sync | Packing slip from Zoho SO PDF is an alternate source |

---

## 4. Target data model

### 4.1 New table: `document_entity_links`

Mirror `photo_entity_links` — many links per document, explicit org scope.

```sql
CREATE TABLE document_entity_links (
  id              BIGSERIAL PRIMARY KEY,
  document_id     INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  entity_type     TEXT NOT NULL,   -- 'ORDER' | 'SHIPMENT'
  entity_id       BIGINT NOT NULL, -- orders.id | shipping_tracking_numbers.id
  link_role       TEXT NOT NULL DEFAULT 'primary',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_document_entity_links_entity_type
    CHECK (entity_type IN ('ORDER', 'SHIPMENT')),
  CONSTRAINT chk_document_entity_links_link_role
    CHECK (link_role IN ('primary', 'secondary')),
  CONSTRAINT ux_document_entity_links_unique
    UNIQUE (document_id, entity_type, entity_id, link_role)
);

CREATE INDEX idx_document_entity_links_entity
  ON document_entity_links (organization_id, entity_type, entity_id);

CREATE INDEX idx_document_entity_links_document
  ON document_entity_links (document_id);
```

**Notes**

- `SHIPMENT` entity_id = `shipping_tracking_numbers.id` (same bigint as `shipment_id` FKs).
- `link_role = 'primary'` on STN for labels; `secondary` on ORDER (or vice versa for slips
  when order-anchored — writers must be consistent; readers use resolution order in §2).
- Apply `enforce_tenant_isolation('document_entity_links')` when infra present.

### 4.2 `documents` row shape (normalized)

| Column | Outbound docs value |
|--------|---------------------|
| `entity_type` | **`ORDER`** (legacy repair rows keep `REPAIR`, etc.) |
| `entity_id` | `orders.id` (primary owner for tenancy gate + cascade policy) |
| `document_type` | `shipping_label` \| `packing_slip` |
| `document_data` | See §4.3 |
| `organization_id` | Required on every row |

Legacy `entity_type = 'SHIPPING_LABEL'` rows are backfilled then stop being written.

### 4.3 `document_data` contract

```typescript
interface OutboundDocumentData {
  /** Resolved storage URL (NAS, GCS, or signed proxy path) */
  url: string;
  /** amazon | ebay | ecwid | walmart | fba | generated | manual */
  platform: string;
  /** marketplace_api | manual_upload | generated | zoho_export */
  source: string;
  /** Dedupe key: hash(platform + orderRef + document_type + stnId?) */
  sourceHash?: string;
  mimeType?: string;          // application/pdf | image/png
  carrier?: string | null;
  tracking?: string | null;   // denorm for display; SoT is STN
  marketplaceOrderId?: string;
  fetchedAt?: string;         // ISO
  uploadedBy?: number;          // staff id
  filename?: string;
  error?: string;             // last fetch failure (optional)
}
```

### 4.4 Entity relationship diagram

```
                    ┌─────────────────┐
                    │     orders      │
                    │  id, order_id   │
                    │  shipment_id ───┼──┐ (primary STN cache)
                    └────────┬────────┘  │
                             │           │
              document_entity_links       │
              (ORDER, order.id)           │
                             │           ▼
                    ┌────────┴────────┐  ┌──────────────────────────┐
                    │   documents     │  │ shipping_tracking_numbers │
                    │ document_type   │  │  id, tracking_number_*   │
                    │ document_data   │  └────────────┬─────────────┘
                    └────────┬────────┘               │
                             │            document_entity_links
                             │            (SHIPMENT, stn.id)
                             │                         │
                    ┌────────┴─────────────────────────┴────────┐
                    │           shipment_links                   │
                    │  owner_type=ORDER, owner_id=orders.id      │
                    │  shipment_id → STN                         │
                    └────────────────────────────────────────────┘
```

### 4.5 Write rules (domain SoT: `src/lib/documents/`)

**Attach / fetch shipping label**

1. Resolve `order` (tenant-scoped).
2. Resolve or create STN for tracking (reuse `resolveShipmentId` / STN registration helpers).
3. `linkShipment(org, { ownerType: 'ORDER', ownerId, shipmentId, direction: 'OUTBOUND' })` if missing.
4. Upsert `documents` (`document_type = 'shipping_label'`, `entity_type = 'ORDER'`, `entity_id = order.id`).
5. Insert links: `(SHIPMENT, stn.id, primary)` + `(ORDER, order.id, secondary)`.
6. Idempotency: `sourceHash` or `(document_type, SHIPMENT, stn.id)` unique partial index.

**Attach / fetch packing slip**

1. Same order resolution.
2. Fetch PDF from marketplace adapter (§7).
3. Store bytes → NAS or GCS (see §5.2).
4. Upsert `documents` (`document_type = 'packing_slip'`).
5. Link `(ORDER, order.id, primary)`; add `(SHIPMENT, stn.id)` when per-box slip.

**Manual NAS upload (fallback)**

- Keep browser PUT flow for labels; extend `OrderDocumentsSection` to accept slips.
- POST stores URL + `source: 'manual_upload'` + dual links when tracking known.

---

## 5. Storage strategy

### 5.1 Decision: NAS first, GCS optional later

| Source | v1 storage | Rationale |
|--------|------------|-----------|
| Manual upload | NAS (`getNasStorageTarget(org, 'shipping')`) | Matches `order-labels` today |
| Marketplace fetch | **Server-side** write to NAS or org GCS prefix | Vercel can't rely on browser PUT for API-fetched bytes |

### 5.2 Path convention (new SoT module)

`src/lib/documents/storage-paths.ts`:

```
{orgSlug}/outbound/{document_type}/{yyyy}/{mm}/{platform}/{orderRef}-{trackingTail}-{docId}.pdf
```

- Reuse NAS agent proxy (`/api/nas-target/shipping`) when configured.
- Fallback: upload to GCS under `{org}/outbound/...` via existing storage adapter pattern from photos.

### 5.3 Content delivery

- **Images/PDF in UI:** signed URL or `/api/documents/[id]/content?download=1` (mirror `/api/photos/[id]/content`).
- **Print:** open URL in hidden iframe or extend `/api/print/dispatch` for PDF→printer (paper profile).

---

## 6. Phase overview

```
Phase 0 — Schema + link hub + backfill           (~2–3 days)   Low risk
Phase 1 — Domain API + migrate order-labels      (~3–4 days)   Medium
Phase 2 — Outbound UI (document tray)            (~3–4 days)   Medium
Phase 3 — Media Library outbound scope           (~4–5 days)   Medium
Phase 4 — Marketplace fetch adapters             (~5–8 days)   Med–high
Phase 5 — Polish (batch, print bundle, metrics)  (~3–5 days)   Low–med
```

**Critical path:** Phase 0 → 1 → 2 (usable outbound) → 4 (marketplace value) → 3 (library browse).

Phases 2 and 3 can overlap after Phase 1 lands.

---

## 7. Phase 0 — Schema & backfill

### 7.1 Migrations (single day, two files if ordering matters)

**File A:** `2026-07-01_outbound_document_entity_links.sql`

- Create `document_entity_links` (§4.1).
- `enforce_tenant_isolation` when available.
- Add partial unique index for idempotency:
  ```sql
  CREATE UNIQUE INDEX ux_documents_outbound_source_hash
    ON documents (organization_id, document_type, (document_data->>'sourceHash'))
    WHERE document_type IN ('shipping_label', 'packing_slip')
      AND document_data->>'sourceHash' IS NOT NULL;
  ```
- Extend `chk` or app-level validation for `document_type` outbound values.

**File B:** `2026-07-01b_backfill_shipping_label_links.sql`

- For each `documents` row where `entity_type = 'SHIPPING_LABEL'`:
  1. Insert `document_entity_links (ORDER, entity_id, secondary)` if missing.
  2. Resolve STN: `orders.shipment_id` → else `shipment_links` WHERE `owner_type='ORDER' AND is_primary`.
  3. Insert `document_entity_links (SHIPMENT, stn.id, primary)` when STN found.
  4. Set `documents.entity_type = 'ORDER'`, keep `entity_id` unchanged.
- **Do not delete** legacy rows; dual-read handles stragglers.
- Verify script: `scripts/verify-outbound-document-links.sql` (counts: labels without STN link, orphan links).

### 7.2 Drizzle / types

- Add `documentEntityLinks` to `schema.ts` (or document-only types file if table not in Drizzle yet).
- `src/lib/documents/types.ts` — `DocumentEntityType`, `OutboundDocumentType`, `OutboundDocumentData`.

### 7.3 Acceptance criteria

- [ ] Migration idempotent on fresh + prod-shaped DB
- [ ] 100% of labels with resolvable STN gain `SHIPMENT` link
- [ ] Labels without tracking (edge) keep `ORDER` link only; flagged in verify script
- [ ] `npm run db:migrate` clean; sha recorded in `schema_migrations`

---

## 8. Phase 1 — Domain layer & API

### 8.1 New module layout

```
src/lib/documents/
  types.ts
  links.ts              # createDocumentEntityLink, listLinksForDocument
  outbound-documents.ts   # attach, listForOrder, listForShipment, delete
  storage-paths.ts
  resolve-stn-for-order.ts
  fetch-idempotency.ts
```

**Deps injection** on domain fns (mirror `image-types.ts`) for unit tests.

### 8.2 Routes

| Route | Methods | Permission | Notes |
|-------|---------|------------|-------|
| `/api/orders/[id]/documents` | GET | `orders.view` | List all docs for order (labels + slips) via links |
| `/api/orders/[id]/documents` | POST | `orders.create` | Manual attach `{ documentType, url, tracking?, carrier? }` |
| `/api/orders/[id]/documents/fetch` | POST | `orders.create` | Trigger marketplace fetch `{ types: ['packing_slip','shipping_label'] }` |
| `/api/shipments/[id]/documents` | GET | `shipping.view` | Per-STN docs (multi-box) |
| `/api/documents/[id]` | DELETE | `orders.create` | Unlink + optional NAS delete |
| `/api/documents/[id]/content` | GET | `orders.view` | Proxy/stream bytes |

**Migrate** `/api/order-labels` → thin wrapper calling `outbound-documents.ts` (deprecation header in response for one release).

### 8.3 Route skeleton (per `new-route` skill)

```
withAuth → validate (Zod) → domain helper → map 404/409/200
→ recordAudit(AUDIT_ACTION.ORDER_DOCUMENT_ATTACH | FETCH, AUDIT_ENTITY.ORDER)
→ after() optional: bust outbound cache keys
```

Register new audit verbs in `audit-logs.ts` (append-only strings).

### 8.4 Permissions

| Action | Permission |
|--------|------------|
| List / view content | `orders.view` |
| Attach / delete / fetch | `orders.create` |
| Shipment-scoped list | `shipping.view` |

Update `docs/security/route-permissions.json` + `route-permission-manifest.test.ts`.

### 8.5 Cache keys

Extend `src/lib/outbound/outbound-cache-keys.ts`:

- `['order-documents', orderId]`
- Bust on attach/delete/fetch alongside `order-labels` invalidations.

### 8.6 Unit tests

- `src/lib/documents/outbound-documents.test.ts` — link creation, idempotent re-attach, resolution order.
- `src/lib/documents/resolve-stn-for-order.test.ts` — primary cache vs `shipment_links`.

### 8.7 Acceptance criteria

- [ ] POST attach creates dual links when tracking provided
- [ ] GET order documents returns merged legacy + new rows
- [ ] DELETE removes links + document; does not delete order
- [ ] Audit rows on first label attach (`orders.label.printed` preserved for timeline)
- [ ] `order-labels` route still works (wrapper)

---

## 9. Phase 2 — Outbound UI

### 9.1 Replace `OrderLabelsSection` → `OrderDocumentsSection`

**File:** `src/components/shipped/OrderDocumentsSection.tsx`

Sections (linear, workbench):

1. **Shipping label** — list + drop zone (existing UX) + “Fetch from marketplace” button
2. **Packing slip** — list + fetch + drop zone
3. **Actions row** — Print label · Print slip · Open in library

Props: `{ orderId, orderRef, accountSource, shipmentId?, platform }`.

### 9.2 Wire contexts

| Context | Show documents |
|---------|----------------|
| `labels` (Outbound) | Full tray + fetch |
| `dashboard` / `fulfillment` | Read + print |
| `staged` (scan-out) | Read-only |
| `packer` | Pack photos only (link to library); docs optional |

Update `ShippedDetailsBody.tsx` to mount `OrderDocumentsSection` where `OrderLabelsSection` sits today.

### 9.3 Labels queue enhancements (ROI)

| Enhancement | File touch |
|-------------|------------|
| Platform filter chips | `LabelsQueueTable` + sidebar `outbound-sidebar-shared.ts` |
| Doc status dot on row | `ShippedRecordRow` — has label? has slip? |
| Keyboard `f` fetch docs for open order | `LabelsOrderWorkspace` |

### 9.4 Empty / error states

- No integration: “Connect Amazon/eBay to fetch slips” → settings link
- Fetch failed: show `document_data.error` + retry button
- Multi-box: sub-list per tracking number under order

### 9.5 Acceptance criteria

- [ ] Operator can attach, view, delete label (parity with today)
- [ ] Operator can attach slip manually
- [ ] Fetch button calls API (stub ok until Phase 4)
- [ ] Timeline still shows `orders.label.printed` on first label
- [ ] Mobile: drop zone usable on tablet label station

---

## 10. Phase 3 — Media Library integration

### 10.1 New library scope: `outbound`

**`library-filter-state.ts`**

```typescript
export type PhotoLibrarySourceScope =
  | 'all' | 'unboxing' | 'local_pickup' | 'packing' | 'repair' | 'claims'
  | 'outbound';  // NEW
```

**`documentType` filter** (URL param):

```typescript
documentType?: 'shipping_label' | 'packing_slip' | 'all';
```

### 10.2 Query layer

**New:** `src/lib/documents/queries/library.ts` → `listOutboundDocumentLibrary(filters)`

Returns items shaped like `LibraryPhoto` union or new `LibraryDocument`:

```typescript
interface LibraryDocument {
  id: number;
  kind: 'document';
  documentType: 'shipping_label' | 'packing_slip';
  platform: string | null;
  orderRef: string | null;
  tracking: string | null;
  createdAt: string;
  displayUrl: string;  // content route
  thumbUrl: string;    // generic PDF icon or first-page raster later
  sourceScope: 'outbound';
}
```

**Endpoint:** extend `GET /api/photos/library` with `sourceScope=outbound` **or** add `GET /api/documents/library` and merge client-side — prefer **single library endpoint** that unions when `sourceScope=outbound`:

```
photos (PACKER_LOG) ∪ documents (outbound types) → normalized grid items
```

### 10.3 Sidebar

**`PhotoStationFolders.tsx`** — add built-in row **Outbound** (icon: `Truck` or `FileText`).

Sub-filters when `outbound` active:

- Document type: All · Shipping label · Packing slip
- Platform: from `orders.account_source` join

### 10.4 Lightbox / viewer

- PDF: iframe or new tab via `/api/documents/[id]/content`
- `PhotoContextPanel` extended → `MediaContextPanel` with provenance:
  - Order #, tracking, platform, source, fetchedAt, linked entities

### 10.5 Saved views

Seed examples (org-level, via existing saved-views hook):

- “Outbound · Labels today”
- “Outbound · Amazon slips · Last 7 days”

### 10.6 Acceptance criteria

- [ ] `?sourceScope=outbound` returns documents + optional pack photos
- [ ] Filter by `documentType` and `tracking` / `order` params works
- [ ] Deep link from order panel → `/ops/photos?sourceScope=outbound&order=…`
- [ ] Select + ZIP: include PDFs in `download-zip` or new `download-documents-zip`

---

## 11. Phase 4 — Marketplace fetch adapters

### 11.1 Adapter interface

**`src/lib/documents/marketplace/types.ts`**

```typescript
interface MarketplaceDocumentAdapter {
  platform: string;
  canFetch(order: OrderContext): boolean;
  fetchPackingSlip(ctx: FetchContext): Promise<FetchResult>;
  fetchShippingLabel(ctx: FetchContext): Promise<FetchResult>;
}
```

**Registry:** `getAdapterForOrder(order)` using `getOrderPlatformLabel()` + `account_source`.

### 11.2 Platform rollout order

| Order | Platform | Adapter file | API notes |
|-------|----------|--------------|-----------|
| 1 | eBay | `marketplace/ebay-documents.ts` | Fulfillment API; may need Sell Feed for some PDFs |
| 2 | Amazon MFN | `marketplace/amazon-documents.ts` | SP-API Orders + Shipping; check token scopes |
| 3 | ECWID | `marketplace/ecwid-documents.ts` | Generate internal slip from order JSON if no PDF |
| 4 | Walmart | stub | Return `not_supported` |

### 11.3 Fetch orchestrator

**`src/lib/documents/marketplace/fetch-outbound-documents.ts`**

1. Load order + sales_order mirror if present.
2. Pick adapter.
3. For each requested type: fetch bytes → store → upsert document + links.
4. Record audit `order.document.fetched`.
5. On partial failure: return `{ fetched: [], failed: [{ type, error }] }`.

### 11.4 Feature flag

`OUTBOUND_MARKETPLACE_FETCH` — org feature flag or env default off in prod until eBay adapter tested.

### 11.5 Rate limits & credentials

- Reuse `organization_integrations` + `getIntegrationCredentials`.
- eBay: per-account `EbayClient` selection from `orders.account_source` → `ebay_accounts`.
- Log API calls to existing audit tables where applicable.

### 11.6 Acceptance criteria

- [ ] eBay order: fetch produces at least packing slip OR label when API returns data
- [ ] Re-fetch is idempotent (`sourceHash` dedupe)
- [ ] Missing integration returns 422 with clear message
- [ ] FBA orders skip MFN label fetch (or route to FBA-specific flow)

---

## 12. Phase 5 — Polish & ops ROI

| Item | Description |
|------|-------------|
| **Print bundle** | One click: slip + label PDFs merged or sequential print |
| **Batch fetch** | Labels queue multi-select → fetch docs for N orders (cap 20) |
| **Sales order panel** | Read-only line items from `sales_orders.lineItems` on Outbound detail |
| **Metrics** | PostHog: `outbound.document.fetched`, `outbound.document.printed` |
| **E2E** | `tests/e2e/outbound-documents.spec.ts` — attach label, verify link row |
| **Generated slip fallback** | Internal HTML→PDF template when marketplace fetch fails (optional) |

---

## 13. Testing plan

### 13.1 Unit

- Link CRUD, resolution order, idempotency, STN resolution edge cases (no STN, multi-STN).

### 13.2 Integration (DB)

- Backfill migration on fixture DB with legacy `SHIPPING_LABEL` rows.
- Attach doc → query via ORDER and via SHIPMENT paths.

### 13.3 E2E

- Outbound Labels: drop PNG label → appears in tray → appears in library `outbound` scope.
- Fetch (mocked API): button → document row created.

### 13.4 Manual QA checklist

- [ ] Single-box order: label + slip linked to same STN
- [ ] Multi-box order: two labels → two STNs → correct per-box docs
- [ ] Order without tracking: manual slip attach works; label prompts for tracking
- [ ] Cross-org: cannot read another org's document content route
- [ ] Delete order: document policy (CASCADE vs SET NULL) — **decision: CASCADE links, soft-retain docs with null owner?** Default **CASCADE document when order deleted** if `entity_id` is order; links cleaned via FK.

---

## 14. Rollout & risk

### 14.1 Rollout sequence

1. Deploy Phase 0 migration (read-only new table).
2. Deploy Phase 1 API behind flag; run backfill verify in prod.
3. Switch `order-labels` POST to new domain module.
4. Ship Phase 2 UI to internal operators.
5. Enable library scope (Phase 3).
6. Enable marketplace fetch per platform (Phase 4).

### 14.2 Risks

| Risk | Mitigation |
|------|------------|
| Marketplace API doesn't return PDF | Manual upload + generated slip fallback |
| STN missing on old orders | ORDER-only link; prompt to add tracking |
| `documents` without `organization_id` on old repair rows | Outbound queries always filter `organization_id = $org` |
| PDF in library ZIP | Stream merge; cap size |
| NAS unreachable from Vercel | Server fetch writes via NAS agent or GCS |

### 14.3 Dependencies

- STN / `shipment_links` SoT (shipped)
- Media library saved views (nice-to-have for presets)
- Platform catalog (future; not blocking v1)

---

## 15. File checklist (implementation order)

### Migrations
- [ ] `2026-07-01_outbound_document_entity_links.sql`
- [ ] `2026-07-01b_backfill_shipping_label_links.sql`
- [ ] `scripts/verify-outbound-document-links.sql`

### Domain
- [ ] `src/lib/documents/types.ts`
- [ ] `src/lib/documents/links.ts`
- [ ] `src/lib/documents/outbound-documents.ts`
- [ ] `src/lib/documents/storage-paths.ts`
- [ ] `src/lib/documents/queries/library.ts`
- [ ] `src/lib/documents/marketplace/*`

### API
- [ ] `src/app/api/orders/[id]/documents/route.ts`
- [ ] `src/app/api/orders/[id]/documents/fetch/route.ts`
- [ ] `src/app/api/shipments/[id]/documents/route.ts`
- [ ] `src/app/api/documents/[id]/route.ts`
- [ ] `src/app/api/documents/[id]/content/route.ts`
- [ ] Refactor `src/app/api/order-labels/route.ts`

### UI
- [ ] `src/components/shipped/OrderDocumentsSection.tsx`
- [ ] `ShippedDetailsBody.tsx` swap
- [ ] `library-filter-state.ts` + `PhotoStationFolders.tsx`
- [ ] `usePhotoLibrary.ts` / library route union
- [ ] `MediaContextPanel` or extend `PhotoContextPanel`

### Auth / audit
- [ ] `audit-logs.ts` new actions
- [ ] `permission-registry.ts` (if new perms needed)
- [ ] `route-permissions.json`

### Tests
- [ ] `outbound-documents.test.ts`
- [ ] `tests/e2e/outbound-documents.spec.ts`

---

## 16. Open questions (resolve before Phase 4)

| # | Question | Default if no answer |
|---|----------|----------------------|
| Q1 | Generated slip fallback when API fails? | Phase 5; manual upload only in v1 |
| Q2 | GCS vs NAS for server-fetched PDFs? | NAS when agent configured; else GCS |
| Q3 | CASCADE delete documents when order deleted? | Yes — outbound docs are order-scoped |
| Q4 | Include pack photos in `outbound` library scope? | Yes — union with `PACKER_LOG` links to order's shipment |
| Q5 | Zoho SO PDF as packing slip source? | Phase 4b after marketplace adapters |

---

## 17. Success metrics (30 days post-launch)

| Metric | Target |
|--------|--------|
| % labels with STN link | > 95% (after backfill) |
| Manual NAS label uploads | Flat or down vs baseline |
| Time on Outbound Labels queue per order | −20% (fetch vs download-upload) |
| Media library `outbound` scope weekly active users | > 50% of label-station staff |
| Support tickets “can't find slip/label” | Down |

---

*End of plan.*
