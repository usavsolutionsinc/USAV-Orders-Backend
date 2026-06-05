# Receiving photos: direct-to-NAS write

## ✅ Deployed state (2026-06-05)

Done and verified on the Ugreen DH2300 at `192.168.50.125`:

- **WebDAV write is live** on `http://192.168.50.125:8088`. Caddy was rebuilt
  with the `webdav` module; it now serves reads (browse/JSON) AND accepts `PUT`,
  with credentialed CORS (preflight `204`, `PUT` `201`, `GET` `200` all verified).
- **Runs as a managed service** — `systemd --user` unit `nas-photos.service`
  (`Restart=always`), with **linger enabled**, so it survives crashes and reboots.
  Manage it over SSH with `XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user
  status|restart nas-photos`.
- **App is pointed at it** — org setting `nasPhotoServers.test =
  http://192.168.50.125:8088`, `active = test`. (Was mistakenly
  `https://192.168.50.125`, which is the **UGOS admin** on :443, not the photo
  server — that's why it was unreachable.)

### ⚠️ The address gotcha (why `https://192.168.50.125` didn't work)
- `:443` / `:9443` on the NAS = the **Ugreen UGOS admin console** (self-signed),
  not the photo server.
- The photo server is **`http://192.168.50.125:8088`** (plain HTTP).
- So on the LAN / local dev (`http://localhost:3000`) it works now. The **live
  HTTPS app** still can't use the `http://` LAN URL (mixed content), which is the
  one remaining step → Cloudflare tunnel below (your Cloudflare login required).

### ▶ Remaining: production HTTPS (Cloudflare tunnel — your steps)
`cloudflared` is already installed at `~/cloudflared` on the NAS. To finish:

```sh
# On the NAS (interactive — opens a browser against YOUR Cloudflare account):
~/cloudflared tunnel login
~/cloudflared tunnel create usav-nas-photos
# Route a hostname you own in Cloudflare to the local Caddy:
~/cloudflared tunnel route dns usav-nas-photos nas-photos.<yourdomain>
# ~/.cloudflared/config.yml:
#   tunnel: usav-nas-photos
#   credentials-file: /home/Michael Garisek/.cloudflared/<TUNNEL_ID>.json
#   ingress:
#     - hostname: nas-photos.<yourdomain>
#       service: http://localhost:8088
#     - service: http_status:404
# Run it (then make it a systemd --user service like nas-photos for persistence):
~/cloudflared tunnel run usav-nas-photos
```

Then in the app: Admin → Receiving Photos → set **Production** =
`https://nas-photos.<yourdomain>`, flip **active** to Production, Save. Protect
the tunnel with **Cloudflare Access** (the client PUTs with
`credentials:'include'`, so the Access cookie flows). Add the hostname to
`next.config` `images.remotePatterns` for the desktop picker thumbnails.

---



Receiving photos no longer go to Vercel Blob. The phone camera now writes the
JPEG **straight to the office NAS over WebDAV**, then links the resulting URL to
the receiving PO. The Vercel server never touches the bytes (it can't reach the
LAN) — the browser does the `PUT`, and `/api/receiving-photos` only stores the
URL.

> Scope: this changed **receiving** photos only. Inventory, SKU, packing-log and
> manual uploads still use Vercel Blob and are untouched.

## How it flows

```
phone camera ──downscale 720p──▶ PUT https://<nas>/<folder>/PO_<id>/photo_<uuid>.jpg
                                         │ (browser → Cloudflare → NAS WebDAV)
                                         ▼
                              POST /api/receiving-photos { photoUrl }
                                         │ (origin-allowlisted against the
                                         ▼  org's configured NAS addresses)
                                  photos row (url = NAS URL)
                                         ▼
                              gallery / Zendesk claim / delete (unchanged)
```

## Admin configuration (Admin → Receiving Photos)

- **NAS address** — two slots, **Testing** and **Production**, plus an active
  toggle. The active URL is what phones write to and what the picker reads from.
  Stored in `organizations.settings.nasPhotoServers` (`{ test, prod, active }`).
  The browser fetches the active one at runtime from `GET /api/nas-config`, so
  flipping test↔prod needs **no rebuild** (this replaces the old build-time
  `NEXT_PUBLIC_NAS_PHOTOS_BASE_URL` env var).
- **Station folders** — unchanged; photos land under
  `<station folder>/PO_<receivingId>/`.

## What the NAS must provide (your infra — Cloudflare already fronts it)

The NAS file server is currently **read-only**. To accept writes it needs:

1. **WebDAV `PUT` enabled** for the photos share (e.g. the
   [`caddy-webdav`](https://github.com/mholt/caddy-webdav) module on the existing
   Caddy binary). Keep the read/browse (`file_server browse` + JSON) you already
   have for the picker; add WebDAV scoped/jailed to the same photos root.
2. **CORS for the cross-origin `PUT`** from the app origin. The browser runs on
   the Vercel app domain and PUTs to the Cloudflare NAS domain, so the NAS must
   answer the preflight:
   - `Access-Control-Allow-Origin: https://<your-app-domain>` (not `*` once
     credentials are involved)
   - `Access-Control-Allow-Methods: GET, PUT, OPTIONS`
   - `Access-Control-Allow-Headers: Content-Type`
   - `Access-Control-Allow-Credentials: true`
   - respond `204` to `OPTIONS`
3. **Auth on writes.** The client PUTs with `credentials: 'include'`, so a
   Cloudflare Access cookie/session rides along — gate the write path with
   Cloudflare Access (or a Caddy basicauth) so the share isn't world-writable.
4. **HTTPS** (already handled by Cloudflare) — the app is HTTPS, so an `http://`
   NAS would be blocked as mixed content.

### Caddyfile sketch

```caddy
nas.example.com {
    @cors_preflight method OPTIONS
    handle @cors_preflight {
        header Access-Control-Allow-Origin "https://app.example.com"
        header Access-Control-Allow-Methods "GET, PUT, OPTIONS"
        header Access-Control-Allow-Headers "Content-Type"
        header Access-Control-Allow-Credentials "true"
        respond 204
    }
    header {
        Access-Control-Allow-Origin "https://app.example.com"
        Access-Control-Allow-Credentials "true"
    }

    root * /srv/receiving-photos
    @write method PUT
    handle @write {
        webdav        # caddy-webdav module
    }
    handle {
        file_server browse   # existing read/list path for the picker
    }
}
```

## App-side notes

- **Next image optimizer** — the desktop picker thumbnails go through
  `/_next/image`, so add the test + prod NAS hostnames to
  `next.config` → `images.remotePatterns`.
- **Off-network capture** — Blob was removed, so a phone that can't reach the NAS
  (off the office network / NAS down) will show the upload as **failed** with a
  retry. There is no cloud fallback by design.
- **Delete** removes only the DB row; the file stays on the NAS (same behavior
  the "Select from NAS" picker always had). Legacy Blob URLs from before this
  change still render and are left in place.
- **Security** — `POST /api/receiving-photos` rejects any `photoUrl` that isn't
  one of the org's configured NAS addresses (or the same-origin `/api/nas-dev`
  dev proxy), so the URL-trust boundary is enforced server-side.

## Local dev

`NEXT_PUBLIC_NAS_PHOTOS_BASE_URL=/api/nas-dev` still works as the initial seed,
and `/api/nas-dev` serves an SMB-mounted folder same-origin. Note the dev proxy
is currently **read-only** (`GET` only) — to exercise the real write path
locally, point the active NAS address at a WebDAV-capable endpoint, or extend
`/api/nas-dev` with a `PUT` handler (writes to the mount via `fs.writeFile`).
```
