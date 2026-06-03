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
| App origin (CORS) | `https://usav-orders-backend.vercel.app` (prod). Add other origins in `nginx.conf` if the app is also served from them. |
| Photos folder | The purchasing-photos subfolder on the Synology — `/volume1/USAV Media/Puchasing photos/2026` (the `USAV Media` share, "Puchasing" spelled as on disk) — mounted **read-only**. Only the `2026` subfolder is exposed, never the share root or a home directory. |
| HEIC | Picker excludes `.heic`; configure phone/sync to export JPEG. |

---

## 2. Architecture (decided)

```
 purchasing photos ────────────────▶  /volume1/USAV Media/Puchasing photos/2026  (Synology @ 192.168.254.14)
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

## 4. App-side state (as of 2026-06-03)

- The picker/listing/attach/display code lives in `src/lib/nas-photos.ts`, the
  receiving photo UI, and `POST /api/receiving-photos` (which accepts a `photoUrl`).
- **Deep folder navigation:** the picker and the `/photos` preview page browse the
  NAS tree with a breadcrumb trail + card-style folder rows that match the
  manuals/library file browser (`src/components/manuals/LibraryBrowser.tsx`). The
  shared chrome is `src/components/nas/NasBrowserChrome.tsx` (`NasBreadcrumb`,
  `NasFolderCard`, `NasSectionLabel`). This is what lets staff drill from
  `2026 → JUN 2026 → …` into deeply nested purchasing-photo folders.
- **Per-station auto-open folder (admin):** Admin → **Receiving Photos**
  (`StationNasFoldersTab`) sets, per station (UNBOX/TECH/PACK/SALES/FBA), the NAS
  folder the picker opens to — browse-to-pick or type a path. Stored in
  `organizations.settings.stationNasPhotoFolders`. `GET /api/receiving-photos`
  resolves the operator's primary station → that folder and returns it as
  `initialNasFolder`; the picker seeds its starting directory from it. So a
  receiving station can land directly in, e.g., `JUN 2026`.
- **Grid + sort:** the picker shows photos in a 5×5 grid paginated 25/page
  (pager sits on the breadcrumb row, top-right) with a Sort control. When the
  PO's scan time is known it defaults to **"PO scan time"** — files are ordered
  by proximity to the receiving row's `created_at` (surfaced by
  `GET /api/receiving-photos` as `receivingCreatedAt`), so the photos taken when
  that PO was scanned float to the top. Other sorts: Most recent / Oldest / Name.
- **Local dev file server (test on localhost first):** a **dev-only** route,
  `src/app/api/nas-dev/[[...path]]/route.ts`, reads the SMB mount the dev Mac
  already has (`/Volumes/USAV Media/Puchasing photos/2026`) and re-serves it in the
  nginx-autoindex JSON shape the client expects — so you can browse the real
  folders/photos at `http://localhost:3000/photos` **before** standing up the
  Synology container. It is hard-disabled in production (returns 404). Configure in
  `.env.local`:
  ```
  NEXT_PUBLIC_NAS_PHOTOS_BASE_URL=/api/nas-dev
  NAS_DEV_ROOT=/Volumes/USAV Media/Puchasing photos/2026
  ```
  (For LAN dev against the live Synology container instead, set the base URL to
  `http://192.168.254.14:8088`.)
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
