# Stripe (platform billing)

Powers the SaaS subscription loop: Checkout → webhook → `billing_subscriptions` mirror →
plan/entitlement gating. **Code is complete and the webhook is functional**, but two
outward-config blockers remain before go-live: the **Stripe product catalog doesn't
exist yet** and **`STRIPE_WEBHOOK_SECRET` isn't set in production**. See
`docs/saas-commercialization-plan.md` and `docs/tier0-go-live-runbook.md`, and the
tier-0 progress memory.

> **Not a customer-facing integration.** Stripe is the *platform operator's* billing
> account, configured entirely through env vars + the Stripe dashboard — it is **not**
> in the Settings → Integrations catalog (`PROVIDER_CATALOG`). The old "per-tenant
> payments override" card was removed (2026-06-14): its only consumer is
> `loadCreds(orgId)`'s vault-first fallback, which is reseller/white-label plumbing with
> no live use, and exposing it invited tenants to mis-connect their own Stripe into the
> subscription-billing flows. The `stripe` provider key, `StripeCredentials`, and the
> connector-registry entry remain (the billing code + env fallback still depend on them);
> only the display card is gone.

## Client — `src/lib/billing/stripe.ts`

- `createStripeCustomer()`, `createCheckoutSession()` (trial days + promo codes + org
  metadata), `createBillingPortalSession()`, `verifyStripeSignature()` (HMAC-SHA256 over
  `<timestamp>.<raw body>`, 5-min tolerance).
- `loadCreds(orgId?)` resolves **per-tenant vault first**, then env. API version pinned
  to `2024-06-20` to avoid `current_period_*` schema drift.

## Plans & entitlements — `src/lib/billing/plans.ts`

Five hard-coded tiers — `trial`, `starter`, `growth`, `pro`, `enterprise` — each with
staff/orders/integrations/warehouse limits and ~11 feature flags
(`fba`, `repair`, `walkIn`, `aiCopilot`, `advancedRoles`, `automations`, `webhooksOut`,
`sso`, `auditLogExport`, `prioritySupport`, `customBranding`). Price ids come from env;
`planFromPriceId(priceId)` is how the webhook derives the plan from an incoming
subscription. `maxIntegrations` is the ceiling the connector framework enforces.

## Routes

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/billing/checkout` | `admin.view` | Create a Checkout session for a plan upgrade |
| `POST /api/billing/portal` | `admin.view` | Mint a Billing Portal session (payment method, cancel, invoices) |
| `POST /api/billing/webhook` | public (signature) | Stripe event receiver |

## Webhook — `src/app/api/billing/webhook/route.ts`

Verifies `stripe-signature` against `STRIPE_WEBHOOK_SECRET`, dedupes on
`stripe_events.event_id`, and handles:

- `checkout.session.completed` → link org ↔ customer/subscription.
- `customer.subscription.created` / `.updated` → upsert `billing_subscriptions`,
  re-derive plan from the price id, sync `organizations.plan`.
- `customer.subscription.deleted` → mark `canceled`.

Returns **400** only on a bad signature; **200** otherwise (even on handler error) so
Stripe doesn't retry into a loop. All mutations are idempotent `INSERT … ON CONFLICT`.

## Checkout flow

`POST /api/billing/checkout { plan }` → validate plan is payable + price id configured →
lazily create the Stripe customer if missing → create a Checkout session (success/cancel
→ `/settings/billing?status=…`) → return `{ url }`. Stripe then POSTs the webhook, which
mirrors the subscription. Feature gates read `org.plan` at request time.

## DB schema (migration `2026-05-22`)

- **`organizations`** — `stripe_customer_id` (unique where set), `stripe_subscription_id`.
- **`billing_subscriptions`** — full subscription mirror keyed by `organization_id`:
  `status`, `plan`, `price_id`, `current_period_*`, `cancel_at_period_end`, `trial_end`.
  `subscriptions.ts` (`getSubscription`, `upsertSubscription`, `recordStripeEvent`).
- **`stripe_events`** — idempotency log (`event_id` PK, type, org, payload, processed_at).

## Environment variables

| Var | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Server API key (`sk_live_…`). Required; hard-fails if missing. **Sensitive**. |
| `STRIPE_PUBLISHABLE_KEY` | `pk_live_…` for client forms. |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` — **required** for the webhook; ⚠️ not set in prod yet. **Sensitive**. |
| `STRIPE_PRICE_STARTER` / `_GROWTH` / `_PRO` / `_ENTERPRISE` | Price ids per payable tier. ⚠️ unset until the catalog is created. |

> `.env` currently carries **test** keys (`STRIPE_*_TEST_KEY`, a test
> `STRIPE_WEBHOOK_SECRET`). `.env`/`.env.local` are git-tracked with live secrets —
> never blanket-stage them (see the tracked-env-secrets memory).

## Go-live blockers (the critical path)

1. **Create the Stripe product catalog** — subscription products + recurring prices; set
   `STRIPE_PRICE_*`. Until then any upgrade click returns `PRICE_NOT_CONFIGURED` (503).
2. **Set `STRIPE_WEBHOOK_SECRET` in production Vercel** and register the
   `…/api/billing/webhook` endpoint in the Stripe dashboard.
3. **Trial enforcement** — `organizations.trial_ends_at` is set on signup but not yet
   gated/banner-surfaced.

Connector registry: `stripe: { authKind: 'vault', capabilities: ['payments'] }` (kept —
required by the `Record<IntegrationProvider, …>`). No Settings card; billing resolves
creds from env via `loadCreds(null)`.
