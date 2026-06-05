# Plan: HTTPS write path for receiving-capture photos (Ugreen NAS + "Naz photos" tunnel)

**Decision (2026-06-05):** newly-captured receiving photos live on the **Ugreen
NAS** (`192.168.50.125`), written by the WebDAV server already deployed there.
The live HTTPS app can't reach the LAN, so a **Cloudflare tunnel hostname** must
front that WebDAV server. The tunnel's connector runs on an **"office machine"**
that isn't reachable from the dev environment, so the steps for that box are
documented here for you to run.

This is the last mile of the [direct-to-NAS write feature](./nas-direct-write-setup.md).

---

## Where things stand

| Piece | Location | State |
|---|---|---|
| **WebDAV read+write server** (Caddy + webdav, `:8088`) | Ugreen NAS `192.168.50.125` | ✅ Done, verified (OPTIONS 204 / PUT 201 / GET 200), runs as `systemd --user nas-photos`, linger on (survives reboot). Root: `/volume1/@home/Michael Garisek/Photos`. |
| **"Naz photos" tunnel** `nas-photos.michaelgarisek.com` | connector on the **office machine** | ✅ Live, but routes to the **purchasing-photos agent** (read-only, `x-agent-token`, no `PUT`) — *not* the NAS WebDAV server. |
| **App active NAS address** (`nasPhotoServers.prod`) | DB org settings | `https://nas-photos.michaelgarisek.com`, active. Desktop picker reads fine; **mobile capture PUT fails** here (agent has no PUT). |
| **Purchasing-photos share** (`USAV Media/Puchasing photos`) | the office machine / a different host | Legacy archive; served by the agent + used by the Zendesk claim archive (`NAS_AGENT_URL`). **Stays as-is.** |

**The gap:** the only HTTPS endpoint the app can reach (`nas-photos…`) points at a
read-only agent. We need an HTTPS hostname that points at the NAS WebDAV server.

---

## Target architecture

```
Mobile capture (HTTPS app, browser on LAN or anywhere)
        │  PUT https://nas-rw.michaelgarisek.com/<folder>/PO_..__photo.jpg
        ▼
Cloudflare ──tunnel──▶ connector (office machine) ──LAN──▶ http://192.168.50.125:8088
                                                              (Caddy WebDAV, NAS)
        ▲                                                         │ writes file
        └── GET browse (same hostname) ◀──────────────────────────┘
Desktop picker reads the SAME hostname → same NAS folder → captured photos appear.

(unchanged) nas-photos.michaelgarisek.com ─▶ purchasing-photos agent  (legacy browse + claim archive)
```

One new hostname (`nas-rw.michaelgarisek.com` — pick any name) does **both** read
and write for receiving photos, because the app uses a single base URL for the
picker listing and the capture PUT.

---

## Step 1 — Office machine: add a tunnel ingress → the NAS WebDAV server

The connector reaches the NAS over the LAN, so the service target is the NAS's
LAN IP, **not** `localhost`.

### If the "Naz photos" tunnel is **locally-managed** (has a `config.yml`)
Edit that machine's `~/.cloudflared/config.yml`, add an ingress rule **above** the
catch-all `http_status:404`:

```yaml
ingress:
  # ... existing nas-photos.michaelgarisek.com rule ...
  - hostname: nas-rw.michaelgarisek.com
    service: http://192.168.50.125:8088
  - service: http_status:404
```
Then create the DNS record and restart the connector:
```sh
cloudflared tunnel route dns <naz-photos-tunnel-name> nas-rw.michaelgarisek.com
# restart however it runs there (launchd/systemd/manual), e.g.:
#   systemctl --user restart cloudflared      (Linux user service)
#   launchctl kickstart -k gui/$(id -u)/<label> (macOS launchd)
```

### If the tunnel is **dashboard-managed** (remotely configured)
Cloudflare **Zero Trust → Networks → Tunnels → "Naz photos" → Public Hostname →
Add a public hostname**:
- Subdomain `nas-rw`, domain `michaelgarisek.com`
- Type **HTTP**, URL **`192.168.50.125:8088`**

No connector restart needed (config is pushed). The connector just needs LAN
reachability to `192.168.50.125:8088` (it already serves the purchasing share on
the same LAN, so this holds).

---

## Step 2 — (recommended) give receiving photos a dedicated NAS folder

Today the WebDAV root is `…/Michael Garisek/Photos` (test photos). For a clean
production store, repoint it to a dedicated folder so receiving photos don't mix
with anything personal. On the NAS:

```sh
mkdir -p "/volume1/@home/Michael Garisek/Receiving"
# edit ~/nas-photos.Caddyfile: change BOTH `root *` and the webdav `root` to the new path
#   root * "/volume1/@home/Michael Garisek/Receiving"
#   webdav @put { root "/volume1/@home/Michael Garisek/Receiving" }
./caddy validate --config ~/nas-photos.Caddyfile --adapter caddyfile
./caddy reload --config ~/nas-photos.Caddyfile --adapter caddyfile
```
(Skip this to keep using `Photos`.) The repo copy of the Caddyfile lives at
`deploy/nas-photo-server/Caddyfile`.

> **Station folders:** `stationNasPhotoFolders` (Admin → Receiving Photos) are
> relative to this root. If you want per-station subfolders, create them under
> the root first — plain WebDAV `PUT` won't auto-create a missing parent (the
> client already writes flat `PO_<id>__photo.jpg` names to avoid this, so an
> empty/root folder works out of the box).

---

## Step 3 — App: point the active address at the new hostname

Once `https://nas-rw.michaelgarisek.com` resolves and returns the JSON listing:

```sh
# in the repo, with env loaded:
NAS_TEST_URL="http://192.168.50.125:8088" \
NAS_PROD_URL="https://nas-rw.michaelgarisek.com" \
NAS_ACTIVE="prod" \
npx tsx scripts/set-nas-server.ts
```
…or Admin → Receiving Photos → set **Production** = `https://nas-rw.michaelgarisek.com`,
active = Production, Save.

Add the hostname to the image optimizer allowlist in `next.config.ts`
(`images.remotePatterns`) so desktop picker thumbnails load:
```ts
{ protocol: 'https', hostname: 'nas-rw.michaelgarisek.com' },
```
Redeploy after editing `next.config.ts`.

---

## Step 4 — Verify

```sh
# 1) tunnel reaches the NAS WebDAV (read + write + preflight)
curl -s -H "Accept: application/json" https://nas-rw.michaelgarisek.com/ | head -c 200
curl -s -o /dev/null -w "OPTIONS %{http_code}\n" -X OPTIONS https://nas-rw.michaelgarisek.com/probe.jpg \
  -H "Origin: https://app.michaelgarisek.com" -H "Access-Control-Request-Method: PUT"
printf '\xff\xd8\xff\xe0 test' > /tmp/p.jpg
curl -s -o /dev/null -w "PUT %{http_code}\n" -X PUT --data-binary @/tmp/p.jpg \
  -H "Content-Type: image/jpeg" https://nas-rw.michaelgarisek.com/probe.jpg
curl -s -o /dev/null -w "GET %{http_code}\n" https://nas-rw.michaelgarisek.com/probe.jpg
```
Expect `204 / 201 / 200`. Then in the app: take a receiving photo on a phone →
it should upload (no "NAS not configured"/network error) and appear in the PO
gallery + desktop picker.

---

## Decisions & caveats

- **Read source switches to the NAS.** With the active base = `nas-rw…`, the
  desktop "Select from NAS" picker now lists the **NAS** receiving folder, not the
  `USAV Media` purchasing archive. That's intended (photos now originate from
  direct capture). If receivers still need to pick from the old purchasing
  archive, that's a separate read-source and would need product changes.
- **Claim archive is unaffected.** The Zendesk claim archive uses a different env
  (`NAS_AGENT_URL` / `x-agent-token` agent) and fetches photo bytes by URL, so it
  keeps working — it'll just fetch the new `nas-rw…` URLs (public HTTPS, fine).
- **Cloudflare Access.** `nas-photos…` currently has no Access wall (verified). If
  you put Access on `nas-rw…`, the app's cross-origin `fetch`/`PUT` (sent with
  `credentials:'include'`) needs an Access policy that admits it (service token or
  a bypass for the app), or the picker/capture will fail. Easiest: leave Access
  off for this internal hostname, or restrict by Cloudflare WAF/IP instead.
- **CORS is already correct** on the NAS Caddy (reflects Origin + `Allow-Credentials`
  + `PUT`), so no change needed there.

## Rollback
Set `nasPhotoServers.active` back to `prod = https://nas-photos.michaelgarisek.com`
(or run `set-nas-server.ts` with the old values). The desktop picker returns to
the purchasing archive; mobile capture writes stop until re-pointed.
```
