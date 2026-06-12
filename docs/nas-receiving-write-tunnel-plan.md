# Plan: HTTPS write path for receiving-capture photos (Ugreen NAS + `nas-photos` tunnel)

**Decision (2026-06-12):** newly-captured receiving/unboxing photos live on the
**Ugreen NAS**, reached through the **one existing tunnel hostname**
`https://nas-photos.michaelgarisek.com`. The app stays on **Vercel** and the
**browser never talks to the NAS directly** — it goes through a same-origin
**`/api/nas` proxy** that does the real read/write server-side over the tunnel,
carrying the shared `x-agent-token`. This removes the mixed-content / CORS /
per-device Cloudflare-Access-cookie problems that made mobile capture silently
fail and the Done button white-screen.

> Earlier drafts proposed a second `nas-rw.michaelgarisek.com` hostname. That is
> dropped — we use **only** `nas-photos.michaelgarisek.com`.

---

## Target architecture

```
Mobile capture / picker (HTTPS app on Vercel, browser on LAN or anywhere)
        │  same-origin: GET/PUT/DELETE /api/nas/<folder>/<file>
        ▼
Vercel function  /api/nas  ── HTTPS + x-agent-token ──▶ nas-photos.michaelgarisek.com
        ▲                                                     │  (Cloudflare tunnel)
        │                                                     ▼
        └─────────── image bytes / listing ◀──── connector (office machine) ──LAN──▶ NAS
```

- **Browser → `/api/nas`** only. No CORS, no mixed-content, no per-phone Access cookie.
- **`/api/nas` → NAS** server-side, holding `NAS_RW_URL` + `NAS_RW_TOKEN`
  (`x-agent-token`). Source: `src/app/api/nas/[[...path]]/route.ts`.
- Stored `photoUrl` becomes a relative `/api/nas/...`, so photos render for any
  authenticated user anywhere — not just on the LAN.

---

## App side — DONE (in this repo)

| Change | File |
|---|---|
| Same-origin CRUD proxy (LIST/GET/PUT/DELETE, per-verb permission, traversal + image-only guards) | `src/app/api/nas/[[...path]]/route.ts` |
| Client base URL → `/api/nas` when a NAS is configured | `src/lib/nas-photos-server.ts` (`getNasConfigForOperator`) |
| `isNasPhotoUrl` recognises `/api/nas` (deletes route through the proxy) | `src/lib/nas-photos.ts` |
| Error boundary so a failed capture/return shows a message, not a white screen | `src/app/m/error.tsx` |

`PUT` / `DELETE` require `receiving.upload_photo`; `GET` requires `receiving.view`.
`/api/receiving-photos` already accepts the relative `/api/nas/...` URL.

---

## Office machine — the one remaining step (give the host a WRITE verb)

`nas-photos.michaelgarisek.com` today routes to the **read-only purchasing-photos
agent** (`x-agent-token`, browse + claim `/archive`, **no write**). Reads already
work through `/api/nas`. To make captures land, the office host must accept a
**write** for the receiving folder. Either option keeps the single hostname:

### Option A — add WebDAV write to the tunnel's Caddy
The verified WebDAV server (`deploy/nas-photo-server/Caddyfile`, Caddy + webdav,
`:8088`, root `…/Michael Garisek/Photos`) already does `PUT`/`DELETE`. Point the
`nas-photos` tunnel ingress (or a Caddy route in front of the agent) so that
`PUT`/`DELETE`/`GET` reach that WebDAV server. The `/api/nas` proxy speaks plain
WebDAV verbs, so no agent code is needed.

### Option B — extend the agent with a write endpoint
Add a token-guarded write to the agent that backs `/_agent/*` (mirroring its
existing `/archive`): accept the photo bytes and write them into the receiving
folder, plus a delete. The `/api/nas` proxy already sends `x-agent-token`.

Either way, set the proxy upstream env on Vercel:
```sh
NAS_RW_URL   = https://nas-photos.michaelgarisek.com   # (or omit to use the active nasPhotoServers slot)
NAS_RW_TOKEN = <same shared secret as NAS_AGENT_TOKEN>  # sent as x-agent-token; omit if the host is unauthenticated
```

---

## Verify

```sh
# Reads (work today, through the proxy — run while signed in):
#   GET https://<app>/api/nas/            → JSON listing
#   GET https://<app>/api/nas/<file>.jpg  → image bytes
# Writes (after the office host exposes the verb):
#   take a receiving/unboxing photo on a phone → it uploads (no white screen),
#   appears in the PO gallery + desktop picker, and Done returns to the Unbox feed.
```

Direct tunnel probe (bypassing the app), once the write verb is live:
```sh
printf '\xff\xd8\xff\xe0 test' > /tmp/p.jpg
curl -s -o /dev/null -w "PUT %{http_code}\n"  -X PUT --data-binary @/tmp/p.jpg \
  -H "Content-Type: image/jpeg" -H "x-agent-token: <token>" https://nas-photos.michaelgarisek.com/probe.jpg
curl -s -o /dev/null -w "GET %{http_code}\n"  -H "x-agent-token: <token>" https://nas-photos.michaelgarisek.com/probe.jpg
curl -s -o /dev/null -w "DEL %{http_code}\n"  -X DELETE -H "x-agent-token: <token>" https://nas-photos.michaelgarisek.com/probe.jpg
```
Expect `201 / 200 / 204`.

---

## Tunnel / connector notes

- `cloudflared` upgraded **2026.5.2 → 2026.6.0** (Homebrew). Restart the
  `nas-photos` connector so the running tunnel picks up the new binary; it is
  currently an unsupervised foreground process — consider installing it as a
  durable service so it survives reboots.
- Cloudflare Access: `nas-photos…` has no Access wall today (verified). Since the
  proxy now sends a shared `x-agent-token`, prefer protecting the host by token
  (and/or Cloudflare WAF/IP) rather than a per-device Access cookie.

## Rollback
Unset `NAS_RW_URL`/`NAS_RW_TOKEN` and revert `getNasConfigForOperator` to return
the absolute active NAS URL — restores the previous browser-direct behaviour.
