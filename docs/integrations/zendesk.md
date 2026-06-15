# Zendesk (support + warranty ticket linkage)

Two-way linkage between **warranty claims** and Zendesk tickets, plus a support overview
for the dashboard. Direct REST API (no Apps Script bridge for new code). Read-time sync —
the app caches only the ticket **id mapping**; subject/status/comments are fetched live.
Built and live. See the warranty-Zendesk round-trip memory.

## Client — `src/lib/zendesk.ts`

`isZendeskConfigured()` (all three env vars present), and the full ticket surface:
`createTicket` (idempotency key + file uploads via `uploadFileToZendesk`), `getTicket`,
`updateTicket`, `deleteTicket` (soft), `listTickets`, `searchTickets` (Search API),
`listTicketComments`, `addTicketComment`, `listAgents` (5-min cache),
`getZendeskSupportOverview()` (unsolved + urgent counts for the dashboard). Errors:
`ZendeskNotConfiguredError` (→ 503) and `ZendeskApiError` (mirrors the HTTP status).

Supporting modules:
- `zendesk-ticket-url.ts` — build the agent URL from subdomain + ticket id.
- `zendesk-links.ts` / `zendesk-link-candidates.ts` — `buildExternalId(type,id)`,
  `linkTicket()`, and the candidate query for the link UI.
- `warranty/zendesk-format.ts` — `buildWarrantyTicketTemplate()` (claim → subject/body).
- `warranty/zendesk-link.ts` — `recordClaimTicketLink()`, `unlinkClaimTicket()`,
  `recordClaimZendeskEvent()` (DB linkage + claim timeline events).

## Routes

### Generic ticket API (`integrations.zendesk`)
| Route | Purpose |
|---|---|
| `GET\|POST /api/zendesk/tickets` | List/search; create (+ optional link to an internal entity) |
| `GET\|PATCH\|DELETE /api/zendesk/tickets/[id]` | Fetch / update or comment / soft-delete |
| `GET /api/zendesk/agents` | Assignable agents (5-min cached) |

### Warranty round-trip (`warranty.view` to read, `warranty.manage` to write)
| Route | Purpose |
|---|---|
| `GET\|POST /api/warranty/claims/[id]/zendesk` | Read live ticket status / create + link a ticket from the claim (returns a draft if Zendesk errors) |
| `GET\|POST /api/warranty/claims/[id]/zendesk/comments` | Read the thread / post a reply (appends a `ZENDESK_REPLY` timeline event) |
| `GET\|POST\|DELETE /api/warranty/claims/[id]/zendesk/link` | List candidates / attach / detach (records `ZENDESK_LINKED` / `ZENDESK_UNLINKED`) |

> Perms note: warranty Zendesk actions are gated by **`warranty.*`**, not
> `integrations.zendesk` (see the warranty round-trip memory).

## Round-trip flow

1. **Create** — `POST …/zendesk` builds the template from claim fields, posts an
   internal-only first comment, records the link + a `ZENDESK_STATUS` timeline event.
2. **Read** — `GET …/zendesk` pulls live subject/status/priority/updatedAt/URL; only the
   id mapping is cached.
3. **Comment** — `GET|POST …/zendesk/comments` reads or posts to the thread.
4. **Link/Unlink** — `…/zendesk/link` attaches an existing ticket, searches candidates,
   or detaches (clears `external_id`, appends the unlink event).

## DB schema

- **`warranty_claims`** — `zendesk_ticket_id BIGINT` (nullable, populated on create/link)
  + partial index `WHERE zendesk_ticket_id IS NOT NULL`; `deleted_at` (soft-delete —
  **never hard-delete** claims).
- Ticket-link rows map `{ zendeskTicketId, entityType, entityId }` so any linked entity
  resolves in the support workspace.

## Environment variables

| Var | Purpose |
|---|---|
| `ZENDESK_SUBDOMAIN` | e.g. `usav` → `usav.zendesk.com`. |
| `ZENDESK_EMAIL` (or `ZENDESK_API_USER`) | API user email (token auth: `{email}/token`). |
| `ZENDESK_API_TOKEN` | API token. **Sensitive**. |

Connector registry: `zendesk: { authKind: 'vault', capabilities: [] }` — support
linkage, no ingestion capability. Settings card `connect: 'vault'`
(`admin.manage_features` to manage the credential).
