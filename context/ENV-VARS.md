# Environment Variables

All env vars are set in Vercel secrets (production) and `.env` (local development).

## Database
```
DATABASE_URL=postgresql://user:pass@host/db
PGHOST=
POSTGRES_USER=
POSTGRES_PASSWORD=
```

## Realtime & Caching
```
ABLY_API_KEY=           # Ably realtime
QSTASH_TOKEN=           # Upstash QStash job scheduling
KV_REST_API_TOKEN=      # Upstash Redis cache
```

## eBay Integration
```
EBAY_APP_ID=
EBAY_CERT_ID=
EBAY_REFRESH_TOKEN_*=   # Per-account tokens
```

## Zoho Inventory
```
ZOHO_CLIENT_ID=
ZOHO_CLIENT_SECRET=
ZOHO_ORG_ID=
```

## Google Sheets
```
GOOGLE_PRIVATE_KEY=
GOOGLE_CLIENT_EMAIL=
```

## Shipping Carriers
```
UPS_CLIENT_ID=
UPS_CLIENT_SECRET=
FEDEX_CLIENT_ID=
FEDEX_CLIENT_SECRET=
CONSUMER_KEY=           # USPS
CONSUMER_SECRET=        # USPS
```

## Ecwid / Square
```
ECWID_STORE_ID=
ECWID_API_TOKEN=
SQUARE_ACCESS_TOKEN=
SQUARE_LOCATION_ID=
```

## File Storage
```
BLOB_READ_WRITE_TOKEN=  # Vercel Blob
```

## AI
```
OLLAMA_BASE_URL=
AI_CHAT_RATE_LIMIT=
```

## App Config
```
NEXT_PUBLIC_APP_URL=    # Base URL for the app
```

## Post-Deploy
After deploying, bootstrap QStash schedules:
```
POST /api/qstash/schedules/bootstrap
```
