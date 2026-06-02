# NAS Photo Server — "Select from NAS" picker

A tiny **read-only** nginx container that serves your synced photo folder to the
receiving app's "Select from NAS" picker. Photos taken on phones sync to the NAS
as usual; receivers then pick the right shots from a PO/item screen instead of
re-taking them in the app.

## How it fits together

```
phone camera ──sync──▶ NAS photos folder
                              │
                  (this nginx container, read-only)
                              │  HTTP(S) + JSON listing
                              ▼
receiver's browser ──fetch listing & thumbnails──▶ picks files
        │
        └──POST /api/receiving-photos { photoUrl } ──▶ Vercel app stores the URL
```

The **Vercel app never touches the NAS** — it only stores the chosen URL
string. The receiver's browser (on the office network) reads the listing and
images directly. That's why this is **internal-only**: the URLs resolve only for
browsers on your LAN/VPN.

## Setup on the Ugreen NAS (UGOS Pro)

1. **Find the real host path** of your photos folder. SSH in and run `ls /volume1`
   (Ugreen shares usually live under `/volume1/<share>/...`). Confirm the photos
   are there.
2. Edit `docker-compose.yml` → change the left side of the volume mount to that
   path. **Only mount the photos folder** — never a parent that holds secrets.
3. Copy `docker-compose.yml` + `nginx.conf` to the NAS (e.g. via File Station)
   and, in Docker / Container Station, run:
   ```sh
   docker compose up -d
   ```
4. Sanity check from a LAN browser: `http://<nas-ip>:8088/` should return a JSON
   listing, and `http://<nas-ip>:8088/<some-photo>.jpg` should show the image.

## Point the app at it

Set this env var (Vercel project settings + your local `.env.local`):

```
NEXT_PUBLIC_NAS_PHOTOS_BASE_URL=http://<nas-ip>:8088
```

When set, a **NAS** button appears next to **+ Photo** on the mobile receiving
photo galleries. When unset, the picker is hidden and nothing changes.

## ⚠️ HTTPS is required on the live site

The deployed app is served over **HTTPS**. Browsers **block** `http://` images
on an HTTPS page (mixed content), so the picker thumbnails and attached photos
will be blank in production until the NAS is reachable over **HTTPS**.

- **Local dev** (`http://localhost:3000`) works fine against an `http://` NAS —
  test here first.
- **Production:** put the NAS behind HTTPS. Options:
  - A reverse proxy on the NAS with a cert (UGOS reverse proxy + Let's Encrypt
    via a DNS challenge for an internal hostname), or
  - Your existing internal HTTPS ingress.
  Then set `NEXT_PUBLIC_NAS_PHOTOS_BASE_URL=https://nas.yourdomain/...`.

## Notes & limits

- **HEIC is excluded.** iPhone's default `.heic` won't render in Chrome/Android,
  and we attach by URL with no transcode. Configure the phone/NAS sync to export
  **JPEG**, or add a transcode step later. Supported: `jpg/jpeg/png/webp/gif`.
- **CORS** is open (`*`) for the JSON listing — it exposes only photo filenames.
  Lock it to your app origin in `nginx.conf` if you prefer.
- **Deleting** a NAS-sourced photo in the app removes only the DB row; the
  original file stays on the NAS (the delete route only purges Vercel Blob URLs).
- **Security:** the container is `read_only` and the volume is mounted `:ro`, so
  it can't modify or delete anything on the NAS even if compromised.
