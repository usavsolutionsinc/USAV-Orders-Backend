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

## Photos platform (GCS catalog — docs/photos-platform-plan.md)

Primary photo bytes land in Google Cloud Storage; Neon holds the catalog (`photos`, `photo_entity_links`, `photo_storage`).

**Platform fallback (orgs without `photo_storage_providers` row):**
```
PHOTOS_GCS_BUCKET=usav-photos-dev          # use usav-photos-prod in production
PHOTOS_GCS_PROJECT_ID=
GOOGLE_APPLICATION_CREDENTIALS_JSON=       # full service-account JSON, single line
PHOTOS_DEFAULT_PROVIDER=gcs
PHOTOS_UPLOAD_PROVIDER=adapter             # adapter | legacy — legacy keeps NAS/Blob capture paths
PHOTOS_SIGNED_URL_TTL_SECONDS=3600
PHOTOS_SHARE_DEFAULT_TTL_DAYS=30
PHOTOS_THUMB_MAX_PX=256
PHOTOS_UPLOAD_MAX_BYTES=8388608            # 8 MB
PHOTOS_NAS_MIRROR_AFTER_DAYS=90          # future NAS cold-mirror cron
NEXT_PUBLIC_PHOTOS_UPLOAD_PROVIDER=adapter
PHOTOS_ANALYZE_ENABLED=false
PHOTOS_ANALYZE_ON_UPLOAD=false
PHOTOS_ANALYZE_PROVIDER=hermes          # hermes (default) | vision | catalog
PHOTOS_JOB_MAX_ATTEMPTS=5
```

**Client:** when `NEXT_PUBLIC_PHOTOS_UPLOAD_PROVIDER=adapter`, mobile/desktop capture POSTs multipart to `/api/photos/upload` instead of NAS WebDAV PUT + URL attach.

**Analysis (opt-in):** set `PHOTOS_ANALYZE_ENABLED=true` to process `photo_jobs` via cron. Default provider is **Hermes** (`HERMES_API_URL`) — no GCP Vision required. Set `PHOTOS_ANALYZE_PROVIDER=vision` only if you want Cloud Vision OCR instead. Cron: `/api/cron/photos/analyze`.

**NAS cold mirror:** `/api/cron/photos/nas-mirror` runs daily; requires `NAS_AGENT_URL` + `NAS_AGENT_TOKEN` (or `NAS_DEV_ROOT` locally).

**Legacy URL attach:** `POST /api/receiving-photos` with `photoUrl` still works for NAS picker flows but returns a `Deprecation` header — prefer `POST /api/photos/upload`.

## NAS (Synology — receiving / shipping photos)

Storage lives on the **Synology NAS**, mounted on the office Mac at `/Volumes/USAV Media`.
The NAS Media Agent (`deploy/nas-media-agent/`) runs on that Mac behind the
`nas-photos.michaelgarisek.com` tunnel. Vercel never touches the LAN directly.

**Vercel (production / preview):**
```
# Photo read/write proxy upstream — the Cloudflare tunnel ROOT that serves browse + WebDAV
# (NOT /_agent/file/receiving unless that agent route is actually mounted)
NAS_RW_URL=https://nas-photos.michaelgarisek.com
NAS_RW_TOKEN=           # Optional; only if the tunnel requires x-agent-token
NAS_AGENT_URL=https://nas-photos.michaelgarisek.com/_agent
NAS_AGENT_TOKEN=        # Same secret as NAS Media Agent (Zendesk archive, agent APIs)
```

**Office Mac (agent process):**
```
# Optional bootstrap defaults — Admin → NAS Photos → Workflow folders is the live source of truth.
# NAS_ROOT_* are used only until the agent receives PUT /roots from Vercel after an admin save.
NAS_ROOT_RECEIVING="/Volumes/USAV Media/Puchasing photos/2026"
NAS_ROOT_SHIPPING="/Volumes/Shipping/2026"
NAS_ROOT_CLAIMS="/Volumes/USAV Media/Puchasing photos/2026/2 Zendesk 2026"
NAS_AGENT_TOKEN=
NAS_AGENT_PORT=8787
```

**Local dev** (Synology share must be mounted):
```
NAS_DEV_ROOT="/Volumes/USAV Media/Puchasing photos/2026"
NAS_RW_URL=http://localhost:3000/api/nas-dev
```

**Admin UI** (per org, not env vars): Admin → NAS Photos
- `nasPhotoServers` — active tunnel base URL (`https://nas-photos.michaelgarisek.com`)
- `nasStorageTargets` — workflow mount roots (`receiving`, `shipping`, `claims`) and subfolders
- `stationNasPhotoFolders` — month subfolder per station (e.g. `JUN 2026`)

See `deploy/nas-media-agent/README.md` and `docs/nas-receiving-write-tunnel-plan.md`.

## AI
```
OLLAMA_BASE_URL=
HERMES_API_URL=         # Production/preview: https://hermes.michaelgarisek.com/v1
HERMES_API_KEY=         # Server-only bearer expected by Hermes gateway
HERMES_MODEL=           # Usually hermes-agent
CLOUDFLARE_ACCESS_CLIENT_ID=      # Optional if Cloudflare Access protects Hermes
CLOUDFLARE_ACCESS_CLIENT_SECRET=  # Optional if Cloudflare Access protects Hermes
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
