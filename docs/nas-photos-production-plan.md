# NAS Photos → Production Plan

> **Decisions resolved (2026-06-02):** the environment-specific, decided plan
> (Synology DSM 7 @ `192.168.254.14` + Container Manager/Docker + a dedicated
> Cloudflare Tunnel on `nas-photos.michaelgarisek.com`) lives in
> [`nas-photos-website-setup.md`](./nas-photos-website-setup.md), with runnable
> artifacts in [`deploy/nas-photo-server/synology/`](../deploy/nas-photo-server/synology/).
> This document remains the generic rationale / options reference.

**Feature:** Receiving (and later packing) staff attach insurance photos to a PO# by
selecting them from a self-hosted NAS file server, instead of capturing them through
an in-app camera pipeline. Photos live on **our own server** (free, self-hosted) and
the app stores only the **URL** — never Vercel Blob or Cloudflare R2.

**Audience:** the developer taking this from working-dev-prototype to production.

---

## 1. What already exists (as of this plan)

Already built, on `main`, and verified in dev:

| Area | Artifact | State |
|---|---|---|
| NAS file server | `deploy/nas-photo-server/` (Caddy `Caddyfile` + nginx/Docker alternative + README) | Running in dev on the Ugreen DH2300 |
| Listing/attach lib | `src/lib/nas-photos.ts` — `listNasDir()`, `attachNasPhoto()`, `nasConfigured()` | Parses Caddy **and** nginx JSON; HEIC excluded |
| Desktop attach UI | `src/components/sidebar/NasReceivingAttach.tsx` + wired into `src/components/sidebar/ReceivingPhotoStrip.tsx` | Compact button + full-width "click to add photos" empty state |
| Mobile attach UI | `src/components/mobile/receiving/NasPhotoPicker.tsx` + `PhotoGalleryView.tsx` "NAS" button | Built (env-gated) |
| Storage contract | `POST /api/receiving-photos { receivingId, receivingLineId?, photoUrl }` | Already accepts a URL; inserts into polymorphic `photos` table |
| Display / delete | `src/components/shipped/PhotoGallery.tsx` + `DELETE /api/photos/:id` | Reused as-is; full CRUD |
| Zendesk | `src/lib/zendesk-claim-template.ts` inlines all `RECEIVING` photo URLs into the claim ticket | Works automatically |
| Preview page | `src/app/photos/page.tsx` | **Local only, uncommitted** — testing surface |
| E2E | `tests/e2e/nas-photos.spec.ts` | API contract test passes |
| Env flag | `NEXT_PUBLIC_NAS_PHOTOS_BASE_URL` | Gates all UI; set in `.env.local` for dev |

**Data model:** photos are rows in the polymorphic `photos` table
(`entity_type`, `entity_id`, `url`, `taken_by_staff_id`, `photo_type`). Receiving =
`entity_type='RECEIVING'`, `entity_id=receiving.id`. A PO# resolves to `receiving_id`
via `GET /api/receiving/po/[poId]` (`header.receiving_id`).

---

## 2. The decisions that drive everything

### 2.1 DECISION REQUIRED — reachability (the central one)

The app is hosted on **Vercel (public cloud, HTTPS)**. A stored photo URL must be
loadable by everyone who needs to *see* the photo:

1. **Staff browsers** — in-office and possibly remote/cellular.
2. **Zendesk** — the claim template **inlines the photo URLs into the ticket body**, so
   Zendesk's servers (and the agent's browser) must be able to fetch them.
3. The Vercel server never needs to reach the NAS (the browser does the listing + display
   directly), so Vercel itself is **not** a constraint.

Two hard constraints fall out of this:

- **Mixed content:** the app is `https://`. Browsers **block** `http://` images on an
  HTTPS page. ⇒ the NAS **must** serve over **HTTPS** in prod.
- **Public reachability:** a LAN address (`http://192.168.x.x:8088`) only works for a
  browser physically on the office network. Zendesk and remote staff get broken images.

| Option | Staff in office | Remote staff | Zendesk photos | Effort | Cost |
|---|---|---|---|---|---|
| **A. Public HTTPS via Cloudflare Tunnel** ✅ recommended | ✔ | ✔ | ✔ | Medium | Free |
| B. LAN-only with internal HTTPS cert | ✔ | ✘ | ✘ (broken in tickets) | Low | Free |
| C. Port-forward + DDNS + Let's Encrypt | ✔ | ✔ | ✔ | Medium-High | Free |

**Recommendation: Option A — Cloudflare Tunnel.** It gives a stable public HTTPS
hostname (e.g. `https://nas-photos.usav.example`) backed by the NAS, with **no router
port-forwarding**, free TLS, and the option to put **Cloudflare Access** in front so the
folder isn't open to the whole internet. It satisfies mixed-content, Zendesk, and remote
staff in one move — and matches the "free hosting" goal.

> If the team accepts **"in-office viewing only and no photos inside Zendesk tickets,"**
> Option B is fine and cheaper to operate — but that is a product decision, because it
> changes what the Zendesk claim shows. **Confirm with stakeholders before building.**

### 2.2 DECISION REQUIRED — dedicated share, not a personal home folder

Dev currently serves `/volume1/@home/Michael Garisek/Photos`, which sits **inside a home
directory that also contains secrets** (`.ssh`, API-key text files, etc.). For prod:

- Create a **dedicated UGOS shared folder**, e.g. `/volume1/ReceivingPhotos`, owned by a
  **dedicated service account** (not a person), and point the phone-sync there.
- The file server must be sandboxed to **that folder only**. Never the home root.

### 2.3 Matching strategy (already chosen)

**Manual browse + multi-select**, PO/box-level. Keep for v1. A "folder-or-filename per PO#"
convention (auto-filter the picker to one PO) is a fast-follow once staff habits settle —
see §9.

---

## 3. Architecture (target prod)

```
 phone camera ──(auto-sync, JPEG)──▶  /volume1/ReceivingPhotos  (Ugreen NAS)
                                             │  read-only
                                   ┌─────────┴──────────┐
                                   │  Caddy file server │  :8088 (LAN)
                                   │  JSON browse + CORS │
                                   └─────────┬──────────┘
                                             │  cloudflared (outbound only)
                                             ▼
                            https://nas-photos.usav.example  (Cloudflare edge, TLS)
                                             │
        ┌────────────────────────────────────┼───────────────────────────────┐
        ▼                                     ▼                               ▼
  staff browser                         Zendesk servers                 Vercel app
  (lists + displays,                    (load inlined photo URLs        (stores only the
   POSTs chosen URL)                     in claim tickets)               URL string)
```

Key property: **the browser talks to the NAS directly** for listing and display; Vercel
only ever persists the URL. Cloudflare provides the public TLS endpoint.

---

## 4. Implementation steps

### Phase A — NAS server (prod-grade)

**A1. Dedicated folder + service account**
- UGOS → create shared folder `ReceivingPhotos` and a service user (e.g. `svc-photos`)
  with read/write to it only.
- Point the phone photo-sync (the tool already syncing to the NAS) at this folder.
- Confirm host path (likely `/volume1/ReceivingPhotos`).

**A2. Run Caddy as a managed service (survives reboot)**
The DH2300 is ARM Debian 12 with no UGOS Docker app and a broken apt state, so we use the
static Caddy binary (already proven). Make it durable via **one** of:
- *Preferred:* a **systemd unit** (needs sudo once):
  ```ini
  # /etc/systemd/system/nas-photos.service
  [Unit]
  Description=NAS photo file server (receiving)
  After=network-online.target
  Wants=network-online.target
  [Service]
  ExecStart=/opt/nas-photos/caddy run --config /opt/nas-photos/Caddyfile --adapter caddyfile
  Restart=always
  RestartSec=5
  User=svc-photos
  [Install]
  WantedBy=multi-user.target
  ```
  `sudo systemctl enable --now nas-photos`
- *Fallback (no sudo):* UGOS web UI → **Task Scheduler → boot-up task** running the same
  `caddy run …` command. (Per-user `crontab` is permission-denied on this unit — don't rely on it.)

**A3. Caddyfile (sandboxed, CORS locked to the app origin)**
Base it on `deploy/nas-photo-server/Caddyfile`, but for prod **lock CORS** to the app's
origin instead of `*`:
```
:8088 {
    root * /volume1/ReceivingPhotos
    @app header_regexp Origin ^https://(www\.)?your-app-domain\.com$
    header @app Access-Control-Allow-Origin "{http.request.header.Origin}"
    header Vary Origin
    header Access-Control-Allow-Methods "GET, HEAD, OPTIONS"
    @opt method OPTIONS
    respond @opt 204
    file_server browse
}
```

**A4. Public HTTPS via Cloudflare Tunnel (Option A)**
- Install `cloudflared` on the NAS (static ARM64 binary, same no-apt approach as Caddy).
- `cloudflared tunnel login` → create tunnel → map hostname
  `nas-photos.usav.example` → `http://localhost:8088`.
- Run `cloudflared` as a systemd service too (or UGOS boot task).
- **Lock it down:** add a **Cloudflare Access** policy (e.g. allow the company email
  domain, or a service token used by the app) so the photo folder isn't world-browsable.
  - If using Access with a browser policy, confirm Zendesk can still fetch the inlined
    URLs (Zendesk's fetcher won't pass an interactive Access login). If Zendesk must load
    them, either (a) use a **bypass/service-token** path for the photo paths, or (b) make
    the photo paths public-but-unguessable. **Resolve this explicitly** — it's the subtle
    part of locking down + Zendesk together.

**A5. HEIC** — iPhone's default `.heic` is excluded by the picker (Chrome/Android can't
render it, and we attach by URL with no transcode). Choose one:
- Configure the phone/sync to **export JPEG** (simplest), or
- Add a transcode step on the NAS (e.g. a small `cron`/inotify job running `heif-convert`/
  ImageMagick into the served folder). Document whichever is chosen.

### Phase B — App configuration

**B1.** In **Vercel → Project → Settings → Environment Variables**, add for
Production (and Preview if desired):
```
NEXT_PUBLIC_NAS_PHOTOS_BASE_URL = https://nas-photos.usav.example
```
This is a **build-time** public var — a **redeploy** is required for it to take effect.
When unset, all NAS UI stays hidden (safe default), so it can be staged without risk.

**B2.** Decide the fate of the dev preview page `src/app/photos/page.tsx`:
- Either **delete it** (it's currently uncommitted/local), or
- keep it but ensure it's acceptable as a prod route (it's auth-gated and shows
  "not configured" when the env var is absent). Recommendation: **delete** for prod.

### Phase C — Code hardening (required before prod)

**C1. Server-side `photoUrl` allowlist (security — required).**
`POST /api/receiving-photos` currently accepts **any** `photoUrl` string. Harden it to
only accept URLs whose origin matches an allowlist (the NAS base URL), to prevent storing
arbitrary/external URLs:
```ts
// src/app/api/receiving-photos/route.ts (inside POST, when photoUrl is provided)
const ALLOWED = (process.env.NAS_PHOTOS_ALLOWED_ORIGINS ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);
if (photoUrl) {
  let ok = false;
  try { ok = ALLOWED.some((o) => new URL(photoUrl).origin === new URL(o).origin); }
  catch { ok = false; }
  if (!ok) throw ApiError.badRequest('photoUrl host not allowed');
}
```
Add a **server-side** env `NAS_PHOTOS_ALLOWED_ORIGINS` (note: *not* `NEXT_PUBLIC_`, this
is server-only) = `https://nas-photos.usav.example`. Apply the same check anywhere else a
URL can be attached (e.g. the future packing endpoint).

**C2. Audit logging (traceability — strongly recommended for insurance).**
The attach (`POST /api/receiving-photos`) and delete (`DELETE /api/photos/:id`) routes do
**not** currently emit audit-log entries. For insurance evidence, add audit entries:
who attached/removed which photo URL to which PO, when. Use the existing
`AUDIT_ACTION` / `AUDIT_ENTITY` helpers (see `src/lib/audit-logs`).

**C3. Provenance (nice-to-have).** Consider tagging NAS-sourced rows
(`photo_type='nas'` or a flag) so reporting can distinguish self-hosted vs legacy blob
photos, and so a future migration/cleanup can target them. Low priority.

**C4. Delete semantics (verify, no change expected).** `DELETE /api/photos/:id` only
purges the file from Vercel Blob when the URL matches `vercel-storage`. For NAS URLs it
just removes the DB row and **leaves the original file on the NAS** — which is the
desired behavior (originals are the source of truth). Confirm this in QA.

**C5. Permissions (verify).** Attach/delete are gated by `receiving.upload_photo`, read by
`receiving.view`. Confirm the staff roles that need to attach have `receiving.upload_photo`.

### Phase D — (Optional) extend to Packing

Out of scope for v1 (receiving only), but if added later:
- Packing photos key on `entity_type='PACKER_LOG'`, `entity_id=packer_logs.id`.
- `/api/packing-logs/save-photo` currently accepts **base64 only** — extend it to accept a
  `photoUrl` (mirroring the receiving route) or add a small generic
  `POST /api/photos/attach { entityType, entityId, photoUrl }` with per-entity permission
  checks + the same C1 allowlist.
- Surface the picker in `ShippedDetailsPanelContent` next to the existing packing
  `PhotoGallery`.

---

## 5. Security checklist (gate before go-live)

- [ ] File server sandboxed to the **dedicated** photos folder only (never home/secrets).
- [ ] Caddy/cloudflared run as a **non-root service account**, read-only mount.
- [ ] CORS restricted to the app origin (not `*`) in prod.
- [ ] Public endpoint behind **Cloudflare Access** (or unguessable + Zendesk-fetchable).
- [ ] `photoUrl` **origin allowlist** enforced server-side (C1).
- [ ] HTTPS end-to-end (no mixed content); verify on a real phone over cellular.
- [ ] Audit logging on attach + delete (C2).
- [ ] Confirm what Zendesk agents can/can't see, and that it's acceptable.
- [ ] No secrets committed; `NEXT_PUBLIC_NAS_PHOTOS_BASE_URL` (public) vs
      `NAS_PHOTOS_ALLOWED_ORIGINS` (server-only) set in the right scopes.

---

## 6. Testing & verification

1. **Automated:** `tests/e2e/nas-photos.spec.ts` —
   `PW_TEST_RECEIVING_ID=<real id> npx playwright test tests/e2e/nas-photos.spec.ts --project=desktop`
   (attach-by-URL → GET shows it → duplicate 409 → delete cleanup). Add a case asserting a
   **non-allowlisted** `photoUrl` is rejected (C1).
2. **Manual prod-like:**
   - From a phone on **cellular** (off the office Wi-Fi), open a PO → attach → image renders
     (proves public HTTPS + no mixed content).
   - File a Zendesk claim for that PO → open the ticket → confirm the photo URLs **load**
     for the agent.
   - Delete a photo in-app → row gone, NAS file still present.
3. **Failure modes:** NAS/Caddy down → picker shows a clear error, app otherwise unaffected.

---

## 7. Rollout

1. Ship code (C1–C2 hardening) to `main`; it's inert while the env var is unset.
2. Stand up the prod NAS folder + Caddy + Cloudflare Tunnel + Access.
3. Set `NAS_PHOTOS_ALLOWED_ORIGINS` (server) and `NEXT_PUBLIC_NAS_PHOTOS_BASE_URL`
   (public) in Vercel → **redeploy**.
4. Pilot with **one receiving station** for a few days; watch audit logs + error rates.
5. Roll out to all receiving stations; announce the workflow change (pick from NAS instead
   of camera). Decide whether to retire the in-app camera capture or keep as fallback.

**Rollback:** unset `NEXT_PUBLIC_NAS_PHOTOS_BASE_URL` in Vercel and redeploy → all NAS UI
disappears instantly; previously-attached URLs remain (and remain viewable as long as the
NAS endpoint is up). No data migration involved.

---

## 8. Operations & monitoring

- **Uptime:** an external check (e.g. Cloudflare health check / UptimeRobot) on
  `https://nas-photos.usav.example/` (expect HTTP 200 JSON with `Accept: application/json`).
- **Disk:** the photos folder grows unbounded — set a retention/archival policy and a
  low-disk alert on the NAS volume.
- **Backups:** the NAS folder is now the **system of record** for insurance photos — ensure
  it's covered by the NAS backup/RAID + an offsite copy. (Unlike Vercel Blob, we own this.)
- **Service health:** `systemctl status nas-photos cloudflared` (or UGOS task status).

---

## 9. Future enhancements

- **Folder/filename-per-PO convention** → auto-filter the picker to a single PO's photos
  (big speed win once capture habits are consistent).
- **Packing** integration (Phase D).
- **HEIC transcode** pipeline if phones can't be forced to JPEG.
- **Migrate** legacy Vercel-Blob receiving photos to the NAS (optional; not required).

---

## 10. Open decisions for the team (resolve before building Phase A)

1. **Reachability:** Option A (public HTTPS via Cloudflare Tunnel, Zendesk + remote work)
   vs Option B (LAN-only, no Zendesk photos). → *Recommend A.*
2. **Access control** on the public endpoint, and how Zendesk fetches photos under it.
3. **Dedicated folder + service account** name/path.
4. **HEIC**: force JPEG at capture, or transcode on the NAS.
5. **Retire the in-app camera** capture, or keep it as a fallback alongside NAS attach.
