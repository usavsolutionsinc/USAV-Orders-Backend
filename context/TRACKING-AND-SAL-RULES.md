# Tracking Number Normalization & SAL Source-of-Truth Rules

These are hard architectural rules. Do not deviate from them without explicit approval.

---

## 1. SAL (station_activity_logs) is the Single Source of Truth for "Processed"

An order is considered **processed** (scanned/tested/packed) if and only if a `station_activity_logs` row exists with `shipment_id = orders.shipment_id`. No other condition is required.

### Rules

- **Do NOT filter by `station` or `activity_type`** — any SAL row with a matching `shipment_id` means the order was handled. This catches TECH scans, PACK scans, and any future station types.
- **Do NOT check `packer_logs`** for shipped/packed filtering. SAL is the SoT. `packer_logs` is an audit trail only.
- **Do NOT check carrier shipped status** (e.g., `is_carrier_accepted`, `is_delivered`). "Processed" = scanned at a station, not carrier acceptance.
- The `has_tech_scan` field in `/api/orders/next` counts ALL SAL entries for the order's shipment, not just TECH station entries. This is intentional — it catches PACK scans too.

### SQL Pattern (canonical)

```sql
-- Exclude processed orders (used in /api/orders, /api/orders/next, etc.)
NOT EXISTS (
  SELECT 1 FROM station_activity_logs sal
  WHERE sal.shipment_id IS NOT NULL
    AND sal.shipment_id = o.shipment_id
)
```

### Where This Applies

| Endpoint | Filter |
|----------|--------|
| `GET /api/orders?excludePacked=true` | SAL `NOT EXISTS` |
| `GET /api/orders/next` (`noTechScanClause`) | SAL `NOT EXISTS` |
| `POST /api/orders/check-shipped` | SAL `EXISTS` → mark `status='shipped'` |
| Client-side `UpNextOrder` filter | `!order.has_tech_scan` (safety net for stale cache) |

---

## 2. Tracking Number Normalization — Three-Layer Cascade

All tracking number lookups MUST use this three-layer fallback cascade. Do not skip layers.

### Layer 1: Exact Normalized Match (fastest)

```sql
WHERE stn.tracking_number_normalized = $normalizedInput
```

`normalizedInput` = `normalizeTrackingNumber(rawScan)` — uppercase, alphanumeric-only, USPS routing prefix stripped.

### Layer 2: Key-18 Suffix Match (fallback for partial mismatches)

```sql
WHERE RIGHT(regexp_replace(UPPER(stn.tracking_number_normalized), '[^A-Z0-9]', '', 'g'), 18) = $key18
```

`key18` = `normalizeTrackingKey18(rawScan)` — last 18 alphanumeric characters.

### Layer 3: Last-8 Digits Match (broadest fallback)

```sql
WHERE RIGHT(regexp_replace(stn.tracking_number_normalized, '[^0-9]', '', 'g'), 8) = $last8
```

`last8` = `normalizeTrackingLast8(rawScan)` — last 8 digits only.

### Why All Three Layers

- **Layer 1** handles 95% of scans (direct match after normalization).
- **Layer 2** catches cases where USPS prefix stripping has edge cases or the DB value was imported via a different normalization path.
- **Layer 3** is the ultimate fallback — the last 8 digits are always identical regardless of prefix, carrier format, or normalization differences.

### Endpoints That MUST Use This Cascade

- `POST /api/packing-logs` (order lookup)
- `POST /api/tech/scan` (via `findOrderByShipment()`)
- `POST /api/scan-tracking` (key18 match)
- `scripts/backfill-packer-shipment-ids.mjs` (migration)

---

## 3. USPS IMpb Routing Prefix — Strip at Both Client and Server

Barcode scanners read the full USPS Intelligent Mail package barcode (IMpb), which prepends `420` + ZIP (5 or 9 digits) to the actual tracking number. The DB stores only the tracking portion.

### Formats

| Scanner Output | Prefix | Actual Tracking |
|---------------|--------|-----------------|
| `420XXXXX` + 20-22 digits | 5-digit ZIP (8 chars total) | 20-22 digit USPS tracking |
| `420XXXXXXXXX` + 20-22 digits | ZIP+4 (12 chars total) | 20-22 digit USPS tracking |

### Example

```
Scanner reads: 420029149300110990413297425607
                ^^^^^^^^                        ← 420 + 5-digit ZIP (02914)
                        ^^^^^^^^^^^^^^^^^^^^^^  ← Actual tracking: 9300110990413297425607
DB stores:     9300110990413297425607
```

### Implementation: `stripUspsRoutingPrefix()` in `src/lib/tracking-format.ts`

```typescript
export function stripUspsRoutingPrefix(input: string): string {
  const clean = normalizeTrackingCanonical(input);
  if (!clean.startsWith('420') || clean.length < 28) return clean;
  // 5-digit ZIP: slice(8), verify starts with 9 + 19-21 more digits
  // 9-digit ZIP+4: slice(12), verify starts with 9 + 19-21 more digits
  ...
}
```

### Defense-in-Depth: Client + Server

Both client and server MUST normalize tracking numbers:

- **Client-side** (`StationPacking.tsx`, `useStationTestingController.ts`): Call `normalizeTrackingNumber()` before sending to API. This makes the exact match (Layer 1) succeed immediately.
- **Server-side** (`/api/packing-logs`, `/api/tech/scan`): Also normalizes via the same function. Idempotent — double-normalizing is safe.

### `useLast8TrackingSearch` Hook

React hook wrapping `normalizeTrackingLast8` (last-8 digits) and `normalizeTrackingNumber` (USPS-stripped canonical). Used in:

- `ShippedSidebar.tsx` — search query normalization
- `StationPacking.tsx` — tracking display (last-8) and pre-normalization
- Any component that searches or displays tracking numbers

---

## 4. Cache Invalidation — Required Tags

When any packing or scanning operation modifies order state, ALL of these cache tags MUST be invalidated:

```typescript
await invalidateCacheTags(['packing-logs', 'orders', 'orders-next', 'shipped']);
```

### Critical: `orders-next`

The `GET /api/orders/next` endpoint caches with tag `orders-next`. If this tag is NOT invalidated after a pack scan, the UpNextOrder component will continue showing the order as unprocessed even though it's been packed.

### Tag Reference

| Tag | Used By |
|-----|---------|
| `orders` | `GET /api/orders` |
| `orders-next` | `GET /api/orders/next` |
| `shipped` | `GET /api/shipped` |
| `packing-logs` | `GET /api/packing-logs` |
| `tech-logs` | `GET /api/tech/logs` |
| `packerlogs` | `GET /api/packerlogs` |

### When to Invalidate Which Tags

| Operation | Tags to Invalidate |
|-----------|-------------------|
| Pack scan (order found) | `packing-logs`, `orders`, `orders-next`, `shipped` |
| Pack scan (order not found) | `packing-logs`, `orders`, `orders-next`, `shipped` |
| Tech scan | `orders`, `orders-next`, `tech-logs` |
| Serial add/remove | `tech-logs`, `orders-next` |
| Order assignment | `orders`, `shipped`, `orders-next`, `tech-logs`, `packing-logs` |
| Check-shipped batch | `orders`, `orders-next`, `shipped`, `packing-logs` |

---

## 5. Ably Realtime Publish — Required for Cross-Device Updates

`window.dispatchEvent(new CustomEvent('usav-refresh-data'))` only works on the same browser tab. For cross-device updates (e.g., packer scans on one device, dashboard updates on another), server-side Ably publish is REQUIRED.

### After Pack Scan (in `/api/packing-logs`)

```typescript
await Promise.allSettled([
  publishOrderChanged({ orderIds: [order.id], source: 'packing-logs' }),
  publishPackerLogChanged({
    packerId: staffId,
    action: 'insert',
    packerLogId: foundPackerLogId ?? undefined,
    source: 'packing-logs',
  }),
]);
```

### After Tech Scan (in `/api/tech/scan`)

```typescript
await publishTechLogChanged({ techId, action: 'insert', rowId: salId, source: 'tech.scan' });
await publishOrderTested({ orderId, testedBy, source: 'tech.scan' });
```

---

## 6. shipment_id FK Linking — The Join Key

`shipment_id` is the foreign key that links all tables to `shipping_tracking_numbers`:

```
orders.shipment_id ──────────┐
packer_logs.shipment_id ─────┤
station_activity_logs.shipment_id ─┤──── shipping_tracking_numbers.id
tech_serial_numbers.shipment_id ───┘
```

### Timing Gap Problem

Packers may scan orders BEFORE they are imported from ShipStation/Amazon (4-11 hours ahead). In this case:

1. `resolveShipmentId()` creates a `shipping_tracking_numbers` row and returns `shipmentId`
2. `packer_logs.shipment_id` and `station_activity_logs.shipment_id` are set correctly
3. But `orders.shipment_id` is NULL because the order hasn't been imported yet
4. The `NOT EXISTS` SAL check compares `sal.shipment_id = o.shipment_id` — but `o.shipment_id` is NULL, so the check passes and the order still appears in UpNext

### Resolution

When the order is eventually imported and `orders.shipment_id` is set, the SAL filter starts working. For immediate reconciliation, run:

```bash
node scripts/backfill-packer-shipment-ids.mjs
```

This finds orphaned `packer_logs` and `station_activity_logs` rows with NULL `shipment_id` that can be matched via key18 suffix to `shipping_tracking_numbers`, and backfills the FK.

---

## 7. Normalization Functions — Single Source of Truth

All normalization functions live in `src/lib/tracking-format.ts`. Do NOT create duplicates elsewhere.

| Function | Purpose | Returns |
|----------|---------|---------|
| `normalizeTrackingCanonical(input)` | Uppercase, alphanumeric-only | `string` |
| `normalizeTrackingNumber(input)` | Canonical + strip USPS prefix | `string` |
| `normalizeTrackingKey18(input)` | Last 18 alphanumeric chars | `string` |
| `normalizeTrackingLast8(input)` | Last 8 digits | `string` |
| `stripUspsRoutingPrefix(input)` | Strip 420+ZIP prefix only | `string` |
| `detectCarrier(tracking)` | Carrier from tracking pattern | `Carrier` |
| `getTrackingUrl(tracking)` | Auto-detect carrier → URL | `string \| null` |

### Re-exports

- `src/lib/shipping/normalize.ts` re-exports `normalizeTrackingNumber` and wraps `detectCarrier` with `CarrierCode` typing
- `src/hooks/useLast8TrackingSearch.ts` wraps `normalizeTrackingLast8` and `normalizeTrackingNumber` as React `useCallback` hooks
