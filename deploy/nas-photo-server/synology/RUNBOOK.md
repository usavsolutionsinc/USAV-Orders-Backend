# Production runbook — NAS photos live on the Vercel site (Synology + Cloudflare Tunnel)

Goal: receiving photos already syncing to the Synology NAS become viewable on the
live (HTTPS) Vercel app, for **in-office staff, remote staff, and Zendesk tickets**.

Target NAS: **Synology DiskStation, DSM 7** — `192.168.254.14` (`USAVSolutions.local`).
Public host we'll create: **`nas-photos.michaelgarisek.com`**.

Approach: a **dedicated** Cloudflare Tunnel whose connector runs **on the NAS**
(always-on), under the `michaelgarisek.com` domain you already control. This does
NOT reuse the existing "ai chat" tunnel — that connector runs on a laptop, so it
would only stay up while the laptop is awake and on the office network. The NAS is
the always-on box, so the connector lives there.

The app code is already done. The only work is (1) stand up the file server +
tunnel on the NAS, (2) flip one Vercel env var.

---

## Prerequisites

- DSM admin login on the Synology.
- `michaelgarisek.com` active in your **Cloudflare** account (it already is — it's
  the domain backing the existing ai-chat tunnel).
- The phone photo-sync will be pointed at the dedicated folder in step 1.

---

## Step 1 — Dedicated shared folder (DSM GUI)

1. DSM → **Control Panel → Shared Folder → Create**.
2. Name it `ReceivingPhotos`. (Host path becomes `/volume1/ReceivingPhotos`.)
3. Repoint the phone photo-sync to drop receiving photos into this folder.
   Do **not** reuse a personal home folder — those hold secrets.

> If your volume isn't `volume1`, adjust the path in `docker-compose.yml`.

## Step 2 — Install Container Manager (DSM GUI)

1. DSM → **Package Center** → search **Container Manager** → **Install**.
   (On older DSM 7.0 it's called **Docker** — same thing.)

## Step 3 — Drop the config files on the NAS

1. DSM → **File Station** → in the `docker` shared folder create a folder
   `nas-photos` (full host path: `/volume1/docker/nas-photos`). If the `docker`
   shared folder doesn't exist, create it (Control Panel → Shared Folder).
2. Upload **`nginx.conf`** (from this repo folder) into `/volume1/docker/nas-photos/`.

## Step 4 — Create the Cloudflare Tunnel (Cloudflare dashboard)

1. Cloudflare → **Zero Trust** → **Networks → Tunnels → Create a tunnel**.
   Create a NEW tunnel — do not edit the existing ai-chat one.
2. Type: **Cloudflared**. Name it `nas-photos`. **Save**.
3. On the "Install connector" screen, **copy the token** (the long `eyJ...` string).
   Ignore the install commands — Container Manager runs the connector for us.
4. **Public Hostname** tab → **Add a public hostname**:
   - Subdomain: `nas-photos`  •  Domain: `michaelgarisek.com`
   - Service: **HTTP**  →  URL: `nas-photos:80`
     (this is the compose service name on the private container network)
   - Save.
5. Leave the tunnel **without an Access policy** for now, so Zendesk and remote
   browsers can load images. (See "Hardening" below to lock the *listing* later.)

## Step 5 — Deploy the containers (DSM GUI)

1. DSM → **Container Manager → Project → Create**.
2. Project name: `nas-photos`. Path: `/volume1/docker/nas-photos`.
3. Source: **Create docker-compose.yml** → paste the contents of this repo's
   `docker-compose.yml`, then **replace** `PASTE_YOUR_TUNNEL_TOKEN_HERE` with the
   token from step 4.3.
4. **Build / Run**. Container Manager pulls `nginx:alpine` + `cloudflare/cloudflared`
   and starts both. `restart: unless-stopped` brings them back after reboots.

## Step 6 — Point the app at the public host (Vercel)

Set the production env var (build-time public var → triggers a redeploy):

```bash
# from this repo, logged into the Vercel CLI:
vercel env add NEXT_PUBLIC_NAS_PHOTOS_BASE_URL production
# value:  https://nas-photos.michaelgarisek.com
vercel --prod        # redeploy so the new value is baked in
```

(Or set it in Vercel → Project → Settings → Environment Variables, then redeploy.)

---

## Verification (run these once it's up)

```bash
# 1. LAN file server is serving JSON (on office network):
curl -s -H 'Accept: application/json' http://192.168.254.14:8088/ | head -c 300

# 2. Public HTTPS tunnel resolves and serves the listing:
curl -s https://nas-photos.michaelgarisek.com/ | head -c 300

# 3. CORS is locked to the app origin (should echo the app origin back):
curl -s -I -H 'Origin: https://usav-orders-backend.vercel.app' \
  https://nas-photos.michaelgarisek.com/ | grep -i access-control-allow-origin
# 4. A random origin should get NO allow-origin header:
curl -s -I -H 'Origin: https://evil.example' \
  https://nas-photos.michaelgarisek.com/ | grep -i access-control-allow-origin || echo "blocked (good)"
```

Then the real test:
- On a phone **off office Wi-Fi (cellular)**: open a PO → attach a NAS photo → it renders.
- File a Zendesk claim for that PO → open the ticket → the photo URLs **load** for the agent.
- Delete the photo in-app → row gone, original file still on the NAS.

---

## Hardening (recommended follow-ups, not blockers)

- **Listing exposure:** images load fine for Zendesk because `<img>` ignores CORS,
  but the directory *listing* itself is publicly fetchable by anyone who knows the
  hostname. Filenames aren't very sensitive, but to lock it: add a Cloudflare WAF /
  Access rule that allows your company email for `/` (browse) while leaving the
  image file paths public, or serve images from an unguessable subpath.
- **Server-side photoUrl allowlist (C1)** and **audit logging (C2)** in
  `src/app/api/receiving-photos/route.ts` — see `docs/nas-photos-production-plan.md`
  §C. Still recommended for insurance traceability; ships inert until configured.
- **HEIC:** the picker excludes `.heic`. Set the phone/sync to export JPEG.
- **Backups:** this folder is now the system of record for insurance photos — ensure
  it's in the NAS backup/RAID + an offsite copy.
