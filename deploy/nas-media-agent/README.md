# NAS Media Agent

Small token-guarded Node service for app-controlled NAS media operations.

It is intended to sit behind Caddy / Cloudflare Tunnel at a private path such as:

```text
https://nas-photos.michaelgarisek.com/_agent
```

The app calls it with `x-agent-token`. Browsers should not call it directly.

## Roots

Storage is the **Synology NAS** (`USAVSolutions`, DSM 7), mounted on the office Mac at `/Volumes/USAV Media`. The agent runs on that Mac (not on the NAS appliance) and reads/writes the SMB mount paths below.

```text
receiving -> /Volumes/USAV Media/Puchasing photos/2026
shipping  -> /Volumes/Shipping/2026
claims    -> /Volumes/USAV Media/Puchasing photos/2026/2 Zendesk 2026
```

**Live source of truth:** Admin → NAS Photos → **Workflow folders** in the app. When an admin saves those roots, Vercel calls `PUT /roots` on this agent. Per-request `x-nas-root` headers from Vercel also override the in-memory root for that call.

`NAS_ROOT_*` env vars are optional bootstrap defaults used only until the first admin sync:

```sh
NAS_ROOT_RECEIVING="/Volumes/USAV Media/Puchasing photos/2026"
NAS_ROOT_SHIPPING="/Volumes/Shipping/2026"
NAS_ROOT_CLAIMS="/Volumes/USAV Media/Puchasing photos/2026/2 Zendesk 2026"
```

**Preflight:** confirm the Synology share is mounted before starting the agent:

```sh
ls "/Volumes/USAV Media"
```

If the service ever runs directly on the Synology host (unusual), paths may use `/volume1/...` instead of `/Volumes/...`.

## Run

```sh
cd deploy/nas-media-agent
NAS_AGENT_TOKEN="change-me" \
NAS_AGENT_PORT=8787 \
node server.mjs
```

Health check:

```sh
curl http://127.0.0.1:8787/health
```

Tokened calls:

```sh
TOKEN="change-me"

curl -H "x-agent-token: $TOKEN" \
  "http://127.0.0.1:8787/list/receiving/JUN%202026"

curl -H "x-agent-token: $TOKEN" \
  "http://127.0.0.1:8787/file/receiving/JUN%202026/photo.jpg" \
  -o photo.jpg

curl -X PUT -H "x-agent-token: $TOKEN" -H "content-type: image/jpeg" \
  --data-binary @photo.jpg \
  "http://127.0.0.1:8787/file/receiving/JUN%202026/photo.jpg"

curl -X DELETE -H "x-agent-token: $TOKEN" \
  "http://127.0.0.1:8787/file/receiving/JUN%202026/photo.jpg"
```

## Endpoints

```text
GET    /health
GET    /roots
PUT    /roots
GET    /list/:root/:path*
GET    /file/:root/:path*
HEAD   /file/:root/:path*
PUT    /file/:root/:path*
DELETE /file/:root/:path*
GET    /thumb/:root/:path*?w=320
POST   /archive
POST   /test-folder
```

`/thumb` uses `sharp` when available. If `sharp` is missing on the host, it falls
back to returning the original image.

## Archive Payload

The Zendesk claim route sends:

```json
{
  "ticketId": "12345",
  "photos": [{ "url": "/api/nas/JUN%202026/photo.jpg" }],
  "info": "ticket metadata",
  "archiveRoot": "/Volumes/USAV Media/Puchasing photos/2026/2 Zendesk 2026",
  "archiveFolder": ""
}
```

The agent creates:

```text
<archiveRoot>/<archiveFolder>/<ticketId>/
```

and copies all available photos plus `_ticket-info.txt`.

## Caddy Front

Example route in the existing tunnel-facing Caddy:

```caddyfile
nas-photos.michaelgarisek.com {
    handle_path /_agent/* {
        reverse_proxy 127.0.0.1:8787
    }

    # Existing public/read-only media server can stay here.
    reverse_proxy 127.0.0.1:8088
}
```

Set Vercel env (split read vs write — do **not** point `NAS_RW_URL` at the agent):

```text
NAS_RW_URL=https://nas-photos.michaelgarisek.com          # reads — tunnel browse root (:8088)
NAS_AGENT_URL=https://nas-photos.michaelgarisek.com/_agent
NAS_AGENT_TOKEN=<same token as agent>
```

The app resolves upstreams in `src/lib/nas-agent-client.ts`:

- **GET** `/api/nas` → `NAS_RW_URL` (fast read-only browse)
- **PUT/DELETE** `/api/nas` → `NAS_AGENT_URL/file/receiving` (token-guarded agent writes)

When `NAS_AGENT_URL` is set, shipping/claims use the same-origin proxy:

```text
/api/nas-target/shipping/<folder>/<file>
/api/nas-target/claims/<folder>/<file>
```

The agent's `/file/:root/...` endpoint can also serve listings, but production
should keep browse on `:8088` and writes on the agent.

## Security

- Keep `NAS_AGENT_TOKEN` set.
- Do not expose raw NAS roots.
- Request-supplied archive roots are restricted to prefixes in
  `NAS_AGENT_ALLOWED_ROOT_PREFIXES`, defaulting to `/Volumes,/volume1`.
- Uploads are limited by `NAS_AGENT_MAX_UPLOAD_BYTES`, default 50 MB.
