# Zoho Webhooks Receiver

Single endpoint that ingests Zoho Inventory webhook deliveries, verifies the HMAC signature, dedupes by event id, and mirrors the change into our local `receiving` / `receiving_lines` tables.

Once this is wired up, `/api/receiving/lookup-po` (the per-scan path) should rarely need to hit Zoho — most scans become a pure local DB query.

## What you do once, per environment

### 1. Pick a shared secret

Any high-entropy string — 32+ bytes hex is plenty:

```bash
openssl rand -hex 32
```

### 2. Set env vars

```bash
# REQUIRED. Same secret you'll paste into Zoho.
ZOHO_WEBHOOK_SECRET=<the value from step 1>

# OPTIONAL — defaults shown.
# Header name Zoho uses to send the signature. Inventory + Books default to
# `X-Zoho-Webhook-Signature`. Marketplace-style integrations use `X-ZOH-Hmac`.
ZOHO_WEBHOOK_SIGNATURE_HEADER=x-zoho-webhook-signature

# OPTIONAL — `hex` (default) or `base64`. Pick whichever Zoho is sending.
ZOHO_WEBHOOK_SIGNATURE_ENCODING=hex
```

Add via `vercel env add ZOHO_WEBHOOK_SECRET production` (and `preview` / `development` as needed), or your usual `.env.local` for local dev.

### 3. Run the dedupe migration

```bash
psql $DATABASE_URL -f src/lib/migrations/2026-05-14_create_zoho_webhook_events.sql
```

### 4. Register the webhook in Zoho

Zoho Inventory exposes outbound webhooks via **Workflow Rules**. Wire one rule per event type:

| Module          | Event           | Action      | URL                                                  |
| --------------- | --------------- | ----------- | ---------------------------------------------------- |
| Purchase Orders | Create / Edit   | Webhook     | `https://<your-domain>/api/zoho/webhooks`            |
| Purchase Orders | Delete          | Webhook     | same                                                 |
| Purchase Receives | Create        | Webhook     | same                                                 |
| Purchase Receives | Delete        | Webhook     | same                                                 |

Steps in Zoho's UI:

1. **Settings → Automation → Workflow Rules → New Rule.**
2. Choose the module (e.g. *Purchase Orders*).
3. **When this rule should be executed**: pick *On a record action → Created* (or *Edited* / *Deleted*).
4. Trigger condition: leave broad (e.g., *All Purchase Orders*) unless you want to narrow.
5. **Action → Add Webhook.**
6. Webhook configuration:
   - **URL**: `https://<your-domain>/api/zoho/webhooks`
   - **Method**: POST
   - **Module fields to include**: select all (we only read fields we care about; extras are ignored).
   - **Custom headers**: leave default — Zoho will add the signature header automatically once you set the secret below.
   - **Custom parameters**: leave empty.
7. **Save.** Zoho will prompt for a *Authentication Type*. Choose **Webhook with Secret** and paste your `ZOHO_WEBHOOK_SECRET`.
8. Repeat for each rule (Create, Edit, Delete on each module).

### 5. Smoke-test

```bash
# Should show signature header name + that the secret is loaded
curl https://<your-domain>/api/zoho/webhooks
```

Then from Zoho's *Workflow Rule* page click **Test webhook**. Look at the rule's history pane — a `200 OK` response means the receiver verified the signature and stored the event. The first real PO edit will fire a real delivery.

You can also peek at recent deliveries directly:

```sql
SELECT event_id, event_type, object_id, received_at, processed_at, processing_error
FROM zoho_webhook_events
ORDER BY received_at DESC
LIMIT 20;
```

## How it behaves on failure

| Situation                      | HTTP returned | Zoho behavior              | What you do |
| ------------------------------ | ------------- | -------------------------- | ----------- |
| Signature missing / wrong       | `401`         | Retries on its retry curve | Verify the secret in both places matches |
| Body isn't JSON                 | `400`         | No retry                   | Ignore — Zoho only sends JSON |
| Duplicate delivery (same event_id) | `200 deduped` | Stops retrying             | Nothing — by design |
| Handler throws                  | `500`         | Retries, eventually gives up | Check `zoho_webhook_events.processing_error` |
| All handlers happy              | `200`         | Done                       | — |

## What the handlers do

| Event                          | Side effect                                                           |
| ------------------------------ | --------------------------------------------------------------------- |
| `purchaseorder.created/updated` | Calls existing `importZohoPurchaseOrderToReceiving(id)` — upserts the PO into `receiving` / `receiving_lines`. |
| `purchaseorder.deleted`        | Soft-detaches: stamps the affected rows in `receiving_lines` with `zoho_sync_source = 'deleted'` and appends a note. |
| `purchasereceive.created`      | Calls existing `importZohoPurchaseReceiveToReceiving({ purchaseReceiveId })`. |
| `purchasereceive.deleted`      | Clears the local `zoho_purchase_receive_id` reference + note. |
| anything else (`unknown`)      | Stored in `zoho_webhook_events` and 200'd. Add a case in `handlers.ts` if you want to act on it. |

## Adding a new event type

1. Add the new discriminator to `ZohoWebhookEventType` in `src/lib/zoho/webhooks/types.ts`.
2. Teach `classifyEventType()` in `src/lib/zoho/webhooks/normalize.ts` to recognize Zoho's raw string.
3. Add a `case` to `dispatchWebhookEvent()` in `src/lib/zoho/webhooks/handlers.ts` that returns a `HandlerResult`.
4. (Optional) Register a new Workflow Rule in Zoho to start sending the event.

## Operational tips

- Keep at least one of the Workflow Rules in *Test mode* in Zoho until you've seen a successful real delivery — Zoho's test payloads are easier to debug than live ones.
- If you ever rotate `ZOHO_WEBHOOK_SECRET`, update Zoho *first*, deploy *second*. Zoho's signature won't match during the gap, so deliveries will go to retry queue — usually fine for a few minutes.
- The `zoho_webhook_events` table grows ~1 row per event. Prune anything older than, say, 90 days with a small nightly job if needed.
