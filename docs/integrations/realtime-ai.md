# Realtime & AI — Ably · local LLM (Ollama / Hermes)

Two infrastructure integrations that have **no ingestion capability** (they don't pull
orders) — they're plumbing. Both are `connect: 'vault'`, `capabilities: []` in the
connector registry.

---

## Ably (realtime channels)

Powers every live UI surface: order/repair/dashboard change feeds, the per-staff inbox,
phone↔desktop bridges, scan logs, and AI session streaming. **Live.**

> **Not a customer-facing card.** Ably is global realtime infrastructure keyed by a single
> env var (`ABLY_API_KEY`), not a per-tenant connection, so its Settings → Integrations
> card was removed (2026-06-14). The `ably` provider key + `AblyCredentials` + connector
> entry remain (the token route + `Record<IntegrationProvider, …>` depend on them); only
> the display card is gone.

### Token auth — org-scoped
- `GET|POST /api/realtime/token` (`dashboard.view`) mints a 1-hour Ably token whose
  capability is scoped to the org prefix. Clients never see the API key.
- Channels are namespaced `org:{orgId}:…`. Publishers must go through
  `orgChannelPrefix()` (throws on a non-UUID org); subscribers use `safeChannelName()`
  (returns `''` for an invalid org). This is the tenancy boundary for realtime.

### Channel families (`src/lib/realtime/channels.ts`)
- **Org broadcast (read-only for clients):** `orders:changes`, `repair:changes`,
  `station:changes`, `staff:changes`, `fba:changes`, `dashboard:operations`,
  `walkin:changes`, `ai:assist`.
- **DB row feeds:** `db:{schema}:{table}:{rowId}` (+ `db:*` wildcard, org-scoped).
- **Per-staff bridges (sub + pub, no cross-staff wildcard):** `inbox:{staffId}`
  (priority alerts + staff messages), `phone:{staffId}` (photo bridge),
  `packer:{staffId}`, `staffstation:{staffId}`, `scanlog:{staffId}` (read-only).
- **AI sessions:** `ai:assist:{sessionId}`.

> Key format is validated in `src/lib/realtime/ably-key.ts` (`<appId>.<keyId>:<secret>`).
> Several subscriber fixes + tech fan-out shipped during the Ably D1 work (see the
> tier-0 progress memory).

### Env
| Var | Purpose |
|---|---|
| `ABLY_API_KEY` | Server-only Ably key. **Sensitive**. |
| `NEXT_PUBLIC_ABLY_AUTH_PATH` | Client token path (default `/api/realtime/token`). |

There is also a DB-change webhook receiver at `POST /api/webhooks/realtime-db` that
fans Postgres changes onto the `db:*` channels.

---

## Local LLM — catalog key `ollama`, runtime gateway **Hermes**

The Settings catalog entry is **"Ollama (AI) — Local LLM via Cloudflare tunnel"**
(`provider: 'ollama'`, `OllamaCredentials = { baseUrl, tunnelUrl, model }`). The
**active runtime path**, though, is the **Hermes** OpenAI-compatible gateway running on
local loopback and exposed to Vercel via a Cloudflare tunnel. There is **no cloud LLM
fallback** — if the local box is down, AI features return a clear error.

### How AI calls work — `src/lib/ai/hermes-tool-call.ts`
A single OpenAI-style request with **forced tool call** (`tool_choice: 'required'`,
`temperature: 0`); returns the parsed tool arguments (caller validates). This shared
harness is the path for every new AI feature (see the AI-automation memory). Consumers:

- `POST /api/ai/chat` + `/api/ai/chat/stream` — the assistant (rate-limited via
  `AI_CHAT_RATE_LIMIT`, default 25/min).
- `POST /api/ai/search` — RAG over product manuals (`queryNemoClawRag`).
- `GET /api/ai/health` / `/api/ai/chat-health` — `/models` probe.
- Server-side feature LLMs: `lib/po-gmail/extract-llm.ts` (PO-email extraction),
  `lib/ai/zendesk-claim-{draft,classify}-llm.ts` (warranty claim drafting/classification).

Embeddings are the one cloud dependency — Gemini `text-embedding-004` via
`src/lib/ai/gemini.ts` (`GEMINI_API_KEY`).

### Env
| Var | Purpose |
|---|---|
| `HERMES_API_URL` | Gateway base (default `http://127.0.0.1:8642/v1`). |
| `HERMES_API_KEY` | Optional bearer for the gateway. |
| `AI_MODEL` | Default model (e.g. `gemma-4-e4b`). |
| `AI_CHAT_RATE_LIMIT` / `AI_SEARCH_RATE_LIMIT` | Per-minute caps (25 / 40). |
| `OLLAMA_BASE_URL` / `OLLAMA_TUNNEL_URL` / `OLLAMA_MODEL` | Vault `OllamaCredentials` shape (catalog representation of the local-LLM connection). |
| `GEMINI_API_KEY` | Embeddings fallback. |

> Reconcile-if-touched: the catalog calls this `ollama` while the live code calls Hermes.
> If you rename, update the provider enum, the registry entry, `OllamaCredentials`, and
> the catalog card together.
