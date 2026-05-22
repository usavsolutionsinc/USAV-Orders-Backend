# Edge rewrites for usavshop.com → staff backend

## Why this exists

Every QR code printed by this app — warehouse location labels, receiving
cartons, receiving lines, repair labels, unit/serial product labels,
sign-in / staff invite QRs — anchors to `https://usavshop.com` (via
`QR_BASE_URL` in `src/lib/barcode-routing.ts`). That keeps the Vercel
deploy hostname off every printed sticker and out of every browser
address bar.

For that to work end-to-end, the **usavshop.com Vercel project** has to
*rewrite* (not redirect) a handful of paths through to the staff backend.
A 302 redirect would still leak the backend host in the browser bar —
only a rewrite keeps the browser on `usavshop.com`.

In-app scans don't need any of this; `routeScan()` parses the path and
ignores the host, so the staff app routes locally with no network hop.
This config only matters for **phone-camera scans by non-staff users**.

## What to paste into the usavshop.com project

Add this to `vercel.json` at the root of the usavshop.com Next.js
project (the consumer storefront). Replace
`https://staff-backend.usavshop.com` with whatever hostname currently
serves this staff app (Vercel preview, prod alias, or a CNAME — any host
that resolves to the staff deploy):

```json
{
  "rewrites": [
    { "source": "/m/r/:id*",        "destination": "https://staff-backend.usavshop.com/m/r/:id*" },
    { "source": "/m/l/:id*",        "destination": "https://staff-backend.usavshop.com/m/l/:id*" },
    { "source": "/m/u/:id*",        "destination": "https://staff-backend.usavshop.com/m/u/:id*" },
    { "source": "/m/b/:barcode*",   "destination": "https://staff-backend.usavshop.com/m/b/:barcode*" },
    { "source": "/m/p/:id*",        "destination": "https://staff-backend.usavshop.com/m/p/:id*" },
    { "source": "/m/enroll/:token*","destination": "https://staff-backend.usavshop.com/m/enroll/:token*" },
    { "source": "/m/scan",          "destination": "https://staff-backend.usavshop.com/m/scan" },
    { "source": "/m/signin",        "destination": "https://staff-backend.usavshop.com/m/signin" },
    { "source": "/repair/:id*",     "destination": "https://staff-backend.usavshop.com/repair/:id*" },
    { "source": "/warehouse",       "destination": "https://staff-backend.usavshop.com/warehouse" },
    { "source": "/warehouse/:path*","destination": "https://staff-backend.usavshop.com/warehouse/:path*" },
    { "source": "/inventory",       "destination": "https://staff-backend.usavshop.com/inventory" },
    { "source": "/inventory/:path*","destination": "https://staff-backend.usavshop.com/inventory/:path*" },
    { "source": "/01/:gtin*",       "destination": "https://staff-backend.usavshop.com/01/:gtin*" },
    { "source": "/414/:gln/254/:code*", "destination": "https://staff-backend.usavshop.com/414/:gln/254/:code*" }
  ]
}
```

## Why a CNAME (not the *.vercel.app host) for the rewrite destination

Vercel rewrites copy the destination URL onto outgoing fetch traffic
*server-side*. The browser still only sees `usavshop.com`. Pointing the
rewrite target at `*.vercel.app` works functionally, but if Vercel ever
exposes the rewrite target in a header or error page, the IaaS hostname
leaks again. Setting up a custom alias on the staff project (e.g.
`staff-backend.usavshop.com` via Vercel → Project → Domains, plus the
matching CNAME at your DNS provider) eliminates that surface entirely.

## Cloudflare Worker alternative

If usavshop.com isn't on Vercel and you'd rather not move it, the same
result can be achieved with a Cloudflare Worker on the usavshop.com
zone:

```js
const BACKEND = 'https://staff-backend.usavshop.com';
const PROXY_PREFIXES = ['/m/', '/repair/', '/warehouse', '/inventory', '/01/', '/414/'];

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (PROXY_PREFIXES.some((p) => url.pathname.startsWith(p))) {
      const proxied = new URL(url.pathname + url.search, BACKEND);
      return fetch(new Request(proxied, request));
    }
    return fetch(request); // everything else stays on the storefront
  },
};
```

## Smoke test after wiring up

1. Print a bin label. Confirm the QR encodes
   `(414)0614141000005(254)A0101101` (DataMatrix, no URL).
2. Print a receiving carton label. Phone-camera scan should open
   `https://usavshop.com/m/r/<id>` — and the browser bar should *stay*
   on `usavshop.com`. If it flips to `*.vercel.app`, you have a redirect
   instead of a rewrite — check the destination config.
3. From the staff app, scan the same carton label. It should route to
   the carton view locally without any network hop to usavshop.com.

## Environment variables

In the staff backend's Vercel project:

```
NEXT_PUBLIC_APP_URL=https://usavshop.com
```

In dev / staging, override per environment (e.g.
`NEXT_PUBLIC_APP_URL=https://staging.usavshop.com` for the preview
deploy). Leaving it unset falls back to `https://usavshop.com` — fine
for prod.
