# Integrations

Per-provider documentation for everything in the Settings → Integrations catalog. The
catalog itself has two sources of truth:

- **Display SoT** — `src/app/settings/integrations/registry.ts` (`PROVIDER_CATALOG`):
  labels, categories, badges, which `connect` method a card uses, OAuth/health paths.
- **Behavior SoT** — `src/lib/integrations/connectors/registry.ts`: `authKind`,
  `capabilities`, and (per provider) `sync` / `health`. A `Record<IntegrationProvider,…>`
  makes missing a provider here a **compile error**.

Credentials for every provider resolve through one path —
`getIntegrationCredentials(orgId, provider)` in `src/lib/integrations/credentials.ts` —
which reads the encrypted `organization_integrations` vault, with a **USAV-org-only
env-var fallback** so the existing single-tenant config keeps working during the
multi-tenant migration. New code must not add to that fallback.

## Provider index

| Provider | Category | `connect` | `authKind` | Capabilities | Status | Doc |
|---|---|---|---|---|---|---|
| **Amazon** | Marketplaces | `amazon` | oauth | orders, inventory | **Live** (Phase 1) | [amazon.md](./amazon.md) |
| **eBay** | Marketplaces | `ebay` | oauth | orders, inventory | **Live** (hardened) | [ebay-connect.md](./ebay-connect.md) |
| **Square** | Storefronts & POS | `nango` | nango | orders | **Built** (needs Nango sidecar to go live) | [square.md](./square.md) |
| **Ecwid** | Storefronts & POS | `vault` | vault | orders | USAV env live; OAuth = plan | [ecwid.md](./ecwid.md) |
| **Shopify** | Storefronts & POS | `nango`¹ | nango¹ | orders, inventory | Plan | [shopify.md](./shopify.md) |
| **Zoho Inventory** | Operations | `oauth` | oauth | inventory | **Live** (backbone) | [zoho.md](./zoho.md) |
| **Google Sheets** | Operations | `vault` | vault | orders | **Live** (legacy/backfill) | [google-sheets.md](./google-sheets.md) |
| **Zendesk** | Support | `vault` | vault | — | **Live** (warranty) | [zendesk.md](./zendesk.md) |
| **UPS / FedEx / USPS** | Shipping carriers | `vault` | vault | tracking | Polling live; webhooks dormant | [carriers.md](./carriers.md) |
| **Ollama / Hermes (AI)** | Realtime & AI | `vault` | vault | — | **Live** (local gateway) | [realtime-ai.md](./realtime-ai.md) |

> **Ably** is live realtime infrastructure but is **not** a customer-facing card — its key
> is wired globally via env (`ABLY_API_KEY`), so the connect card was removed (2026-06-14).
> See [realtime-ai.md](./realtime-ai.md).

¹ Shopify is a **plan** — not yet in `PROVIDER_CATALOG`/the provider enum. The doc
describes how it slots in once added.

## The two integration patterns

### Hand-built (eBay, Amazon, Zoho) and vault (carriers, Zendesk, Sheets, AI)
Most providers are hand-built OAuth or paste-credential ("vault") flows. The vault stores
an AES-256-GCM-encrypted payload per `(org, provider, scope)`; `INTEGRATION_KMS_KEY` is
**required in production** (tokens/state are plaintext without it — dev only).

### Nango-backed (Square, future Shopify)
For providers whose OAuth is the only real gap, a self-hosted **Nango sidecar**
(`src/lib/integrations/nango.ts`, `nango-providers.ts`,
`/api/integrations/nango/{session,connected}`) does the OAuth dance, encrypted token
storage, and **auto-refresh**, and exposes an authenticated **proxy** to the provider
API. We use Nango's free **auth + proxy** tier — *not* Nango Syncs (Enterprise).

> One sidecar (nango-server + Postgres + Redis) unlocks Square, Shopify, and ~250 other
> OAuth providers. Until `NANGO_SECRET_KEY` is set, `isNangoConfigured()` is false and
> Nango-backed cards fall back to vault entry. See `docs/nango-additive-integration-plan.md`.

**Recipe for a Nango-backed provider:** (1) add the key to `IntegrationProvider` +
`NANGO_BACKED_PROVIDERS` (mapping our key → Nango's `provider_config_key`); (2) add a
`ProviderDef` with `connect: 'nango'`; (3) add a connector entry with `authKind: 'nango'`
+ a lazy `sync`; (4) write `connectors/<provider>.ts` that calls
`nangoProxy(orgId, provider, …)` and upserts into `orders` (reuse the `sale_amount` /
`currency` ingestion); (5) add it to `SOURCE_PLATFORMS` and the orchestrator cron. The
display card + Connect button + `/api/integrations/nango/*` flow already exist.

## Shared framework

- **Connection-driven sync** — `connectorsWithCapability('orders')` feeds the
  orchestrator; "Sync now" → `POST /api/integrations/<provider>/sync`; the cron
  `/api/cron/integrations/sync?providers=ebay,…` runs the same path on a schedule
  (currently `*/15 * * * *`, `?providers=ebay`). See
  `docs/integrations-oauth-connection-plan.md`.
- **`maxIntegrations`** — each connected provider counts against the org's plan ceiling
  (`src/lib/billing/plans.ts`).
- **Per-provider crons** — Zoho, Amazon, Google Sheets, and the shipping carriers run
  their own dedicated crons rather than the generic orchestrator (see each doc). All cron
  routes authenticate with `Bearer ${CRON_SECRET}` (a Vercel **Sensitive** var — env
  changes require a redeploy or the crons 401).

## Conventions every doc follows

Real route paths + auth guard, the lib files that own the logic, the env vars (flagged
**Sensitive** where they hold secrets), the DB tables, the cron schedule (verified
against `vercel.json`), and a clear **built / plan / dormant** status so the doc doesn't
overstate what exists.
