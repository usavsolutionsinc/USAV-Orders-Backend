# EXECUTION PROMPT — Universal Surfaces & AI-First Assistant (Fable 5, ultracode)

> Paste everything below the line into a fresh Claude Code (Fable 5) session at the repo root.
> Budget expectation: this is a deliberately expensive, multi-workflow run. Expect several
> orchestrated phases with adversarial verification. Stop points are explicit — the agent must
> halt at each HUMAN GATE rather than push through.

---

ultracode

# Mission

Execute `docs/todo/universal-feed-polymorphic-plan.md` (v2, AI-first — the §-2 synthesis table is
the single source of truth for every decision; do NOT re-litigate any locked decision) into this
codebase. Implement **Phase 0 through Phase 3** end-to-end, production-quality, with Phase 4/5
explicitly out of scope for this run. You are building the foundation the whole AI-first SaaS
stands on: get the contracts right over getting it done fast.

# Read first (in this order, before writing any code)

1. `docs/todo/universal-feed-polymorphic-plan.md` — the plan. §-2 (locked decisions), §2 (DDL +
   emitter standard), §3 (AI layer), §4 (Studio refactor), §7 (phases). Memorize the §2.3
   "Emitter standard: two classes, one contract" — it is normative.
2. `.claude/rules/polymorphic-tables.md` — every new table obeys it point-for-point.
3. `.claude/rules/backend-patterns.md` + `CLAUDE.md` — route skeleton, transition(), recordAudit,
   clientEventId, withTenantTransaction, Deps injection.
4. `context/OVERALL-CONTEXT.md` §5–§7 — state machine, workflow engine/taps, tenancy two-pool
   reality (RLS enforces only on GUC-wrapped paths; always keep explicit organization_id).
5. Existing patterns you will extend, not fork: `src/lib/scan-hotkey/store.ts` (the registry-hook
   model for `useAssistantContext`), `src/lib/workflow/applyTransition.ts` + `tapWorkflow`
   (fire-and-forget semantics), `src/lib/cron/run-log.ts` + `lock.ts` (cron contract),
   `src/lib/audit-logs.ts`, `src/lib/tenancy/db.ts`, `src/lib/feature-flags.ts`
   (`resolveForOrg`), the ai_chat_sessions/ai_chat_messages schema, the integrations sync
   orchestrator (`syncConnection` / `runOrdersSyncAllOrgs`), `src/components/studio/StudioShell.tsx`
   / `StudioInspector.tsx` / the Simulate panel, `src/lib/settings` registry,
   `permission-registry.ts` + `route-permission-manifest.test.ts`.
6. Skills to invoke when their trigger matches (mandatory, not optional): `db-migration-author`
   (every migration), `new-route` (every new API route), `domain-unit-test` (every domain helper),
   `org-scope`, `sidebar-mode` (any new page surface), `ops-studio` (before touching /studio),
   `claude-api` (before writing the agent loop).

# Hard invariants (violating any of these is a failed run)

- Work only on `main`. Never branch, never `git stash`, never commit or push — leave the working
  tree for the user to commit via GitHub Desktop. Never touch `.env`.
- The working tree already contains the uncommitted `serial_unit_provenance` refactor (~24
  receiving/tech/serial files + 4 migrations incl. one `.BLOCKED`). Do not revert, "clean up," or
  rename any of it. Never re-add `serial_units.origin_*` readers.
- Migrations: author only — dated immutable filenames, idempotent DDL, tenant-from-birth
  (`organization_id NOT NULL`, org-led keys, `enforce_tenant_isolation()` in the same migration),
  named CHECK constraints in the guarded DO-block form. Do NOT apply them to any database; do NOT
  run drizzle-kit push. Model every table in `src/lib/drizzle/schema.ts` in the same change.
- Status changes only via `transition()`/`applyTransition()`. Audit only via `recordAudit()` with
  `AUDIT_ACTION`/`AUDIT_ENTITY` constants (add new constants; never rename existing). orgId from
  `ctx`, never the body; thread orgId explicitly everywhere (beware the `?? USAV_ORG_ID` fallback
  — never rely on it, never import `USAV_ORG_ID` in new code).
- Every new route: `withAuth(handler, { permission })` (or `requireRoutePerm` for dynamic ids),
  new permissions registered in `permission-registry.ts` + manifest test updated in the same
  change, Zod validation, 404/409/200 mapping, `recordAudit`, `after()` for side-effects.
- Every new domain helper: injectable `Deps` (default real impls) + a DB-free `node:test` unit
  test with a `fakes()` factory. Co-locate as `src/**/*.test.ts` so CI's glob discovers it.
- UI: obey the display archetypes (run the pickArchetype algorithm per region), compose
  `SidebarShell`/rails, semantic color tokens only, named z-index tokens only, motion only through
  `useMotionPresence`/`useMotionTransition`, `HoverTooltip` not `title=`, no raw `<button>`
  (canonical `Button`), typography tokens only, no Tailwind `dark:` (the app uses the
  `html[data-theme=dark]` remap). The DS guard tests will fail the run otherwise.
- Signals for external sources follow the §2.3 mirror-derivation standard exactly: never emit
  inline in a connector; `source_ref` idempotency; eBay only in this run (Amazon/RDT explicitly
  out of scope).
- Out of scope for this run (do not build): Redis caching, anonymized cross-org benchmarks,
  Amazon buyer-note ingestion, Jetson/fine-tuning anything, MCP exposure, generative onboarding,
  Phase 4 rails cutover, Phase 5 history pages.

# Orchestration directives (ultracode)

- Begin with a **parallel understanding workflow**: fan out readers over (a) the plan doc, (b)
  the workflow engine + applyTransition + taps, (c) the ai_chat schema + any existing AI/agent
  code, (d) the sync orchestrator + sales_orders mirror shape (verify where buyer notes land
  today — this is a required scouting deliverable), (e) Studio shell/inspector/simulate, (f) the
  four chokepoints that will emit signals (linkReturnedSerial + warranty claim paths, receiving
  exception/triage paths, recordTestVerdict), (g) cron + flag + settings registries. Synthesize a
  structured map before any code.
- For each phase: **design → implement → adversarially verify**. Verification fan-out per phase:
  one skeptic per contract (tenancy leak hunter, idempotency breaker, polymorphic-contract
  auditor, DS-guard/UI-rules checker, permission-registry auditor, "does this violate a locked
  §-2 decision" reviewer). A finding survives only if a verifier reproduces it against the actual
  diff. Fix confirmed findings before advancing a phase.
- Use worktree isolation only if agents must mutate overlapping files in parallel; otherwise
  pipeline sequentially per phase — this repo's working tree is shared with in-flight human work.
- After each phase, run the full local gate suite and report results honestly:
  `npx tsc --noEmit` · `npx eslint . --max-warnings=0` (scope to changed dirs if the full run is
  prohibitive, but say so) · the `node:test` glob for all new/affected tests ·
  `npm run test:ds-guards` (or the guard-test glob) · knip against `knip-baseline.json` ·
  `audit-route-auth` + route-permission manifest test. A red gate blocks the next phase.

---

# PHASE 0 — Schema wave + vocabulary spine

Deliverables:

1. **One migration wave** (separate dated files, one concern each, via `db-migration-author`):
   `feed_memberships`, `staff_rail_exclusions`, `entity_signals` (WITH `source_ref` + the partial
   unique idempotency index + `notes_tsv` GIN), `node_surfaces`, `insight_links`,
   `agent_mutations` + `agent_mutation_affects`. Exactly the shapes in plan §2 (amend only where
   the live schema forces a type reconciliation — document any deviation in the migration header
   and the plan doc). Named CHECKs, org-led uniques/indexes, `enforce_tenant_isolation()` per
   table, parent-delete integrity per the trigger-family pattern (dispatch on TG_ARGV[0]) for
   every day-one entity_type/target_kind — if a discriminator value has no confirmable parent,
   document the explicit skip in the migration comment per the contract. `insight_links` allows
   NULL organization_id for seeded global rows — handle its RLS policy deliberately (seeded rows
   must be readable by all orgs; document the mechanism).
2. **Drizzle models** for all seven tables in `schema.ts`, same change, discriminator values in
   comments.
3. **The kind catalog / canonical-ref registry** (`src/lib/surfaces/registry.ts` or similar):
   typed registries for `feed_key`, `signal_kind`, `linkage_type`, `mutation_kind`,
   `node_surface.role`, entity_type vocabularies; a canonical-ref grammar
   (`<table>:<axis>:<value>:entity:<id>`) with parse/format helpers + unit tests. This registry
   is what CHECK constraints mirror and what the AI will read at runtime — treat it as SoT.
4. **A one-page spec** appended to the plan doc resolving §8's first open question: the initial
   `mutation_kind` list with per-kind trust class (auto | draft-scoped | review) and target_kind
   mapping.

HUMAN GATE 0: present the migration set + registry for review. Do not apply migrations.

# PHASE 1 — AI read substrate

Deliverables:

1. **`recordEntitySignal`** domain helper (Deps-injected, DB-free tested): validates
   signal_kind against the registry, writes signal + emits ops_event, org via
   withTenantTransaction, ON CONFLICT DO NOTHING when source_ref present.
2. **Three internal emitters** wired inside their existing chokepoints (returns/warranty incl.
   linkReturnedSerial context; receiving exceptions + triage outcomes; recordTestVerdict fail
   reasons with their governed reason_codes). Additive taps — never change the chokepoints'
   existing behavior or failure modes; a signal failure must never fail the domain action.
3. **Buyer-note mirror derivation (eBay only)** per §2.3: (a) scouting-verified confirmation of
   where eBay buyer notes/messages land in the sales_orders mirror (if they don't, extend the
   sync upsert minimally to persist them — mirror change only, no signal logic in the connector);
   (b) a derivation module deriving signals from mirror rows with source_ref idempotency;
   (c) the fresh-path hook in the sync orchestrator (fire-and-forget, tapWorkflow semantics);
   (d) a nightly heal-sweep cron route (`withCronRun` + `withCronLock`, registered in the cron
   registry + vercel.json via the cron conventions, `isAuthorizedCronRequest`, allow-listed in
   `src/proxy.ts` if needed); (e) per-tenant gate via `resolveForOrg('BUYER_NOTE_SIGNALS', …)`.
4. **The typed read-tool registry** (`src/lib/assistant/tools/`): org-scoped, Deps-injected,
   Zod-schema'd tools — `get_signals_by_node`, `get_top_reasons`, `get_unit_journey`,
   `get_feed_state`, `get_graph`, `get_node_detail`, `get_benchmarks`, `get_kpis`,
   `search_notes` (tsvector), `get_mutation_history`, `get_chat_history`. Each tool: input/output
   schema, permission requirement, unit test with fakes. A single registry export the agent loop
   consumes; design the entry shape so the same registry can later back MCP without rework.
5. **Seeded `insight_links`**: a seed migration (or idempotent seed script) with defensible
   reseller-vertical benchmark rows (test-fail %, return %, receive→list days — mark values as
   editable seeds); `get_benchmarks` reads them; a minimal "you vs typical" readout on
   /operations analytics (Monitor rules: read-only, org-scoped, degrade-not-fail).

HUMAN GATE 1: demo the tool registry outputs (via unit tests / a scratch harness), the signal
rows shape, and the /operations benchmark readout. Migrations still unapplied — coordinate apply.

# PHASE 2 — Global English assistant (read/explain only)

Deliverables:

1. **Server agent loop**: `POST /api/assistant/chat` (withAuth, new `assistant.chat` permission,
   streaming). Claude API tool-use loop (invoke the `claude-api` skill first; use the current
   model id it prescribes) over the Phase 1 read registry; org scoping threaded into every tool
   call; turns persisted to ai_chat_sessions/ai_chat_messages; hard cap on loop iterations;
   graceful tool-error surfacing. No write tools in this phase.
2. **`AssistantProvider` + dock**: root-layout provider; right-side collapsible dock (portal,
   named z-token — add one if needed via the token file, never `z-[NNN]`), present on every
   route; chat UI per house style; an (empty-for-now) AI-edits tray section. Keyboard: cmd/ctrl-K
   family only — never F2 or any scan-hotkey-claimable key; verify no collision with the
   scan-hotkey store.
3. **`useAssistantContext`** registry hook (last-registered-wins, module-scope store modeled on
   scan-hotkey): pages register `{ page, station, selection, mode }`; per-page **skill
   fragments** registered the same way (station Q&A fragment on station pages, KPI/benchmark
   fragment on /operations, flow-display fragment on /studio). Context + fragment injected into
   the system prompt server-side per request.
4. **Client UI tools**: `navigate(path, params)` (router.push over URL-as-state), `highlight(ref)`
   — streamed to the client as tool calls the provider executes and acknowledges. Canvas-control
   tools stubbed but not wired (Phase 3).
5. Realtime plumbing (Ably channel per org/session) ready for Phase 3 applies.

HUMAN GATE 2: run the app locally (with applied Phase 0/1 migrations), demonstrate: ask "why are
units failing testing this week" on /operations and get a tool-grounded answer; ask it to take
you to a receiving PO and watch it navigate.

# PHASE 3 — AI write path + AI-first Studio refactor

Deliverables:

1. **`applyAgentMutation`** chokepoint (Deps-injected, heavily unit-tested): validates
   mutation_kind against the Phase 0 spec; enforces the trust classes — **auto-apply**:
   staff_rail_exclusion.*, feed_membership.state, entity_signal.insert, node_surface.config;
   **draft-scoped** (applies to a workflow DRAFT without review — the draft is the safety
   layer): workflow node/edge/config/surface edits; **review-gated** (lands as `proposed`):
   staff.create and anything touching masters or live definitions. One transaction through
   existing guarded helpers; `recordAudit` + ops_event + Ably emit on every apply; revert path
   (`status='reverted'`) for draft-scoped edits.
2. **Write tools** added to the registry (propose_mutation, apply/revert where trust allows),
   exposed to the agent loop; the system prompt teaches the trust model so the AI sets
   expectations correctly ("applied to your draft" vs "queued for review").
3. **AI-first Studio refactor** (invoke `ops-studio` skill first):
   - Dock absorbs StudioInspector: focused-node detail renders beneath the chat in the merged
     dock; the standalone w-72 inspector aside is removed on /studio; micro-tweaks (rename, one
     config field) stay in the dock's node detail.
   - Manual structural editing (Library drag-drop, NodeConfigForm/DecisionRulesEditor as primary
     entry points) demoted/hidden behind the dock's micro-tweak surface; the canvas becomes
     read-only live display + AI-driven draft preview. Do not delete the underlying
     editing/domain code — the AI write path calls the same guarded helpers.
   - **Canvas-control tools** wired: `focus_node`, `set_lens`, `set_zoom` (drive the existing
     `?v=&focus=&z=&lens=` URL state), `highlight`. Draft edits arriving over Ably repaint per
     the motion rules (overlay repaint, never crossfade the graph).
   - **AI-narrated simulate loop**: a tool that runs the existing client-side Simulate dry-run
     against the draft with sample/fake units and returns the structured result to the agent
     loop so it narrates the behavioral diff and diagnostics; iteration stays conversational.
   - **Publish untouched**: human-only, `studio.manage` + step-up + diagnostics gate. The AI may
     request it, never perform it.
4. **AI-edits tray** live: the dock lists the draft's agent_mutations (applied/pending/reverted)
   with check/revert affordances, realtime via Ably.

HUMAN GATE 3 (final): full gate suite green; a written honest status report (what works, what's
stubbed, every deviation from the plan doc); update the plan doc's status header to reflect
implemented phases; list the exact migrations awaiting apply and the suggested apply order. Then
STOP — Phases 4/5 are a separate run.

# Reporting discipline

Throughout: narrate phase transitions and load-bearing discoveries. If scouting contradicts the
plan (e.g. buyer notes are not in the mirror at all, ai_chat_sessions shape doesn't fit), surface
the conflict and the minimal-change resolution BEFORE building on an assumption — amend the plan
doc when you resolve it. Never report a gate as passing without pasting the actual command
results. If a locked decision proves impossible as specified, stop at the nearest HUMAN GATE with
options — do not silently substitute your own design.
