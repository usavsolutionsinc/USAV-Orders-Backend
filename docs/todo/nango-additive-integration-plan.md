# Nango — Additive Integration Plan

**Status:** ~85% SHIPPED (re-verified 2026-07-09; "no code changes yet" was stale) — seam
(`src/lib/integrations/nango.ts`), `NANGO_BACKED_PROVIDERS` registry
(`src/lib/integrations/nango-providers.ts`), both additive routes (shipped 2026-06-05).
Residual: **live enablement is external/owner-gated** (Nango sidecar deploy + provider config).
**Date:** 2026-06-05
**Premise:** Do **not** replace any hand-built integration. Add Nango (nango.dev) as an
optional layer that (a) stands up *new* OAuth providers fast and (b) finishes a few
half-built ones — while every existing provider keeps its current code path untouched.

---

## 1. TL;DR

- **You cannot lift files out of the Nango repo.** The whole `NangoHQ/nango` repo —
  including `packages/providers/providers.yaml` and the `integration-templates` repo — is
  **Elastic License 2.0 (ELv2)**, not MIT/Apache. ELv2 is fine for *running* Nango
  internally and *reading it as reference*; bulk-copying its config/code into our product
  is a legal gray area. So "add from the repo" means **run it as a sidecar** or **use
  `providers.yaml` as a lookup**, not vendor its files.
- **Nango's value for our *existing* providers is small.** eBay + Zoho are already built
  well (don't touch). Ecwid, UPS, FedEx, USPS are **not in Nango's catalog at all** — keep
  them hand-built forever. The only existing-provider win is **Square** (OAuth flow is
  missing) and a minor one for **Google Sheets**.
- **Nango's real value is NEW providers** we haven't built: Amazon SP-API, Shopify,
  QuickBooks, HubSpot, Slack, etc. — all in Nango. The recommended end-state is: new OAuth
  SaaS provider = "add a provider key + a connect button," not a week of OAuth/refresh code.
- **Recommended deployment:** self-hosted **auth + proxy sidecar** (3 containers, free
  tier). It does the OAuth dance, encrypted token storage, **auto-refresh**, and an
  authenticated proxy. It slots behind our existing `credentials.ts` seam with **zero
  caller changes** for existing providers.
- **Know the ceiling:** in free self-host, **Syncs, Actions, Webhooks, and MCP are
  Enterprise-gated.** Free = auth + proxy only. That kills token boilerplate but is *not*
  the "managed continuous data sync" pitch — that part is paid.

---

## 2. Where Nango fits (provider-by-provider)

Mapping current implementation status against Nango's actual catalog coverage.

| Provider | Status today | In Nango catalog? | Additive verdict |
|---|---|---|---|
| eBay | Fully built (OAuth + refresh cron + client) | ✅ `ebay` | **Skip** — rewriting working code |
| Zoho (×4) | Fully built | ✅ `zoho` / `zoho-inventory` / `zoho-crm` / `zoho-books` | **Skip** |
| Zendesk | Fully built (static API token) | ✅ `zendesk` | **Skip** — token auth is trivial already |
| Ecwid | Fully built (static token) | ❌ **Not in catalog** | None — keep hand-built |
| UPS | Partial (webhook sub only, no refresh) | ❌ **Not in catalog** | **None — keep hand-built** |
| FedEx | Partial (webhook sub only) | ❌ **Not in catalog** | **None — keep hand-built** |
| USPS | Partial (creds shape only) | ❌ **Not in catalog** | **None — keep hand-built** |
| **Square** | Partial — API client but **no OAuth connect flow** | ✅ `squareup` (+ `squareup-sandbox`) | **PILOT** — Nango adds the missing OAuth |
| Google Sheets | Partial — immutable service-account key | ✅ `google-sheet` | Optional — OAuth instead of SA-key pain |
| Stripe | Billing only (not an order/inventory integration) | ✅ `stripe` | Low |
| Ably | Realtime channel auth | ❌ | None (not an integration) |
| Ollama | Local LLM config | ❌ | None |

> ⚠️ **Correction to a common misread:** UPS/FedEx/USPS are **not** Nango candidates.
> They are absent from `providers.yaml`. Our carrier subsystem (tracking polling, webhook
> subscribe, USPS quota handling) stays exactly as-is.

**Conclusion:** Nango is not a cleanup tool for what we already have. It's an *acceleration
tool for what we'll build next*, with Square as a convenient first real target.

---

## 3. License reality (ELv2) — what we may and may not do

Confirmed by reading the `LICENSE` files in both repos.

- `NangoHQ/nango` (server, `providers.yaml`) → **Elastic License 2.0**.
- `NangoHQ/integration-templates` (prebuilt syncs/actions) → **Elastic License 2.0**.
- Not FSL, not MIT/Apache. ELv2 never converts to open source (no change date).

**ELv2 in plain terms** — three prohibitions:
1. Don't provide the software to third parties as a hosted/managed service.
2. Don't circumvent license-key / feature gating.
3. Don't strip license notices.

**What this means for us (internal SaaS, not reselling Nango):**

| Action | Allowed? |
|---|---|
| Run self-hosted Nango internally, modified or not | ✅ Yes |
| Read `providers.yaml` / templates as reference, then write our own config | ✅ Yes (endpoint URLs/scopes are public vendor facts) |
| Bulk-vendor `providers.yaml` or template `.ts` files verbatim into our repo | ⚠️ Gray — get legal sign-off first |
| Offer Nango itself as a feature to our customers as a managed service | ❌ No |

**Practical rule:** treat the Nango repo as a *runnable service* and a *reference manual*,
never as a parts bin to copy from.

---

## 4. Deployment options, ranked

### Option A — Reference-only, zero infra (fallback)
Use `providers.yaml` / Nango docs to look up auth URLs, token URLs, scopes, proxy base URLs
when hand-rolling a new provider in our existing `credentials.ts` + per-provider-client
pattern. Don't run Nango.
- **Buys:** saves OAuth research per provider.
- **Costs:** we still write/store/refresh tokens ourselves. No proxy, no managed refresh.
- **Use when:** new providers are rare and our auth framework already handles them well.

### Option B — Auth + proxy sidecar (RECOMMENDED) ⭐
Self-host the lightweight `:hosted` image. Use it **only** for new connections; existing
providers keep their own creds.
- **Containers:** `nango-server` + Postgres + Redis (Elasticsearch is optional/off).
  Point Postgres at a dedicated Neon branch/database.
- **Buys:** Nango owns OAuth dance + encrypted token storage + **auto token refresh** +
  authenticated **proxy** (our backend never handles raw tokens). Per-org multi-tenancy via
  `connectionId`. Hosted Connect UI for the consent screen.
- **Costs:** one more internal service to deploy/monitor/upgrade/back up; a new runtime
  dependency in the request path *for those providers only*. Free tier has limited
  observability and **no syncs/actions/webhooks**.
- **Use when:** onboarding several new OAuth SaaS providers; want to stop hand-writing
  refresh logic without a rewrite.

### Option C — Full self-host with Syncs/Actions (NOT recommended now)
Adds Elasticsearch + Orchestrator + Jobs + Runner + Persist + object storage. Enables
scheduled syncs, prebuilt templates, webhooks, MCP.
- **Reality:** Functions/syncs are **Enterprise-licensed** → effectively a paid/Cloud path.
  Heavy ops (stateful ES + object storage). Overlaps infra we already have.
- **Use when:** we make a strategic bet to standardize *data ingestion* across many
  providers. Out of scope for "additive."

---

## 5. How it slots in without touching existing code

Our integration credentials already funnel through one seam:
`src/lib/integrations/credentials.ts` → `getIntegrationCredentials(orgId, provider, {scope})`.

Today resolution is: (1) `organization_integrations` row → (2) env-var fallback (USAV only).
We **add a third mode** for providers explicitly marked "Nango-backed," without changing any
caller or any existing provider's path.

```
Existing providers ─► getIntegrationCredentials ─► organization_integrations  (UNCHANGED)
                                                 └► env fallback (USAV)        (UNCHANGED)

Nango-backed providers ─► getNangoClient(orgId, provider) ─► Nango sidecar
                                                             (OAuth + refresh + proxy)
```

### 5.1 The seam (new file: `src/lib/integrations/nango.ts`)

Two access shapes depending on how we want to call the provider:

- **Proxy mode (preferred):** we never see the token. Call the provider through Nango.
  ```ts
  // sketch — not final code
  import { Nango } from '@nangohq/node';
  const nango = new Nango({ host: process.env.NANGO_HOST, secretKey: process.env.NANGO_SECRET_KEY });

  export function nangoConnectionId(orgId: OrgId): string {
    return `org_${orgId}`;                 // per-tenant key
  }

  export async function nangoProxy(orgId: OrgId, providerConfigKey: string, req: {
    method: 'GET'|'POST'|'PUT'|'DELETE'; endpoint: string; data?: unknown; params?: Record<string,string>;
  }) {
    return nango.proxy({ providerConfigKey, connectionId: nangoConnectionId(orgId), ...req });
  }
  ```
- **Token mode (when an SDK needs the raw access token):** fetch the live, auto-refreshed
  token from Nango and hand it to the existing client.
  ```ts
  const conn = await nango.getConnection(providerConfigKey, nangoConnectionId(orgId));
  const accessToken = conn.credentials.access_token; // Nango refreshes before returning
  ```

### 5.2 Registry of which providers are Nango-backed

A small map keeps the routing explicit and reversible — flip a provider back to hand-built
by removing one entry.

```ts
// e.g. in nango.ts
export const NANGO_BACKED: Partial<Record<IntegrationProvider, string>> = {
  // square: 'squareup',     // enabled in the pilot
};
```

`getIntegrationCredentials` (or a thin `getProviderClient` wrapper) checks this map first;
if absent, behaves exactly as today. **No behavior change until a provider is added here.**

### 5.3 Connect flow (new, additive routes — do not disturb existing ones)

- `POST /api/integrations/nango/session` → backend mints a per-org connect session
  (`end_user.id = orgId`, `allowed_integrations: [providerConfigKey]`), returns the token.
- `IntegrationCard` for a Nango-backed provider renders a "Connect" button that opens the
  hosted Connect UI with that token.
- On success, Nango stores the connection keyed by `org_<id>`. We persist a lightweight
  marker row in `organization_integrations` (status/display_label only, **no secret**) so
  the existing admin UI still shows connection state without decrypting anything.

This means `IntegrationsTab` keeps working unchanged; Nango-backed cards just point at the
new connect endpoint instead of a credential form.

---

## 6. Pilot: Square (smallest real win)

Square is the best first target: API client exists, only the OAuth connect flow is missing,
and it's in Nango's catalog (`squareup`).

**Steps (when we decide to build):**
1. Stand up the Option B sidecar (3 containers; Postgres on a Neon branch).
2. Configure the `squareup` integration in Nango (client id/secret, scopes, sandbox vs prod).
3. Add `src/lib/integrations/nango.ts` (seam + `NANGO_BACKED = { square: 'squareup' }`).
4. Add `POST /api/integrations/nango/session`.
5. Wire the Square `IntegrationCard` "Connect" button to the hosted Connect UI.
6. Route `src/lib/square/client.ts` calls through `nangoProxy(orgId, 'squareup', …)` (or
   token mode), behind the registry check — existing Walk-in/POS sync logic unchanged.
7. Verify per-org isolation with two orgs.

**Acceptance:** an org admin connects Square via OAuth (no manual token paste); Square API
calls succeed through Nango with auto-refresh; turning off the registry entry falls back to
the old static-token path cleanly.

If the pilot feels good, the same 6-line recipe onboards each *new* OAuth provider.

---

## 7. Env / config to add (when building)

| Var | Purpose |
|---|---|
| `NANGO_HOST` | Internal URL of the self-hosted sidecar |
| `NANGO_SECRET_KEY` | Backend SDK auth to the sidecar |
| `NANGO_PUBLIC_KEY` / connect-session usage | Frontend Connect UI |
| Sidecar: `NANGO_DATABASE_URL` | Neon branch for Nango's own storage |
| Sidecar: `NANGO_ENCRYPTION_KEY` | Nango's at-rest credential encryption |

Sidecar runs from Nango's published `docker-compose.yaml` (server + Postgres + Redis;
Elasticsearch commented out). Not deployed on Vercel — it's a stateful service (separate
host / container platform).

---

## 8. Risks & open questions

- **Free-tier ceiling:** auth + proxy only. If we ever want managed *syncs/webhooks*, that's
  Enterprise — re-evaluate as a separate decision, don't assume it's free.
- **New runtime dependency:** for Nango-backed providers, sidecar downtime = those providers
  down. Mitigate with the registry escape hatch (flip back to hand-built) and health checks.
- **Credential residency:** Nango-backed tokens live in the sidecar's Postgres (its own
  encryption), not our `organization_integrations` vault. Acceptable, but it's a second
  secret store to secure and back up. Document it in the security model.
- **Ops ownership:** who patches/upgrades the sidecar? ELv2 image, so track upstream.
- **Legal:** confirm ELv2 is acceptable for an internal-use self-hosted service (it is, by
  plain reading) and that we are *not* vendoring `providers.yaml`/templates verbatim.

---

## 9. Recommendation

1. **Don't** route any currently-working provider through Nango (eBay, Zoho, Zendesk, Ecwid,
   carriers stay as-is).
2. Adopt **Option B (auth+proxy sidecar)** when the next new OAuth provider or the Square
   gap justifies standing up the service.
3. Use **Square as the pilot**; make it the template for all future new OAuth providers.
4. Keep **Option A (reference-only)** as the zero-infra fallback if we'd rather not run the
   sidecar yet.
5. Treat Nango strictly as a *runnable service + reference manual*, never a code parts bin.

---

## 10. Key references

- Providers catalog: https://github.com/NangoHQ/nango/blob/master/packages/providers/providers.yaml
- Integration templates: https://github.com/NangoHQ/integration-templates
- License (ELv2): https://github.com/NangoHQ/nango/blob/master/LICENSE
- Self-host compose: https://github.com/NangoHQ/nango/blob/master/docker-compose.yaml
- Self-hosting guide: https://nango.dev/docs/guides/platform/self-hosting
- Node SDK: https://nango.dev/docs/reference/sdks/node
- Frontend SDK: https://nango.dev/docs/reference/sdks/frontend
- Local seam this plugs into: `src/lib/integrations/credentials.ts`, `src/components/admin/IntegrationsTab.tsx`

---

## 11. Enablement runbook (owner-executed; code side is DONE)

Everything below is **owner/ops work** — no repo code changes are required to go live. The seam
(`src/lib/integrations/nango.ts`), the `NANGO_BACKED_PROVIDERS` registry
(`src/lib/integrations/nango-providers.ts`), and both additive routes shipped 2026-06-05 and are
inert until the env vars exist (fail-open: unset = every provider stays on its hand-built path).

1. **Deploy the sidecar** (self-host, ELv2): `docker compose up` from the upstream
   `docker-compose.yaml` (see §10) on a host reachable from Vercel — Fly/Railway/small VPS all fine.
   Postgres for Nango state comes with the compose file. Pin an upstream release tag, not `master`.
2. **Create the Nango account + environment** on the sidecar UI; note the **secret key** (server)
   and **public key** (frontend).
3. **Configure the pilot provider (Square per §9.3)** in the Nango UI: provider template `square`,
   OAuth client id/secret from the Square developer console, callback
   `https://<nango-host>/oauth/callback`. Register that callback in Square's app settings too.
4. **Set the env vars** (Vercel → Production; names per `src/lib/integrations/nango.ts`):
   `NANGO_HOST` (sidecar base URL), `NANGO_SECRET_KEY`; plus the public key if the frontend connect
   flow is enabled. Redeploy.
5. **Verify additively**: on `/settings/integrations`, the Nango-backed provider's connect flow now
   routes via the sidecar; every existing provider (eBay, Zoho, Amazon, ShipStation…) is untouched
   (their code paths never consult Nango).
6. **Reversibility**: unset the env vars → the seam disables itself; nothing else to roll back.
   Note reversibility-fixes-plan §5.5: disconnect currently deletes only the local marker — wiring
   `forgetNangoConnection` + Nango's connection-delete API into the integration-delete path is the
   one residual **code** item (tracked there, not here).

**Do not** migrate existing providers onto Nango (§0 premise: additive only) and **do not** vendor
Nango source into this repo (ELv2 — runnable service + reference manual only).
