---
name: new-route
description: Scaffold a new Next.js API route under src/app/api following the canonical handler skeleton — withAuth/requireRoutePerm gate → Zod validate → domain helper → 404/409/200 map → recordAudit → after() side-effects. Also wires the permission into permission-registry.ts and a regression test into route-permission-manifest.test.ts. Use when adding any new operator/mutation API endpoint.
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---

# New API route scaffolder

Generates a route that already satisfies what `api-route-reviewer`, `route-auth-check`,
and `permission-registry-guard` police, so it passes review on the first pass. Read
`.claude/rules/backend-patterns.md` before starting — this skill operationalizes it.

The reference templates live next to this file:
- `templates/collection-route.ts.tmpl` — a non-dynamic `route.ts` (uses `withAuth`).
- `templates/id-route.ts.tmpl` — a dynamic `[id]/route.ts` (uses `requireRoutePerm`, because
  `withAuth` ignores Next's route-`params`; param routes need the plain handler form).

## Before writing anything — gather the shape

Ask (or infer from the request) and pin down:

1. **Path** → `src/app/api/<segments>/route.ts`. Dynamic segment? → `[id]/route.ts`.
2. **Methods** — GET (read) / POST (create) / PATCH (update) / DELETE (soft-delete).
3. **Permission** — does an existing `PERMISSIONS` id in `src/lib/auth/permission-registry.ts`
   already fit? Reads usually reuse a `*.view`; writes a `*.manage`. Only add a new permission
   when none fits (step 5).
4. **Domain helper** — the business logic must live in `src/lib/**`, not in the handler. If it
   doesn't exist yet, create/point at it; the route only validates → delegates → maps → audits.
5. **Audit verb** — which `AUDIT_ACTION` / `AUDIT_ENTITY` constant. If none fits, register a
   new one (procedure below).

### Registering a new audit verb (when no existing constant fits)

All audit vocabulary lives in `src/lib/audit-logs.ts`. To add one:
- Append an entry to `AUDIT_ACTION` (verb, e.g. `FOO_CREATE: 'foo.create'`) and/or
  `AUDIT_ENTITY` (noun, e.g. `FOO: 'foo'`). Group it under the right `// ── section` comment.
- **Value strings are append-only — never rename or repurpose an existing one.** Dashboards
  and timeline reads filter on the literal `action`/`entity_type` strings; renaming silently
  breaks them. A typo fix is a *new* constant + a data backfill, not an in-place edit.
- Follow the dotted-namespace convention (`<entity>.<verb>`, lowercase) the file already uses;
  a few legacy literals are SCREAMING_CASE (`PACK_COMPLETED`) — match the neighbours, don't
  invent a third style.
- If the verb breaks expected state (adjust / scrap / override / cancel / reverse), also add
  it to `AUDIT_REASON_REQUIRED` so `recordAudit` warns when a `reasonCode` is missing.
- The `AuditAction` / `AuditEntity` union types derive automatically — no other edit needed.

## Steps

1. **Pick the template** by route kind (collection vs `[id]`) and read it. Copy it to the target
   path and fill the placeholders (`<<...>>`). Delete the methods/branches you don't need.

2. **Gate every handler.**
   - Collection routes: `withAuth(handler, { permission: '<perm>' })`. Add `stepUp: true` for
     destructive verbs not already covered by the registry's `stepUp` flag.
   - `[id]` routes: first line is `const gate = await requireRoutePerm(req, '<perm>'); if (gate.denied) return gate.denied;`
   - **Never** read `staffId`/`orgId` from the body — use `ctx.organizationId` / `gate.ctx.organizationId`.

3. **Validate the body** with a Zod schema in `src/lib/schemas/` via `parseBody`:
   ```ts
   const raw = await req.json().catch(() => ({}));
   const parsed = parseBody(MyCreateBody, raw);
   if (parsed instanceof NextResponse) return parsed;
   ```
   For path params: `const id = Number(rawId); if (!Number.isFinite(id) || id <= 0) return 400`.

4. **Delegate, then map status:** call the `src/lib/**` helper, then map its result —
   `400` invalid · `404` not found · `409` conflict / idempotent-replay · `201` create · `200` ok ·
   `500` is the wrapper's catch-all. No business logic inline.

5. **Thread idempotency** on creates/mutations (a retried request must be a no-op):
   - CRUD-style creates → API idempotency: `readIdempotencyKey` + `getApiIdempotencyResponse` /
     `saveApiIdempotencyResponse` with a `ROUTE_*` const (see `collection-route.ts.tmpl`).
   - State-machine mutations → thread `clientEventId` into `inventory_events`
     (`UNIQUE(client_event_id)`); re-entering the same state returns `idempotent: true`.

6. **Status changes go through the state machine** — if the route changes a unit's status, call
   `transition()` (or the flag-gated `applyTransition()`), **never** raw `UPDATE … current_status`.
   Org-scoped writes use `withTenantTransaction(orgId, …)`, not manual `WHERE organization_id =`.

7. **Audit on the success path** (before returning), using constants:
   ```ts
   await recordAudit(pool, ctx, req, {
     source: '<feature>-api',
     action: AUDIT_ACTION.<VERB>,
     entityType: AUDIT_ENTITY.<TYPE>,
     entityId: result.id,
     before, after,
   });
   ```

8. **Fire-and-forget side-effects** (Zoho sync, Ably emit) go in `after(() => …)` from
   `next/server` — never block the response on them.

9. **Wire the permission registry (if you added one in step 0.5):**
   - Append a row to `PERMISSIONS` in `src/lib/auth/permission-registry.ts` (right category;
     `destructive: true` / `stepUp: true` as needed). Everything else derives automatically.
   - Add a regression test to `src/lib/auth/route-permission-manifest.test.ts` asserting
     `routesGatedBy('<perm>')` includes the new path. (`permission-registry-guard` requires this pairing.)
   - Regenerate the committed manifest: `npm run audit-route-auth:emit`.

10. **Verify** — run the guards this skill is designed to satisfy:
    ```bash
    npm run audit-route-auth:check
    npx --no-install next lint --file <relative path to route.ts>
    npm test -- route-permission-manifest    # if you touched the registry
    ```
    Report results. Do not commit (user commits via GitHub Desktop).

## Rules

- The handler is thin: **validate → delegate → map status → audit → after()**. Business logic
  lives in `src/lib/**` behind an injectable `Deps` so it unit-tests DB-free.
- `orgId`/`staffId` always come from the auth context, never the request body.
- Use `AUDIT_ACTION` / `AUDIT_ENTITY` constants; never inline literals, never rename existing ones.
- Don't hand-roll auth: `withAuth` for collection routes, `requireRoutePerm` for `[id]` routes.
- If the route is intentionally public (webhook with its own signature gate, etc.), use
  `withAuth(handler, { allowAnonymous: true })` and null-check `ctx.user` — don't leave it ungated.
