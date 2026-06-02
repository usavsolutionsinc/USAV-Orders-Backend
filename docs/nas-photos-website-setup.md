# NAS Photos → Website: concrete setup plan (decisions resolved)

This is the **decided, environment-specific** plan for making the receiving photos
that already sync to the office NAS display live on the Vercel website (for staff,
remote staff, and Zendesk tickets). It resolves the open decisions in
[`nas-photos-production-plan.md`](./nas-photos-production-plan.md) §10 with the
actual hardware, domain, and approach chosen on 2026-06-02.

The runnable artifacts referenced here live in
[`deploy/nas-photo-server/synology/`](../deploy/nas-photo-server/synology/)
(`docker-compose.yml`, `nginx.conf`, `RUNBOOK.md`).

---

## 1. Resolved decisions

| Decision (plan §10) | Resolution |
|---|---|
| Reachability | **Option A — public HTTPS via Cloudflare Tunnel.** Must work for in-office, remote, and Zendesk. |
| Prod NAS | **Synology DiskStation, DSM 7** — hostname `USAVSolutions`, LAN IP `192.168.254.14`. Replaces the dev Ugreen DH2300 (`192.168.50.125`). |
| Server runtime | **Docker via Synology Container Manager** (confirmed available on this DSM 7). No static binaries / systemd — DSM manages and auto-restarts the containers. |
| Tunnel | **Dedicated Cloudflare Tunnel whose connector runs ON the NAS.** Not the existing "ai chat" tunnel (its connector runs on a laptop → would only be up while the laptop is awake/on-network). |
| Domain | **`michaelgarisek.com`** (already in the Cloudflare account). Public host: **`nas-photos.michaelgarisek.com`**. |
| App origin (CORS) | `https://usav-orders-backend.vercel.app` (prod). `https://staff-backend.usavshop.com` also allowlisted. |
| Photos folder | A **dedicated** shared folder on the Synology (e.g. `/volume1/ReceivingPhotos`), mounted **read-only**. Never a home directory or the share root. |
| HEIC | Picker excludes `.heic`; configure phone/sync to export JPEG. |

---

## 2. Architecture (decided)

```
 phone camera ──(auto-sync, JPEG)──▶  /volume1/ReceivingPhotos   (Synology @ 192.168.254.14)
                                              │ read-only
                          ┌───────────────────┴───────────────────┐
                          │ Container Manager (Docker) on the NAS  │
                          │  • nginx  → JSON listing + CORS  :8088 │
                          │  • cloudflared → outbound tunnel       │
                          └───────────────────┬───────────────────┘
                                              │ (outbound only, no port-forward)
                                              ▼
                         https://nas-photos.michaelgarisek.com  (Cloudflare edge, TLS)
                                              │
        ┌─────────────────────────────────────┼──────────────────────────────┐
        ▼                                      ▼                              ▼
   staff browser                          Zendesk servers                Vercel app
   (lists + displays,                     (load inlined <img> URLs       (stores only the
    POSTs chosen URL)                      in claim tickets)              URL string)
```

The browser (and Zendesk) talk to the Cloudflare hostname; the `cloudflared`
container reaches the nginx container privately at `http://nas-photos:80`. Vercel
only ever persists the URL string — it never reaches the NAS.

Note on CORS vs Zendesk: image bytes load as `<img>` (not subject to CORS), so the
locked CORS allowlist only restricts who can *browse the listing* via `fetch()`; it
does **not** break image display in the app or in Zendesk.

---

## 3. Production setup — follow the runbook

The full, ordered, copy-paste steps are in
[`deploy/nas-photo-server/synology/RUNBOOK.md`](../deploy/nas-photo-server/synology/RUNBOOK.md):

1. **One-time GUI/dashboard:** enable SSH, install Container Manager, create the
   Cloudflare tunnel + public hostname (`nas-photos.michaelgarisek.com` → `nas-photos:80`)
   and copy the tunnel token.
2. **Dedicated folder + service account** on the Synology; point the phone sync at it.
3. **Deploy the two containers** (`nginx` + `cloudflared`) via Container Manager →
   Project, using `docker-compose.yml` + `nginx.conf` (paste the tunnel token).
4. **Point the app at it:** set `NEXT_PUBLIC_NAS_PHOTOS_BASE_URL =
   https://nas-photos.michaelgarisek.com` in Vercel (Production) and **redeploy**.
5. **Verify** from a phone on cellular + a Zendesk ticket (see runbook).

---

## 4. App-side state (as of 2026-06-02)

- The picker/listing/attach/display code is already built and unchanged:
  `src/lib/nas-photos.ts`, the receiving photo UI, and `POST /api/receiving-photos`
  (already accepts a `photoUrl`).
- **Dev config** (`.env.local` → `NEXT_PUBLIC_NAS_PHOTOS_BASE_URL`) was repointed
  from the now-unreachable Ugreen (`http://192.168.50.125:8088`, a different subnet
  from the current `192.168.254.x` network) to the Synology
  (`http://192.168.254.14:8088`). For local/LAN dev, only the nginx file-server
  container is needed (permissive CORS); the tunnel is for the live site.
- **Gating:** when `NEXT_PUBLIC_NAS_PHOTOS_BASE_URL` is unset, all NAS UI stays
  hidden, so prod can be staged safely and rolled back by unsetting + redeploying.

---

## 5. Still-recommended hardening (not blockers)

- **C1 — server-side `photoUrl` origin allowlist** in
  `src/app/api/receiving-photos/route.ts` (env `NAS_PHOTOS_ALLOWED_ORIGINS`,
  server-only). See production plan §C1.
- **C2 — audit logging** on attach + delete for insurance traceability.
- **Listing privacy:** images are public (needed for Zendesk), but the directory
  *listing* is publicly fetchable by anyone who knows the hostname. Optionally lock
  the `/` browse with a Cloudflare WAF/Access rule while leaving image paths public.
- **Backups:** the NAS folder is now the system of record for insurance photos —
  ensure RAID + offsite backup coverage.

---

## 6. Pointers

- Generic plan / rationale: [`nas-photos-production-plan.md`](./nas-photos-production-plan.md)
- Runbook + compose + nginx: [`deploy/nas-photo-server/synology/`](../deploy/nas-photo-server/synology/)
- Original LAN-only dev server: [`deploy/nas-photo-server/`](../deploy/nas-photo-server/)
