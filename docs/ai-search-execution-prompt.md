# Execution prompt — AI Search Modernization (Phase 0 + Phase 1)

> Paste everything below the line into a fresh Claude Code session. Re-runnable: if a prior session
> completed part of the work, the prompt instructs the model to audit what exists first and continue,
> not restart.

---

You are executing an already-ratified plan. **Do not re-litigate decisions, do not propose alternatives, do not write a new plan.** Your job is disciplined implementation with verification gates.

## Mission

Implement **Phase 0 (Foundations) and Phase 1 (CommandBar AI + tool calling)** of `docs/ai-search-modernization-plan.md` in this codebase. Phase 2 (removing old search UIs) is explicitly **out of scope** for this session — do not delete or hide any existing search bar.

## Step 0 — Load context before writing any code

Read, in this order:

1. `docs/ai-search-modernization-plan.md` — the whole doc. The **"Locked Decisions (2026-07-03, Q&A round 2)"** section overrides anything else in the doc that contradicts it (notably: cloud provider layer supersedes the old "local-only" premise).
2. `.claude/rules/polymorphic-tables.md` — the `entity_search_docs` table must follow this contract **exactly** (named CHECK discriminator, BIGINT `entity_id`, `entity_type`/`entity_id` naming, org-led indexes, delete-trigger family, `enforce_tenant_isolation()` in the same migration, Drizzle model in the same change).
3. `.claude/rules/backend-patterns.md` — route skeleton, `Deps` injection, `withTenantTransaction`, `recordAudit`, idempotency.
4. These existing modules — they are the reuse surface; **never reimplement what they already do**:
   - `src/app/api/global-search/route.ts` (the 5 entity searchers + result normalization + `createCrudHandler` caching)
   - `src/components/CommandBar.tsx` (debounce, abort, recents, cmdk groups, `ENTITY_ICONS`, `CmdRow`, "Ask AI")
   - `src/lib/search/sql-ranked-search.ts` (`buildTextSearchVariants`, `buildRankedSearchSql` — the keyword arm)
   - `src/lib/ai/hermes-tool-call.ts` (forced tool-calling, OpenAI wire format)
   - `src/lib/ai/context-fetchers.ts`, `src/lib/ai/intent-router.ts`
   - `src/lib/drizzle/schema.ts` (`pgVector` custom type — currently hardcoded 1536; you will parameterize or add a 768 variant without breaking `rag_document_chunks`)
   - One recent polymorphic migration for shape reference (e.g. `2026-06-18_photos_platform_side_tables.sql`) and `2026-07-01j_polymorphic_orphan_delete_triggers.sql` for the trigger-family pattern
5. Then audit for prior progress: check whether any of the deliverables below already exist (`src/lib/ai/provider.ts`, `entity_search_docs` migration, `/api/ai/retrieve`, etc.). Continue from where the last session stopped; never duplicate or fork an existing deliverable.

## Locked decisions you must honor (no deviation)

1. **Provider layer**: all LLM + embedding calls go through `src/lib/ai/provider.ts`, resolving `{ baseURL, apiKey, model }` per capability from env (`AI_CHAT_BASE_URL/MODEL/API_KEY`, `AI_EMBED_BASE_URL/MODEL/API_KEY`). Hermes local = dev config; **Vercel AI Gateway = prod default**. Never hardcode a provider URL or model name outside this module. Add the new env var names (blank) to `.env.example`; **never touch `.env`**.
2. **LLM model**: `anthropic/claude-haiku-4-5` via the gateway, only on the explicit "Ask AI" path.
3. **Embeddings**: 768 dims, `openai/text-embedding-3-small` with `dimensions: 768` in prod, `nomic-embed-text` in dev. Column is `vector(768)`. Do not disturb the existing 1536-dim RAG tables.
4. **Latency contract**: keystroke search is **hybrid only** — exact bypass → keyword (`sql-ranked-search` + pg_trgm) → pgvector cosine → RRF merge. **The LLM is never inline on the keystroke path.** The only per-keystroke cloud call is one query-embedding request (and even that must degrade gracefully: if the embed call fails or times out at ~300ms, return keyword-only results — never block or error the search).
5. **Freshness**: DB triggers on parent tables enqueue `(entity_type, entity_id, org)` into an outbox table; an async worker builds `search_text` + embeds. **Do not add `upsertSearchDoc` calls to domain helpers.**
6. **P0 entity scope**: exactly the 5 CommandBar entities — orders/shipments, `serial_units`, receiving, `sku_catalog`, repairs + FBA. Nothing else.
7. **SearchHit** is a strict superset of global-search's current result shape (`{ id, entityType, title, subtitle, href, matchField }` + `score`, `chips[]`, `facets?`, `actions?`), so CommandBar renders it with minimal change.

## Hard constraints (from CLAUDE.md — violations are failures)

- Work only on `main`. Never branch, never `git stash`, never commit or push unless I explicitly ask.
- Never touch Station scan bars or any scan-driven surface. Never remove exact-match fast paths.
- Tenant isolation everywhere: org-led indexes, GUC scoping (`withTenantTransaction` / `tenantQuery`), `orgId` from `ctx` never the body. Every vector query filters `organization_id` first.
- Never join `items` and `sku_catalog` on the SKU string. `items.name` is the title SoT.
- Migrations are **authored, not applied**: idempotent SQL file in `src/lib/migrations/` with a dated name. Use the `/db-migration-author` skill. Same for the backfill script — write it, don't run it against prod.
- New routes follow the house skeleton (use the `/new-route` skill): `withAuth(handler, { permission })` → Zod validate → domain helper → status map → `recordAudit` → `after()`. Register the permission in `permission-registry.ts` **and** its manifest test in the same change.
- Domain functions take injectable `Deps` (default real impls) so unit tests run DB-free (use the `/domain-unit-test` skill).
- UI: compose, never fork (`CmdRow`/CommandBar patterns); color from semantic tokens; no hardcoded hex or `z-[NNN]`; any new Tailwind class only in already-scanned paths.

## Deliverables, in build order

Work through these sequentially; each has a gate before moving on.

**D1 — Provider + embed layer**
- `src/lib/ai/provider.ts` (capability-keyed env resolution, typed config, loud error listing missing env vars when a capability is requested but unconfigured).
- `src/lib/ai/embed.ts` — `embedText(texts: string[], deps?) → number[][]`, batching, 768-dim assertion, timeout.
- Gate: DB-free unit tests for env resolution + dim assertion; `npx tsc --noEmit` clean.

**D2 — Schema**
- Migration creating `entity_search_docs` per the polymorphic contract: discriminator CHECK with exactly the P0 entity types, `search_text TEXT NOT NULL`, `embedding vector(768)` (nullable — keyword works before the worker embeds), denormalized facet columns (status, condition_grade, source_platform, relevant date), org-led unique index on `(organization_id, entity_type, entity_id)`, HNSW cosine index, `enforce_tenant_isolation()`, delete-trigger family for **every** P0 entity type in the same migration (no silent gaps — cite the `work_assignments` lesson).
- Same migration (or sibling file): `entity_search_outbox` table + BEFORE/AFTER INSERT-OR-UPDATE triggers on the 5 parent tables enqueueing into it (dedupe on pending `(org, entity_type, entity_id)`).
- Drizzle models for both tables in `src/lib/drizzle/schema.ts` in the same change, with the CHECK values documented in a comment.
- Gate: migration file is idempotent (re-runnable), reviewed against the contract point-by-point; Drizzle compiles.

**D3 — Search text + worker**
- `src/lib/search/build-search-text.ts` — `buildSearchText(entityType, row)` per P0 entity, mirroring the fields global-search already queries (titles via `items.name`, serials, tracking, source platform, notes). Pure functions, unit-tested with fixture rows.
- Outbox worker as a cron-style route (follow an existing cron route's auth pattern with `CRON_SECRET`): drain N outbox rows → load parent rows org-scoped → `buildSearchText` → `embedText` (best-effort; on embed failure still upsert the doc with `search_text` and leave `embedding` NULL for retry) → upsert docs. Idempotent, bounded batch size.
- Org-scoped backfill script under `scripts/` (write only; it enqueues into the outbox rather than embedding inline, so the worker is the single embed path).
- Gate: worker domain function unit-tested via `Deps` fakes (captures upserts, simulates embed failure).

**D4 — Hybrid retrieval + tools**
- `SearchHit` type in `src/lib/search/search-hit.ts` (superset rule above).
- `src/lib/search/hybrid-retrieval.ts` — `hybridSearch(orgId, query, opts)`: (a) exact/ID/serial bypass reusing the existing last-8 + exact logic (extract from global-search into a shared helper rather than duplicating), (b) keyword arm via `buildTextSearchVariants` over `entity_search_docs.search_text` + facet columns, (c) vector arm `1 - (embedding <=> $1)` org-filtered, (d) RRF merge, (e) map to `SearchHit[]` with facet chips. `Deps`-injected; the embed call is optional/failable per the latency contract.
- `src/lib/ai/search-tools.ts` — tool registry: `exactIdSerialSearch`, `hybridEntitySearch(query, entityTypes?, facets?)`, plus 1–2 typed wrappers (e.g. `searchUnits`). Tools return only `SearchHit[]`. Wire `hermesToolCall` orchestration for the Ask-AI path only.
- Gate: unit tests for RRF merge determinism, exact-bypass short-circuit, embed-failure → keyword-only degradation.

**D5 — API route**
- `/api/ai/retrieve` via the house skeleton: input `{ query, entityTypes?, limit?, pageContext? }` (Zod), calls `hybridSearch`, output `{ hits, usedSemantic: boolean }`. New permission registered + manifest test updated. `recordAudit` on the Ask-AI/LLM variant only (don't audit-spam every keystroke — use a read permission and skip audit on plain retrieval; audit the tool-calling invocation).
- Gate: run the `api-route-reviewer` and `permission-registry-guard` agents on the diff; fix findings.

**D6 — CommandBar wiring**
- Evolve `CommandBar.tsx`: query the new retrieve endpoint; **merge with (do not remove) existing global-search results during transition** — dedupe by `(entityType, id)`, prefer the hit with the higher score/richer chips. Preserve debounce, abort, recents, `shouldFilter={false}`, `ENTITY_ICONS`, `CmdRow`, and the "Ask AI" group exactly. Render new chips through existing chip conventions. Behind a flag (`readBoolEnv('AI_SEARCH_COMMANDBAR', false)` or per-org `resolveForOrg`) so rollback is an env flip.
- Gate: `npx tsc --noEmit` + production build clean; `test:ds-guards` passes; with the flag off, CommandBar behavior is byte-identical.

**D7 — Final verification + report**
- Full: typecheck, build, all new unit tests, ds-guards.
- Run the `neon-cost-reviewer` agent over the diff (vector queries + outbox polling are exactly its beat); address findings.
- Update `docs/ai-search-modernization-plan.md`: mark Phase 0/1 items shipped, note anything deliberately deferred.
- Final report: what shipped (file list), what's deploy-gated (migrations to apply, env vars to set — name them exactly, including the AI Gateway key), what's flagged off, and the precise runbook order: apply migration → set env → run backfill script → enable worker cron → flip `AI_SEARCH_COMMANDBAR`.

## Working style

- Use the repo's skills where they exist (`/db-migration-author`, `/new-route`, `/domain-unit-test`) instead of hand-rolling those artifacts.
- After each deliverable's gate passes, state the checkpoint in one line and move on; don't ask permission between deliverables.
- If you hit a genuine contradiction between the plan and the codebase (e.g. a parent table's PK isn't what the plan assumed), resolve it in favor of the codebase, note it in the final report, and keep moving — do not stop to ask unless the choice is destructive or changes a locked decision.
- If the session runs long, prioritize finishing the current deliverable + its gate over starting the next; the prompt is re-runnable.
