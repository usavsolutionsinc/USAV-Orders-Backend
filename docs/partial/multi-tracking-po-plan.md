# Multi-Tracking → PO Plan

**FINAL STATUS: SUPERSEDED / COMPLETE — archivable. Migrations verified APPLIED 2026-06-29 (db ledger 0 pending).**
Capability ships via the generic `shipment_links` SoT (`owner_type=RECEIVING`); this plan's own
`receiving_shipments` table + `expected_box_count` column were created then DROPPED (28o/28p/28q —
all APPLIED ✅, deploy cutover done) once `shipment_links` subsumed them.
**SUPERSEDED-BY:** `src/lib/shipping/shipment-links.ts` (linkage SoT).

**Status:** plan-only (2026-06-09)
**Flag:** `RECEIVING_MULTI_BOX` (additive; nothing user-visible until Phase 3)
**Principle:** keep `reference# = tracking number` as the anchor. The existing
single-box unbox flow is **never changed** — multi-box is a layer that sits
*beside* it.

---

## 1. Problem

A vendor ships one PO as 10 cartons, each with its own carrier label. Today the
system treats a Zoho PO's single `reference_number` as **the** tracking number
for the whole PO:

- `zoho_po_mirror.reference_number` carries the tracking per the inbound contract.
- On sync that one reference# is registered into `shipping_tracking_numbers`
  (UNIQUE on `tracking_number_normalized`) and stamped onto `receiving.shipment_id`.
- `ux_receiving_zoho_po_matched` enforces **one `receiving` row per Zoho PO**.

So a 10-box PO collapses to one carton pinned to one tracking. Scanning any of
the other 9 labels falls through `lookup-po` to the unmatched/`NO_PO` path — the
receiver has no way to say "this box also belongs to PO-1234."

---

## 2. How Zoho natively handles this (answer: it mostly doesn't)

Investigated against the live integration (`src/lib/zoho.ts`):

- **Purchase Orders have no native tracking field.** The only free-text slots are
  `reference_number` (single) and `notes`. There is no repeatable tracking list.
- **Purchase Receives have no native tracking field either.**
  `searchPurchaseReceivesByTracking()` (`src/lib/zoho.ts:237`) finds a receive
  only via `search_text` (full-text across the receive), not a dedicated field —
  proof that tracking lives nowhere structured on the purchase side.
- **Tracking is first-class only on the SALES/outbound side** — Zoho Shipment
  Orders / Packages carry `tracking_number`, `carrier`, `tracking_url`, and a
  sales order can have many packages. None of that machinery exists for purchases.

The native Zoho mechanisms you *could* lean on, and why each is limited:

| Zoho native option | What it gives | Limitation |
|---|---|---|
| `reference_number` | One tracking, searchable via `reference_number=` param | Single value — already used for box 1 |
| Multiple **Purchase Receives** per PO | Real "PO arrived in N shipments" model; drives received-qty / partial-receipt | Receive has **no tracking field**; tracking still goes in reference/notes |
| **Custom fields** (`custom_fields[]`, present on `ZohoPurchaseOrder`) | Structured, API-readable, picked up by `search_text` | Scalar — no native list; N trackings = one delimited field or N fixed fields |
| `notes` | Free text, picked up by `search_text` | Unstructured |

**Conclusion:** there is no clean native place in Zoho to hold an arbitrary set
of tracking numbers per PO. Forcing Zoho to be the source of truth for the extra
boxes means abusing a delimited custom field. **So Zoho stays the anchor only
(`reference_number` = primary box), and our own `receiving_shipments` junction is
the source of truth for the extra cartons.**

### Optional Zoho mirror (bonus, not required)

If Zoho-side visibility is wanted, write the extra trackings into a **PO custom
field** (e.g. `cf_additional_tracking`, newline-delimited) or `notes`. Useful
side effect: both are indexed by Zoho `search_text`, and our existing
`searchPurchaseOrdersByTracking()` already searches `search_text` — so a
secondary tracking written there would let the *existing* tracking→PO lookup
resolve box 2..N with **no new Zoho endpoint**. This is a Phase 5 nicety, not a
dependency.

---

## 2b. Strategic frame — local system as SoT for the *inbound physical* layer

This plan is Phase 1 of a deliberate system-of-record split. It is **not** a
wholesale "replace Zoho" — it's drawing the SoT line where it already naturally
falls. Zoho cannot model inbound tracking at all (§2), and this system is already
the de-facto owner of scans, `serial_units`, carrier state, and station sessions.

**System-of-record by bounded context:**

| Domain | SoT | Sync direction |
|---|---|---|
| PO exists, ordered lines/qty, vendor, pricing, bills | **Zoho** | Zoho → local (mirror/read, as today) |
| Tracking numbers + carrier delivery state | **This system (STN)** | already true — carrier polling writes STN |
| Which box(es) a PO arrived in (tracking ↔ PO, many-to-many) | **This system** | local-owned `receiving_shipments` |
| Which line arrived in which box | **This system** | `receiving_lines.shipment_id` |
| Received qty / serials / condition / disposition | **This system** | local → Zoho **write-back** (Purchase Receive) |

**Two disciplines that make the split safe:**

1. **STN stays PO-agnostic.** Do NOT denormalize a PO# onto
   `shipping_tracking_numbers`. The tracking↔PO link lives only in
   `receiving_shipments`, so one tracking can serve many POs (the existing
   `multi_po_warning` case) and be reused for returns/outbound. STN remains a pure
   "this carrier label exists, state = X" fact table.
2. **Flip the sync direction for received state.** Today tracking is *pulled* from
   Zoho (`reference_number`). Target: local owns tracking↔PO, and received
   quantities are *pushed back* to Zoho as a Purchase Receive (existing
   `purchasereceive` support in `src/lib/zoho.ts`). Zoho stays correct for
   inventory/accounting without ever being the tracking SoT. `reference# = tracking`
   stays a back-compat shim — box 1's seed, not the source.

**Out of scope (do NOT do):** creating POs locally, or becoming SoT for
procurement/financials. Purchasing stays in Zoho. The value is entirely in owning
the inbound physical layer Zoho can't represent.

## 3. Model: anchor box unchanged, extras additive

```
PO (receiving row, source='zoho_po')
 ├── PRIMARY box  = reference# tracking = receiving.shipment_id   ← unchanged, today's flow
 └── EXTRA boxes  = additional trackings, attached via junction   ← new, additive
```

The reference# tracking stays the anchor carton. `lookup-po`'s primary resolve
path, the `ux_receiving_zoho_po_matched` constraint, and the unbox workspace are
all untouched. Extra cartons are *added on top* of an already-anchored PO.

---

## 4. Schema — one new junction table

```sql
CREATE TABLE receiving_shipments (
  id            BIGSERIAL PRIMARY KEY,
  receiving_id  INTEGER  NOT NULL REFERENCES receiving(id) ON DELETE CASCADE,
  shipment_id   BIGINT   NOT NULL REFERENCES shipping_tracking_numbers(id) ON DELETE CASCADE,
  box_seq       INTEGER  NOT NULL DEFAULT 1,     -- 1 = primary
  is_primary    BOOLEAN  NOT NULL DEFAULT false, -- true = the reference# tracking
  received_at   TIMESTAMPTZ,
  received_by   INTEGER REFERENCES staff(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (receiving_id, shipment_id)
);

CREATE INDEX idx_receiving_shipments_receiving ON receiving_shipments(receiving_id);
CREATE INDEX idx_receiving_shipments_shipment  ON receiving_shipments(shipment_id);

-- Optional denominator for the "X of N boxes" chip; null = open-ended.
ALTER TABLE receiving ADD COLUMN IF NOT EXISTS expected_box_count INTEGER;
```

Makes PO↔carton many-to-many in one place, and naturally also models the existing
reverse case (one shipment shared by multiple POs → multiple junction rows).
`receiving.shipment_id` stays the canonical primary pointer; the junction is a
superset.

### Backfill (existing POs read as correct, 1-box, for free)

```sql
INSERT INTO receiving_shipments (receiving_id, shipment_id, box_seq, is_primary, received_at, received_by)
SELECT id, shipment_id, 1, true, received_at, received_by
FROM receiving
WHERE shipment_id IS NOT NULL
ON CONFLICT (receiving_id, shipment_id) DO NOTHING;
```

---

## 5. Attach path — a *separate* endpoint, `lookup-po` untouched

```
POST /api/receiving/:id/attach-box   { trackingNumber, carrier? }
```

1. `registerShipmentPermissive(trackingNumber)` → idempotently mints/finds the
   `shipping_tracking_numbers` row (so the existing carrier-delivery cron sweep
   polls this box too).
2. Insert a `receiving_shipments` row (`box_seq = max+1`, `is_primary=false`,
   `received_at=now`, `received_by`).
3. Clear any unfound / `NO_PO` exception for that tracking.

Items for the extra box keep living on the **same `receiving_id`** —
`receiving_lines` are untouched. Optionally stamp `receiving_lines.shipment_id`
(the flag-gated column already added 2026-06-08) during unbox to record which box
each item came in; **not required for v1**.

---

## 6. UI — additive chrome on both modes

**Unbox mode (`?mode=receive`):** wrap the existing line list in a
`CollapsibleGroupRow` carton-group header with a `Box 1 of N · received X/N` chip
and a **"+ Add box to this PO"** button (calls `attach-box`). The unbox
interaction underneath is identical to today.

**Triage mode (Unfound list):** each unfound carton gets a **"Link to PO"**
action → searches open/recent POs (`zoho_po_mirror` + local lines, already
available) → confirm calls `attach-box`. The carton leaves the unfound queue.

**Rollup chip:** `received = count(receiving_shipments WHERE received_at IS NOT NULL)`.
Denominator = `receiving.expected_box_count` if the receiver set it, else
open-ended ("3 boxes received").

---

## 7. Phasing (behind `RECEIVING_MULTI_BOX`)

1. **Schema + backfill** — table, indexes, `expected_box_count`, backfill script.
   Zero behavior change; primary path keeps working. ✅ **DONE** —
   `src/lib/migrations/2026-06-09_receiving_shipments.sql`,
   `scripts/backfill-receiving-shipments.sql`, Drizzle `receivingShipments`.
   *Pending: run `npm run db:migrate` + the backfill against the DB.*
   **SUPERSEDED 2026-06-28** — the `receiving_shipments` table + `receiving.expected_box_count`
   were created then DROPPED (28o/28q); the generic `shipment_links` SoT
   (`owner_type=RECEIVING`, `src/lib/shipping/shipment-links.ts`) now carries the PO↔carton link.
2. **`attach-box` endpoint + read-model** — queries return a PO's carton list.
   ✅ **DONE (endpoint + UI wire)** — `POST /api/receiving/[id]/attach-box`
   registers the tracking via the shipping backbone, self-heals the primary
   junction row, and returns the full box list. Wired into `LineEditPanel`'s
   top-bar tracking editor (`onCommitExtraTracking` → `attachExtraBox`): adding
   an extra tracking now attaches a box to the carton's PO (was localStorage-only)
   and clears the row for rapid multi-box scanning. Read-model (carton-list query
   for the group header) still TODO.
3. **Unbox carton group + "Add box"** — the everyday path.
4. **Triage "Link to PO"** — recovers boxes that arrive unfound.
4b. **Incoming-tab PO search + attach-tracking popover** — pre-register a
   vendor's tracking numbers against a PO *before* the boxes arrive (this is
   where a multi-tracking manifest actually shows up). In
   `IncomingSidebarPanel`, a popover (Radix) searches POs via
   `/api/receiving/po/list?search=` and, on a selected PO, scans/enters
   tracking numbers that attach via a new PO-level endpoint
   `POST /api/receiving/po/[poId]/attach-box`. That endpoint **get-or-creates
   the PO's `receiving` carton without a Zoho round-trip** (source='zoho_po',
   no line-link so workflow stays EXPECTED and the PO stays in Incoming) and
   reuses the shared `attachBoxToReceiving` core. Because `view=incoming` joins
   the carton by PO id preferring `shipment_id IS NOT NULL`
   (receiving-lines/route.ts:211-221), the first attached tracking flips the
   row's `delivery_state` from **AWAITING_TRACKING → carrier status** for free.
   Shared core extracted to `src/lib/receiving/attach-box.ts`
   (`attachBoxToReceiving` + `ensureReceivingForPo`), reused by the carton-level
   `[id]/attach-box` route too. ✅ **DONE.**
5. *(optional)* Zoho mirror of extras into a searchable PO custom field; per-item
   box mapping via `receiving_lines.shipment_id`; expected-count input;
   packing-list / ASN ingest.

Nothing before Phase 3 is user-visible, and the reference#-tracking unbox flow is
identical at every phase.

---

## 8. Files in scope

- **Schema:** new `src/lib/migrations/2026-06-09_receiving_shipments.sql`;
  `src/lib/drizzle/schema.ts` (add `receiving_shipments`, `receiving.expected_box_count`).
- **Endpoint:** new `src/app/api/receiving/[id]/attach-box/route.ts`; reuse
  `registerShipmentPermissive`.
- **Read-model:** `src/lib/neon/receiving-queries.ts` (carton list per PO),
  `src/app/api/receiving-lines/route.ts` (rollup count).
- **UI:** `LineEditPanel` / unbox workspace (carton group + Add box),
  `TriageUnfoundList` (Link to PO).
- **Untouched on purpose:** `src/app/api/receiving/lookup-po/route.ts` primary
  path, `ux_receiving_zoho_po_matched`, `receiving.shipment_id`.

---

## Session 2026-06-28/29 — completion pass

- Migration status verified 2026-06-29 (db ledger 0 pending): 28o/28p/28q all APPLIED — the legacy
  `receiving_shipments` table + `receiving.expected_box_count` are dropped and the deploy cutover happened.
- No code changes — doc-only status reconciliation.
- Verified live: `src/lib/receiving/attach-box.ts`
  (`attachBoxToReceiving` / `ensureReceivingForPo` / `listBoxesForReceiving` via `linkShipment`),
  carton-level `POST /api/receiving/[id]/attach-box` + PO-level
  `POST /api/receiving/po/[poId]/attach-box` (both `withAuth` + `recordAudit`), and the Incoming
  pre-register popover (`IncomingAttachTrackingPopover`).
- Confirmed the plan's `receiving_shipments` table + `expected_box_count` were created then DROPPED
  (28o/28q); capability is now carried by the generic `shipment_links` SoT (`owner_type=RECEIVING`).

---

## Remaining work — handoff (2026-06-28 / verified 2026-06-29)

- **[MIGRATION-DEPLOY-COUPLED] ✅ APPLIED (verified 2026-06-29, db ledger 0 pending).** The 28q
  legacy-table drop (with 28o/28p) is applied and the column-free app code deploy cutover happened;
  no further migration action. (Separate `.gated` composite-PK swaps for `fba_fnskus`/`sku_catalog`
  are a different, still-pending concern tracked in tier0 — not this plan.)
- **[CODE]** Confirm Phase 4 triage "Link to PO" routes through `attach-box` (vs only the
  Package-Pairing relink path); wire it through `attachBoxToReceiving` if missing.
- **[DEFERRED-BY-DESIGN]** Phase 5 Zoho `cf_additional_tracking` mirror / ASN (packing-list) ingest.

Plan is fully superseded/complete and archivable out of `docs/partial/` (the Phase 4 triage check is
the only optional cleanup left).
