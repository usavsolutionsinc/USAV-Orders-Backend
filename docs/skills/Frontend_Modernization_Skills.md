# Frontend Modernization Skills — USAV Orders Backend

> **Skill file.** Future Claude sessions: when adding/modifying UI, follow these recipes verbatim. They reflect what the codebase already does well; don't reinvent.

---

## Executive Summary

Stack is current: Next.js 16 App Router, React 19, TypeScript 5, Tailwind 3.4, Drizzle ORM, TanStack Query 5, Framer Motion 11, sonner, cmdk, lucide-react. **No framework migration is needed.** The work is consolidation, enforcement, and decomposition — not greenfield. This file is a set of opinionated recipes future sessions should default to.

---

## 1. Folder Conventions

```
src/
  app/                 # Next.js App Router pages & API routes — server components by default
    api/<domain>/route.ts        # API handlers — always wrapped in withAuth
    <route>/page.tsx             # Pages — call requirePermission() in server components
    m/                           # Mobile-only routes (PWA-installable surface)
  components/
    <feature>/                   # Feature-grouped components — owns data fetching, business logic
      <SubComponent>.tsx
      hooks.ts                   # Feature-local hooks
      queries.ts                 # TanStack Query keys + fns for this feature
    ui/                          # LEGACY primitives — do not add new files here
  design-system/                 # Canonical UI layer — atomic, no data fetching
    tokens/                      # Raw values (colors, sizes, weights, spacings, motion)
    foundations/                 # Computed values (breakpoints, motion presets)
    themes/                      # Token compositions for light/dark
    primitives/                  # Atomic visual blocks (no state beyond hover/focus)
    components/                  # Composed from primitives (local UI state ok)
    utils/                       # CSS variable helpers, theme factories
    index.ts                     # Barrel export
  lib/
    auth/                        # AuthN/AuthZ — withAuth, requirePermission, manifest
    neon/                        # Typed query helpers (per domain)
    integrations/<provider>/     # External APIs (preferred location for ebay/zoho/ecwid)
    jobs/                        # QStash + cron handlers
    pipeline/                    # Workflow orchestrator
    realtime/                    # Ably channel helpers
    audit-log/                   # Audit-log writers
    schemas/                     # Zod schemas (request/response validators)
    drizzle/schema/              # Per-domain schema files (see Architecture doc §6)
  hooks/                         # Cross-feature React hooks only
  contexts/                      # React contexts (auth, dashboard)
  utils/                         # Stateless pure helpers — no data, no business rules
```

**Rules of the road:**
- `src/components/<feature>/` owns data; `src/design-system/` never fetches.
- New shared primitive → `src/design-system/primitives/`. Period.
- No new top-level files in `src/components/` (must be in a feature folder).
- No new files in `src/components/ui/` (legacy — migrate, don't extend).
- Server-only modules go in `src/lib/` and must be re-validated as never imported by client code (`dependency-cruiser`).

---

## 2. Styling Approach

### Use the design system. Do not bypass it.

Read `.design-system-rules.md` once and treat it as binding. Highlights:

- **Typography** → `typographyPresets.sectionLabel | fieldLabel | dataValue | monoValue | chipText | cardTitle | tableHeader | tableCell`
- **Motion** → `framerTransition.*` for transitions, `framerPresence.*` for AnimatePresence children
- **Colors** → `semanticColors.*` (domain-mapped) or `StatusBadge` (status-mapped)
- **Spacing** → `density.compact | standard | spacious`
- **Chips** → `TrackingChip | FnskuChip | SerialChip | OrderIdChip | TicketChip | SourceOrderChip` — bound to data types, never interchanged

### Tailwind escape hatches (when token doesn't exist)

If you genuinely need a one-off:
1. Check if `tokens/` has the value first.
2. If not, propose adding a token before reaching for arbitrary values.
3. Arbitrary values (`text-[10px]`, `gap-[3px]`) in feature code are a code-review blocker.

### Anti-pattern grep targets

When reviewing UI code, look for and reject:
- `text-[10px]` / `text-[11px]` / `text-[13px]` outside `design-system/`
- `motion.div` with inline `transition={{ duration: ... }}`
- `rounded-full` on non-pill, non-avatar elements
- `setTimeout` used for animation timing
- Hand-rolled `<label>` + required `*` + `<p className="text-red...">` error pattern (use `FormField`)
- `window.confirm` / `alert` (use a proper dialog + sonner toast)
- Status-to-color object literals (`const colors = { active: 'green', ... }`) — use `StatusBadge`

---

## 3. Component Architecture

### Three layers, three responsibilities

| Layer | Path | May fetch data? | May hold state? |
|---|---|---|---|
| **Primitive** | `design-system/primitives/` | No | Only hover/focus |
| **Component** | `design-system/components/` | No | Local UI state (open/closed, animation) |
| **Feature** | `src/components/<feature>/` | Yes | Yes — business state, fetches, routing |

### When to extract

A pattern lives in 3+ feature components → extract it:
- Purely visual → primitive
- Visual + local UI state → component
- Needs data → keep in feature layer; extract only the visual part

### Component file size budget

- Feature component > 500 LOC → consider extraction.
- Feature component > 800 LOC → must split before next merge.
- See `UX_UI_Analysis_and_Improvement_Plan.md` §1 for the current offenders.

### Server vs client components

- **Default to server components.** Add `'use client'` only when you need state, refs, event handlers, or browser APIs.
- Pages that need auth: call `requirePermission()` server-side; don't rely on `AuthContext` for gating (it's for rendering convenience).
- Heavy client-only widgets: dynamic import with `ssr: false` (`@zxing/browser`, `signature_pad`, `bwip-js`, `canvas-confetti`, scanner UIs).

---

## 4. Data Layer Recipes

### Reading data in a page

Server component:
```ts
// src/app/orders/[id]/page.tsx
import { requirePermission } from '@/lib/auth/page-guard';
import { getOrderById } from '@/lib/neon/orders-queries';

export default async function Page({ params }: { params: { id: string } }) {
  const { user } = await requirePermission('orders.view');
  const order = await getOrderById(user.organizationId, params.id);
  return <OrderDetail order={order} />;
}
```

### Reading data on the client

```ts
// src/components/orders/queries.ts
import { useQuery } from '@tanstack/react-query';
export function useOrder(id: string) {
  return useQuery({
    queryKey: ['order', id],
    queryFn: () => fetch(`/api/orders/${id}`).then(r => r.json()),
    staleTime: 30_000, // adjust per domain — DON'T leave default 0
  });
}
```

### Writing data

API route:
```ts
// src/app/api/orders/[id]/assign/route.ts
import { withAuth } from '@/lib/auth/withAuth';
import { assignOrder } from '@/lib/neon/orders-queries';
import { z } from 'zod';

const Body = z.object({ techStaffId: z.number().int().positive() });

export const POST = withAuth(async (req, { staffId, organizationId }) => {
  const body = Body.parse(await req.json());
  const result = await assignOrder({
    organizationId,
    orderId: req.nextUrl.pathname.split('/').at(-2)!,
    assignedBy: staffId,
    techStaffId: body.techStaffId,
  });
  return Response.json(result);
}, {
  permission: 'orders.assign',
  audit: { action: 'order.assign' },
});
```

Client mutation:
```ts
const qc = useQueryClient();
const assign = useMutation({
  mutationFn: (techStaffId: number) =>
    fetch(`/api/orders/${id}/assign`, { method: 'POST', body: JSON.stringify({ techStaffId }) })
      .then(r => r.ok ? r.json() : Promise.reject(r)),
  onSuccess: () => qc.invalidateQueries({ queryKey: ['order', id] }),
  onError: (e) => toast.error('Could not assign'),
});
```

### Idempotency
- Use `src/lib/api-idempotency.ts` for any mutation a user might retry (scan flows, mark-received).
- Pass `Idempotency-Key` from the client where relevant.

### Offline mutations
- `src/lib/offlineQueue.ts` + `idb` for mobile / spotty Wi-Fi flows.
- Queue the mutation; replay on reconnect. Ensure server-side handlers are idempotent.

---

## 5. Auth Recipes

### Gating a page (server)
```ts
import { requirePermission } from '@/lib/auth/page-guard';
const { user } = await requirePermission('receiving.mark_received');
```

### Gating a route (API)
```ts
export const POST = withAuth(handler, { permission: 'orders.assign', stepUp: true });
```

### Gating UI rendering
```tsx
import { Can } from '@/contexts/AuthContext'; // or wherever it's exported
<Can perm="orders.assign"><AssignButton /></Can>
```

### Adding a new permission
1. Add it to `src/lib/auth/permission-registry.ts`.
2. Wire it into the relevant route via `withAuth({ permission: '...' })` and/or page via `requirePermission('...')`.
3. Run `npm run audit-route-auth:emit` to regenerate `docs/security/route-permissions.json`.
4. Commit both code and the regenerated manifest.
5. CI's `audit-route-auth:check` will pass.

### Step-up auth
For sensitive ops, set `stepUp: true` in `withAuth` options. The client must obtain a fresh grant (WebAuthn or PIN) before the call succeeds. UI: prompt and retry.

---

## 6. Responsiveness Strategy

### Decide the device intent first
- **Phone, single task** (scan, lookup) → use `/m/*` routes. Mobile-first layout. Big touch targets. PWA-installable.
- **Phone, browsing the main app** → wrap in `MobileBottomNav` + `MobileAppHeader` via `ResponsiveLayout`.
- **Station PC** (always desktop) → standard pages, but assume 1920×1080 and possibly Electron. Add keyboard shortcuts via `CommandBar` (cmdk).
- **Desktop browser** → same pages as station, but expect mouse + multitasking.

### Layout shells
Today: `ResponsiveLayout`, `RouteShell`, `ResponsiveShell`, `m/layout.tsx`. **Pending consolidation** (see UX doc §5 #9). Until then, when adding a new route, copy from the nearest existing route in the same surface (don't pick arbitrarily).

### Breakpoints
- Don't hardcode pixels. Use Tailwind's defaults or tokens from `design-system/foundations/`.
- Test at: 375 (phone), 768 (tablet), 1280 (laptop), 1920 (station). Electron screens are usually 1920×1080.

### Density on mobile
- `density.compact` is for desktop tables only. Use `density.standard` or `spacious` on `/m/*`.
- 44 px minimum touch target — verify by clicking with a fingertip, not a mouse cursor.

---

## 7. Animation Library Usage

### When to animate
- State changes the user initiated (open/close, add/remove).
- Drawing attention to async results (toast, save indicator).
- Spatial continuity (sliding a card into the workspace).

### When NOT to animate
- Bulk list mount (don't stagger 100 rows).
- Every hover.
- Page-level transitions (App Router doesn't ship a default; resist adding one).

### How
- Always use `framerTransition.*` and `framerPresence.*` from `design-system/foundations`.
- Use the dedicated primitive (`ExpandableSection`, `OverlaySearch`) instead of inline `AnimatePresence`.
- `framerTransition.stationCardMount` for active order card; `framerTransition.upNextRowMount` for the queue list; etc.

---

## 8. Coding Standards to Enforce

### TypeScript
- `strict: true` (verify `tsconfig.json`).
- No `any` in new code. Use `unknown` + narrowing, or `zod` parsing at boundaries.
- Public exports get explicit return types; internal helpers can infer.

### React
- No `useEffect` for derived state — compute inline or `useMemo`.
- No `useEffect` for data fetching in client components — use TanStack Query.
- Keys on lists must be stable IDs, never array indices.
- Avoid `key={Math.random()}` — it's a smell that some other bug exists.

### Imports
- Use the `@/` alias (configured in `tsconfig.json`) — no `../../../` chains.
- Sort: framework → external → `@/` → relative. Trust ESLint to enforce.

### Naming
- Components: `PascalCase.tsx`.
- Hooks: `useCamelCase.ts`.
- API routes: `route.ts` inside a kebab-case folder.
- Tests: colocated `*.test.ts` next to source where possible.

### Comments
- Default to no comments. Only add when the WHY is non-obvious.
- Don't restate what the code does. Don't reference past PRs or "the new flow."
- Drizzle schema annotations and migration files are exceptions — those benefit from a why-line.

### Commits
- See repo conventions in `git log` — short prefix (`feat:`, `fix:`, `refactor:`, `chore:`) then a verb. Body explains why, not what.

---

## 9. Testing Strategy

### What exists
- `npm run test:auth` — permission registry, route-permission manifest, shared permission logic
- `npm run test:dashboard-state` — dashboard search state
- `npm run test:e2e:fba-sidebar | station-serial | station-sku-pull | sal-tsn-fba` — node scripts under `scripts/`
- Playwright is installed but only used minimally (`playwright.config.ts`, `tests/e2e/`).

### What's missing (recommendations, not blockers)
- A Playwright smoke test per critical user flow (receive, pack, complete tech order, FBA scan).
- API route contract tests via `node --test` (mirror the pattern in `permission-registry.test.ts`).
- Visual regression on the design-system primitives (Storybook + Chromatic, optional).

### Don't mock the DB
- Integration tests should hit a real Postgres (use a `_test` DB or Neon branch).
- Mocks have masked real schema/migration bugs in prior incidents — when in doubt, hit real DB.

---

## 10. Performance Defaults

- Set `staleTime` on every `useQuery` (default 0 burns the DB).
- Use `<Image>` from `next/image` everywhere — never `<img>`.
- Use `next/font` (already configured via `src/lib/fonts.ts`).
- Dynamic-import heavy client libs (`@zxing/browser`, `signature_pad`, `bwip-js`, `canvas-confetti`).
- Server components for everything that doesn't need interactivity.
- `route-metrics.ts` should be wrapping every API route — verify on new routes.

---

## 11. When You're About to Build Something New

Ask yourself in order:
1. **Does the design system already have a primitive for this?** Check `src/design-system/primitives/` and `components/`.
2. **Does an existing feature have a similar component I can lift the pattern from?** Look in `src/components/<nearest-feature>/`.
3. **Is there a token for the styling I want?** Check `src/design-system/tokens/`.
4. **Am I creating a new permission?** Wire it through `permission-registry.ts` + `audit-route-auth:emit`.
5. **Am I creating a new DB query?** Add it to the matching `src/lib/neon/<domain>-queries.ts` (or split if the file is already 1000+ LOC).
6. **Am I adding a client-only dep?** Dynamic-import it.
7. **Am I touching auth?** Use `withAuth` / `requirePermission`, never roll your own.

If you can't answer all of these confidently, ask the user before building.

---

## See also
- `UX_UI_Analysis_and_Improvement_Plan.md`
- `Code_Architecture_Logic_Improvements.md`
- `Feature_Interaction_Map.md`
- `.design-system-rules.md` (binding)
- `docs/UI-PATTERNS.md`, `docs/HOOKS.md`, `docs/API-ROUTES.md`
