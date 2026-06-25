# Project rules — USAV-Orders-Backend

Hard rules and source-of-truth invariants for this repo. These were promoted from auto-memory because
they are durable, team-wide, and protect against repeatable high-cost mistakes. They override default behavior.

## Workflow

- **Work only on `main`.** Do all work on the main branch. Do not create or switch branches.
- **The user commits via GitHub Desktop mid-session**, so `HEAD` can move on its own. **Never run `git stash`** here —
  it can collide with their in-flight commits. Don't commit or push unless explicitly asked.

## Safety

- **Never commit `.env`.** The real `.env` is gitignored but holds ~113 live secrets (incl. `INTEGRATION_KMS_KEY`).
  `.env.example` (blank values) is the committed template. CI secrets live in GitHub Actions.
  If a tracked file is about to capture secrets, stop and surface it.

## Source-of-truth invariants

Correctness rules — each concern has a single source module; never inline or duplicate the mapping.
The full rule list (always loaded via import) is the single source of truth:

@.claude/rules/source-of-truth.md

## UI / design-system conventions

House style is **simple, linear, icon-based, contextual** (Notion-like). Detail: see `.claude/rules/ui-design-system.md`.

- **Pick the display archetype first** — four archetypes, chosen by the region's job + input model: **station**
  (`scan → crossfade → display`), **workbench** (`list → select → detail → update`), **monitor** (observe / read-only
  dashboard), **canvas** (node-graph / semantic-zoom). They have different layout/motion/state rules; never blend two in
  one region. Run the per-region decision algorithm in `.claude/rules/contextual-display.md` — the master index for the
  `.claude/rules/display/*` archetype docs.
- **Compose rails, don't rebuild them:** wrap `SidebarRailShell` / `RecentActivityRailBase`; supply only renderers.
- **Linear scaffold, no grids:** `space-y-*` / `divide-y` sections, `flex-1 overflow-y-auto` body, `border-t` dividers.
- **One row anatomy:** left-aligned title → meta eyebrow → chips; selection is `bg-blue-50 ring-1 ring-inset ring-blue-400` only (never a size shift).
- **Contextual info via `HoverTooltip`** (body-portal), not `title=`. Status = small dot + tooltip.
- **Icons structural & paired, never decorative;** import from `@/components/Icons`, size by context.
- **Color only from `src/design-system/tokens/colors/semantic.ts`;** chips = `bg-x-50 text-x-700 ring-x-200`. No hardcoded hex.

## Backend patterns

Detail: see `.claude/rules/backend-patterns.md`.

- **Status changes only via `transition()`** (`src/lib/inventory/state-machine.ts`) — never raw `UPDATE … current_status`.
- **Route skeleton:** `withAuth(handler, { permission })` → validate → domain helper → map 404/409/200 → `recordAudit()` → `after()` side-effects. `orgId` from `ctx`, never the body.
- **Audit only via `recordAudit()`** with `AUDIT_ACTION`/`AUDIT_ENTITY` constants; never `createAuditLog()` directly, never rename actions.
- **Idempotency:** thread `clientEventId` → `UNIQUE(client_event_id)` on `inventory_events`.
- **Tenant scope via `withTenantTransaction(orgId, …)`** (sets `app.current_org`; columns auto-stamp), not manual `WHERE org_id =`.
- **Inject `Deps`** into domain fns (default real impls) so unit tests run DB-free.

## Build gotchas

Silent-failure traps (always loaded via import — a miss is invisible in CI/prod):

@.claude/rules/build-gotchas.md

---

Broader project context (in-flight initiatives, feature history) lives in Claude Code's per-project auto-memory,
not here. This file is intentionally limited to hard rules and SoT invariants.
