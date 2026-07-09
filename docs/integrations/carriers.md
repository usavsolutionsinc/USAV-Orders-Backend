# Shipping carriers — UPS · FedEx · USPS

Carrier **tracking** for inbound (receiving) and outbound (shipped) shipments. Carriers
are **hand-built forever** — Nango doesn't cover them. The live mechanism is **adaptive
cron polling** (carrier webhooks are paid/unreliable, so the webhook receivers exist but
are **dormant** — no subscribe cron is scheduled). See the tracking-live-sync and
receiving-history memories.

Providers: `src/lib/shipping/providers/{ups,fedex,usps}.ts` (+ matching
`*-subscription.ts`). All three resolve creds from the vault
(`getIntegrationCredentials`) with a USAV env fallback; `connect: 'vault'`,
`capabilities: ['tracking']`.

## Per-carrier auth & tracking

| | Token model | Token endpoint | Tracking call |
|---|---|---|---|
| **UPS** | Client-credentials (Basic) | `/security/v1/oauth/token` | `GET /api/track/v1/details` |
| **FedEx** | Client-credentials (form body) | `/oauth/token` | `POST /track/v1/trackingnumbers` |
| **USPS** | OAuth2 client-credentials (JSON) | `/oauth2/v3/token` | `GET /tracking/v3/tracking/{num}?expand=DETAIL` |

Access tokens are cached in-process with a ~60s refresh buffer (USPS tokens last ~1h —
shorter than UPS/FedEx). **USPS enforces a 60 req/hr quota** — the binding constraint on
sweep size — and USPS 403s have historically blocked some lookups (see the
receiving-history memory).

## Polling — the live path (`vercel.json`)

| Schedule | Path | What |
|---|---|---|
| `7,22,37,52 * * * *` | `/api/cron/shipping/sync-due?limit=150&concurrency=8` | Rolling sweep of due shipments (all carriers); staggered off `:00` so it never collides with the deep tick |
| `30 3 * * 2-6` | `/api/cron/shipping/sync-due?limit=200&concurrency=8&carriers=UPS,FEDEX` | Nightly deep refresh (Tue–Sat, 03:30 UTC) |
| `20 * * * *` | `/api/cron/shipping/reconcile-delivered` | Reconcile delivered-but-unscanned |
| `*/30 * * * *` | `/api/cron/shipping/metrics` | Sync-health metrics |
| `10,25,40,55 * * * *` | `/api/cron/receiving/incoming-tracking-sync` | Re-poll the Incoming UI shipment set (keeps "Delivered · not scanned" fresh) |

`sync-due` runs `runShippingSyncDueJob`; registry key `shipping.sync_due` in
`src/lib/cron/registry.ts` (with `expectedEveryMs` for staleness detection — a job is
flagged `stale` past ~2.5× its expected interval even without an error). Updates land on
the shipment tracking record (STN). All crons authenticate with `Bearer ${CRON_SECRET}`.

## Webhooks — built but dormant

`POST /api/webhooks/{ups,fedex,usps}` receivers exist with multi-scheme auth (HMAC-SHA256
preferred, plus shared-secret header echo and bearer fallbacks), and `*-subscription.ts`
modules can register tracking numbers. **However, no `subscribe-*` cron is scheduled in
`vercel.json`**, so nothing is subscribed and the push path is inactive. Caveats baked
into the code comments:

- **UPS** — may not push *third-party* tracking numbers at all; confirm with UPS before
  relying on it. Polling is the fallback.
- **FedEx** — full async two-pass subscription model (`POST …/subscriptions` → jobId →
  reconcile `…/jobs/{jobId}`), 1000 numbers/batch. Needs `FEDEX_WEBHOOK_PROJECT_ID`.
- **USPS** — exact callback auth scheme unconfirmed (JS-rendered portal); three auth
  mechanisms accepted — confirm in sandbox before trusting prod.

To activate webhooks: schedule the `subscribe-{carrier}` crons, set the webhook env
vars, and point the carrier portal at `…/api/webhooks/{carrier}`.

## Environment variables

| Carrier | Vars |
|---|---|
| **UPS** | `UPS_CLIENT_ID`, `UPS_CLIENT_SECRET`, `UPS_BASE_URL` (default `https://onlinetools.ups.com`); webhook: `UPS_WEBHOOK_CALLBACK_URL`, `UPS_WEBHOOK_SECRET`, `UPS_WEBHOOK_BEARER`, `UPS_WEBHOOK_CREDENTIAL_HEADER` |
| **FedEx** | `FEDEX_CLIENT_ID`, `FEDEX_CLIENT_SECRET`, `FEDEX_ENV` (`production`/`sandbox`); webhook: `FEDEX_WEBHOOK_PROJECT_ID`, `FEDEX_WEBHOOK_SECRET`, `FEDEX_WEBHOOK_BEARER`, `FEDEX_WEBHOOK_SIGNATURE_HEADER` |
| **USPS** | `CONSUMER_KEY`/`CONSUMER_SECRET` (or `USPS_CONSUMER_KEY`/`_SECRET`), `USPS_BASE_URL` (default `https://apis.usps.com`); webhook: `USPS_WEBHOOK_SECRET`, `USPS_WEBHOOK_BEARER`, `USPS_WEBHOOK_SIGNATURE_HEADER`, `USPS_WEBHOOK_SECRET_HEADER` |
| All | `CRON_SECRET` for the polling crons |

## Status

Polling is **live** for all three carriers. Webhooks are **built but unscheduled**
(dormant) pending real-world confirmation that carrier push is worth the paid tier.
