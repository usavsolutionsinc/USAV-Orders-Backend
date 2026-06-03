# Carrier Tracking Live-Sync Production Plan

**Status:** Phase 1–3 built (2026-06-02) — pending FedEx portal setup + endpoint confirmation
**Created:** 2026-06-02
**Owner:** TBD
**Goal:** Eliminate stale carrier tracking displays (currently up to ~21h behind the carrier's own status) and keep FedEx/UPS/USPS tracking in near-real-time sync.

> **Decision locked (2026-06-02):** We track only tracking numbers billed to
> *other parties'* accounts, so **Account-level subscriptions do not apply** —
> we use **per-tracking-number subscription** exclusively (FedEx: ≤1000/batch
> async job).
>
> **Constraint locked (2026-06-02): the solution must be FREE.** This rules out
> paid aggregators (Shippo ~$0.01/tracker, EasyPost ~$0.02–0.03/tracker, which
> charge per *third-party* tracker). The free path = **direct carrier
> webhooks + polling**:
> - **FedEx** — tracking-number subscription webhook (free within 100k/day). ✅ built
> - **USPS** — Tracking 3.2 **supports webhook subscription by tracking number**
>   (free with a USPS developer account). ✅ **built** (receiver + subscribe cron + renewal)
> - **UPS** — third-party push doubtful (account-only lineage); **polling is the
>   free fallback**. Subscription pipeline built but may be a no-op for third-party.
>
> **Correction:** an earlier note called USPS "poll-only" — that is wrong; USPS
> now offers tracking-number webhook subscriptions.

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

### Phase 1 — Activate FedEx push (the high-impact fix) ✅ built
- [x] Verify FedEx subscription API contract — *shape* confirmed (async job, `action: ADD`, ≤1000 batch, OAuth bearer). Literal endpoint path is behind the authenticated console; left env-overridable (see §7).
- [x] Subscription client `src/lib/shipping/providers/fedex-subscription.ts` — `subscribeTrackingNumbers(ADD/DELETE)` + `getSubscriptionJobStatus`, reusing OAuth from `fedex.ts`.
- [x] DB subscription state — migration `2026-06-02_fedex_webhook_subscription.sql` adds `webhook_subscription_status / _job_id / _error`, `webhook_subscribed_at` + work-queue indexes (so we never double-subscribe).
- [x] Subscription engine — `src/lib/jobs/fedex-subscribe-pending.ts` (Pass A associate, Pass B reconcile jobs) driven by cron `/api/cron/shipping/subscribe-fedex` (every 15 min). Handles both **backfill** of existing shipments and steady-state new ones.
- [ ] **Manual (you):** create the FedEx webhook project in the portal — callback `https://…/api/webhooks/fedex`, security token → `FEDEX_WEBHOOK_SECRET`; set `FEDEX_WEBHOOK_PROJECT_ID`. Confirm US-based account.
- [x] UPS push subscription → `/api/webhooks/ups` — built the same way (synchronous model; no async job). Client `ups-subscription.ts`, job `ups-subscribe-pending.ts`, cron `/api/cron/shipping/subscribe-ups`. Receiver hardened (credential echo + HMAC + bearer).
  - ⚠️ **UPS third-party coverage unconfirmed.** UPS tracking push (Quantum View / Track Alert lineage) historically requires the shipment to be on *your* UPS account. We only track *others'* numbers, so UPS may reject/never push for them — unlike FedEx tracking-number subscription, which explicitly supports any number. **Verify with UPS before relying on it;** if unsupported, UPS stays polling-only and the cron is a harmless no-op.

### Phase 2 — Tighten the polling fallback
- [x] Reduce `LABEL_CREATED` interval in `normalize.ts` from 8h → **2h** (webhook fallback / missed-event recovery).
- [ ] Verify cron `limit` ≥ steady-state non-terminal shipment count, or increase sweep frequency, so the oldest shipments don't starve.
- [ ] Add alerting/reset for shipments that hit the `consecutive_error_count >= 5` cutoff (currently they silently stop updating forever).

### Phase 3.5 — Live UI updates ✅ built (the display refreshes like the carrier site)
The backend freshness (webhooks + poll) is only half of "live"; the *display* must
re-render when the DB changes. Wired end-to-end:
- `publishShipmentStatusChange()` now **always** emits a `shipment.changed` realtime
  event (Ably, station channel) — not just for order-linked shipments — plus the
  existing `order.changed` for dashboard/shipped views.
- All four update paths fire it: the FedEx/UPS/USPS webhook receivers and the poll
  (`sync-shipment.ts`, gated on new events so no-op sweeps don't spam clients).
- Client: `useRealtimeInvalidation({ receiving:true })` (mounted in `ReceivingDashboard`)
  + the open `IncomingDetailsPanel` both subscribe to `shipment.changed` and invalidate
  the incoming list / summary / details queries → instant refresh.
- Polling fallback: `IncomingDetailsPanel` query has `refetchInterval: 60s`
  (foreground-only, single PO row) so the status stays live even if Ably is down.

### Phase 3 — Webhook hardening
- [x] Event upsert confirmed **idempotent** — `repository.ts` `upsertTrackingEvents` uses `ON CONFLICT (shipment_id, external_event_id, external_status_code, event_occurred_at) DO NOTHING`. At-least-once duplicates are absorbed. No change needed.
- [x] Receiver `/api/webhooks/fedex` upgraded to **HMAC-SHA256 (base64) signature verification** over the raw body, keyed by `FEDEX_WEBHOOK_SECRET`; static bearer kept as dev/replay fallback.
- [ ] Treat polling as the official recovery path for missed webhook events (FedEx replay window was refuted).

### Phase 4 (optional) — Evaluate aggregator
- [ ] Only if multi-carrier maintenance burden grows. If adopted, dedup events on carrier event ID to avoid double-processing when both direct webhooks and aggregator are active.

---

## 7. Implementation notes (2026-06-02 build)

**Files added**
- `src/lib/migrations/2026-06-02_carrier_webhook_subscription.sql` (carrier-agnostic: FedEx + UPS + USPS)
- `src/lib/shipping/providers/fedex-subscription.ts`, `ups-subscription.ts`, `usps-subscription.ts`
- `src/lib/jobs/fedex-subscribe-pending.ts`, `ups-subscribe-pending.ts`, `usps-subscribe-pending.ts`
- `src/app/api/cron/shipping/subscribe-fedex/route.ts`, `subscribe-ups/route.ts`, `subscribe-usps/route.ts`
- `src/app/api/webhooks/usps/route.ts` (new receiver — none existed before)
- `src/lib/shipping/providers/usps-subscription.test.ts` (unit tests; `npm run test:shipping-usps`)

**Files changed**
- `src/lib/shipping/providers/fedex.ts` — export `getAccessToken`, `FEDEX_BASE_URL`
- `src/lib/shipping/providers/ups.ts` — export `getAccessToken`, `UPS_BASE_URL`
- `src/lib/shipping/providers/usps.ts` — export `getAccessToken`, `USPS_BASE_URL`; extract shared `parseUSPSTrackingPayload` (polling + webhook)
- `src/lib/shipping/repository.ts` — carrier-agnostic subscription work-queue + reconcile + **renewal** helpers
- `src/app/api/webhooks/fedex/route.ts` — HMAC signature verification
- `src/app/api/webhooks/ups/route.ts` — credential-echo + HMAC verification
- `src/lib/shipping/normalize.ts` — LABEL_CREATED 8h → 2h
- `vercel.json` — subscribe-fedex + subscribe-ups + subscribe-usps crons (every 15 min)
- `package.json` — `test:shipping-usps` script

**USPS notes / limitations vs FedEx**
- USPS is **per-tracking-number** (no documented bulk batch like FedEx's ≤1000) and **synchronous** (no async jobId to reconcile, like UPS).
- USPS subscriptions **expire** → the job renews COMPLETED rows older than `USPS_SUBSCRIPTION_TTL_DAYS` (default 25). FedEx has no renewal step.
- Webhook payload **follows the modernized Tracking response shape**, so the same parser serves polling + push. No new migration — the carrier-agnostic columns cover USPS (`webhook_subscription_job_id` repurposed to store the USPS subscription id when returned).

**Env vars to set**
| Var | Purpose |
|-----|---------|
| `FEDEX_WEBHOOK_SECRET` | Security token from the portal webhook project; HMAC verify |
| `FEDEX_WEBHOOK_PROJECT_ID` | Project the tracking numbers associate to (sent in the ADD request) |
| `FEDEX_SUBSCRIPTION_PATH` | Override if not `/track/v1/notifications/subscriptions` |
| `FEDEX_SUBSCRIPTION_JOB_PATH` | Override if not `/track/v1/notifications/jobs` |
| `FEDEX_WEBHOOK_SIGNATURE_HEADER` | Override if not `x-fdx-sc-signature` / `fdx-signature` / `x-fedex-signature` |
| `UPS_WEBHOOK_SECRET` | Credential sent on subscribe + verified on callback |
| `UPS_WEBHOOK_CALLBACK_URL` | Where UPS should POST events, e.g. `https://…/api/webhooks/ups` |
| `UPS_SUBSCRIPTION_PATH` | Override if not `/api/track/v1/subscription` |
| `UPS_WEBHOOK_CREDENTIAL_HEADER` | Override if not `credential` / `x-ups-credential` |
| `UPS_BASE_URL` | Override host (e.g. CIE sandbox `https://wwwcie.ups.com`) |
| `USPS_WEBHOOK_SECRET` | Shared secret sent on subscribe + verified on callback (HMAC / echo) |
| `USPS_WEBHOOK_CALLBACK_URL` | Listener URL USPS pushes to, e.g. `https://…/api/webhooks/usps` |
| `USPS_SUBSCRIPTION_PATH` | Override if not `/tracking/v3/subscriptions` |
| `USPS_SUBSCRIPTION_TTL_DAYS` | Renewal window (default 25; 0 disables renewal) |
| `USPS_SUBSCRIPTION_BATCH_LIMIT` | Max numbers (re)subscribed per cron run (default 200) |
| `USPS_WEBHOOK_SIGNATURE_HEADER` / `USPS_WEBHOOK_SECRET_HEADER` | Override callback auth header names |
| `USPS_BASE_URL` | Override USPS API host |
| `CONSUMER_KEY` / `CONSUMER_SECRET` | USPS OAuth credentials (already used by polling) |

**⚠️ Must confirm before go-live** (unknowns the public docs don't pin down):
1. **FedEx** — subscription endpoint path + signature header name (env-overridable).
2. **UPS** — (a) whether push works for **third-party** tracking numbers at all (may be account-only → polling-only fallback); (b) subscription endpoint path, request/response field names, and callback credential header (all env-overridable).
3. **USPS** — (a) subscription endpoint path + request body field names (`trackingNumber`/`callbackUrl`/`sharedSecret` in `buildSubscriptionRequestBody`); (b) callback auth scheme + header name; (c) subscription TTL (tune `USPS_SUBSCRIPTION_TTL_DAYS`); (d) the **April 2026 "API Access Control" gating** — confirm eligibility. All env-overridable.

**Apply the migration:** `npm run db:migrate` (dry-run: `npm run db:migrate:dry`).
**Run USPS unit tests:** `npm run test:shipping-usps`.

**Rollout order:** migrate DB → set env vars → create FedEx portal project / register USPS callback → deploy → watch `[cron.shipping.subscribe-fedex|ups|usps]` logs reach `completed` → confirm `/api/webhooks/<carrier>` receives signed pushes.

---

## 5. Open questions

1. Does FedEx plan to extend Shipment Visibility Webhook access to non-US accounts?
2. ~~Does USPS offer any push/webhook option?~~ **Answered: yes** — USPS Tracking 3.2 supports webhook subscription by tracking number (free). No USPS receiver exists yet; building one the same way as FedEx is the free path to USPS push. Confirm the exact subscription endpoint/payload + the April 2026 "API Access Control" gating against developers.usps.com.
3. Dual-source dedup strategy if direct webhooks + aggregator ever run simultaneously.
4. Is there any documented FedEx backfill/replay for downtime windows? (7-day window claim was refuted — assume no.)

---

## 6. Caveats

- FedEx webhooks are documented **US-only**; international shipments may be polling-only.
- "Near real-time" has **no numeric SLA** from FedEx.
- Aggregator comparison figures came from vendor-biased blogs — validate against current provider docs before committing.
- All quota/retry figures current through early 2026 and subject to carrier change.
