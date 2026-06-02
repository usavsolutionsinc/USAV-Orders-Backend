# Carrier Tracking Live-Sync Production Plan

**Status:** Proposed
**Created:** 2026-06-02
**Owner:** TBD
**Goal:** Eliminate stale carrier tracking displays (currently up to ~21h behind the carrier's own status) and keep FedEx/UPS/USPS tracking in near-real-time sync.

---

## 1. Problem statement

The app displays `FEDEX · label created · 21 hours ago` while FedEx's own tracking shows the shipment is already in transit ("Arrived at FedEx location"). This is a **sync-freshness bug**, not a rendering bug.

### Root cause (confirmed against the codebase)

1. **Slow polling for early-stage shipments.** `src/lib/shipping/normalize.ts:220-245` (`computeNextCheckAt()`) sets the poll interval for a `LABEL_CREATED` shipment to **8 hours**. The Vercel cron only sweeps 50–100 shipments every 2h (`vercel.json`). A 21-hour-stale `LABEL_CREATED` status is the predictable result.
2. **Webhook receivers exist but are likely never fed.** `src/app/api/webhooks/fedex/route.ts` and `src/app/api/webhooks/ups/route.ts` are implemented, but a receiver does nothing unless the carrier is actively **subscribed** to push events for that tracking number. FedEx push requires registering each shipment (or the account) via FedEx's subscription API. **If we never call the subscription API, no events are ever pushed**, and we silently fall back to the slow 8h polling.

---

## 2. Research summary (deep-research, 24 sources, 15 claims confirmed / 10 refuted)

### Confirmed findings

| # | Finding | Confidence |
|---|---------|-----------|
| 1 | FedEx offers native **"Near Real Time Track Event Push (Webhooks)"** (Advanced Integrated Visibility). Two subscription models: **account-number** (richer data, account holders) and **tracking-number** (more limited, Integrators; batches up to **1,000 tracking numbers/request**). **US accounts only.** No numeric latency SLA. | High |
| 2 | FedEx Track API polling has a hard **100,000 requests/day quota (PCPP)** resetting at **00:00 GMT**. Exhausting it blocks ALL polling until midnight GMT. Effective Oct 15 2023. | High |
| 3 | Aggregators (EasyPost, Shippo, AfterShip) normalize multi-carrier events and add their own webhook layer, but their "real-time" is bounded by their own polling cadence (e.g. TrackingMore polls carriers every **4–6h**). Trade integration convenience for latency + cost + a third party in the path. | Medium |
| 4 | Webhook reliability rules are universal: respond **2xx fast** (EasyPost: <7s), defer heavy work to a queue; **at-least-once delivery is standard so duplicates are guaranteed** → idempotent handlers keyed on event ID are mandatory; providers retry but some (Twilio) don't, so a polling fallback is still required. | High |
| 5 | `pg-boss` is a Postgres-native queue (2s default poll, 500ms min) — relevant only if we move to a persistent Node process. **We are on Vercel cron (serverless)**, so pg-boss does not fit cleanly today. | High |

### Refuted claims (killed by adversarial review — do NOT design around these)

- ❌ FedEx provides a "7-day missed-event retrieval/replay window." (votes 0-3, 1-2) → **We cannot rely on FedEx to backfill missed webhook events. Polling is our recovery mechanism.**
- ❌ "EasyPost webhooks eliminate the need to poll." (0-3) → Aggregators still poll under the hood.
- ❌ "Transactional outbox guarantees exactly-once delivery." (1-2) → Idempotency on event ID is the real defense.
- ❌ "FedEx Account Number Subscription covers all shipment directions (inbound/outbound/third-party)." (0-3) → Verify coverage per subscription.

### Key sources

- FedEx webhooks: `developer.fedex.com/api/en-us/webhookmarketing.html`, `/catalog/account-number-subscription.html`, `/catalog/tracking-number-subscription.html`, Feb 2025 release notes
- FedEx quotas: `developer.fedex.com/api/en-us/guides/ratelimits.html`
- Webhook reliability: `hookdeck.com/webhooks/guides/implement-webhook-idempotency`, `easypost.com/webhooks-guide/node`
- Queue: `github.com/timgit/pg-boss`

---

## 3. Current architecture (as-is)

The architecture is largely correct — the gaps are **activation** and **freshness**, not design.

**Carrier API integrations**
- `src/lib/shipping/providers/fedex.ts` — OAuth + `track/v1/trackingnumbers`
- `src/lib/shipping/providers/ups.ts` — OAuth + `track/v1/details`
- `src/lib/shipping/providers/usps.ts` — OAuth + `tracking/v3/tracking`

**Status normalization & display**
- `src/lib/shipping/normalize.ts` — `normalizeFedExStatus()`, `normalizeUPSStatus()`, `normalizeUSPSStatus()`, `computeNextCheckAt()`
- `src/components/shipping/ShipmentStatusBadge.tsx` — renders category, "stalled" if `latestEventAt` > 72h old

**Polling (Vercel cron in `vercel.json`)**
- Every 2h: `/api/cron/shipping/sync-due?limit=100&concurrency=5`
- Daily 00:00 Tue–Sat: `/api/cron/shipping/sync-due?limit=200&concurrency=8&carriers=UPS,USPS,FEDEX`
- Engine: `src/lib/shipping/scheduler.ts` (`runDueShipments()`), `src/lib/shipping/sync-shipment.ts` (`syncShipment()`)

**Polling cadence** (`normalize.ts:220-245`): LABEL_CREATED 8h · ACCEPTED 4h · IN_TRANSIT 2h · OUT_FOR_DELIVERY 45m · EXCEPTION 3h · RETURNED 12h · UNKNOWN 6h. Exponential backoff `offset * 2^(errors-1)` capped 16x; stops polling after 5 consecutive errors.

**Webhook receivers**
- `src/app/api/webhooks/fedex/route.ts` (source `fedex_webhook`)
- `src/app/api/webhooks/ups/route.ts` (source `ups_webhook`)
- **No USPS webhook** — USPS is polling-only.

**Database** (`src/lib/migrations/2026-03-10_shipping_backbone.sql`)
- `shipping_tracking_numbers` (master) + `shipment_tracking_events` (append-only log)
- `next_check_at` drives polling; milestone timestamps; error counters

---

## 4. Plan of work

### Phase 1 — Activate carrier push (the high-impact fix)
- [ ] **Verify FedEx subscription API contract** against `developer.fedex.com` (request/response shape, auth, batch semantics). *Not yet read — must confirm before coding.*
- [ ] Confirm the FedEx account is **US-based** (required for webhooks at all).
- [ ] Build a subscription registration step: when a FedEx tracking number is created/linked, call FedEx's **tracking-number subscription API** (batches up to 1,000) pointing at the existing `/api/webhooks/fedex` callback.
- [ ] Do the same for UPS push subscription → `/api/webhooks/ups`.
- [ ] Add a backfill job to subscribe all currently-active (non-terminal) shipments.
- [ ] Store subscription state on the shipment row (subscribed flag + timestamp) so we don't double-subscribe.

### Phase 2 — Tighten the polling fallback
- [ ] Reduce `LABEL_CREATED` interval in `normalize.ts:220-245` from 8h → ~1–2h. Quota math: ~1,000 active shipments polled hourly = 24k/day, well under the 100k FedEx cap.
- [ ] Verify cron `limit` ≥ steady-state non-terminal shipment count, or increase sweep frequency, so the oldest shipments don't starve.
- [ ] Add alerting/reset for shipments that hit the `consecutive_error_count >= 5` cutoff (currently they silently stop updating forever).

### Phase 3 — Webhook hardening
- [ ] Confirm event upsert is **idempotent on carrier event ID** (not shipment+timestamp), since at-least-once delivery guarantees duplicates.
- [ ] Confirm receivers respond 2xx quickly and defer heavy work (cache invalidation, real-time publish) appropriately.
- [ ] Treat polling as the official recovery path for missed webhook events (FedEx replay window was refuted).

### Phase 4 (optional) — Evaluate aggregator
- [ ] Only if multi-carrier maintenance burden grows. If adopted, dedup events on carrier event ID to avoid double-processing when both direct webhooks and aggregator are active.

---

## 5. Open questions

1. Does FedEx plan to extend Shipment Visibility Webhook access to non-US accounts?
2. Does USPS offer any push/webhook option, or is polling the only path? (Currently no USPS receiver.)
3. Dual-source dedup strategy if direct webhooks + aggregator ever run simultaneously.
4. Is there any documented FedEx backfill/replay for downtime windows? (7-day window claim was refuted — assume no.)

---

## 6. Caveats

- FedEx webhooks are documented **US-only**; international shipments may be polling-only.
- "Near real-time" has **no numeric SLA** from FedEx.
- Aggregator comparison figures came from vendor-biased blogs — validate against current provider docs before committing.
- All quota/retry figures current through early 2026 and subject to carrier change.
