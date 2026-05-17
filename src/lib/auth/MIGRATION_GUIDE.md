# API route migration: legacy `body.staffId` → `withAuth`

This is the recipe for converting an existing API route to the new auth system.
Do one feature area at a time; ship each as its own PR with smoke tests.

## Before

```ts
export async function POST(req: NextRequest) {
  const body = await req.json();
  const staffId = Number(body.staffId);   // ← trusted from client
  // … work …
}
```

## After

```ts
import { withAuth } from '@/lib/auth/withAuth';

export const POST = withAuth(async (req, ctx) => {
  // ctx.staffId is verified from the session cookie. ctx.role and
  // ctx.permissions are also available. ctx.user is the full envelope.
  const body = await req.json();
  // … work using ctx.staffId instead of body.staffId …
}, { permission: 'receiving.mark_received' });
```

The wrapper:
- Returns `401 UNAUTHENTICATED` when there is no valid session (in enforce mode).
- Returns `403 FORBIDDEN` when the session lacks `permission` (in enforce mode).
- Returns `403 STEPUP_REQUIRED` when the permission is in `STEP_UP_PERMISSIONS`
  and no fresh step-up grant exists. The client retries after running the
  step-up modal.
- During rollout (`AUTH_V2_ENABLED` unset), the wrapper logs but does not block,
  so each migrated route stays compatible with the old `?staffId=` flow.

## Permission strings

All in `src/lib/auth/permissions.ts` under `PermissionString`. Common ones:

- `receiving.view`, `receiving.scan_po`, `receiving.mark_received`
- `packing.scan_order`, `packing.complete_order`, `packing.print_label`
- `tech.scan_serial`, `tech.qc_pass`, `tech.qc_fail`
- `shipping.mark_shipped`, `shipping.void_order`
- `sku_stock.adjust`, `sku_stock.manage`
- `bin.adjust`, `bin.set`, `bin.rename`, `bin.swap`, `bin.remove`, `bin.add_sku`
- `admin.manage_staff`, `admin.manage_roles`, `admin.view_logs`

## Step-up scopes

Verbs flagged in `STEP_UP_PERMISSIONS` (e.g. `bin.remove`, `shipping.void_order`,
`admin.manage_staff`) automatically require a fresh `staff_stepups` row. Clients
catch the 403 and retry after the user re-enters their PIN (or hits passkey).

## Suggested rollout order

1. Receiving (`/api/receiving*`)
2. Packing & tech stations
3. Shipping / orders
4. FBA, inventory, replenish
5. Repair / walk-in
6. Admin endpoints (already done in Phase 4)
7. Integrations (Zoho, eBay, Ecwid) — server-to-server, often need `allowAnonymous`
   plus a separate API-key gate

When every route is wrapped, flip `AUTH_V2_ENABLED=true` in env and remove the
last `?staffId=` query-param consumers from any pages still reading them.
