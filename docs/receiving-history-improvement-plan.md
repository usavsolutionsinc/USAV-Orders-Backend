# Receiving History — Carrier Status Consistency Improvement Plan

**Status:** Phases A–G implemented (2026-06-04). Plan complete.
**Created:** 2026-06-04
**Owner:** TBD
**Related:** [tracking-live-sync-plan.md](./tracking-live-sync-plan.md) (free cron-polling, carrier webhooks are paid; USPS API now access-gated)

---

## Implementation status (2026-06-04)

Shipped and validated e2e against live FedEx + UPS through the cron poll path
(`scheduler → syncShipment → updateShipmentSummary`):

- **Phase A1/A2/A4** — `updateShipmentSummary` (`src/lib/shipping/repository.ts`)
  now derives `is_delivered` from the append-only event log
  (`bool_or(normalized_status_category='DELIVERED')`), is **monotonic**
  (`is_delivered`/`is_terminal` OR-guarded), takes the earliest delivered event
  as `delivered_at` (LEAST), and enforces `is_delivered ⇒ delivered_at NOT NULL`.
- **Phase A3** — shared `looksDelivered()` text-fallback in `normalize.ts`,
  wired into all three carrier text normalizers; unit-tested
  (`normalize.test.ts`, `npm run test:shipping-status`).
- **Phase B** — one canonical predicate in
  `src/lib/receiving/delivered-unscanned.ts` (`deliveredUnscannedBaseSql` +
  `getDeliveredUnscannedCount`), consumed by the summary tile count and the
  list endpoint, so count === list length by construction (parity unit-tested
  and verified live).
- **Phase C1/C2** — carrier 403/401 → `ACCESS_CONTROL`/`AUTH_ERROR` codes;
  `updateShipmentError` records `tracking_blocked_reason` and backs off 24h.
  New `tracking_blocked_reason` column (migration). `delivery_state` +
  summary expose a `TRACKING_UNAVAILABLE` bucket; sidebar tile + row icon added.
- **Phase F1** — `src/lib/migrations/2026-06-04_reconcile_delivered.sql` adds the
  columns and backfills/reconciles delivered from the event log (applied).

**Validation:** live poll flipped a FedEx and a UPS shipment to `DELIVERED`
(event-log-derived `delivered_at`, sticky terminal), zero coherence/monotonic/
log-disagreement violations across the whole table, count↔list parity holds.

- **Phase F2** — `src/lib/jobs/reconcile-delivered.ts` + cron
  `/api/cron/shipping/reconcile-delivered` (hourly, `vercel.json`): re-derives
  delivered from the event log (catches a logged DELIVERED stranded behind a
  failed summary write / `consecutive_error_count≥5`) and frees error-stuck rows
  for one retry per 12h. Pure SQL, no carrier calls. First live run recovered
  2,211 silently-stuck shipments.
- **Phase E (partial)** — incoming sidebar now has two always-visible controls
  (above the Filters popover so it can't overlay them): **Refresh** (re-reads the
  DB only — reflects cron-poll changes instantly) and **Sync carriers** (re-polls
  UPS/USPS/FedEx via the existing refresh endpoint, then re-reads).

- **Phase D** — `src/lib/jobs/tracking-match-reconcile.ts` (folded into the
  reconcile cron): links inbound `receiving` rows that have a tracking# but no
  `shipment_id` — exact-normalized, then 18-char suffix (D2), else registers a
  new STN for carrier-detectable numbers; tracking-shaped values it still can't
  place go to `tracking_exceptions` (D3). `receiving-lines/route.ts` soft join
  hardened to `LEFT JOIN LATERAL … LIMIT 1` (D1) — deterministic single
  receiving row, no more row-multiplication / arbitrary shipment. First live run
  drained 467→150 unlinked (33 exact, 92 suffix, 192 registered; rest are
  non-carrier refs, left alone). `receiving_lines` has no line-level tracking, so
  D1 tie-break is FK > has-shipment > newest, not tracking-match.

- **Phase G** — `src/lib/jobs/shipping-metrics.ts` + cron
  `/api/cron/shipping/metrics` (every 30 min): emits a structured snapshot
  (`[metrics.shipping.tracking]` — delivered-unscanned, per-carrier
  active/in-transit/delivered-7d/blocked/error-stuck, pending-status,
  open exceptions, unmatched-tracking) and derived alerts
  (`[alert.shipping.tracking]`): USPS access-blocked > 0, error-stuck backlog,
  and a delivered-detection-zero signal (a carrier with live volume but 0
  delivered in 7d → likely an unmapped status code, R3). Logs are the alert
  channel (no Slack integration in this codebase). First snapshot was healthy
  (0 alerts).

- **Phase E (complete)** —
  - E1: `TRACKING_UNAVAILABLE` chip/icon + tile (Phase C).
  - E2: the rose "Delivered · not scanned" facet now shows a per-row carrier +
    age chip ("FedEx · 4h ago") via `ReceivingLineOrderRow`; the tile already
    clicks through to the canonical (delivered_at-desc) list.
  - E3: per-shipment "Last checked" + "Re-poll" already live in
    `IncomingDetailsPanel` (`/api/shipping/track/sync-one`); the incoming sidebar
    Refresh/Sync buttons cover the bulk path.
  - E4: per-carrier breakdown in the summary (`by_carrier`, deduped — sums to the
    delivered-unscanned tile) rendered in the Filters popover ("By carrier:
    Deliv / Unav / Trans" per UPS/USPS/FedEx).

**Plan complete.** All correctness (A), single-source-of-truth (B), carrier-
blocked honesty (C), match reliability (D), UI consistency (E), data integrity +
reconcile (F), and observability (G) work is shipped and validated.

---

## 1. Problem statement

The receiving **history / incoming** views show carrier status (and the **"Delivered · not scanned"** tile) **inconsistently across carriers**. A package the carrier has actually delivered does not reliably show as `DELIVERED`, so the "delivered but not scanned" surface — which should list *every* carrier-delivered package the dock hasn't scanned yet — under-counts and drifts.

The "Delivered · not scanned" state is the operationally important one: it tells the receiving team **"a box is physically here / arriving that we haven't processed."** If it's wrong, packages get missed, sit unlogged, or the team loses trust in the tile.

**Goal:** one **carrier-agnostic, reliable `DELIVERED` signal** feeding a **single source of truth** for "delivered but not scanned," fresh enough to be trusted, and surfaced consistently in the history UI for FedEx, UPS, and USPS alike.

---

## 2. How it works today (as-is)

**UI**
- Mobile history: `src/app/m/receiving/history/page.tsx` (query key `mobile-receiving-search`), rows via `src/components/mobile/receiving/MobileReceivingRow.tsx`.
- Incoming sidebar tiles: `src/components/sidebar/receiving/IncomingSidebarPanel.tsx:47-108` — the **"Delivered · not scanned"** tile (`DELIVERED_UNOPENED`, rose tone), polled ~30s.
- Status badge: `src/components/shipping/ShipmentStatusBadge.tsx` (`normalizeCategory`, stalled-after-72h logic).
- Detail panel carrier state: `src/components/sidebar/receiving/IncomingDetailsPanel.tsx` (now live via `shipment.changed` + 60s refetch — see tracking-live-sync-plan §3.5).

**Data flow**
- Carrier sync (`src/lib/shipping/sync-shipment.ts`) → `updateShipmentSummary` (`src/lib/shipping/repository.ts:186-280`) writes `latest_status_category`, `is_delivered`, `delivered_at` onto `shipping_tracking_numbers` (STN); events appended to `shipment_tracking_events`.
- Per-carrier normalization: `src/lib/shipping/normalize.ts` (`normalizeUPSStatus`, `normalizeUSPSStatus`, `normalizeFedExStatus`).
- "Delivered · not scanned" computed **on read** (CQRS-style), two places that must agree:
  - `src/app/api/receiving-lines/route.ts:593-629` (`incomingExtrasSelect`): `stn.is_delivered = true AND NOT EXISTS (receiving_scans for r.id)`.
  - `src/app/api/receiving-lines/incoming/summary/route.ts:47-52` **and** a second shipment-anchored recount at `:104-133` (because the PO-line filter "always reads ~0" — see its own comment).
  - Standalone list: `src/app/api/receiving-lines/incoming/delivered-unscanned/route.ts` (30-day window, dedupe by `tracking_number_normalized`, cap 100).
- Tracking ↔ receiving join: `receiving_lines.receiving_id → receiving.id` (soft fallback by `zoho_purchaseorder_id`) → `receiving.shipment_id → shipping_tracking_numbers.id` (`route.ts:159-173, 662-668`).

---

## 3. Root-cause analysis (why it's inconsistent)

| # | Root cause | Effect on "delivered" consistency |
|---|---|---|
| **R1** | **`DELIVERED` is derived only from the *latest snapshot*.** `updateShipmentSummary` overwrites `latest_status_category` each sync; `is_delivered = (latest === 'DELIVERED')`. A **late-arriving or out-of-order event** (common on USPS) can leave `latest` on `OUT_FOR_DELIVERY` even after a `DELIVERED` event exists in the append-only log. | Delivered package reads as not-delivered → missing from the tile. |
| **R2** | **`is_delivered` / `delivered_at` can drift.** `delivered_at` is set once and locked; `is_delivered` recomputes each sync. DELIVERED→(rare)RETURNED, or a parse miss, flips `is_delivered=false` while `delivered_at` stays set. | Row shows a delivered date but is excluded from delivered counts. |
| **R3** | **Per-carrier `DELIVERED` detection differs and is brittle.** UPS `statusType='D'`, FedEx `eventType ∈ {DL,DT}`, USPS `statusCategory='DELIVERED'`, each with a text-regex fallback. A new/edge status code a carrier introduces falls through to `UNKNOWN`. | One carrier's deliveries silently don't map → cross-carrier inconsistency. |
| **R4** | **USPS is currently access-blocked (HTTP 403).** USPS "Tracking API Access Controls" (4/1/2026) reject our MID until an IP Agreement is approved (see tracking-live-sync-plan). USPS shipments therefore **never** advance to `DELIVERED` via polling. | All USPS packages stuck pre-delivered → the tile is systematically blind to USPS. **This is likely the biggest single contributor.** |
| **R5** | **Two independent "delivered-unscanned" computations** (summary PO-line filter vs shipment-anchored recount vs the standalone list endpoint), with different windows (30d) / dedupe / INBOUND predicates. They can return different numbers. | Tile count ≠ list length ≠ row badges. |
| **R6** | **Staleness between syncs.** Even post-pivot (15-min sweep, OFD 30m), a carrier delivery can lag the UI by up to the cadence interval; the tile polls every 30s but the underlying STN only changes on sync. | Transient under-count right after a delivery. |
| **R7** | **Soft-join fallback can attach the wrong shipment** when `receiving_id IS NULL` and multiple receiving rows share a PO. | Wrong/again-missing delivered status on a line. |
| **R8** | **`NULL`/`UNKNOWN` latest status** classified as `PENDING_CARRIER` even when an earlier sync had `is_delivered=true`. | Tile says pending; cell hints delivered. |

**Theme:** delivered-ness is computed from a *mutable latest snapshot* and detected *per-carrier with brittle maps*, then read through *multiple non-identical queries* — and one carrier (USPS) is currently dark. The fix is to make `DELIVERED` **monotonic, event-log-derived, carrier-agnostic, and read through one query.**

---

## 4. Goals & success criteria

1. **Carrier-agnostic delivered signal** — a delivered package shows `DELIVERED` identically whether FedEx, UPS, or USPS.
2. **Monotonic terminal state** — once a `DELIVERED` event is observed, the shipment stays delivered (a later out-of-order in-transit event can't un-deliver it).
3. **Single source of truth** — tile count, list, and row badge all derive from one query/helper; they always agree.
4. **Honest carrier-blocked state** — USPS (or any carrier) that we *cannot* reach is shown as `TRACKING_UNAVAILABLE`, not silently stuck pre-delivered.
5. **Trustworthy freshness** — every row shows "last checked", supports on-demand re-poll, and the tile reflects reality within one sweep.
6. **No regressions** to FedEx/UPS happy paths or existing receiving flows.

**Acceptance:** for a labeled test set across all three carriers, every carrier-delivered + dock-unscanned package appears in "Delivered · not scanned"; count == list length == sum of row badges; USPS-blocked packages render as `TRACKING_UNAVAILABLE` (not delivered/pending).

---

## 5. Solution — phased

### Phase A — Make `DELIVERED` correct & monotonic at the source *(highest leverage)*
**Files:** `src/lib/shipping/repository.ts` (`updateShipmentSummary`), `src/lib/shipping/normalize.ts`, `src/lib/shipping/sync-shipment.ts`

- **A1. Derive delivered from the event log, not just the latest snapshot.** In `updateShipmentSummary`, set `is_delivered = true` if **any** event in `shipment_tracking_events` for the shipment has `normalized_status_category = 'DELIVERED'` (or the incoming result does). Compute `delivered_at` as the earliest such event time.
- **A2. Make terminal states monotonic.** Never flip `is_delivered` back to false once true. Guard with `is_delivered = shipping_tracking_numbers.is_delivered OR <new>`. Keep `latest_status_category` as the true latest for display, but add a separate **`effective_status`** (or reuse `is_terminal`) so "delivered" is sticky even if a stray later event arrives.
- **A3. Harden per-carrier DELIVERED detection.** Audit `FEDEX_EVENT_TYPE_MAP` / `UPS_STATUS_TYPE_MAP` / `USPS_CATEGORY_MAP` against current carrier docs; ensure the **text-fallback** reliably catches "Delivered", "Left at", "Received by", "Picked up at locker", etc. Add unit tests with real payload samples per carrier.
- **A4. Coherence invariant.** Enforce `is_delivered ⇒ delivered_at IS NOT NULL` (and vice-versa) in `updateShipmentSummary`; add a CHECK or a reconcile pass (Phase F).

### Phase B — One source of truth for "delivered but not scanned"
**Files:** new `src/lib/receiving/delivered-unscanned.ts`; refactor `incoming/summary/route.ts`, `incoming/delivered-unscanned/route.ts`, `receiving-lines/route.ts`

- **B1. Extract one canonical SQL/helper** — `deliveredUnscannedPredicate()` + `getDeliveredUnscanned({ windowDays, limit })` — used by **all three** read paths (tile count, list, row `delivery_state`). Delete the duplicate shipment-anchored recount once the single helper covers the PO-line-less shipments.
- **B2. Anchor on the shipment, not the PO line** (the recount comment already proves PO-line anchoring reads ~0): the unit is "an inbound STN row that is delivered and has no `receiving_scans` for its receiving row (or has no receiving row yet)."
- **B3. Align window/dedupe/INBOUND predicate** across count and list so `count === list.length` by construction. Make the 30-day window a shared constant.

### Phase C — Honest carrier-availability state (handles USPS 403)
**Files:** `src/lib/shipping/sync-shipment.ts`, `repository.ts`, `normalize.ts`/types, `ShipmentStatusBadge.tsx`, `IncomingSidebarPanel.tsx`

- **C1. Record carrier-unreachable distinctly.** When a carrier returns an auth/access error (USPS 403 access-control, repeated 401/403), set a `tracking_blocked_reason` (e.g., `USPS_ACCESS_CONTROL`) and surface a `TRACKING_UNAVAILABLE` display state — *not* `UNKNOWN`/`PENDING_CARRIER`. Already have `consecutive_error_count`/`last_error_code` to build on.
- **C2. Stop hammering blocked carriers.** If `last_error_code = 403 access-control`, push `next_check_at` far out (e.g., daily) until cleared, so we don't burn the USPS 60/hr quota re-failing.
- **C3. Surface it in UI** — a distinct chip ("USPS tracking pending access approval") so the team understands why USPS delivered status is missing, instead of mistaking it for "not delivered." Ties to the USPS IP-Agreement request in tracking-live-sync-plan.

### Phase D — Tracking ↔ receiving match reliability
**Files:** `src/lib/tracking-format.ts`, `receiving-lines/route.ts` join, `tracking_exceptions`

- **D1. Wrong-shipment guard** on the soft join: when `receiving_id IS NULL` and >1 receiving row shares the PO, prefer the row whose `tracking_number_normalized` matches the line, else leave unmatched (don't grab arbitrarily).
- **D2. Suffix-match fallback** using existing `normalizeTrackingKey18` / `normalizeTrackingLast8` when an exact normalized match fails (carrier barcode vs human-readable form — e.g., the 34-digit FedEx form we saw resolves to a 12-digit number).
- **D3. Match telemetry** — count lines with a tracking number but no STN link; route to `tracking_exceptions` for triage instead of silently showing no status.

### Phase E — History UI consistency
**Files:** `MobileReceivingRow.tsx`, `ReceivingLinesTable.tsx`, `ShipmentStatusBadge.tsx`, history `page.tsx`, `IncomingSidebarPanel.tsx`

- **E1. One status chip component** for all carriers, driven solely by `latest_status_category` + the sticky delivered flag + `TRACKING_UNAVAILABLE`. Identical rendering regardless of carrier; show carrier as a small glyph, not a different status vocabulary.
- **E2. Delivered-not-scanned prominence** — make the rose tile click through to the canonical list (Phase B), sorted by `delivered_at` desc, with carrier + age ("delivered 4h ago, not scanned").
- **E3. "Last checked" + manual re-poll** on every history row/detail (re-poll already exists in `IncomingDetailsPanel`), so staleness (R6) is visible and fixable on demand.
- **E4. Per-carrier filter/breakdown** on history so the team can see, e.g., "USPS: 12 unavailable, FedEx: 3 delivered-unscanned."
- **E5. Live updates** already wired via `shipment.changed` (tracking-live-sync §3.5) — ensure the history list query keys are in the invalidation set.

### Phase F — Data integrity & backfill
**Files:** new migration `src/lib/migrations/2026-06-XX_reconcile_delivered.sql` + one-off script

- **F1. Backfill `is_delivered`/`delivered_at` from the event log** (apply A1/A2 retroactively): set delivered for any STN with a historical `DELIVERED` event; fix coherence violations (R2).
- **F2. Reconcile cron / guard** — a periodic check that flags STN rows where `is_delivered` disagrees with the event log, or that hit the `consecutive_error_count >= 5` cutoff (the open Phase-2 item in tracking-live-sync-plan — those silently stop updating).

### Phase G — Observability
- **G1. Structured logs/metrics** on delivered-unscanned count, per-carrier delivered counts, `TRACKING_UNAVAILABLE` counts, unmatched-tracking counts.
- **G2. Alert** when USPS-blocked count > 0 (reminds you the IP Agreement is still pending) and when any carrier's delivered-detection rate drops (possible new status code → R3).

---

## 6. Data-model changes (minimal)
- Add `tracking_blocked_reason TEXT NULL` to `shipping_tracking_numbers` (C1).
- (Optional) `delivered_source TEXT` ('event_log' | 'latest' | 'manual') for auditability.
- No change needed to the carrier-agnostic webhook-subscription columns (unrelated; dormant).
- Reconcile/backfill migration (F1). All additive.

---

## 7. Testing plan
- **Unit (extend `usps-subscription.test.ts` pattern, `tsx --test`):** per-carrier normalization incl. delivered text-fallbacks (A3); monotonic delivered (A2 — DELIVERED then a later OUT_FOR_DELIVERY stays delivered); coherence invariant (A4); `deliveredUnscannedPredicate` (B1).
- **Query parity test:** assert tile count == list length for a seeded fixture (B3).
- **Live spot-checks:** the throwaway poll harness already validated FedEx/UPS live; re-run a known **delivered** number per carrier to confirm `DELIVERED` maps (USPS pending access).
- **Regression:** existing FedEx/UPS receiving flows unchanged; `npx tsc --noEmit` clean.

---

## 8. Sequencing / rollout
1. **Phase A** (source correctness) + **F1 backfill** — fixes the largest share immediately and is prerequisite for everything else.
2. **Phase B** (single source of truth) — makes counts/list/badges agree.
3. **Phase C** (USPS-blocked state) — stops USPS from poisoning the picture; pair with the USPS IP-Agreement request.
4. **Phase E** (UI consistency) — surfaces the now-correct data.
5. **Phase D, G** (match reliability, observability) — harden + monitor.

Each phase ships independently behind the existing patterns; no big-bang.

---

## 9. Risks & open questions
- **USPS access (R4/C)** is an external dependency — until the IP Agreement clears, USPS delivered status is *unobtainable*; the plan makes that honest (`TRACKING_UNAVAILABLE`) rather than fixing it in code.
- **Monotonic delivered (A2)** vs legitimate returns: confirm whether a delivered-then-returned package should leave the delivered-unscanned list (proposal: a delivered package that later goes RETURNED drops off the *unscanned* surface but keeps `delivered_at` for history).
- **Window size (30d):** confirm with ops whether older delivered-unscanned items should still surface.
- **Neon cost:** event-log-derived delivered (A1) adds a read per sync; bounded and cheap, but confirm against the cost budget.
- Need a labeled **per-carrier delivered test set** (real tracking numbers) to validate A3/A4 — FedEx/UPS available now; USPS blocked.

---

## 10. Appendix — key file references
- UI: `src/app/m/receiving/history/page.tsx`, `src/components/mobile/receiving/MobileReceivingRow.tsx`, `src/components/sidebar/receiving/IncomingSidebarPanel.tsx:47-108`, `src/components/sidebar/receiving/IncomingDetailsPanel.tsx`, `src/components/shipping/ShipmentStatusBadge.tsx`
- Read paths: `src/app/api/receiving-lines/route.ts:593-629` (incoming extras), `:1248-1346` (`normalizeRow`); `incoming/summary/route.ts:47-52,104-133`; `incoming/delivered-unscanned/route.ts`
- Status source: `src/lib/shipping/normalize.ts`, `src/lib/shipping/repository.ts:186-280` (`updateShipmentSummary`), `src/lib/shipping/sync-shipment.ts`
- Matching: `src/lib/tracking-format.ts` (`normalizeTrackingNumber`, `normalizeTrackingKey18`, `normalizeTrackingLast8`)
- Tables: `receiving`, `receiving_lines`, `shipping_tracking_numbers`, `shipment_tracking_events`, `receiving_scans`, `zoho_po_mirror`, `tracking_exceptions`
