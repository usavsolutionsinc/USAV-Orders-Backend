# Google Drive photo backup — setup & operations

Lets **any tenant** connect **their own** Google Drive with one "Sign in with Google" click, so
photo originals back up into storage they pay for — not your GCS bucket. One shared Google Cloud
OAuth client serves every tenant; each tenant's refresh token + backup folder are stored per-org
(encrypted) in the `organization_integrations` vault.

This doc is the **Google Cloud Console checklist** plus the env vars and how the pieces run.

---

## 1. What you do in the Google Cloud Console (one-time)

You're creating **one** OAuth client for the whole platform. Tenants never touch the console — they
just click "Connect" and sign in.

### 1.1 Pick / create a project
1. Go to <https://console.cloud.google.com/> → top bar project picker → **New Project** (or reuse the
   project that already holds your GCS bucket / Google Photos client). Name it e.g. `usav-platform`.

### 1.2 Enable the Google Drive API
1. **APIs & Services → Library** → search **"Google Drive API"** → **Enable**.
   (That's the only API needed. Do **not** enable the full Drive scope set.)

### 1.3 Configure the OAuth consent screen
1. **APIs & Services → OAuth consent screen**.
2. **User type: External** (so any tenant's Google account can connect), → **Create**.
3. App information:
   - **App name:** what users see on the consent screen (e.g. "USAV Orders").
   - **User support email:** your support address.
   - **App logo** (optional but recommended — shows on the consent screen).
4. **App domain** (recommended for a clean consent screen):
   - Application home page, Privacy policy URL, Terms of service URL.
   - **Authorized domains:** add your apex domain (e.g. `yourdomain.com`).
5. **Scopes →  Add or remove scopes →** add **exactly one**:
   ```
   https://www.googleapis.com/auth/drive.file
   ```
   (`openid`, `email`, `profile` are added automatically / are non-sensitive.)
   > `drive.file` = the app can only see files **it** created. This is least-privilege **and** keeps
   > you out of Google's restricted-scope review (no annual CASA security assessment). Do **not** add
   > `auth/drive` or `auth/drive.readonly`.
6. **Test users:** while the app is in **Testing**, add the Google accounts you'll test with
   (yours + a tenant's). ⚠️ In Testing, Google **rotates refresh tokens ~weekly** → backups will
   start failing with a "reconnect" prompt. **Publish to Production** before real use (next step).
7. **Publishing status → Publish app.** With only `drive.file` (non-sensitive), this is usually
   instant — no verification queue. If Google still asks for verification, it's the lightweight
   "branding" review (logo/domain), not the restricted-scope security review.

### 1.4 Create the OAuth client ID
1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. **Application type: Web application.** Name it e.g. `usav-drive-web`.
3. **Authorized redirect URIs** — add one per environment, each EXACTLY matching what the app sends:
   ```
   https://app.yourdomain.com/api/integrations/google-drive/callback      (production)
   https://staging.yourdomain.com/api/integrations/google-drive/callback  (preview, if used)
   http://localhost:3000/api/integrations/google-drive/callback           (local dev)
   ```
   > Must be character-for-character identical to `GOOGLE_DRIVE_REDIRECT_URI` (see §2). A trailing
   > slash, wrong scheme, or wrong host = `redirect_uri_mismatch`.
4. **Create** → copy the **Client ID** and **Client secret**.

That's everything in the console. ✅

---

## 2. Environment variables (set in Vercel + local `.env`)

> The repo hook blocks editing `.env*` from tooling — add these by hand. They're documented here and
> belong in `.env.example` too (blank values).

| Var | Required | Example / notes |
|---|---|---|
| `GOOGLE_DRIVE_CLIENT_ID` | ✅ | from §1.4 |
| `GOOGLE_DRIVE_CLIENT_SECRET` | ✅ | from §1.4 |
| `GOOGLE_DRIVE_REDIRECT_URI` | ✅ | must equal an Authorized redirect URI exactly, e.g. `https://app.yourdomain.com/api/integrations/google-drive/callback` |
| `INTEGRATION_KMS_KEY` | ✅ (already set) | base64 32-byte key — encrypts the stored refresh token. Required in prod. |
| `CRON_SECRET` | ✅ (already set) | authorizes the nightly backup cron. |
| `PHOTOS_DRIVE_FOLDER_NAME` | optional | backup folder name in each Drive (default `USAV Photo Backup`). |
| `PHOTOS_DRIVE_MIRROR_AFTER_DAYS` | optional | only back up photos older than N days (default `0` = immediately). |
| `PHOTOS_DRIVE_BACKUP_ENABLED` | optional | global kill-switch (default `true`). |

**Vercel:** Project → Settings → Environment Variables → add for Production (and Preview). Env
changes only take effect **after a redeploy**.

If you don't set a separate redirect per environment, you can omit `GOOGLE_DRIVE_REDIRECT_URI` and the
app falls back to `${APP_URL or NEXT_PUBLIC_APP_URL}/api/integrations/google-drive/callback` — but then
that exact computed URL **must** be in the Authorized redirect URIs list.

---

## 3. How a tenant connects (the runtime flow)

1. Tenant admin opens **Settings → Integrations → Storage & Backup → Google Drive → Connect**.
   (Requires the `integrations.google_drive` permission.)
2. Browser → `GET /api/integrations/google-drive/connect` → 302 to Google consent
   (`scope=drive.file`, `access_type=offline`, `prompt=consent`; org id travels in an AES-GCM
   encrypted `state`).
3. Google → `GET /api/integrations/google-drive/callback` (no session cookie; org recovered from the
   encrypted state, 15-min TTL). The app:
   - exchanges the code for a **refresh token**,
   - creates the **backup folder** in the user's Drive,
   - stores `{refreshToken, rootFolderId, accountEmail}` encrypted in the vault
     (`organization_integrations`, provider `google_drive`),
   - records an `integration.connect` audit row,
   - redirects back with a success banner.
4. Backups begin automatically (see §4). "Check" on the card calls
   `/api/integrations/google-drive/health` (mints a token, reads the account's storage quota).

**Disconnect:** the card's Disconnect → `POST /api/admin/integrations/delete` removes the vault row.
Existing Drive copies remain in the tenant's Drive and stay referenceable.

---

## 4. How backup runs

- **Nightly cron** `GET /api/cron/photos/drive-mirror?limit=25` (in `vercel.json`, `0 5 * * *`).
  It selects GCS-primary photos for orgs with an **active** `google_drive` connection, enqueues
  `export_drive` jobs, uploads each into `…/USAV Photo Backup/<yyyy>/<MM>/PO-<po>_<id>.jpg`, and
  writes a non-primary `photo_storage` row (`provider='google_drive'`, `object_key=<driveFileId>`).
  No-op for tenants who never connected Drive.
- **Manual** from the photo library: `POST /api/photos/drive-backup` runs one batch immediately;
  `GET` returns status + Drive storage quota.
- **Idempotent & resilient:** one job per photo (`UNIQUE`-guarded enqueue + `SKIP LOCKED` claim),
  exponential backoff on failure, and a Postgres advisory lock so overlapping cron runs don't double-run.
- **Reconnect handling:** a revoked/expired refresh token flips the vault row to `status='error'`
  and the card shows "Needs attention" → the tenant reconnects.

### Reading photos back
`readPhotoBytesById` now falls back to Drive (`getDriveFileMedia`) after GCS/NAS, so anything that
streams a photo (Zendesk claim attachments, share-pack zips, the `/api/photos/[id]/content` route)
keeps working even when the bytes live in the tenant's Drive.

---

## 5. Going further — actually dropping the GCS bill (phase 2, not yet built)

Phase 1 (this change) is a **mirror** — GCS stays primary, so it *adds* a little cost. To make Drive
authoritative and shrink the GCS bill, a follow-up adds a `gcs-evict` cron: for photos with a
**verified** Drive copy (sha/size match) older than `evict_gcs_after_days`, delete the GCS full-res
object (keep the small GCS thumbnail hot for the library grid) and serve full-res from Drive on demand.
Flag-gated, with a clear "you own these files now" warning in the UI. Say the word and I'll build it.

---

## 6. Quick verification checklist

- [ ] Drive API enabled; consent screen **Published**; `drive.file` scope only.
- [ ] OAuth **Web** client created; redirect URI(s) match `GOOGLE_DRIVE_REDIRECT_URI` exactly.
- [ ] `GOOGLE_DRIVE_CLIENT_ID/SECRET/REDIRECT_URI` set in Vercel (Production) + redeployed.
- [ ] Settings → Integrations shows a **Google Drive** card under "Storage & Backup".
- [ ] Click **Connect** → Google consent → lands back with "Google Drive connected".
- [ ] A `USAV Photo Backup` folder appears in that Google account's Drive.
- [ ] **Check** button reports healthy (shows quota).
- [ ] Manual backup (or wait for the 05:00 UTC cron) creates `.../yyyy/MM/PO-*.jpg` files.
