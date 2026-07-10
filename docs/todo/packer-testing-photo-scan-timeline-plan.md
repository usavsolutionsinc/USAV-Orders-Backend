# Packer testing-label photo scan → phone capture → unit photo timeline

**Status:** BUILT + E2E-VERIFIED (flag-gated, ships dark) · 2026-07-09 · enable with `NEXT_PUBLIC_UNIT_SCAN_PHOTOS=1`
— tsc-clean (adds 0 errors), 13/13 unit tests pass, 0 net design-guard violations,
6/6 E2E pass (`tests/e2e/unit-photo-scan.spec.ts`) incl. a real GCS upload→pair→render round-trip.
Phone capture route is `/m/unit-photos/[id]` (immersive), not `/m/u/[id]/photos` (route-group conflict).
**Owner:** —
**Flag:** `UNIT_SCAN_PHOTOS` (per-org via `resolveForOrg`, env fallback `UNIT_SCAN_PHOTOS`)

---

## 1. Goal & user flow

At the **desktop station scan** (the order-anchored tech testing station), an operator:

1. Scans a **tracking number** first → gains order context (`activeOrder`), exactly as today.
2. Scans a unit's **printed testing/unit label** (DataMatrix encoding `U-{serial}` / GS1 `(01)(21)` / minted `unit_uid`). Inside an active order this is classified `SERIAL` and flows through `handleSerialScan`.
3. On that label scan the desktop **fires an Ably request to the operator's phone**, which **auto-opens the camera** for that specific unit.
4. Photos captured on the phone are **paired to the scanned unit** (`photo_entity_links.entity_type='SERIAL_UNIT'`, `entity_id = serial_units.id`, `photo_type='testing_photo'`) and uploaded GCS-primary.
5. The unit's **serial unit detail pane** shows a **photo-enriched timeline** that merges these testing-scan photos with the unit's **receiving-unbox photos** (joined via `serial_unit_provenance → receiving_lines`) and its lifecycle `inventory_events` — newest-first, thumbnails inline.

This is a **1:1 mirror of the existing receiving photo-request pipeline**, standing up a **fully parallel, non-overlapping namespace** so testing photos never collide with receiving photos.

### Decisions locked (from requirements Q&A)

| Fork | Decision |
|---|---|
| Scan surface | **Order-anchored station scan** (`useStationTestingController`): tracking-first to gain context, then the label scan. Not a new standalone bar. |
| Trigger | **Auto-open** on the phone (mirror `receiving_photo_request`), in a **fully separate namespace** — new event/channel-event/route/photo_type/queue key, zero overlap with receiving endpoints. |
| **Fire only on genuine unit-label scans** | The camera fires **only when the raw scan is a printed unit-label payload** — gate `routeScan(rawInput)?.type === 'serial-unit'`. The bench's rapid partial-serial *confirm* scans (which default to `SERIAL`) never trip the camera. **Committed** (was a risk; now the design). |
| Timeline home | **Serial unit detail pane** (`/api/serial-units/[id]` → `UnitDetailWorkspace`). |

---

## 2. Critical finding that shapes the design

**The desktop tech station does not have a `serial_units.id` after a serial scan.**

`handleSerialScan` (active-order branch) POSTs `/api/tech/add-serial` → `/api/tech/serial`, which writes **`tech_serial_numbers`** (order/shipping lineage) and returns only `{ success, serialNumbers, tsnId }`. The client `activeOrder.serialNumbers` is a flat `string[]` — **there is no per-unit `serial_units.id` in the client model** (confirmed by `serial-units-queries.ts:325` — shipped serials live in `tech_serial_numbers`, "never in `serial_units`").

But the **photo pairing target must be a `serial_units` row**, because that is the join key to receiving-unbox photos (`serial_units → serial_unit_provenance (RECEIVING_LINE) → receiving_lines`). The label's DataMatrix encodes the **unit identity** (serial / `unit_uid`), and `serial_units` is minted at receiving/unbox time — so the row exists for any unit that came through receiving (the intended population).

**Resolution:** on the label scan, resolve the scanned string → `serial_units` row, then fire the request keyed on that unit.

- `POST /api/serial-units/[id]/photos`'s `resolveUnit` already accepts **numeric id, `normalized_serial`, OR minted `unit_uid`** as the `[id]` segment ("the same id a packer scans"). So the **phone can attach photos with only the scanned string** — no numeric id needed on the wire.
- The **desktop** still needs to (a) confirm a unit exists, (b) show a photo count on the active card, (c) build the timeline deep-link. **Verified call: `POST /api/serial-units/resolve-batch`** (perm `print.label`), body `{ serials: [scannedSerial] }` → response `{ ok, units: [{ serial, unit_uid, serial_unit_id }] }`. Read `units[0].serial_unit_id` (**= `serial_units.id`; note the field name is `serial_unit_id`, not `id`**) and `units[0].unit_uid`. Do **not** use `/api/serial-units/lookup` — it omits `id`. (A 1-item twin `POST /api/units/resolve-id` also exists if preferred.)

**Degrade path:** resolve-batch **always echoes the row**; a serial with no `serial_units` record comes back as `{ serial_unit_id: null, unit_uid: null }`. On that null, **do not fire** the photo request — surface a quiet "no unit record to attach photos to" hint on the active card and continue the scan loop. Never block the scan.

---

## 3. Non-overlap namespace matrix

The left column is the existing **receiving** pipeline (do NOT reuse); the right column is the **new** value.

| Layer | Receiving (existing — do not reuse) | New (this feature) |
|---|---|---|
| Desktop→phone request event | `receiving_photo_request` | **`unit_photo_request`** |
| Phone→desktop echo event | `receiving_photo_uploaded` | **`unit_photo_uploaded`** |
| Parity broadcast event | `receiving-photo.changed` | **`unit-photo.changed`** |
| Request channel | `staffstation:{staffId}` (shared) | **reuse** `staffstation:{staffId}` — new event name only |
| Echo channel | `phone:{staffId}` (shared) | **reuse** `phone:{staffId}` — new event name only |
| Broadcast channel | `station:changes` (shared) | **reuse** `station:changes` — new event name only |
| Mobile capture route | `/m/r/[id]/photos` | **`/m/unit-photos/[id]`** (immersive group) — NOT `/m/u/[id]/photos`, which collides with the `(shell)/u/[id]` unit-detail route (two route groups can't own the same segment; E2E-verified) |
| Upload queue localStorage | `usav.receiving.upload_queue.v1` | **`usav.unit.upload_queue.v1`** |
| entityType | `RECEIVING` / `RECEIVING_LINE` | **`SERIAL_UNIT`** (already in `PHOTO_ENTITY_TYPES`) |
| photo_type | `receiving_package` / `receiving_item` | **`testing_photo`** |
| Read route | `/api/receiving-photos` | **reuse** `GET /api/serial-units/[id]/photos` (serial-unit namespace, zero receiving overlap) |
| Upload route | `/api/photos/upload` (shared) | **reuse** `/api/photos/upload` — new `SERIAL_UNIT` publish branch |
| Delete route | `DELETE /api/photos/[id]` (shared) | **reuse** `DELETE /api/photos/[id]` |
| React Query key (photos) | `['receiving-photos', …]` | **`['unit-photos', serialUnitId]`** |
| Window event | `receiving-photo.changed` | **`unit-photo.changed`** |
| publish `source` tag | `photos.upload` | **`photos.upload` reused** (generic), differentiate by event name |

**Channels are deliberately reused** (they are per-staff / per-org buses shared by many features); only the **event names on them** are new, which is the established non-collision rule. **No token-route change** — `staffstation`, `phone`, and `station:changes` capabilities are already granted per-staff/org.

---

## 4. Data-flow architecture

```
DESKTOP (station scan, tracking-first)
  handleTrackingScan → /api/tech/scan → activeOrder (context)
  handleSerialScan (label scan, classified SERIAL)
     └─ resolve serial/unit_uid → serial_units {id, unit_uid}   (POST /api/serial-units/resolve-batch)
     └─ publishUnitPhotoRequest(serialUnitId, unit_uid, serial, requestId)
            Ably: staffstation:{staffId}  event 'unit_photo_request'
                                             │
PHONE (MobileShell, always-on bridge)        ▼
  UnitPhotoRequestCamera  (subscribes 'unit_photo_request')
     └─ router.push('/m/u/{serialUnitId}/photos?requestId=…&unit=…')
  MobileUnitPhotoStudio  (MobilePackerSpamCamera)
     └─ unitPhotoUploadQueue.enqueue({ serialUnitId, unitUid, requestId })
            uploadPhotoClient({ entityType:'SERIAL_UNIT', entityId:serialUnitId,
                                photoType:'testing_photo', poRef: unitUid })
              POST /api/photos/upload  →  uploadPhoto() → GCS put + photos + photo_entity_links + photo_storage
                 └─ NEW branch: entityType SERIAL_UNIT → publishUnitPhotoChanged()
                        Ably: station:changes  event 'unit-photo.changed'
     └─ echo Ably: phone:{staffId}  event 'unit_photo_uploaded'
                                             │
DESKTOP refresh                              ▼
  useUnitPhotosRealtimeRefresh (subscribes 'unit_photo_uploaded' + 'unit-photo.changed')
     └─ active card: bump photo count · unit detail pane: refetch timeline

UNIT DETAIL PANE (/api/serial-units/[id])
  SerialUnitTimelineSection
     ├─ inventoryEventsToTimeline (lifecycle)
     ├─ SERIAL_UNIT 'testing_photo' photos          (entity_type=SERIAL_UNIT)
     └─ receiving-unbox photos via provenance        (serial_unit_provenance → receiving_lines → RECEIVING_LINE photos)
     → merge + sort desc + collapse → TimelineSection → EventTimeline (NEW media render branch)
```

---

## 5. Phased implementation

### Phase 0 — Types, permissions, path-builder, flag (no UI)

- **`src/lib/photos/types.ts`** — add `'testing_photo'` to the photo-type vocabulary (if a typed union exists; `photo_type` is free-text in DB, but keep the client union in sync). `SERIAL_UNIT` already in `PHOTO_ENTITY_TYPES`.
- **`src/lib/photos/entity-permissions.ts`** — ensure `uploadPermissionFor('SERIAL_UNIT')` returns `tech.scan_serial` (mirror the existing `POST /api/serial-units/[id]/photos` gate). If SERIAL_UNIT is missing from `UPLOAD_PERM_BY_ENTITY`, add it. **Per `permission-registry-guard`: any registry touch needs a matching `route-permission-manifest.test.ts` update.** Reads reuse `sku_stock.view` (existing serial-unit photo GET perm) — no new permission introduced.
- **`src/lib/photos/storage/path-builder.ts`** — add a `SERIAL_UNIT` case to `buildGcsObjectKey`, e.g. `{org}/units/{yyyy}/{mm}/{unit_uid ?? serialUnitId}/{photoId}.jpg`. Today only RECEIVING/PACKER_LOG have explicit branches.
- **Flag** — `UNIT_SCAN_PHOTOS` via `resolveForOrg(orgId, 'UNIT_SCAN_PHOTOS', 'UNIT_SCAN_PHOTOS')`. Gate the desktop publish + the phone subscriber mount.
- **No new table.** Pairing rides `photos` + `photo_entity_links` (SERIAL_UNIT). Filing key `po_ref = unit_uid`. (Respects the polymorphic-table contract by *not* adding a table.)

### Phase 1 — Desktop publisher (request to phone)

- **`src/lib/realtime/receiving-photo-request.ts`** → new sibling **`src/lib/realtime/unit-photo-request.ts`**: `publishUnitPhotoRequest(client, orgId, staffId, { serialUnitId, unitUid, serialNumber, requestId })` → publishes **`unit_photo_request`** on `getStaffStationBridgeChannelName(orgId, staffId)`.
- **`src/components/sidebar/receiving/usePhotoRequestPublisher.ts`** → new sibling client hook **`useUnitPhotoRequestPublisher({ staffIdNum, getAblyClient, stationChannelName })`** returning `(serialUnitId, unitUid, serialNumber) => Promise<void>`; mints `requestId` via `safeRandomUUID()`.
- **Wire into the station controller** (the one structural change to the tech station):
  - The controller (`useStationTestingController`) has `userId`/`userName` only — **no `staffId`/`orgId`/Ably**. Add an optional callback prop **`onUnitLabelScanned?(rawInput: string, resolvedSerial: string): void`** to the controller props.
  - Hook point: **`src/hooks/station/handleSerialScan.ts:124`**, right after `ctx.syncActiveOrderState(nextOrder)`. `handleSerialScan(input, ctx)` still has the **raw** `input` in scope here — call `ctx.onUnitLabelScanned?.(input, finalSerial)` (thread the callback through `ScanHandlerContext` in `station/types.ts` + `buildCtx()`). Pass the RAW `input` so the gate can classify it.
  - **The genuine-label gate + resolve + publish live in `src/components/station/StationTesting.tsx`** (already has `staffId`; add `useAuth()` for `organizationId` + `useAblyClient()`):
    1. `if (routeScan(rawInput)?.type !== 'serial-unit') return;` — **committed gate**; a bare partial-serial confirm scan is dropped here. (`routeScan` from `src/lib/barcode-routing.ts`; the discriminant field is **`.type`**, not `.kind`.)
    2. `POST /api/serial-units/resolve-batch { serials: [resolvedSerial] }` → read `units[0]`.
    3. `if (!units[0].serial_unit_id) { hint("no unit record"); return; }` — degrade-not-block.
    4. `publishUnitPhotoRequest(client, orgId, staffId, { serialUnitId: units[0].serial_unit_id, unitUid: units[0].unit_uid, serialNumber: resolvedSerial, requestId: safeRandomUUID() })`.
    - Guard the whole path behind `UNIT_SCAN_PHOTOS`.
  - **Residual false-positive note:** `routeScan` is shape-based — a manufacturer serial that happens to match the minted-uid shape (`…-DDDD-DDDDDD`), a `U-` handle, or a full GS1 `(01)(21)` frame would pass the gate. That's safe: resolve-batch returns `serial_unit_id: null` for any string with no unit row, so step 3 drops it. No spurious camera opens.

### Phase 2 — Phone subscriber + capture surface

- **`src/components/mobile/receiving/ReceivingPhotoRequestCamera.tsx`** → new sibling **`src/components/mobile/unit/UnitPhotoRequestCamera.tsx`**: subscribes **`unit_photo_request`** on `staffstation:{staffId}`; dedups by `request_id`; `router.push('/m/u/{serialUnitId}/photos?requestId=…&unit={unitUid}')`; same `pathname.endsWith('/photos')` re-entry guard.
- **`src/components/mobile/receiving/ReceivingPhoneBridgeMount.tsx`** → add `UnitPhotoRequestCamera` to the bridge mount (or a new `UnitPhoneBridgeMount`), mounted once in **`src/components/mobile/redesign/MobileShell.tsx:88`**. Gate behind flag.
- **`src/app/m/(immersive)/r/[id]/photos/page.tsx`** → new **`src/app/m/(immersive)/u/[id]/photos/page.tsx`**: reads `[id]` (serialUnitId), `requestId`, `unit`, `back`; renders `MobileUnitPhotoStudio`.
- **`src/components/mobile/photos/MobileReceivingPhotoStudio.tsx`** → new sibling **`src/components/mobile/photos/MobileUnitPhotoStudio.tsx`** (wraps the same `MobilePackerSpamCamera`): scope `{ serialUnitId, unitUid, requestId, fileIndex }`; on done enqueue into the new queue; echo **`unit_photo_uploaded`** on `phone:{staffId}`; local invalidation of `['unit-photos', serialUnitId]`.
- **`src/components/mobile/receiving/PhotoUploadQueue.ts`** → new sibling **`src/components/mobile/unit/UnitPhotoUploadQueue.ts`** singleton: localStorage **`usav.unit.upload_queue.v1`**; `postPhoto` → `uploadPhotoClient({ file, entityType:'SERIAL_UNIT', entityId: serialUnitId, photoType:'testing_photo', poRef: unitUid })`; reuse `downscaleImageTo720`.

### Phase 3 — Parity broadcast + desktop refresh

- **`src/lib/realtime/publish.ts`** — add `publishUnitPhotoChanged(payload)` mirroring `publishReceivingPhotoChanged`: event **`unit-photo.changed`** on `getStationChannelName(org)`; payload `{ type:'unit-photo.changed', action, serial_unit_id, photo_id, total_photo_count, source, timestamp }`. Add `UnitPhotoChangedPayload` type.
- **`src/app/api/photos/upload/route.ts`** — add a `SERIAL_UNIT` branch after upload success (alongside the RECEIVING/PACKER_LOG branches) → `publishUnitPhotoChanged({ action:'insert', source:'photos.upload' })` with `total_photo_count` from a new `countUnitPhotos(org, serialUnitId)`.
- **`src/hooks/useReceivingPhotosRealtimeRefresh.ts`** → new sibling **`src/hooks/useUnitPhotosRealtimeRefresh.ts`**: subscribes **`unit_photo_uploaded`** (`phone:{staffId}`) + **`unit-photo.changed`** (`station:changes`); refetch `['unit-photos', serialUnitId]`.
- **`src/lib/photos/queries/packer-list.ts`** pattern → add **`src/lib/photos/queries/unit-list.ts`**: `listUnitPhotos({ org, serialUnitId })`, `countUnitPhotos(org, serialUnitId)` (INNER JOIN `photo_entity_links` on `entity_type='SERIAL_UNIT' AND entity_id=$serialUnitId AND photo_type='testing_photo'`).

### Phase 4 — Photo-enriched timeline on the unit detail pane

Photos are **not** in `EventTimeline` today — this is the one genuinely new UI capability.

1. **`src/lib/timeline/types.ts`** — extend `TimelineItem` with an optional media channel:
   ```ts
   /** Optional inline photo thumbnails for this event (unbox/testing captures).
       EventTimeline renders a thumbnail strip; omit ⇒ no media block. */
   media?: TimelineMedia[];
   // export interface TimelineMedia { photoId: number; thumbUrl: string; fullUrl: string; caption?: string }
   ```
   Additive/optional → every existing consumer unaffected.
2. **`src/components/ui/EventTimeline.tsx`** — add a render branch after the badges/ref block (~L535-552): a horizontal `overflow-x-auto` thumbnail strip (`max-h`, `rounded`, `ring-1`) opening the **shared** `PhotoViewerModal` (`src/components/shipped/photo-gallery/`). Keep it opacity+transform only; no layout animation; no fetch inside `EventTimeline` (data comes pre-attached). Reuse tone/CopyChip discipline.
3. **`src/lib/timeline/`** — new adapter **`unit-photos-events.ts`** → `unitPhotosToTimeline(rows, { source })` mapping photo rows to `TimelineItem` with `media`, tone `info` (testing) / `muted` (unbox), `ref` = the unit serial chip. Export from `src/lib/timeline/index.ts`.
4. **`src/lib/photos/queries/`** — **`unit-timeline-photos.ts`**: `listUnitTimelinePhotos(org, serialUnitId)` returns two tagged buckets:
   - `testing`: SERIAL_UNIT `testing_photo` photos.
   - `unbox`: receiving-unbox photos via `serial_units → serial_unit_provenance (origin_type RECEIVING_LINE) → receiving_lines`, then `RECEIVING_LINE` photos for that line (reuse the walk in `src/lib/photos/queries/library.ts`).
   Each row carries `photoId, thumbUrl, fullUrl, at (created_at), source`.
5. **`src/components/labels/unit-detail/`** — new **`SerialUnitTimelineSection.tsx`** (model on `src/components/shipped/OrderTimelineSection.tsx`): fetch lifecycle events + `listUnitTimelinePhotos`, map via `inventoryEventsToTimeline` + `unitPhotosToTimeline`, **merge → sort desc → `collapseTimeline` → `<TimelineSection>`**. Do all merge/sort in the section, never in `EventTimeline`.
6. **Mount** in `UnitDetailWorkspace` (the `/api/serial-units/[id]` detail pane). Optionally surface `total_photo_count` on `UnitDetailHeader` (already deep-links to `/ops/photos?entityType=SERIAL_UNIT&entityId=…`).

### Phase 5 — Active-card feedback (desktop)

- **`src/components/station/ActiveOrderScanFeedback.tsx`** — after the last-serial chip (~L335) add a small, non-blocking **"📷 photo request sent · N captured"** row for the most-recently-scanned unit. Count comes from `useUnitPhotosRealtimeRefresh` keyed on the resolved `serialUnitId`. Status dot from semantic tokens; big-card state, not a toast (station rule). Do **not** add a browsable list (anti-mix: it's a Station region).

### Phase 6 — Tests, audit, docs

- **E2E (`e2e-spec-writer`):** `tests/e2e/unit-photo-scan.spec.ts` — model on `mobile-photos.spec.ts`: desktop tracking scan → label scan → assert `unit_photo_request` published → phone route opens → upload → assert `photo_entity_links` SERIAL_UNIT row + timeline renders the thumbnail.
- **Unit (`domain-unit-test`):** `listUnitTimelinePhotos` (provenance join returns unbox + testing buckets), `unitPhotosToTimeline` (media mapping, tone/source), the resolve-then-publish decision (fires only when a `serial_units` row exists).
- **Audit:** photo uploads already `recordAudit` inside `/api/photos/upload`; the Ably request is client-side and un-audited (mirrors receiving). No new audit action.
- Update this doc's status; add an auto-memory pointer.

---

## 6. Reuse / SoT compliance checklist

- ✅ **Photo platform SoT** — `uploadPhoto()` + `photo_entity_links` + `/api/photos/upload` GCS-primary; no bespoke storage.
- ✅ **Ably SoT** — reuse `staffstation`/`phone`/`station:changes` channels with new event names; no token-route change; implicit per-staff pairing.
- ✅ **Timeline SoT** — one `EventTimeline` primitive; new capability is an **additive** `media` field + one render branch + an adapter; merge/collapse in the section wrapper; **no second timeline component**.
- ✅ **Station archetype** — desktop stays scan → crossfade → active-card; no browsable list added to the scan region; big-card feedback not a toast.
- ✅ **Backend route skeleton** — reuses `/api/photos/upload` (withAuth → validate → `uploadPhoto` → publish via `after`-style side-effect → recordAudit).
- ✅ **Permission registry** — reuse `tech.scan_serial` (upload) + `sku_stock.view` (read); if `uploadPermissionFor('SERIAL_UNIT')` needs adding, pair with the manifest test (permission-registry-guard).
- ✅ **Polymorphic contract** — no new table; SERIAL_UNIT is an existing `photo_entity_links` discriminator value.
- ✅ **Idempotency** — `uploadPhoto` dedups on GCS object key + `photo_entity_links` unique index; upload queue is offline-durable.

---

## 7. Risks & follow-ups

- **`serial_units` existence** — the intended population (units labeled at receiving) always has a row; pure shipping serials do not. Degrade-not-block (Phase 1). Consider a "mint on demand" only if a real need appears — do **not** auto-create rows from the tech path (would blur the tech_serial_numbers vs serial_units boundary).
- **~~Rapid multi-serial scanning~~ — RESOLVED.** Committed to firing only on genuine unit-label scans (`routeScan(rawInput)?.type === 'serial-unit'`), so ordinary partial-serial confirm scans never open the camera. Layered defenses remain: the phone's `pathname.endsWith('/photos')` re-entry guard + `request_id` dedup, and resolve-batch's null-id degrade for shape-only false-positives.
- **~~`resolve-batch` shape~~ — RESOLVED (verified).** Returns `{ ok, units: [{ serial, unit_uid, serial_unit_id }] }`; use `serial_unit_id` (= `serial_units.id`), treat `null` as no-match. Accepts a normalized-serial array; perm `print.label`.
- **NAS cold-storage mirror** hardcodes `ReceivingPhotos/…` (`src/lib/photos/mirror-nas.ts`) — SERIAL_UNIT testing photos mirrored through it would land under `ReceivingPhotos/`. Cosmetic; add a `units/` branch as a follow-up.
- **`EventTimeline` media on other surfaces** — once `TimelineItem.media` exists, receiving/order timelines could opt in. Out of scope here; keep the render branch generic so they can.

---

## 8. File touch list (quick index)

**New:** `src/lib/realtime/unit-photo-request.ts` · `src/components/sidebar/receiving/useUnitPhotoRequestPublisher.ts` · `src/components/mobile/unit/UnitPhotoRequestCamera.tsx` · `src/components/mobile/unit/UnitPhotoUploadQueue.ts` · `src/app/m/(immersive)/unit-photos/[id]/page.tsx` · `src/components/mobile/photos/MobileUnitPhotoStudio.tsx` · `src/lib/photos/queries/unit-list.ts` · `src/lib/photos/queries/unit-timeline-photos.ts` · `src/hooks/useUnitPhotosRealtimeRefresh.ts` · `src/lib/timeline/unit-photos-events.ts` · `src/components/labels/unit-detail/SerialUnitTimelineSection.tsx` · `tests/e2e/unit-photo-scan.spec.ts`

**Edit:** `src/lib/photos/types.ts` · `src/lib/photos/entity-permissions.ts` · `src/lib/photos/storage/path-builder.ts` · `src/lib/realtime/publish.ts` · `src/app/api/photos/upload/route.ts` · `src/hooks/useStationTestingController.ts` · `src/hooks/station/types.ts` · `src/hooks/station/handleSerialScan.ts` · `src/components/station/StationTesting.tsx` · `src/components/station/ActiveOrderScanFeedback.tsx` · `src/components/mobile/redesign/MobileShell.tsx` (+ bridge mount) · `src/lib/timeline/types.ts` · `src/lib/timeline/index.ts` · `src/components/ui/EventTimeline.tsx` · `src/components/labels/unit-detail/*` (mount + header count) · `src/lib/auth/permission-registry.ts` + `route-permission-manifest.test.ts` (only if SERIAL_UNIT upload perm added)
