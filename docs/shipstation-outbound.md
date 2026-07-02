# Outbound Shipping — ShipStation rate-shop + buy-label

The Outbound · Labels station can now **rate-shop live carrier prices and buy a
label in one flow**, instead of pasting a tracking number by hand. It reuses the
existing outbound plumbing end-to-end: the purchased label + a generated packing
slip land in the same `documents` tray + "Print both" view, the tracking is
registered through the same shipment-link spine, and the order flips to shipped
via the normal path.

## The two ShipStation APIs (why both)

ShipStation exposes **two different APIs** and we use each for what only it can do:

| | Host | Auth | Used for |
|---|---|---|---|
| **v2** (ShipEngine) | `api.shipstation.com/v2` | `API-Key: <key>` | **Rate-shop, buy/void labels, tracking, webhooks** — the label engine |
| **v1** (legacy) | `ssapi.shipstation.com` | Basic `key:secret` | **Order pull** (orders with SKUs + weights) — v2 has **no** order-list endpoint |

Both keys come from the **same ShipStation account** (Settings → Account → API
Settings). v2 is required for the core buy-label flow; v1 is optional and only
needed if you want live order sync + "use the order's ShipStation-stored weight".

## Environment variables

Credentials are per-tenant in the encrypted `organization_integrations` vault
(Settings → Integrations → ShipStation). For the USAV single tenant you can
bootstrap from env instead (mirrors the other providers):

```bash
# ── ShipStation credentials (USAV env bootstrap; prod uses the vault) ──
SHIPSTATION_API_KEY=              # v2 API key — REQUIRED (rates/labels/void)
SHIPSTATION_V1_API_KEY=           # v1 key    — optional (order pull + stored weight)
SHIPSTATION_V1_API_SECRET=        # v1 secret — optional
SHIPSTATION_WEBHOOK_TOKEN=        # unguessable path segment for the webhook URL
SHIPSTATION_WEBHOOK_SECRET=       # this org's shared secret (optional extra check)

# ── Warehouse origin (ship_from) — used on every rate/label ──
# Preferred: set a structured address under the org's settings.shipFrom.
# Fallback: these env vars.
SHIPSTATION_SHIP_FROM_NAME=
SHIPSTATION_SHIP_FROM_COMPANY=
SHIPSTATION_SHIP_FROM_PHONE=
SHIPSTATION_SHIP_FROM_ADDRESS1=
SHIPSTATION_SHIP_FROM_ADDRESS2=
SHIPSTATION_SHIP_FROM_CITY=
SHIPSTATION_SHIP_FROM_STATE=
SHIPSTATION_SHIP_FROM_POSTAL=
SHIPSTATION_SHIP_FROM_COUNTRY=US

# ── Already-required platform vars this feature leans on ──
INTEGRATION_KMS_KEY=              # AES-256-GCM key for the vault (prod-required)
RESEND_API_KEY=                   # customer ship-notification email (optional)
EMAIL_FROM=                       # From: header for notifications
# GCS (label/slip byte storage) — the same config the outbound documents use.
```

Optional overrides: `SHIPSTATION_V2_BASE_URL`, `SHIPSTATION_V1_BASE_URL`,
`SHIPSTATION_JWKS_URL`.

## Permissions

- `shipping.buy_label` — gates rate-shop (`POST /api/outbound/rates`) and label
  purchase (`POST /api/outbound/labels/purchase`).
- `shipping.void_label` — gates voiding (`POST /api/outbound/labels/void`);
  **step-up + reason-required**.

Grant these to the packing/shipping roles in Admin → Roles.

## Connection steps

1. In ShipStation: **Settings → Account → API Settings** → generate the v2 API
   key (and the v1 key/secret if you want order sync). Connect your carriers in
   ShipStation (UPS/USPS/FedEx/etc.) — the rate-shop returns exactly the
   carriers connected there.
2. In this app: **Settings → Integrations → ShipStation** → paste the credential
   JSON into the vault (`{ "apiKey": "...", "v1ApiKey": "...", "v1ApiSecret": "..." }`),
   or set the env vars above for USAV.
3. Set your **warehouse ship-from** (org `settings.shipFrom` or the
   `SHIPSTATION_SHIP_FROM_*` env). A rate needs a complete origin (line1 + city +
   state + zip).
4. (Optional) Register the tracking webhook — see below.

## The full flow (how to test)

1. **Sync orders** — `POST /api/integrations/shipstation/sync` (or the
   integrations cron) pulls ShipStation orders (v1) into `orders`
   (`account_source = 'shipstation'`). Awaiting-shipment orders land in the
   Outbound · Labels queue. *(Marketplace orders from eBay/Amazon/Square already
   sync via their own connectors and can also be rated/labelled, as long as they
   have a ship-to + a weight.)*
2. **Open an order** in Outbound · Labels → the **Documents** tab shows the new
   **Buy Label** panel.
3. **Get shipping rates** → live carrier options (cheapest first) with price +
   ETA.
4. **Pick a rate → Confirm & buy** → the label is purchased. The tracking is
   registered as the order's primary shipment; the label PDF + a generated
   packing slip are stored and appear in the document tray.
5. **Print** the label + slip from the main-pane "Print both".
6. If wrong: **Void / refund** on the success card (reason required).

## Webhook (near-real-time tracking)

Register a `track` webhook in ShipStation pointing at:

```
https://<your-domain>/api/webhooks/shipstation/<SHIPSTATION_WEBHOOK_TOKEN>
```

via `POST https://api.shipstation.com/v2/environment/webhooks`
`{ "event": "track", "url": "…/api/webhooks/shipstation/<token>" }`.

The receiver verifies ShipStation's **RSA-SHA256 signature** (over
`timestamp + "." + rawBody`, JWKS-published key) when present, and always gates
on the unguessable token in the path. Tracking events update the matching
shipment through the existing tracking spine and fan out a realtime refresh.

## Known limitations / follow-ups

- **Idempotency window.** The buy-label route dedupes on a per-purchase
  `clientEventId` (stored as the label document's `sourceHash`), and the UI
  disables double-submit. ShipStation's create-label is not itself idempotent,
  so the one residual double-charge window is a purchase that succeeded but died
  before the document write. A dedicated `shipstation_label_purchases` idempotency
  table would close it fully.
- **Stored weight needs v1.** For a ShipStation-sourced order, the rate/label
  reuses the order's ShipStation-stored weight by fetching the v1 order live.
  Non-ShipStation orders (eBay/Amazon/Square) have no ShipStation weight — pass a
  `weightOz` override in the rate request (a manual weight field is an easy UI
  add) or none of their rates will price.
- **Customers not populated at sync.** The order sync writes `orders` but not
  `customers`; the rate/label ship-to comes from the live v1 order. Populating
  `customers` (so the panel's Customer tab shows the buyer for ShipStation
  orders) is a follow-up.
- **Webhook updates existing shipments only.** A `track` event for a tracking
  number we didn't buy is a no-op (we don't create STN rows from webhooks).
