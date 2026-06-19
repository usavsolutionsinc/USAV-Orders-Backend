# Photos Platform — Implementation Plan

**Status:** Draft (2026-06-18)  
**Audience:** Developers implementing GCS-backed photo storage, Neon indexing, share packs, and the ops Photo Library.

---

## 1. Goals

| Goal | Success criteria |
|------|------------------|
| **Single durable store** | New captures land in GCS; `photos.url` is never a fragile LAN/tunnel path |
| **Entity linkage in Neon** | Every photo queryable via `photo_entity_links` (PO, receiving, packer, unit, claim, share pack) |
| **In-app viewing** | Existing `PhotoGallery`, line edit, claim modal work without NAS |
| **Insurance / share workflow** | One-click share pack → public or tokenized link; optional Zendesk ticket link |
| **Late claims** | Photos selectable weeks later at testing — bytes from GCS, not Vercel Blob |
| **Cold archive** | NAS mirror after ~90 days; GCS remains hot; NAS is fallback only |
| **AI-ready** | `photo_analysis` side table; analysis runs async, search via SQL first |

**Non-goals (v1):**
- Google Photos as system of record
- Vercel Blob as primary storage
- Per-PO Google Photos albums
- Vision on every gallery open

---

## 2. Current state (codebase inventory)

### Storage paths today

| Flow | Upload | `photos.url` | Display |
|------|--------|--------------|---------|
| Receiving capture | Browser → NAS WebDAV / `/_agent` | `/api/nas/…` or tunnel URL | `normalizePhotoDisplayUrl` → `/api/nas` proxy |
| Receiving attach | NAS picker → POST URL only | Same | Same |
| Packer | Base64 → Vercel Blob | `blob.vercel-storage.com` | Direct Blob URL |
| Serial unit (pre-pack) | NAS WebDAV | NAS proxy path | Unit detail panel |

### Key files

| Area | Path |
|------|------|
| Receiving attach API | `src/app/api/receiving-photos/route.ts` |
| Packer save | `src/app/api/packing-logs/save-photo/route.ts` |
| Serial unit photos | `src/app/api/serial-units/[id]/photos/route.ts` |
| Unified delete | `src/app/api/photos/[id]/route.ts` |
| Mobile upload queue | `src/components/mobile/receiving/PhotoUploadQueue.ts` |
| Line edit launcher | `src/components/receiving/workspace/line-edit/ReceivingPhotoButton.tsx` |
| Claim modal | `src/components/receiving/workspace/ReceivingClaimModal.tsx` |
| Gallery | `src/components/shipped/PhotoGallery.tsx` |
| Zendesk claim bytes | `src/lib/receiving-claim-photos.ts` + `src/app/api/receiving/zendesk-claim/route.ts` |
| NAS preview (not DB) | `src/app/photos/page.tsx` |

### Schema already present

- `photos` — today has `entity_type` + `entity_id` on the row (legacy); **target:** lean catalog + `photo_entity_links`
- Google Photos columns (backup-era): `google_photos_id`, … → migrate to `photo_exports`
- Admin Google Photos routes were **removed** in commit `a0b915c2`; migrations remain

### Pain points driving this plan

- Split NAS / Blob / tunnel read-write paths
- `photos.url` mixes storage backends; claim `readPhotoBytes` must guess shape
- No cross-PO photo library; `/photos` is NAS folder preview only
- Vercel Blob 2GB cap; unsuitable for photos needed weeks later
- Google Photos album search weak for PO-scoped ops

---

## 3. Target architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Clients (mobile capture, desktop picker, claim modal, photo library)   │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ POST multipart / GET list / share actions
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Next.js API (Vercel)                                                    │
│  • POST /api/photos/upload          → adapter put + INSERT photos + link   │
│  • GET  /api/photos/library         → filtered list (Neon)               │
│  • GET  /api/photos/[id]/content    → signed GCS read (thumb/full)       │
│  • POST /api/photos/share-packs     → create pack + public token         │
│  • GET  /share/photos/[token]       → public read-only page              │
│  • Existing entity routes           → delegate to upload or proxy content│
└───────────────┬─────────────────────────────┬───────────────────────────┘
                │                             │
                ▼                             ▼
┌───────────────────────────┐   ┌─────────────────────────────────────────┐
│  Neon Postgres             │   │  Google Cloud Storage (default adapter)    │
│  photos (catalog)          │   │  gs://{bucket}/{org}/…                   │
│  photo_entity_links        │   │  + optional _thumb.jpg variants          │
│  photo_storage             │   └─────────────────────────────────────────┘
│  photo_share_packs         │
│  photo_share_pack_items    │
│  photo_analysis (1:1)      │
└───────────────────────────┘                    │ async (QStash, 90d+)
                │                                 ▼
                │              ┌─────────────────────────────────────────┐
                │              │  NAS (cold mirror) — fallback only       │
                └──────────────│  Optional: Google Drive/Photos export    │
                               └─────────────────────────────────────────┘
```

**Principles:**
1. **Neon = catalog** — `photos` is the stable photo record; **`photo_entity_links`** holds all relationships to other tables
2. **Never add `photo_id` to receiving, packer, claims, etc.** — linkage is always `photo_entity_links(photo_id, entity_type, entity_id)`
3. **Storage is pluggable** — `photo_storage` rows keyed by `photo_id` + `provider`; new backends = new provider value, not new columns on `photos`
4. **Multi-tenant providers** — per-org default in `photo_storage_providers`
5. **Never store expiring signed URLs in DB** — store object keys; app resolves via `/api/photos/[id]/content`
6. **Share packs** — insurance/customer UX; link pack to entities via `photo_entity_links` + `photo_share_pack_items`

### Table roles (side-car pattern)

```
photos                  ← id, org, photo_type, staff, po_ref (search denorm), created_at
  ├── photo_entity_links ← ALL links to receiving, lines, packer, units, claims, share packs
  ├── photo_storage      ← 1..N rows: where bytes live (GCS, NAS, Blob, S3…)
  ├── photo_analysis     ← 0..1 row: AI metadata
  └── photo_share_pack_items ← M:N bundles (share pack ↔ photo)

photo_storage_providers ← per-org: which provider(s) are enabled + config JSON
```

**Do not** add nullable `receiving_id`, `packer_id`, `claim_id` columns to a link table — use `entity_type` + `entity_id` rows instead (see §4.2).

---

## 4. Database schema

### 4.1 Migration: `2026-06-XX_photos_platform_side_tables.sql`

**Design rules:**
1. Do **not** add `gcs_path`, `storage_backend`, etc. to `photos` — use `photo_storage`.
2. Do **not** keep `entity_type` / `entity_id` on `photos` long-term — use `photo_entity_links`.
3. Do **not** add `photo_id` columns to `receiving`, `packer_logs`, claims, or other parent tables.

```sql
BEGIN;

-- ─── photos: lean catalog (no entity columns, no storage columns) ─────────
-- Target shape (new installs). Existing DB: backfill links then drop entity cols.
--
--   photos (
--     id, organization_id, photo_type, taken_by_staff_id,
--     po_ref,              -- optional search denorm
--     created_at, updated_at
--   )

ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS po_ref TEXT;

CREATE INDEX IF NOT EXISTS idx_photos_org_po_ref
  ON photos (organization_id, po_ref)
  WHERE po_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_photos_org_created
  ON photos (organization_id, created_at DESC);

-- Phase E (2026-06-21): entity_type, entity_id, url dropped from photos.
-- Relationships: photo_entity_links. Bytes: photo_storage.legacy_url / GCS keys.
-- Display: /api/photos/{id}/content (never store expiring signed URLs on photos).

-- ─── photo_entity_links: single hub for all relationships ───────────────
CREATE TABLE IF NOT EXISTS photo_entity_links (
  id              BIGSERIAL PRIMARY KEY,
  photo_id        BIGINT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_id       BIGINT NOT NULL,
  link_role       TEXT NOT NULL DEFAULT 'primary',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_photo_entity_links_entity_type
    CHECK (entity_type IN (
      'RECEIVING', 'RECEIVING_LINE', 'PACKER_LOG', 'SERIAL_UNIT',
      'SKU', 'SKU_STOCK', 'BIN_ADJUSTMENT',
      'SHARE_PACK', 'ZENDESK_TICKET'
    )),
  CONSTRAINT chk_photo_entity_links_link_role
    CHECK (link_role IN ('primary', 'claim_evidence', 'insurance_share')),
  CONSTRAINT ux_photo_entity_links_unique
    UNIQUE (photo_id, entity_type, entity_id, link_role)
);

CREATE INDEX IF NOT EXISTS idx_photo_entity_links_entity
  ON photo_entity_links (organization_id, entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_photo_entity_links_photo
  ON photo_entity_links (photo_id);

-- Backfill from legacy photos.entity_type / entity_id (run once after CREATE):
-- INSERT INTO photo_entity_links (photo_id, organization_id, entity_type, entity_id, link_role)
-- SELECT id, organization_id, entity_type, entity_id, 'primary'
-- FROM photos
-- WHERE entity_type IS NOT NULL AND entity_id IS NOT NULL
-- ON CONFLICT DO NOTHING;

-- ─── photo_storage: 1..N storage locators per photo ─────────────────────
CREATE TABLE IF NOT EXISTS photo_storage (
  id                BIGSERIAL PRIMARY KEY,
  photo_id          BIGINT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  organization_id   UUID NOT NULL,
  provider          TEXT NOT NULL,
  bucket            TEXT,              -- GCS/S3 bucket; null for nas/legacy_url
  object_key        TEXT NOT NULL,     -- path/key within provider
  thumb_object_key  TEXT,
  content_type      TEXT DEFAULT 'image/jpeg',
  file_size_bytes   INTEGER,
  sha256_hex        TEXT,
  legacy_url        TEXT,              -- migration: original NAS/Blob URL
  provider_meta     JSONB NOT NULL DEFAULT '{}',
  is_primary        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_photo_storage_provider
    CHECK (provider IN (
      'gcs', 'vercel_blob', 'nas', 'legacy_url', 's3', 'r2', 'google_drive'
    ))
);

-- Exactly one primary locator per photo (mirrors use is_primary = false)
CREATE UNIQUE INDEX IF NOT EXISTS ux_photo_storage_primary
  ON photo_storage (photo_id)
  WHERE is_primary = TRUE;

CREATE INDEX IF NOT EXISTS idx_photo_storage_org_provider
  ON photo_storage (organization_id, provider);

CREATE INDEX IF NOT EXISTS idx_photo_storage_object
  ON photo_storage (provider, bucket, object_key);

-- ─── photo_storage_providers: per-org backend config ─────────────────────
CREATE TABLE IF NOT EXISTS photo_storage_providers (
  id                SERIAL PRIMARY KEY,
  organization_id   UUID NOT NULL,
  provider          TEXT NOT NULL,
  is_default        BOOLEAN NOT NULL DEFAULT FALSE,
  config            JSONB NOT NULL DEFAULT '{}',
  -- e.g. { "bucket": "usav-photos-prod", "prefix": "", "credential_key": "gcs_main" }
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_photo_storage_providers_provider
    CHECK (provider IN ('gcs', 'vercel_blob', 'nas', 's3', 'r2', 'google_drive'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_photo_storage_providers_org_provider
  ON photo_storage_providers (organization_id, provider);

-- One default provider per org
CREATE UNIQUE INDEX IF NOT EXISTS ux_photo_storage_providers_org_default
  ON photo_storage_providers (organization_id)
  WHERE is_default = TRUE;

-- ─── photo_analysis: 1:1 enrichment (keep photos lean) ────────────────────
CREATE TABLE IF NOT EXISTS photo_analysis (
  id              BIGSERIAL PRIMARY KEY,
  photo_id        BIGINT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  model           TEXT NOT NULL,
  analyzed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata        JSONB NOT NULL DEFAULT '{}',
  error_message   TEXT,
  CONSTRAINT ux_photo_analysis_photo UNIQUE (photo_id)
);

CREATE INDEX IF NOT EXISTS idx_photo_analysis_org_analyzed
  ON photo_analysis (organization_id, analyzed_at DESC);

-- GIN for OCR / label search (phase 3)
CREATE INDEX IF NOT EXISTS idx_photo_analysis_metadata_gin
  ON photo_analysis USING GIN (metadata);

-- ─── photo_share_packs: insurance / customer bundles ──────────────────────
CREATE TABLE IF NOT EXISTS photo_share_packs (
  id              BIGSERIAL PRIMARY KEY,
  organization_id UUID NOT NULL,
  public_token    TEXT NOT NULL UNIQUE,  -- url-safe random, e.g. 32 chars
  title           TEXT NOT NULL,
  pack_type       TEXT NOT NULL DEFAULT 'manual',
  po_ref          TEXT,
  receiving_id    INTEGER,
  zendesk_ticket_id BIGINT,
  created_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  expires_at      TIMESTAMPTZ,
  password_hash   TEXT,                  -- optional bcrypt for public packs
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_photo_share_pack_type
    CHECK (pack_type IN ('manual', 'claim', 'customer'))
);

CREATE INDEX IF NOT EXISTS idx_photo_share_packs_org_created
  ON photo_share_packs (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_photo_share_packs_po
  ON photo_share_packs (organization_id, po_ref)
  WHERE po_ref IS NOT NULL;

-- ─── photo_share_pack_items ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS photo_share_pack_items (
  id              BIGSERIAL PRIMARY KEY,
  pack_id         BIGINT NOT NULL REFERENCES photo_share_packs(id) ON DELETE CASCADE,
  photo_id        BIGINT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  sort_order      SMALLINT NOT NULL DEFAULT 0,
  export_filename TEXT,  -- e.g. Claim_4821_01.jpg
  CONSTRAINT ux_photo_share_pack_item UNIQUE (pack_id, photo_id)
);

COMMIT;
```

### 4.2 `photo_entity_links` — linkage model

**One junction table** connects photos to every other domain table. Parent tables (`receiving`, `packer_logs`, `serial_units`, …) are never altered.

| `entity_type` | `entity_id` references | Typical `link_role` |
|---------------|----------------------|---------------------|
| `RECEIVING` | `receiving.id` | `primary` |
| `RECEIVING_LINE` | `receiving_lines.id` | `primary` |
| `PACKER_LOG` | `packer_logs.id` | `primary` |
| `SERIAL_UNIT` | `serial_units.id` | `primary` |
| `SHARE_PACK` | `photo_share_packs.id` | `insurance_share` |
| `ZENDESK_TICKET` | Zendesk ticket id (numeric) | `claim_evidence` |

**`link_role` values:**

| Role | Use |
|------|-----|
| `primary` | Where the photo was originally captured |
| `claim_evidence` | Added when filing/linking a claim days later (same bytes, new link row) |
| `insurance_share` | Photo included in a share pack / external bundle |

**Multi-link example (late claim at testing):**

```
photo_id 42
  (42, RECEIVING,      1987, 'primary')         ← captured at receiving
  (42, RECEIVING_LINE, 8832, 'primary')         ← optional item-level capture
  (42, SERIAL_UNIT,    501,  'claim_evidence')  ← linked when testing claim filed
  (42, ZENDESK_TICKET, 4821, 'claim_evidence')  ← linked on Zendesk submit
```

**List photos for a receiving carton:**

```sql
SELECT p.*
FROM photos p
JOIN photo_entity_links l ON l.photo_id = p.id
WHERE l.organization_id = $org
  AND (
    (l.entity_type = 'RECEIVING' AND l.entity_id = $receivingId)
    OR (l.entity_type = 'RECEIVING_LINE' AND l.entity_id IN (
         SELECT id FROM receiving_lines WHERE receiving_id = $receivingId
       ))
  )
ORDER BY p.created_at ASC;
```

Implement shared builder in `src/lib/photos/queries/list-for-entity.ts`.

### 4.3 `photo_storage` row examples

| Scenario | `provider` | `bucket` | `object_key` | `is_primary` |
|----------|------------|----------|--------------|--------------|
| New GCS upload | `gcs` | `usav-photos-prod` | `{org}/receiving/2026/06/PO-4421/99.jpg` | true |
| Legacy NAS (migration) | `legacy_url` | null | `_legacy_` | true |
| | | | `legacy_url` = `/api/nas/JUN%202026/foo.jpg` | |
| NAS cold mirror | `nas` | null | `ReceivingPhotos/2026/PO-4421/99.jpg` | false |
| Packer Blob (legacy) | `vercel_blob` | null | blob pathname | true |

**Read path:** `getPrimaryPhotoStorage(photoId)` → provider adapter → bytes or signed URL.

**Multi-backend per photo:** GCS primary + NAS mirror = two `photo_storage` rows; no schema change.

### 4.4 Multi-tenant provider selection

On upload, server reads:

```sql
SELECT provider, config
FROM photo_storage_providers
WHERE organization_id = $1 AND is_default = TRUE;
```

Fallback: env-level `PHOTOS_DEFAULT_PROVIDER=gcs` for orgs with no row (backfill USAV).

Future org on S3 only → insert `photo_storage_providers` row; zero changes to `photos`, `photo_entity_links`, or upload route signature.

### 4.5 Legacy `photos.url` during migration

| Phase | `photo_storage` | `photos.url` |
|-------|-----------------|--------------|
| Legacy row | none or `legacy_url` row | existing NAS/Blob URL |
| New upload | `gcs` primary row | `/api/photos/{id}/content` |
| After backfill | `gcs` primary + optional `legacy_url` retained | content path |

Display helper: `resolvePhotoDisplayUrl(photoId)` in `src/lib/photos/display-url.ts`:

1. If primary `photo_storage` exists → `/api/photos/{id}/content`
2. Else fall back to `photos.url` + `normalizePhotoDisplayUrl` (legacy)

### 4.6 `po_ref` population

On insert, resolve from the **primary** linked entity (the `photo_entity_links` row being created):

| `entity_type` | Source |
|---------------|--------|
| `RECEIVING` | `receiving.zoho_purchaseorder_number` or PO id |
| `RECEIVING_LINE` | line’s PO number via `receiving_lines` |
| `PACKER_LOG` | order id / scan ref from `packer_logs` |
| `SERIAL_UNIT` | parent order PO if resolvable, else unit uid |

Implement in `src/lib/photos/resolve-po-ref.ts` (server-only). Set on `photos.po_ref` at upload time.

### 4.7 Legacy column retirement (Phase E — done)

Migration `2026-06-21_photos_phase_e_drop_legacy_columns.sql`:

```sql
ALTER TABLE photos DROP COLUMN IF EXISTS entity_type;
ALTER TABLE photos DROP COLUMN IF EXISTS entity_id;
ALTER TABLE photos DROP COLUMN IF EXISTS url;
-- also drops google_photos_* columns; parent-delete trigger uses photo_entity_links
```

All list/upload paths use **`photo_entity_links` + `photo_storage` only** (no dual-read). Display URLs are always `/api/photos/{id}/content`.

**Phase D backfill skipped** — greenfield flow; no legacy URL migration required.

---

## 5. Google Cloud Storage setup

### 5.1 Bucket layout

```
gs://{PHOTOS_GCS_BUCKET}/
  {organization_id}/
    receiving/
      {YYYY}/{MM}/
        PO-{poRef}/
          {photoId}.jpg
          {photoId}_thumb.jpg
    packing/
      {YYYY}/{MM}/...
    serial-units/
      {unitUid}/
        {photoId}.jpg
    shares/
      {public_token}/
        Claim_4821_01.jpg   # copies or signed refs at pack creation
```

### 5.2 IAM

- Vercel runtime service account: `roles/storage.objectAdmin` on bucket prefix (or whole bucket per env)
- Signed URLs: use `@google-cloud/storage` with `GOOGLE_APPLICATION_CREDENTIALS` JSON in Vercel secret

### 5.3 Env vars (add to `context/ENV-VARS.md`)

```
PHOTOS_GCS_BUCKET=usav-photos-prod
PHOTOS_GCS_PROJECT_ID=
GOOGLE_APPLICATION_CREDENTIALS_JSON=   # full SA JSON, single line
PHOTOS_SIGNED_URL_TTL_SECONDS=3600
PHOTOS_SHARE_DEFAULT_TTL_DAYS=30
PHOTOS_THUMB_MAX_PX=256
PHOTOS_UPLOAD_MAX_BYTES=8388608        # 8 MB
PHOTOS_NAS_MIRROR_AFTER_DAYS=90        # QStash job
```

### 5.4 Storage adapter layer (provider-agnostic)

Create `src/lib/photos/storage/`:

```
storage/
  types.ts           # PhotoStorageRow, ProviderId, PutResult
  registry.ts        # getAdapter(provider) → GcsAdapter | NasAdapter | ...
  resolve-primary.ts # getPrimaryPhotoStorage(photoId, orgId)
  gcs-adapter.ts     # put, getSignedUrl, delete, copy
  legacy-adapter.ts  # fetch photo_storage.legacy_url
  nas-adapter.ts     # mirror + read fallback
```

Upload route calls `registry.getDefaultProvider(orgId)` → adapter.put() → INSERT `photo_storage`.

DELETE removes all `photo_storage` rows + objects via each adapter.

GCS adapter methods:

- `putObject({ bucket, key, buffer, contentType })`
- `getSignedReadUrl({ bucket, key, ttl, variant })`
- `copyObject({ src, dest })`
- `deleteObject({ bucket, key })`

---

## 6. API routes

### 6.1 New routes

| Method | Path | Permission | Purpose |
|--------|------|------------|---------|
| `POST` | `/api/photos/upload` | entity-specific | Multipart → storage adapter + photos + link |
| `POST` | `/api/photos/links` | entity-specific | Link existing photo to another entity (late claim) |
| `GET` | `/api/photos/library` | `photos.view` (new) | Paginated filter list (joins `photo_entity_links`) |
| `GET` | `/api/photos/[id]/content` | entity or `photos.view` | Stream or redirect signed GCS URL |
| `POST` | `/api/photos/share-packs` | `photos.share` (new) | Create pack from photo ids |
| `GET` | `/api/photos/share-packs/[token]` | public (token) | Pack metadata + photo list |
| `GET` | `/api/photos/share-packs/[token]/zip` | public or staff | Download-all |
| `POST` | `/api/qstash/photos/analyze` | QStash signature | Run vision on one photo |
| `POST` | `/api/qstash/photos/nas-mirror` | QStash signature | Copy GCS → NAS |

### 6.2 Upload contract

```typescript
// POST /api/photos/upload  (multipart/form-data)
{
  file: Blob,
  entityType: 'RECEIVING' | 'RECEIVING_LINE' | 'PACKER_LOG' | 'SERIAL_UNIT',
  entityId: number,
  photoType?: string,
  linkRole?: 'primary' | 'claim_evidence' | 'insurance_share',  // default 'primary'
  poRef?: string,           // optional override
}

// POST /api/photos/links  (json — no new bytes)
{
  photoId: number,
  entityType: 'RECEIVING' | 'RECEIVING_LINE' | 'SERIAL_UNIT' | 'ZENDESK_TICKET' | 'SHARE_PACK',
  entityId: number,
  linkRole: 'primary' | 'claim_evidence' | 'insurance_share',
}

// Response (upload)
{
  id: number,
  url: '/api/photos/123/content',
  thumbUrl: '/api/photos/123/content?variant=thumb',
}
```

**Server steps:**
1. Auth + permission for `entityType`
2. Validate mime (jpeg/png/webp), max size
3. Optional downscale full image (reuse `src/lib/image/downscale` server-side)
4. Generate thumb (256px)
5. Storage adapter `put()` full + thumb
6. `INSERT photos` (`organization_id`, `photo_type`, `taken_by_staff_id`, `po_ref`)
7. `INSERT photo_entity_links` (`photo_id`, `entity_type`, `entity_id`, `link_role`)
8. `INSERT photo_storage` (provider from org default, `bucket`, `object_key`, `thumb_object_key`, `is_primary=true`)
9. Enqueue `photo_jobs` row + QStash analyze job (phase 3)
10. Publish Ably `receiving_photo_uploaded` / station events (preserve existing realtime)

**Link-only (no new bytes):** `POST /api/photos/links` — attach existing `photo_id` to another entity with a new `link_role` (e.g. claim at testing time).

### 6.3 Library query params

```
GET /api/photos/library?
  cursor=&limit=48
  &dateFrom=&dateTo=
  &entityType=RECEIVING|PACKER_LOG|SERIAL_UNIT   # filters photo_entity_links
  &entityId=                                     # with entityType: specific parent row
  &linkRole=primary|claim_evidence|insurance_share
  &poRef=
  &receivingId=                                  # expands to RECEIVING + lines
  &staffId=
  &hasAnalysis=true|false
  &hasSharePack=true|false
  &q=                    # po_ref ILIKE or OCR jsonb (phase 3)
```

### 6.4 Share pack creation

```typescript
// POST /api/photos/share-packs
{
  photoIds: number[],
  title: string,              // "Claim #4821 · PO 4421"
  packType: 'claim' | 'manual' | 'customer',
  poRef?: string,
  receivingId?: number,
  zendeskTicketId?: number,
  expiresInDays?: number,
  filenamePrefix?: string,    // "Claim_4821"
}

// Response
{
  packId: number,
  publicToken: string,
  shareUrl: 'https://app…/share/photos/{token}',
}
```

**Server steps:**
1. Validate all `photoIds` belong to org
2. Insert `photo_share_packs` + `photo_share_pack_items` with `export_filename`
3. Insert `photo_entity_links` for each photo: `(photo_id, SHARE_PACK, pack_id, 'insurance_share')`
4. Optionally link pack to receiving/Zendesk via `photo_entity_links` on the pack id or `photo_share_pack_links` (§21.2)
5. Serve photos via signed URLs from primary `photo_storage` (no GCS copy in v1)
6. Return share URL

### 6.5 Update existing routes

| Route | Change |
|-------|--------|
| `POST /api/receiving-photos` | **Phase 1b:** Delegate to `uploadPhoto()` + link; dual-read lists from `photo_entity_links` |
| `POST /api/packing-logs/save-photo` | Delegate to `uploadPhoto()` |
| `POST /api/serial-units/[id]/photos` | Delegate to `uploadPhoto()` |
| `DELETE /api/photos/[id]` | Delete all `photo_storage` objects; CASCADE removes `photo_entity_links` |
| `POST /api/receiving/zendesk-claim` | Create share pack; add `claim_evidence` links; put share URL in ticket |
| `readPhotoBytes` in `receiving-claim-photos.ts` | Resolve via `getPrimaryPhotoStorage` → provider adapter download |

---

## 7. Permissions

Add to `src/lib/auth/permission-registry.ts`:

```typescript
{ id: 'photos.view',  category: 'photos', label: 'View photo library' },
{ id: 'photos.share', category: 'photos', label: 'Create photo share links' },
```

Update `src/lib/auth/route-permission-manifest.test.ts` and run `scripts/audit-route-auth.ts`.

Entity upload permissions unchanged (`receiving.upload_photo`, `packing.complete_order`, etc.).

---

## 8. Client changes

### 8.1 Unified upload helper

Create `src/lib/photos/upload-client.ts`:

- `uploadPhoto({ file, entityType, entityId, photoType })` → POST multipart
- Used by mobile queue, packer, serial unit capture

### 8.2 Mobile receiving queue

**File:** `src/components/mobile/receiving/PhotoUploadQueue.ts`

Replace NAS PUT pipeline:

```
queued → uploading → POST /api/photos/upload → done
```

Keep localStorage retry semantics; remove `putNasPhoto` / `configureNas` dependency for capture (keep NAS picker as optional legacy attach during migration).

### 8.3 Display URL helper (client)

**File:** `src/lib/photos/display-url.ts`

```typescript
export function photoContentUrl(id: number, variant?: 'thumb' | 'full'): string {
  const q = variant === 'thumb' ? '?variant=thumb' : '';
  return `/api/photos/${id}/content${q}`;
}
```

Update `PhotoGallery` to prefer `id`-based URLs when present.

### 8.4 ReceivingPhotoButton / Claim modal

- Load photos from existing GET endpoints (response includes `photoId` for content URLs; no storage internals)
- Thumbnails: `photoContentUrl(p.id, 'thumb')`
- Claim modal: add **“Share all (N)”** → creates claim pack before/alongside Zendesk submit
- Default insurance flow: select all photos + share link in ticket (reduce per-photo review)

### 8.5 PhotoGallery toolbar

Re-enable / extend:
- **Copy share link** (pack URL, not raw GCS signed URL)
- **Create share pack** from selection
- **Open in library** deep link

---

## 9. Photo Library page (QoL)

### 9.1 Route

- **`/ops/photos`** — staff-only (sidebar entry under Operations or Receiving)
- Deprecate NAS-only `/photos` preview or redirect with banner

### 9.2 UI components

```
src/app/ops/photos/page.tsx
src/components/photos/PhotoLibraryPage.tsx
src/components/photos/PhotoLibraryFilters.tsx
src/components/photos/PhotoLibraryGrid.tsx
src/components/photos/PhotoLibraryToolbar.tsx   # multi-select actions
src/hooks/usePhotoLibrary.ts                    # react-query + cursor pagination
```

### 9.3 Features (v1)

- Grid view with infinite scroll
- Filters: date range, entity type, PO#, staff, receiving id
- Multi-select → create share pack, download zip (phase 2)
- Click photo → fullscreen viewer (reuse `PhotoGallery` modal)
- Row actions: jump to PO, copy link, delete (permission-gated)

### 9.4 Sidebar

Add to `src/lib/sidebar-navigation.ts`:

```typescript
{ key: 'ops-photos', label: 'Photo library', href: '/ops/photos', icon: Camera, requires: 'photos.view' }
```

---

## 10. Public share page

### 10.1 Route

`src/app/share/photos/[token]/page.tsx` — **no auth** (token is secret)

### 10.2 UX

- Title, PO ref, photo count, created date
- Grid of images (signed URLs server-rendered or via API)
- **Download all** button
- Optional password gate if `password_hash` set
- Expired pack → 410 page

### 10.3 Security

- Unguessable `public_token` (32+ bytes base64url)
- Rate limit by IP on public routes
- Do not expose staff names on public page
- Short TTL default (30 days); staff can extend

---

## 11. Zendesk claim integration

**File:** `src/app/api/receiving/zendesk-claim/route.ts`

**New flow:**

1. Operator selects photos (or “all”) in claim modal
2. On submit:
   - Create Zendesk ticket (existing)
   - `POST` internal share pack: `packType='claim'`, `filenamePrefix=Claim_{ticketId}`, all PO photos or selected subset
   - Append to ticket HTML: `Share pack: {shareUrl}`
   - **Optional:** attach 1–2 key photos as files (from GCS bytes) for inline preview
3. Store `zendesk_ticket_id` on `photo_share_packs` (or `photo_share_pack_links` per §21.2)
4. Insert `photo_entity_links` rows: `(photo_id, ZENDESK_TICKET, ticketId, 'claim_evidence')` for selected photos
5. Keep NAS archive step as best-effort fallback during migration only

---

## 12. NAS cold mirror (phase 4)

### 12.1 Job

`POST /api/qstash/photos/nas-mirror` (daily cron)

- Select photos with primary `photo_storage.provider='gcs'`, `created_at < now() - 90 days`, no secondary `photo_storage.provider='nas'` row yet
- Copy bytes GCS → NAS; INSERT second `photo_storage` row (`is_primary=false`, `provider='nas'`)
- On failure: retry; never delete GCS primary in v1

### 12.2 Fallback read order in `readPhotoBytes`

```
1. photo_storage WHERE is_primary = true  (usually gcs)
2. photo_storage WHERE provider = 'nas'   (mirror)
3. photo_storage legacy_url / photos.url
```

---

## 13. AI analysis (phase 3)

### 13.1 Pipeline

```
Upload success → QStash → /api/qstash/photos/analyze
  → fetch image from GCS
  → Cloud Vision OCR + labels OR Gemini Flash JSON schema
  → INSERT/UPDATE photo_analysis (latest row only)
```

### 13.2 Metadata shape

```json
{
  "ocr_text": ["PO 4421", "1Z999AA10123456784"],
  "labels": ["cardboard", "shipping label"],
  "damage_detected": false,
  "damage_notes": null,
  "caption": "Carton on receiving table, label visible"
}
```

### 13.3 Cost control

- Analyze **once** on upload
- Never re-run on gallery open
- Hermes search uses SQL on `photo_analysis.metadata` first; vision only on explicit “analyze these N photos” (cap N≤10)

### 13.4 Hermes tool (phase 3b)

Add to ops assistant tool registry:

```typescript
search_photos({ poRef?, dateFrom?, dateTo?, damageDetected?, limit? })
  → SQL only, returns photo ids + thumb URLs
```

---

## 14. Migration strategy

### Phase A — Dual write (no breaking changes)

1. Deploy migration: `photo_entity_links`, `photo_storage`, side tables
2. Backfill `photo_entity_links` from legacy `photos.entity_type` / `entity_id`
3. New captures: INSERT photos + link + storage; list APIs dual-read links then legacy cols
4. Display resolver uses content route + storage adapter

### Phase B — Client switchover

1. Mobile queue → GCS upload
2. Packer save-photo → GCS
3. Serial unit photos → GCS

### Phase C — Deprecate URL-only receiving POST

1. `POST /api/receiving-photos` with `photoUrl` logs a server warning and returns a `Deprecation` header — prefer `POST /api/photos/upload`
2. Remove NAS PUT from capture path when `NEXT_PUBLIC_PHOTOS_UPLOAD_PROVIDER=adapter`; keep NAS picker attach for legacy files until backfill done

### Phase D — Backfill (skipped)

Not required for this rollout — **no production legacy photo rows**. Optional scripts remain for future imports:

- `scripts/backfill-photos-to-gcs.mjs` — copy legacy URLs → GCS
- `scripts/backfill-photo-entity-links.mjs` — entity links from old `photos.entity_*`

### Phase E — Drop legacy columns (done)

- [x] Migration `2026-06-21_photos_phase_e_drop_legacy_columns.sql`
- [x] All writers use `insertPhotoCatalog` + `photo_entity_links` + `photo_storage`
- [x] All readers join `photo_entity_links`; display via `/api/photos/[id]/content`
- [x] Parent-delete trigger cascades via links
- [ ] Enable NAS mirror cron after GCS stable 30+ days (ops)

---

## 15. Implementation phases & task checklist

### Phase 0 — Prep (1–2 days)

- [x] Create GCS bucket + service account; add Vercel secrets *(ops — env in Vercel)*
- [x] Write migration `2026-06-18_photos_platform_side_tables.sql` (includes `photo_entity_links`)
- [x] Backfill script: `photos.entity_*` → `photo_entity_links` (`scripts/backfill-photo-entity-links.mjs`)
- [x] Add permissions `photos.view`, `photos.share`
- [x] Document env vars in `context/ENV-VARS.md`

### Phase 1 — Core storage (3–5 days)

- [x] `src/lib/photos/storage/*` (adapter registry + GCS adapter)
- [x] `src/lib/photos/resolve-po-ref.ts`
- [x] `src/lib/photos/queries/list-for-entity.ts` (join `photo_entity_links`)
- [x] `src/lib/photos/links.ts` (`createLink`, `listLinksForPhoto`)
- [x] `src/lib/photos/display-url.ts`
- [x] `src/lib/photos/read-bytes.ts` (server: GCS + legacy)
- [x] `POST /api/photos/upload` + `POST /api/photos/links`
- [x] `GET /api/photos/[id]/content`
- [x] Update `DELETE /api/photos/[id]` for GCS cleanup
- [x] Unit tests for path builder + signed URL TTL

### Phase 2 — Client upload switch (3–4 days)

- [x] `src/lib/photos/upload-client.ts`
- [x] Refactor `PhotoUploadQueue.ts` → GCS upload (when `NEXT_PUBLIC_PHOTOS_UPLOAD_PROVIDER=adapter`)
- [x] Refactor `save-photo/route.ts` → GCS
- [x] Refactor `serial-units/[id]/photos` POST → GCS
- [x] Update `PhotoGallery` / `ReceivingPhotoButton` for content URLs
- [x] E2E: mobile capture → gallery visible on desktop — `useReceivingPhotosRealtimeRefresh` + `photos-realtime-sync.spec.ts`

### Phase 3 — Share packs (2–3 days)

- [x] `POST /api/photos/share-packs`
- [x] `GET /api/photos/share-packs/[token]`
- [x] `src/app/share/photos/[token]/page.tsx`
- [x] Claim modal: share-all + link in Zendesk body
- [x] Update `readPhotoBytes` to use GCS

### Phase 4 — Photo Library (3–4 days)

- [x] `GET /api/photos/library`
- [x] `/ops/photos` page + components
- [x] Sidebar nav entry
- [x] Deep links from line edit / unit detail

### Phase 5 — QoL polish (2–3 days)

- [x] Share pack zip download
- [x] Copy link / QR on share page
- [x] Admin storage dashboard (counts by month) — `PhotosPlatformPanel` + `/api/admin/photos/stats`
- [x] `photo_analysis` presence badge in library

### Phase 6 — AI analysis (3–5 days, optional)

- [x] Analyze handler via cron `/api/cron/photos/analyze` + `photo_jobs` *(not QStash)*
- [x] Hermes default (`PHOTOS_ANALYZE_PROVIDER=hermes`); optional Cloud Vision when configured
- [x] Library filter: damage / OCR search (`q=`, `damageDetected`, `hasAnalysis`)
- [x] Hermes photos context (`intent-router` → `fetchPhotosContext` / `searchPhotos`)
- [x] `photo_analysis_runs` history on re-analyze (`2026-06-20_photo_analysis_runs.sql`)

### Phase 7 — NAS mirror (2 days, optional)

- [x] Mirror job via `photo_jobs` + second `photo_storage` row (`provider='nas'`)
- [x] Admin manual re-sync button — `/api/admin/photos/mirror`

### Out of scope (v1)

- Google Drive / Google Photos OAuth export — **not planned**; share packs + ZIP cover vendor handoff
- Phase D GCS byte backfill — **skipped** (greenfield; scripts kept for optional import)
- ~~Phase E legacy column drop~~ — **done** (`2026-06-21_photos_phase_e_drop_legacy_columns.sql`)

---

## 16. Testing plan

| Test | Type | Path | Status |
|------|------|------|--------|
| Upload → content URL returns image | API | `tests/e2e/photos-gcs-upload.spec.ts` | gated `E2E_PHOTOS_GCS=1` |
| Library filter by receivingId / entity | API | `tests/e2e/photos-receiving-platform.spec.ts` | done |
| Share pack public page | E2E | `tests/e2e/photos-share-pack.spec.ts` | done |
| Claim creates pack + share URL | E2E | `tests/e2e/photos-zendesk-share-pack.spec.ts` | skips if Zendesk offline |
| Library deep links | E2E | `tests/e2e/photos-library-deep-link.spec.ts` | done |
| Legacy NAS URL attach + links read | API | `tests/e2e/nas-photos.spec.ts` | done |
| Delete removes row | API | `tests/e2e/photos-delete.spec.ts` | done |
| Mobile queue retry after refresh | E2E | `tests/e2e/mobile-photos.spec.ts` | route via `PW_MOBILE_ENTRY_PATH` |
| Mobile → desktop sync | E2E | `tests/e2e/photos-realtime-sync.spec.ts` | API refetch + `useReceivingPhotosRealtimeRefresh` |

---

## 17. Rollback plan

- Feature flag `PHOTOS_GCS_UPLOAD_ENABLED=false` → fall back to NAS/Blob upload paths
- GCS rows remain readable as long as content route deployed
- Do not delete legacy URLs until backfill verified

---

## 18. Open decisions (resolve before Phase 1)

| # | Decision | Recommendation |
|---|----------|----------------|
| 1 | Single GCS bucket vs env buckets | **Separate** `usav-photos-dev` / `usav-photos-prod` |
| 2 | Share pack bytes: copy vs signed URL only | **Signed URL per photo** in v1; copy to `shares/` if vendor needs stable filenames |
| 3 | Public share auth | Token-only v1; password optional v2 |
| 4 | Keep NAS capture path during migration | **Yes**, 4–6 weeks dual write |
| 5 | Restore Google Photos admin backup | **No** — out of scope; use share packs + ZIP |
| 6 | Thumbnail generation | Server-side on upload (sharp) |

---

## 19. File tree (new/modified)

```
src/lib/photos/
  display-url.ts
  resolve-po-ref.ts
  read-bytes.ts
  upload-client.ts
  links.ts
  share-packs.ts
  queries/
    list-for-entity.ts
    library.ts
  storage/
    types.ts
    registry.ts
    resolve-primary.ts
    gcs-adapter.ts
    legacy-adapter.ts
    nas-adapter.ts

src/app/api/photos/
  upload/route.ts
  links/route.ts
  library/route.ts
  [id]/content/route.ts
  share-packs/route.ts
  share-packs/[token]/route.ts
  share-packs/[token]/zip/route.ts

src/app/ops/photos/page.tsx
src/app/share/photos/[token]/page.tsx

src/components/photos/
  PhotoLibraryPage.tsx
  PhotoLibraryFilters.tsx
  PhotoLibraryGrid.tsx
  PhotoLibraryToolbar.tsx

src/lib/migrations/
  2026-06-XX_photos_platform_side_tables.sql

docs/
  photos-platform-plan.md   ← this document

tests/e2e/
  photos-gcs-upload.spec.ts
  photos-share-pack.spec.ts
```

---

## 20. Summary

**Build order:** storage adapters + upload route → switch clients → share packs + claim links → Photo Library → AI + NAS mirror.

**Neon holds truth; `photo_entity_links` holds relationships; `photo_storage` holds locators; the app is the GUI.**

---

## 21. Consistency improvements (same patterns as `photo_storage`)

Other areas in this plan still use the old “fat table / fat route / env-only config” style. Apply the **side-car + adapter + service layer** pattern everywhere below.

### 21.1 Legacy columns on `photos` → migrate to side tables

| Today (plan / existing schema) | Improvement |
|--------------------------------|-------------|
| `google_photos_id`, `google_album_id`, `google_product_url` on `photos` | **`photo_exports`** rows: `{ photo_id, provider: 'google_photos' \| 'google_drive', external_id, external_url, exported_at }` — same pattern as storage, for on-demand share/export only |
| `photos.url` long-term | **Deprecate** after backfill; display always via `photo_id` + content route; keep `legacy_url` only inside `photo_storage` |
| `po_ref` on `photos` | **Keep** as search denorm (worth the duplication) OR maintain via trigger from entity — do not add more denorm columns (`tracking_ref`, `order_id`, …); resolve those in library SQL joins |

### 21.2 Share packs — split access & external links

`photo_share_packs` is doing too much. Split:

```
photo_share_packs          ← id, title, pack_type, org, created_by, created_at
photo_share_pack_items     ← pack_id, photo_id, sort_order, export_filename (unchanged)
photo_share_pack_access    ← pack_id, public_token, expires_at, password_hash, revoked_at
photo_share_pack_links     ← pack_id, link_type, external_id  (zendesk_ticket, receiving_id, po_ref)
```

**Why:** token rotation, expiry extension, and Zendesk linkage do not require altering the pack row. Multiple links per pack (ticket + customer email) stay clean.

**GCS `shares/{token}/` copies:** prefer **no copy** in v1 — serve via signed URLs from primary `photo_storage`. If export copies are needed, add **`photo_storage` rows** with `provider_meta: { source: 'share_pack', pack_id }` instead of a separate path convention.

### 21.3 Async jobs — `photo_jobs` instead of implicit QStash-only state

| Today | Improvement |
|-------|-------------|
| QStash handlers with no DB job row | **`photo_jobs`**: `{ id, photo_id, job_type: 'analyze' \| 'nas_mirror' \| 'export_drive', status, attempts, last_error, scheduled_at, completed_at }` |
| “No NAS row yet” inferred by query | Job row `status='completed'` + `photo_storage` mirror row — explicit, retryable, visible in admin |

Hermes/admin can query failed jobs; QStash becomes transport, not state.

### 21.4 AI analysis — version history (optional phase 3+)

| Today | Improvement |
|-------|-------------|
| Single `photo_analysis` row, overwrite on re-run | **Default:** keep 1:1 `photo_analysis` (current plan) |
| Re-analyze with new model | **`photo_analysis_runs`** history table OR `analysis_version` + soft-replace; library always reads latest |

Same side-table logic as storage: `photos` never gets `damage_detected` columns.

### 21.5 Org config — one table, not settings + env

| Today in codebase | Improvement |
|-------------------|-------------|
| NAS paths in `organizations.settings.stationNasPhotoFolders` | **Migrate** display defaults to admin UI reading `photo_storage_providers` + optional `photo_capture_defaults` JSON (initial folder labels only — not storage paths) |
| `PHOTOS_GCS_BUCKET` env | Env = platform fallback only; **per-org bucket/prefix** in `photo_storage_providers.config` |
| Raw credentials in JSON | **`credential_key`** → integration vault / `google_oauth_tokens` pattern (see `docs/integrations/token-sot-consolidation-plan.md`) |

### 21.6 API routes — single service, thin handlers

| Today (plan) | Improvement |
|--------------|-------------|
| `POST /api/receiving-photos`, `save-photo`, `serial-units/photos` each own logic | **`src/lib/photos/service.ts`**: `uploadPhoto()`, `listPhotosForEntity()`, `deletePhoto()`, `createSharePack()` — routes are 10-line wrappers |
| `readPhotoBytes` in claim-specific file | **`src/lib/photos/read-bytes.ts`** only — claim, Zendesk, zip, export all call it |
| Library + entity GETs duplicate SQL | **`src/lib/photos/queries.ts`** shared list builder with filters |

Same adapter idea as `storage/registry.ts`, but for application operations.

### 21.7 External export adapter (Google Drive / Photos)

Mirror `photo_storage` pattern:

```
photo_exports
  photo_id | share_pack_id (nullable)
  provider   'google_photos' | 'google_drive'
  external_id, external_url
  created_at
```

Share-pack button “Export to Google Drive” → INSERT export rows, not new columns on pack or photo.

### 21.8 Entity linkage — `photo_entity_links` (P0, not v2)

**Adopted in §4.2.** Do not keep `photos.entity_type` / `entity_id` long-term.

| Anti-pattern | Correct pattern |
|--------------|-----------------|
| `photo_id` column on `receiving`, `packer_logs`, claims | **`photo_entity_links`** only |
| Wide link table with nullable `receiving_id`, `packer_id`, … | **`entity_type` + `entity_id`** rows |
| Duplicate photo bytes for late claim | **`POST /api/photos/links`** with `link_role='claim_evidence'` |

Optional **v3:** `photo_entity_links` M:N already supported — one photo, many links; no `photo_entity_links` schema change needed.

### 21.9 Architecture diagram & goals wording

Update remaining GCS-centric language:

- §1 Goals: “New captures land in **primary storage adapter** (default GCS)”
- §3 diagram: API box says “adapter put + INSERT photo_storage”, not “GCS put”
- §6.1 upload route description: “multipart → **storage adapter**”
- §15 Phase 7: remove stale “`nas_mirror_path` column” — mirror = second `photo_storage` row + `photo_jobs`

### 21.10 Permissions & feature flags

| Pattern | Improvement |
|---------|-------------|
| `PHOTOS_GCS_UPLOAD_ENABLED` | **`PHOTOS_UPLOAD_PROVIDER=legacy\|adapter`** + per-org `photo_storage_providers.is_default` — flag at wrong layer if GCS-only name |
| `photos.view` / `photos.share` | Sufficient for library + share packs — **no** separate export permission |

### 21.11 Priority order for these improvements

| Priority | Change | When |
|----------|--------|------|
| **P0** | `photo_entity_links` + backfill from legacy `photos.entity_*` | Phase 1 |
| **P0** | `photo_storage` + `photo_storage_providers` + service layer | Phase 1 |
| **P0** | Thin API routes → `lib/photos/service.ts` | Phase 1 |
| **P1** | `photo_share_pack_access` + `photo_share_pack_links` split | Phase 3 |
| **P1** | `photo_jobs` for analyze + mirror | Phase 3–7 |
| **P2** | ~~Deprecate `photos.url` + legacy Google columns~~ | **Done** — Phase E migration |
| **P3** | `photo_analysis_runs` history | Phase 6 — **done** |
| ~~**P2**~~ | ~~`photo_exports` for Google optional export~~ | **Cancelled** — not planned |

---

## 22. Revised table map (target end state)

```
photos                      ← id, org, photo_type, staff, po_ref, timestamps (no entity cols)
photo_entity_links          ← ALL relationships (entity_type, entity_id, link_role)
photo_storage               ← 1..N byte locators (gcs, nas, blob, …)
photo_storage_providers     ← per-org provider config + credential_key
photo_analysis              ← 0..1 latest AI enrichment
photo_analysis_runs         ← re-analyze history (implemented)
photo_jobs                  ← async analyze / mirror
photo_share_packs           ← bundle metadata
photo_share_pack_items      ← M:N photos in a pack
photo_share_pack_access     ← token, expiry, password
photo_share_pack_links      ← zendesk_ticket, receiving_id, po_ref
photo_exports               ← schema only; Google push not planned for v1
```
