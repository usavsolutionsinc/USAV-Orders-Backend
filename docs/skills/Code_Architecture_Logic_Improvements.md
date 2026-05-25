# Code Architecture & Logic Improvements — USAV Orders Backend

> **Skill file.** Future Claude sessions: this is the backend/architecture companion to `UX_UI_Analysis_and_Improvement_Plan.md`. Read before making cross-cutting changes (auth, DB, jobs, integrations).

---

## Executive Summary

The codebase is a Next.js 16 App Router app (React 19, TypeScript) wrapped in Electron, with **103 API route folders**, a 1966-line Drizzle schema, Neon Postgres, Ably realtime, Upstash QStash + Redis, and a homegrown pipeline orchestrator (`src/lib/pipeline/orchestrator.ts`). Integrations: eBay, Google Sheets, Zoho, Ecwid, Firebase (logs), Vercel Blob, WebAuthn/SimpleWebAuthn.

**Architecture strengths:** strong auth core (`withAuth` wrapper, route-permission manifest with CI verification, step-up grants, WebAuthn, PIN, SSO/OIDC), dual-driver DB pool (`pg` in dev, `@neondatabase/serverless` in prod), tagged-template SQL helpers in `neon-client.ts`, dependency-cruiser configured, knip configured, route-auth audit script committed.

**Real risks:** the size of a few core files (`schema.ts` 1966 LOC, `orders-queries.ts` 1471 LOC, `location-queries.ts` 1066 LOC, `sku-catalog-queries.ts` 1032 LOC) suggests domain logic is concentrated in monolithic query files; tenancy is present (`AuthContext.organizationId`) but the schema's enforcement of it needs verification; `.env` is committed (in working tree, possibly historically); committed backup JSONs and `firebase-debug.log` are in the working tree.

---

## 1. Code Organization

### Top-level `src/` layout

| Dir | Purpose |
|---|---|
| `src/app/` | Next.js App Router — pages, layouts, and **103 API route folders** under `src/app/api/` |
| `src/components/` | Feature-layer React components, grouped by domain (receiving, station, tech, fba, etc.) |
| `src/design-system/` | Tokens, primitives, components — the canonical UI layer |
| `src/lib/` | Shared business logic, data access, integrations, schemas |
| `src/hooks/` | React hooks |
| `src/contexts/` | React contexts (auth, dashboard state) |
| `src/domain/` | Domain models (verify scope) |
| `src/features/` | Feature-specific modules |
| `src/queries/` | Possibly TanStack Query keys/fns — overlap with `src/lib/neon/*-queries.ts`? |
| `src/services/` | External-service wrappers |
| `src/styles/` | Global styles |
| `src/utils/` | Utilities (notably `staff-colors.ts` at 1011 LOC — investigate) |
| `src/config/` | Config |
| `src/proxy.ts` | **Edge middleware** (formerly `middleware.ts`) — auth gate + QR rewrites |

### Strengths
- Clear separation: `lib/` for business logic, `components/` for UI, `design-system/` for primitives.
- API routes grouped by domain under `src/app/api/`.
- Auth is consolidated under `src/lib/auth/` — a single place to reason about identity.

### Weaknesses
- **Three places that may overlap**: `src/queries/`, `src/lib/neon/`, `src/services/`. Establish a single owner for "Postgres → typed result" code.
- **Top-level `src/components/*.tsx` files** without folders (see UX doc §1).
- **`src/utils/staff-colors.ts` (1011 LOC)** is suspicious for a "utils" file — almost certainly contains data or business rules masquerading as a helper.
- **`src/lib/` is broad** — auth, integrations, jobs, schemas, repositories, services-style modules all live here. Consider hoisting: `src/lib/integrations/{ebay,zoho,ecwid,google}/`, `src/lib/jobs/` (already exists), `src/lib/repositories/` (already exists).

---

## 2. State Management & Data Flow

### Current shape
- **Server state**: `@tanstack/react-query` (v5) for client-side fetching; server components for initial render.
- **Auth state**: `src/contexts/AuthContext.tsx` hydrates from `/api/auth/session` on mount; rest of app reads `useAuth()` / `<Can perm>`.
- **Dashboard state**: `src/hooks/useDashboardSelectedOrder.ts`, `src/lib/dashboard-*.ts` — likely a custom store.
- **Offline / IndexedDB**: `idb` is in deps; `src/lib/offline/`, `src/lib/offlineQueue.ts` exist — there's an offline mutation queue.
- **Realtime updates**: Ably channels + `src/lib/realtime/` + the outbox-relay pattern (`scripts/realtime-outbox-relay.js`).

### How features interact
- **Forms**: server actions are not the dominant pattern; most writes go through `POST /api/.../route.ts` handlers wrapped in `withAuth`.
- **Routing**: App Router segments. Mobile-only paths under `/m/*`; printed QR labels get rewritten by `proxy.ts` (`/m/b` → bin, `/m/l` → location, `/m/u` → unit).
- **API calls**: client → `fetch('/api/...')` (no GraphQL, no tRPC). Some idempotency through `src/lib/api-idempotency.ts`.
- **Authentication**: cookie `usav_sid` set by `/api/auth/signin`; verified at every API call via `getCurrentUserBySid`. Step-up for sensitive ops via `hasStepUp(perm)`.

### Identified coupling / smells
- **`AuthContext` mirrors `PUBLIC_PATHS` from `proxy.ts` by hand** (`CLIENT_PUBLIC_PATHS`). The comment admits this — set up a shared source of truth (e.g., `src/lib/auth/public-paths.ts`) and import from both.
- **Query files are giant** (`orders-queries.ts` 1471, `location-queries.ts` 1066, `sku-catalog-queries.ts` 1032). Split by use case: `orders/list`, `orders/by-id`, `orders/search`, `orders/aggregations`.
- **Top-level `src/lib/*.ts` files of unclear ownership**: `replenishment.ts` (785), `zoho.ts` (805), `staff-availability.ts`, `staff-schedule.ts`, `tracking-exceptions.ts`. Many cross-cut multiple features; consider folding into the matching subdir if one exists (e.g., `src/lib/zoho/index.ts` already exists — what's `src/lib/zoho.ts` doing separately?).

---

## 3. Performance Bottlenecks & Optimization

### Server / DB
1. **Connection pool sizing** is environment-aware (`PG_POOL_MAX` defaults: 10 dev, 3 prod) — good. Verify prod actually has 3 enough for the load (Vercel concurrent fn invocations × 3 = real pool size).
2. **Per-request schema reads**: `src/lib/receiving-schema-cache.ts` exists — verify all hot reads use cached schema, not re-introspect.
3. **N+1 risk** in 1471-LOC `orders-queries.ts`: spot-check that batch fetches use `IN (...)` or joins, not loops.
4. **Transaction usage**: `neon-client.ts` exposes `transaction()` — audit `POST /api/.../route.ts` handlers that do multi-step writes (assign, receive, complete) to ensure they're wrapped.
5. **`db-retry.ts`** exists — ensure it's used at all WS-prone call sites in prod (Neon serverless can hiccup).

### Client
1. **Audit `framer-motion` usage** — animate only what matters; bulk lists shouldn't animate every row.
2. **Lazy-load heavy clients** — `@zxing/browser`, `signature_pad`, `bwip-js`, `qrcode`, `canvas-confetti` should be dynamic imports on the routes that need them.
3. **React Query defaults** — verify `staleTime > 0` for staff lists, SKU catalog, location tree (slow-changing data).
4. **PWA caching** — `@ducanh2912/next-pwa` strategy needs to be auditable; warehouse Wi-Fi is patchy.

### Jobs & pipeline
1. **`src/lib/pipeline/orchestrator.ts`** is the in-house workflow runner. Verify failure paths: dead-letter, retries, idempotency keys.
2. **QStash schedules** — `scripts/qstash-sync.js`, `scripts/ensure-google-sheets-qstash-schedules.js`. Document the source of truth; today it's spread between code and the QStash UI.
3. **Realtime outbox relay** (`scripts/realtime-outbox-relay.js`) — needs supervised process (`pm2`/`ecosystem.config.cjs` is configured); document SLA and ops runbook.

---

## 4. Security, Error Handling, Edge Cases

### Security strengths
- **`withAuth` is the unconditional gate** for API routes — every wrapped route requires a valid session unless `allowAnonymous: true`.
- **Server never trusts `staffId` from request body** — it comes from the verified session cookie.
- **Route-permission manifest** (`docs/security/route-permissions.json`) is **generated + CI-verified** via `npm run audit-route-auth -- --check`. Excellent pattern.
- **Step-up auth** for sensitive ops via `hasStepUp(perm)`.
- **WebAuthn + PIN + SSO/OIDC** all present (`src/lib/auth/{webauthn,pin,sso,sso-oidc}.ts`).
- **Edge proxy** (`src/proxy.ts`) does only cookie-presence check — keeps node:crypto/pg out of the Edge bundle. Correct architecture.
- **Tenant scoping** via `organizationId` on `AuthContext` — every business query should filter by it.
- **`api-idempotency.ts`** + `api-guard.ts` + `setup-guard.ts` + `security/` subdir present.

### Security risks to verify
1. **`.env` shows as modified in `git status`** — make sure no secret was committed historically. Run `git log -p .env` and rotate anything leaked.
2. **`firebase-debug.log` committed** — `.gitignore` has `firebase-debug.log` but it's already tracked. Run `git rm --cached firebase-debug.log` after confirming nothing sensitive is in it.
3. **`receiving_lines_cleanup_backup_*.json` (~440 KB each, two copies) committed** — likely contains PII/operational data. Same treatment.
4. **Tenant enforcement audit**: pick 10 random API handlers and verify every query references `organizationId` (or has a documented reason not to).
5. **Webhook signature verification** — `proxy.ts` exempts `/api/webhooks/*` and `/api/billing/webhook` from cookie gate; each handler must verify its own signature (Stripe, carrier callbacks, eBay). Audit each `src/app/api/webhooks/**/route.ts`.
6. **QStash + cron auth** — `/api/qstash/*` and `/api/cron/*` exempted from cookie gate; verify they check `Upstash-Signature` and `CRON_SECRET` respectively.
7. **Service-to-service routes** — anything with `serviceToService` exemption in the manifest needs a token check.
8. **`/api/auth/signup` is public** — verify rate limiting and that it can't create privileged accounts.
9. **Electron's `EmbeddedBrowser.tsx`** — if it loads untrusted URLs, ensure `webPreferences: { contextIsolation: true, nodeIntegration: false }` and `webSecurity: true`.

### Error handling
- `src/lib/observability/` exists — check coverage (Sentry? structured logs?).
- `src/lib/route-metrics.ts` exists — ensure all routes report.
- `db-retry.ts` retries DB. What about Ably / QStash / eBay / Zoho? Each integration needs a defined retry + backoff strategy.
- Toast UX (`sonner` + `src/lib/toast.ts`) — verify network errors surface usefully, not as silent failures.

### Edge cases worth scripted tests
- Receiving a PO line **twice** (idempotency): `src/app/api/receiving/mark-received-po/route.ts` (830 LOC) — already overhauled per recent commit `c4452a1`. Verify the rescans test covers all paths.
- Scanning a QR after the underlying entity is deleted/moved.
- Offline mutation queue replaying out of order on reconnect (`offlineQueue.ts`).
- Realtime outbox delivering after a row is updated again — order/causality.
- Session expiry mid-operation (heartbeat? auto-renew?).

---

## 5. Constraints

### Tech debt
- **1966-line schema** — manageable if grouped by domain, painful if not. Split into per-domain schema files re-exported from a root.
- **Mixed JS/TS in `scripts/`** (149 scripts, mix of `.js`, `.mjs`, `.ts`) — fine for ops scripts, but document which are load-bearing vs one-off backfills.
- **Two parallel mobile UIs** (see UX doc).
- **`src/components/ui/` vs `src/design-system/components/` overlap** (see UX doc).
- **`get-ebay-tokens.js` and `get-all-ebay-tokens.js` at repo root** — one-off auth flows. Move to `scripts/integrations/ebay/` or delete after capture.
- **`Working GAS`, `Repair Service HTML`, `fba_tracker_plan.docx`, `test-packing-flow.sh`** at root — relics. Triage.

### Hosting / runtime
- **Vercel** is the prod host (`vercel.json`, `next.config.ts`, Vercel Blob, `@neondatabase/serverless`).
- **Electron** is the desktop wrapper for station PCs (Mac DMG + Win NSIS builds in `package.json` scripts).
- **PM2** drives the realtime outbox relay (`ecosystem.config.cjs`).
- **Edge runtime** for `src/proxy.ts` only — keep node-only deps out.

### Third-party dependency risk
| Dep | Why it matters | Action |
|---|---|---|
| `next 16.1.1`, `react 19.2.1` | Bleeding edge | Watch for breaking changes; pin majors |
| `@neondatabase/serverless` | Prod DB driver | Monitor cold-start latency |
| `ebay-api`, `@googleapis/sheets`, `ably` | External APIs | Rate limits, deprecation cycles |
| `@simplewebauthn/*` 11.x | Auth-critical | Major-version upgrade path |
| `framer-motion`, `lucide-react` | UI weight | Audit usage / lazy load |
| `drizzle-orm`, `drizzle-kit` | Schema migrations | Generated migrations live in `src/lib/migrations/` — verify all are applied via `npm run db:migrate` |

### Budget / time
- Internal tool — favor "boring & maintainable" over "novel."
- Warehouse downtime cost is real — every prod migration should be tested via `db:migrate:dry` and have a rollback plan.

---

## 6. Recommended Architectural Improvements

### High priority
1. **Single source for `PUBLIC_PATHS`** — extract to `src/lib/auth/public-paths.ts`, consumed by both `proxy.ts` and `AuthContext.tsx`. Eliminates hand-sync drift.
2. **Split `src/lib/drizzle/schema.ts`** into `schema/{orders,receiving,inventory,staff,audit,...}.ts` re-exported from `schema/index.ts`. Use Drizzle's per-file support.
3. **Split mega-query files** (`orders-queries.ts`, `location-queries.ts`, `sku-catalog-queries.ts`) by use case.
4. **Audit tenant scoping** end-to-end. Add a lint rule (or `dependency-cruiser` constraint) that every query helper takes `organizationId` as a required arg.
5. **Document webhook signature verification** per provider (Stripe, eBay, carriers, Zoho, Ecwid). Add a smoke test per webhook.
6. **Remove committed secrets/dumps**: `firebase-debug.log`, `receiving_lines_cleanup_backup_*.json`, `snapshot{,2,3,4}.txt`. Rotate any keys that may have leaked via `.env`.

### Medium priority
7. **Formalize the integrations layer** under `src/lib/integrations/{provider}/` — current state has `src/lib/ebay/`, `src/lib/ecwid/`, `src/lib/zoho/` + top-level `zoho.ts`, plus `services/`.
8. **Realtime ops runbook**: where does Ably token vending live? Outbox relay restart procedure? Observable SLA?
9. **Pipeline orchestrator hardening** — retries, idempotency, dead-letter, observability.
10. **Stop mixing `src/queries/`, `src/lib/neon/`, `src/services/`** — pick one home for "Postgres → typed result"; deprecate the other two.

### Low priority
11. **Knip cleanup** — knip is configured (`knip.config.ts`); run periodically and prune dead exports.
12. **`dependency-cruiser` rules** — already configured. Add rules for "no `src/components/` imports from `src/lib/`" and "no `src/lib/` imports from `src/app/`" (or whatever direction the team chose).
13. **Drizzle `db:studio`** is wired — document the connection.

---

## 7. Pre-Commit / CI Checklist (recommended)

| Check | Tool | Already wired? |
|---|---|---|
| Lint | `next lint` (ESLint 9, flat config) | yes |
| Route-auth coverage | `npm run audit-route-auth:check` | yes |
| Permissions audit | `npm run audit-permissions` | yes |
| Auth tests | `npm run test:auth` | yes |
| Dashboard-state test | `npm run test:dashboard-state` | yes |
| E2E station/fba | `npm run test:e2e:*` scripts | yes (manual run) |
| Migration dry-run | `npm run db:migrate:dry` | yes |
| Dep graph health | `npm run diagrams:check` | yes |
| Knip dead-code scan | `npx knip` | configured |

**Gap**: no CI workflow visible (only `.github/` dir, contents not enumerated here — verify). Recommend a single `ci.yml` that runs lint + audit-route-auth:check + test:auth + db:migrate:dry on every PR.

---

## See also
- `UX_UI_Analysis_and_Improvement_Plan.md`
- `Frontend_Modernization_Skills.md`
- `Feature_Interaction_Map.md`
- `docs/architecture.md`, `docs/auth-coverage.md`, `docs/security/`
