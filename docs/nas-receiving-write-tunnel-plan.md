# Production NAS photo uploads — deployment plan

**Status (2026-06-16):** App-side split read/write is implemented locally.
Production uploads fail because the office Mac runs a **partial agent** at
`/_agent` (health returns `{ archiveDir, mounted }`, no `PUT /file/receiving`).
The fix is office infrastructure, not app code.

**Decision:** Deploy the full NAS Media Agent (`deploy/nas-media-agent/server.mjs`)
on the office Mac. Keep the public tunnel browse root **read-only**; route all
writes (PUT/DELETE) through the token-guarded agent at `/_agent/*`.

See also: `deploy/nas-media-agent/README.md`, `context/ENV-VARS.md`.

---

## Target architecture

```
Clients (mobile capture, desktop picker, Zendesk archive)
        │  same-origin only
        ▼
Vercel  /api/nas          GET  → NAS_RW_URL (browse root)
        /api/nas-target/* PUT  → NAS_AGENT_URL/file/{receiving|shipping|claims}
        /api/receiving-photos   (DB attach — after NAS PUT succeeds)
        │
        ▼
Caddy on office Mac (nas-photos.michaelgarisek.com)
   :8088  browse (read-only) ──▶ tunnel GET works today
   :8787  NAS Media Agent     ──▶ PUT/DELETE/POST /archive (needs full agent)
        │
        ▼
/Volumes/USAV Media  (Synology SMB mount)
```

Principles:

- Browsers never talk to the NAS directly — only `/api/nas` and `/api/nas-target`.
- Stored URLs are relative (`/api/nas/JUN%202026/photo_….jpg`).
- Reads use the tunnel browse root; writes use the agent + `x-agent-token`.
- Folder roots: Admin → NAS Photos → synced to agent via `PUT /roots`.

---

## App side — DONE (in this repo)

| Behavior | Implementation |
|---|---|
| GET `/api/nas` → browse root | `resolveNasReceivingUpstream()` in `src/lib/nas-agent-client.ts` |
| PUT/DELETE → agent write path | `resolveNasReceivingWriteUpstream()` |
| Shipping/claims CRUD | `src/app/api/nas-target/[target]/[[...path]]/route.ts` |
| Admin root sync | `syncAgentRootsFromSettings()` on org settings save |
| Client base URL `/api/nas` | `getNasConfigForOperator()` in `src/lib/nas-photos-server.ts` |
| Legacy URL rewrite | `normalizePhotoDisplayUrl()` in `src/lib/nas-photo-url.ts` |
| Zendesk archive | `POST /_agent/archive` via `NAS_AGENT_URL` |

Deploy the app after Phase 1–2 complete so production runs the split read/write
proxy and config fallback.

---

## Phase 0 — Preconditions

Confirm on the office Mac:

| Item | Expected |
|---|---|
| NAS | Synology `USAVSolutions`, share at `/volume1/USAV Media/Puchasing photos/2026` |
| Connector host | Office Mac, SMB mount at `/Volumes/USAV Media` |
| Tunnel | `cloudflared` for `nas-photos.michaelgarisek.com` |
| Front proxy | Caddy splitting `/_agent/*` → `:8787`, everything else → `:8088` browse |

Inventory what's running today:

- Which process serves `:8088` (browse)?
- Which process serves `:8787` (agent)? Full `server.mjs` or slim archive-only build?
- Is Caddy routing `handle_path /_agent/*` → `127.0.0.1:8787`?
- Is `cloudflared` a LaunchAgent/service or a foreground shell?

Generate `NAS_AGENT_TOKEN` (32+ random bytes); store in password manager — must
match on agent + Vercel Production. Do not commit.

---

## Phase 1 — Office infrastructure (the fix)

### 1.1 Deploy full NAS Media Agent

```sh
cd deploy/nas-media-agent
ls "/Volumes/USAV Media/Puchasing photos/2026"

NAS_AGENT_TOKEN="<secret>" \
NAS_AGENT_PORT=8787 \
NAS_ROOT_RECEIVING="/Volumes/USAV Media/Puchasing photos/2026" \
NAS_ROOT_SHIPPING="/Volumes/Shipping/2026" \
NAS_ROOT_CLAIMS="/Volumes/USAV Media/Puchasing photos/2026/2 Zendesk 2026" \
node server.mjs
```

Local verification (must pass before touching tunnel):

```sh
TOKEN="<secret>"

curl -s http://127.0.0.1:8787/health
# → { "ok": true, "roots": ["receiving","shipping","claims"] }

curl -s -o /dev/null -w "PUT %{http_code}\n" \
  -X PUT -H "x-agent-token: $TOKEN" -H "content-type: image/jpeg" \
  --data-binary @test.jpg \
  "http://127.0.0.1:8787/file/receiving/JUN%202026/_probe.jpg"
# → 201
```

### 1.2 Wire Caddy

```caddyfile
nas-photos.michaelgarisek.com {
    handle_path /_agent/* {
        reverse_proxy 127.0.0.1:8787
    }
    reverse_proxy 127.0.0.1:8088
}
```

Verify through public tunnel:

```sh
curl -s https://nas-photos.michaelgarisek.com/_agent/health
# Must show { "ok": true, "roots": [...] } — NOT { archiveDir, mounted }

curl -s -o /dev/null -w "PUT %{http_code}\n" \
  -X PUT -H "x-agent-token: $TOKEN" -H "content-type: image/jpeg" \
  --data-binary @test.jpg \
  "https://nas-photos.michaelgarisek.com/_agent/file/receiving/JUN%202026/_probe.jpg"
# → 201, not 404
```

### 1.3 Durability

| Service | Recommendation |
|---|---|
| NAS Media Agent | macOS LaunchAgent — auto-start, restart on crash |
| Caddy | LaunchAgent |
| cloudflared | System service — survives reboots |
| SMB mount | Auto-mount before agent starts |

Health monitor: `GET https://nas-photos.michaelgarisek.com/_agent/health` every 5 min.

### 1.4 Retire slim agent

Replace the partial agent on `:8787` — do not run two agents on the same port.

---

## Phase 2 — Vercel configuration

| Variable | Value |
|---|---|
| `NAS_RW_URL` | `https://nas-photos.michaelgarisek.com` |
| `NAS_AGENT_URL` | `https://nas-photos.michaelgarisek.com/_agent` |
| `NAS_AGENT_TOKEN` | Same secret as office agent |

Redeploy production after env changes. Ignore legacy `NEXT_PUBLIC_NAS_PHOTOS_BASE_URL`.

---

## Phase 3 — Admin UI

Admin → NAS Photos:

- Active NAS server: `https://nas-photos.michaelgarisek.com`
- Receiving root: `/Volumes/USAV Media/Puchasing photos/2026`
- Receiving folder + station folders: current month (e.g. `JUN 2026`)

Saving workflow folders triggers `PUT /roots` — confirm `agentSync.ok` in the save response.

---

## Phase 4 — App deploy

Deploy when Phase 1–2 are green. No additional code changes required for the minimum path.

---

## Phase 5 — End-to-end verification

**External probes:**

```sh
# Browse stays read-only (PUT should fail — expected)
curl -s -o /dev/null -w "browse PUT %{http_code}\n" \
  -X PUT --data-binary "x" \
  "https://nas-photos.michaelgarisek.com/JUN%202026/_probe.jpg"

# Agent write works
curl -s -o /dev/null -w "agent PUT %{http_code}\n" \
  -X PUT -H "x-agent-token: $TOKEN" -H "content-type: image/jpeg" \
  --data-binary @test.jpg \
  "https://nas-photos.michaelgarisek.com/_agent/file/receiving/JUN%202026/_probe.jpg"
```

**App flow (signed-in mobile):**

1. Capture photo → `PUT /api/nas/...` → 201
2. `POST /api/receiving-photos` → 200
3. Photo visible in strip + gallery; file on Synology under month folder
4. Gallery delete → `DELETE /api/nas/...` → 204

---

## Rollback

1. Stop new agent; restore slim archive-only agent if Zendesk claims need it temporarily.
2. Unset or revert `NAS_AGENT_URL` on Vercel.
3. Reads continue via browse; writes disabled (same as today). No data loss.

---

## Success criteria

- [ ] `/_agent/health` returns `{ ok: true, roots: [...] }`
- [ ] `PUT /_agent/file/receiving/...` returns 201 through public tunnel
- [ ] Mobile capture: PUT 201 + POST 200 + photo visible everywhere
- [ ] File on Synology under correct month folder
- [ ] Gallery delete removes file from NAS
- [ ] Agent, Caddy, cloudflared survive Mac reboot

**Minimum path to green:** Phase 1 → Phase 2 → Phase 5 mobile test.
