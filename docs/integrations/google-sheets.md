# Google Sheets

The **legacy order-transfer pipeline** — USAV's pre-app orders/tech/packer data lived in
a Google Sheet, and these jobs pull it into the DB. Built and live, but **write-back to
Sheets is removed** (everything now persists straight to Postgres). Service-account auth
(no per-user OAuth).

## Auth — `src/lib/google-auth.ts`

`getGoogleAuth()` builds a JWT from a service account
(`GOOGLE_CLIENT_EMAIL` + `GOOGLE_PRIVATE_KEY`). Scopes:
`https://www.googleapis.com/auth/spreadsheets` and `.../auth/drive.readonly`.
`connect: 'vault'` in the catalog (`admin.manage_features` to manage); the env fallback
mirrors USAV's single service account.

## Routes

| Route | Auth | Purpose |
|---|---|---|
| `POST\|GET /api/google-sheets/transfer-orders` | `orders.import` | Streaming NDJSON job: import orders from the sheet (POST takes optional `manualSheetName`). |
| `POST /api/google-sheets/sync-shipstation-orders` | `admin.manage_features` | Upload a ShipStation CSV → match tracking → insert/update orders, clear matched exceptions. |
| `POST /api/google-sheets/execute-script` | `admin.manage_features` | Routes `scriptName` → `checkShippedOrders` / `syncTechSerialNumbers` / `syncPackerLogs`. |
| `POST /api/sync-sheets` | `integrations.sheets` | Multi-tab sync: `shipped` + `tech_1..3` + `packer_*` in one pass. |
| `POST /api/google-sheets/append` | `admin.manage_features` | **Removed** — returns 410. Persist to the DB instead. |

`updateNonshippedOrders` (an old execute-script target) is likewise **410 Gone**.

## What `/api/sync-sheets` maps

- **`shipped`** tab → `orders` (`status='shipped'`, title/qty/condition/tracking/sku +
  `sku_catalog_id`, `account_source`).
- **`tech_1` / `tech_2` / `tech_3`** → `tech_serial_numbers` (+ `orders_exceptions` for
  unmatched tracking); resolves `shipment_id` from tracking.
- **`packer_*`** (dynamic tab names) → `packer_logs` (+ legacy allocation mirror).
- Detects FBA-like FNSKU patterns and logs exceptions when tracking doesn't match an
  order.

Shared helpers live in `src/lib/sync/sheet-sync-common.ts`
(`getTrackingLast8`, `hasFbaFnsku`, `hasOrderByTracking`, `parseSheetDateTime`,
`upsertOpenOrdersException`, …). The transfer-orders job is
`src/lib/jobs/google-sheets-transfer-orders.ts`
(`runGoogleSheetsTransferOrders(manualSheetName?, source?, emitFn?)`).

## Cron (`vercel.json`)

| Schedule | Path |
|---|---|
| `30 15 * * 1-5` | `/api/cron/google-sheets/transfer-orders` (3:30pm weekdays) |
| `0 18 * * 1-5`  | `/api/cron/google-sheets/transfer-orders` (6:00pm weekdays) |
| `0 22 * * 1-5`  | `/api/cron/google-sheets/transfer-orders` (10:00pm weekdays) |

The cron route calls `runGoogleSheetsTransferOrders()` under `withCronRun()`.

## Environment variables

| Var | Purpose |
|---|---|
| `GOOGLE_CLIENT_EMAIL` | Service-account email. |
| `GOOGLE_PRIVATE_KEY` | Service-account private key (escaped multiline). **Sensitive**. |
| `SPREADSHEET_ID` | Target spreadsheet (a default is hardcoded in the job). |
| `CRON_SECRET` | Bearer for the transfer-orders cron. |

## Status / direction

This is a **migration-era** integration: it exists to drain the old spreadsheet workflow
into the DB. New writes never go back to Sheets. As the v1 outbound tracker
(`docs/integrations/`/ memory `v1-tracker-tier-strategy`) takes over the orders sheet,
these jobs become the backfill path, not the steady state.
