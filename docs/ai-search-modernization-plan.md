# AI Search Modernization Plan

**Goal:** Replace the current fragmented exact-string / per-field search pattern across pointer-driven surfaces with a modern, local-model-powered AI search experience featuring:

- Natural language queries
- Per-page context injection
- Hybrid (keyword + semantic) retrieval
- Structured tool calling that produces "tool-calling friendly" result tables
- Progressive reduction (and eventual removal) of narrow search bars where they add friction

**Provider-agnostic, cloud-default.** (Supersedes the earlier "local-only" premise — Vercel prod can't reach the LAN Hermes box.) One provider-config layer (`src/lib/ai/provider.ts`) resolves `{ baseURL, apiKey, model }` per capability from env; Hermes local is the dev config, **Vercel AI Gateway is the prod default** (token/spend tracking + provider fallbacks built in).

**Status:** Phase 0 + Phase 1 **LIVE-CAPABLE 2026-07-03**: migration 2026-07-03d **APPLIED** (RLS forced, triggers verified — no-op UPDATE enqueues 0, real change enqueues 1), backfill enqueued + drained (**7,618 docs live, keyword-only** — embeddings NULL until `AI_EMBED_*` is set), tenancy coverage regenerated. Remaining go-live steps: set `AI_EMBED_*` env (+ redeploy → cron activates → docs re-embed via backfill re-run), grant `ai.search` to roles, flip `AI_SEARCH_COMMANDBAR`.
**Phase 2 SUBSTANTIALLY COMPLETE 2026-07-04**: 2a per-page context (pageContext → soft entity-type boost, never a filter, `src/lib/search/page-context.ts`), 2b Ask-AI inline results in CommandBar (mode:'ask' hits render in the palette; chat deep-link kept as fallback + follow-up), 2c chat tool reuse (`src/lib/ai/search-context.ts` — /api/ai/chat grounds retrieval-shaped questions in hybridSearch hits; SERIAL_UNIT deep-link closed via `?unit=`), and 2d workbench conversions: shared client bridge (`src/lib/search/ai-search-client.ts` — one flag probe + retrieve POST, CommandBar deduped onto it), `useAiQuickJump` hook + `AiQuickJumpResults` shared SearchHit row list, wired into **ShippedSidebar** (dashboard) and **InventorySidebar** (cross-entity quick-jump band alongside the classic results), and the inventory per-tab "Search By" grid collapses behind an **Advanced** disclosure when the flag is on (`'all'` already searches every column; auto-expands when a non-default field is active). The shipped field selector already lives behind the Filters popover (= §8.3 collapsed state). All 2d behavior rides the same `AI_SEARCH_COMMANDBAR` flag — off = byte-identical surfaces.
**Phase 3 STARTED 2026-07-04**: keyword arm EXPLAIN-verified on the live index and rewritten to hit the trgm GIN (predicates textually match `lower(search_text)`; "samsung galaxy" 145.9ms → 0.4ms — the BTRIM/raw-ILIKE shapes forced a Seq Scan); embedding retry sweep (`sweepEmbeddingRetries` — the search-outbox cron re-enqueues stale NULL-embedding docs, so failed embeds and the pre-env backfill heal without a parent touch; no-op while embeds unconfigured); AI-suggested filter application v1 (§8.4 — `searchScopeHref` maps Ask-AI's distilled scope to the target list surface's own URL filter: dashboard `?search=`, inventory `?q=`; CommandBar renders "View all in <surface>"); search documented as a **source-of-truth invariant** (`.claude/rules/source-of-truth.md` → "Cross-entity search"). Provider flip / re-embed runbook: re-run `scripts/backfill-entity-search-docs.mjs` (enqueue-only; the worker re-embeds).
**Adversarial review 2026-07-04** (20-agent find→refute workflow over the whole diff): 13 confirmed findings, all fixed same-day — headline: the outbox claim→mark dedupe race (a parent write during a drain was silently lost; fixed via `claimed_at` claim-window in migration **2026-07-04a**, APPLIED + live-verified), attempts cap + dead-lettering (poison rows can't starve the queue), line-table freshness triggers (`receiving_lines` / `fba_shipment_items` re-enqueue their header docs — carton/shipment line text no longer indexes blank), exact-bypass now respects hard `entityTypes` scopes (searchUnits can't return cross-type parent hits), Ask-AI staleness guard, quick-jump abort-on-clear, cron overlap lock, LLM tool-arg coercion, `repair_service.source_system` trigger coverage.
**Per-org AI + /search shipped 2026-07-04 (user directive — supersedes global env wiring for tenants)**:
- **Per-org provider resolution** (`src/lib/ai/org-provider.ts`): BYOK vault rows in `organization_integrations` (new providers `ai_gateway`/`openai`/`anthropic`; `ollama` = self-hosted slot; KMS-encrypted, 5-min cached) → platform-metered env default → null = keyword-only fallback. All consumers rewired (query embeds, worker doc embeds, Ask-AI). Connecting/switching a provider auto-re-embeds the org's corpus (`enqueueOrgReembed` hook in the vault upsert route; `entity_search_docs.embedded_model` stamps the embedding space).
- **Usage metering + price breakdown**: `ai_usage_events` (migration 2026-07-04b, APPLIED, FORCE RLS) written at every embed/Ask-AI call; per-org margin is DB-first (`organizations.settings.aiUsageMarginPercent`, env `AI_USAGE_MARGIN_PERCENT` default); **Settings → AI** page (`/settings/ai`, admin.view) shows active providers per capability + usage table + estimated vs billed (margin on platform-carried usage only, BYOK at cost); `GET /api/ai/usage` for programmatic access.
- **Stripe margin billing**: `reportAiUsageToStripe` (`src/lib/billing/ai-meter-reporter.ts`, daily via cleanup cron) pushes billed cents per org to a Stripe Billing Meter — no-op until `STRIPE_AI_METER_EVENT_NAME` is set; orgs without a stripe_customer_id stay unreported until billing setup. Idempotent (row-range identifiers + stripe_reported_at).
- **/search results page** (Shopify-style): `?q=`/`?type=` URL state, Overview tab groups all categories with counts + "View all", per-category tabs re-query with hard scopes, rows via the shared SearchHit renderer, ⌘K "See all results" hands off. Keyword-only for unlinked tenants by construction; 403 = teaching state.
- Tenant identity is DB-resolved everywhere (organizations / organization_integrations / organization_feature_flags rows) — no org constants in any new module.

**Remaining (Phase 3 tail)**: hard DELETION of `inventory-search.ts` / `shipped-search.ts` field configs + `?field=` params — sequenced after `AI_SEARCH_COMMANDBAR` flips on (the selectors are the live UX until then; deleting first would strand users with neither), richer SearchHit `actions[]`, Monitor/Canvas AI inputs, Upstash-backed retrieve cache if metrics warrant. Phase 4 (proactive agent search) rides the universal-feed agent surface.
**Updated 2026-07-03 with explicit priorities + locked decisions (see below).**
**Related docs:**
- `docs/ai-automation-opportunities-plan.md`
- `docs/todo/ai-chat-ux-plan.md`
- `.claude/rules/polymorphic-tables.md`, `.claude/rules/backend-patterns.md`, `.claude/rules/contextual-display.md`
- `CLAUDE.md`

## User-Confirmed Priorities (2026-07-03)

1. **P1 surface**: CommandBar / global `⌘K` first.
2. **Aggressiveness**: Update everything — aim for full removal of old exact/per-field search bars and complete transition to industry-standard AI search on non-station surfaces.
3. **Full remove**: Replace narrow search controls with the new AI experience (industry standard: one contextual NL box + structured results).
4. **Schema**: Use a new `entity_search_docs` polymorphic table (follow `.claude/rules/polymorphic-tables.md` contract exactly).
5. **Patterns**: Follow existing codebase patterns (see Section 5.1 "Best Patterns to Follow").
6. **Long-term**: See Section 12 "Recommended Long-Term Architecture".

## Locked Decisions (2026-07-03, Q&A round 2)

1. **Provider infra**: Cloud connectors via a single provider-config layer — `src/lib/ai/provider.ts` resolving
   `{ baseURL, apiKey, model }` per capability (`AI_CHAT_*`, `AI_EMBED_*` env sets). Hermes = local/dev config of the
   same layer (already OpenAI-compatible, so `hermes-tool-call.ts` ports unchanged). Prod routes through
   **Vercel AI Gateway** (one key, model strings, token-consumption accounting, fallbacks) rather than hand-built
   per-provider connectors — Anthropic doesn't speak the OpenAI wire format natively; the gateway erases that.
2. **LLM default (Ask AI path)**: `anthropic/claude-haiku-4-5` via AI Gateway for tool routing (fast, cheap, strong
   forced-tool-call discipline).
3. **Embeddings**: Hosted, pinned at **768 dims** (`openai/text-embedding-3-small` with `dimensions: 768`), so
   `embedding vector(768)` stays interchangeable with local `nomic-embed-text` (natively 768) — provider flip = re-embed
   job, no schema change. Dodges the 1536-dim RAG collision.
4. **Latency / LLM-in-loop**: **Hybrid always, LLM never inline.** Keystroke search = exact bypass + keyword
   (`sql-ranked-search` + trgm) + pgvector cosine + RRF, sub-500ms. LLM tool-calling fires only on explicit
   Enter/"Ask AI" or a complex-NL heuristic. Per-keystroke cloud cost = one query-embedding call only.
5. **Doc freshness**: **DB trigger → outbox → worker.** Triggers on parent tables enqueue `(entity_type, entity_id)`;
   a worker builds `search_text` + embeds async. Zero changes to existing domain helpers; can't be forgotten at new
   write sites. (Supersedes "call `upsertSearchDoc` in every domain helper.")
6. **Phase-2 deletion depth**: **Delete the UI, keep the query libs as tools.** Field dropdowns/configs go; the
   shipped-search / inventory-search query logic survives as the typed fast-path tools behind the AI box.
7. **P0 backfill scope**: exactly the **5 CommandBar entities** global-search covers today — orders/shipments,
   serial_units, receiving, sku_catalog, repairs+FBA. Parity from day one; P1 list unchanged.

## Phase 0/1 Shipped (2026-07-03, code-complete — deploy-gated)

Everything below is in the tree; nothing is live until the runbook runs (migration → env → backfill →
cron → flag). All honoring the Locked Decisions above.

- **Provider layer**: `src/lib/ai/provider.ts` (`resolveAiConfig('chat'|'embed')`, `EMBEDDING_DIMS=768`,
  loud missing-env errors, Hermes legacy fallback for chat) + `src/lib/ai/embed.ts` (`embedText` — batching,
  768-dim assertion, abort timeout). Unit-tested (`test:ai-search`).
- **Schema**: migration `src/lib/migrations/2026-07-03d_entity_search_docs.sql` — `entity_search_docs`
  (per the polymorphic contract: named CHECK over ORDER|SERIAL_UNIT|RECEIVING|SKU|REPAIR|FBA_SHIPMENT,
  BIGINT entity_id, org-led natural unique, trgm GIN + HNSW cosine indexes, tenant-from-birth) +
  `entity_search_outbox` (pending partial unique) + enqueue triggers (AFTER INSERT OR UPDATE OF
  searchable columns on all 6 parents) + delete-trigger family covering every discriminator value.
  Drizzle models (`entitySearchDocs`, `entitySearchOutbox`, `pgVector768`) in the same change.
- **Freshness pipeline**: `src/lib/search/build-search-text.ts` (pure per-entity builders; serial-unit
  titles prefer `items.name` via zoho_item_id), `src/lib/search/search-outbox-worker.ts`
  (`drainSearchOutbox`, Deps-injected, embed best-effort → keyword-fresh docs with NULL embedding),
  cron `/api/cron/search-outbox` (vercel.json: every 5 min), backfill
  `scripts/backfill-entity-search-docs.mjs` (enqueue-only; worker stays the single embed path).
- **Hybrid engine**: `src/lib/search/search-hit.ts` (SearchHit superset + DB↔UI vocab + href SoT),
  `src/lib/search/global-entity-search.ts` (the 5 global-search searchers extracted verbatim = the
  exact bypass), `src/lib/search/hybrid-retrieval.ts` (identifier bypass short-circuit → keyword
  (`sql-ranked-search` + trgm) + vector (org-filtered cosine) → RRF k=60, deterministic; ~300ms embed
  budget, keyword-only degradation), `src/lib/ai/search-tools.ts` (tool registry + `runAskAiSearch`
  forced tool call via provider layer).
- **API**: `POST /api/ai/retrieve` (`withAuth` + NEW permission `ai.search`; Zod body; mode
  `retrieve` = un-audited keystroke path, mode `ask` = LLM path with `AI_SEARCH_ASK` audit +
  Redis-backed rate limit; GET = flag probe). Manifest + regression test updated.
- **CommandBar**: flag-gated (`AI_SEARCH_COMMANDBAR` / per-org `ai_search_commandbar` via
  `isAiSearchCommandbar`) merge of AI hits with classic global-search rows, deduped by
  (entityType, id); facet chips render through the house 3-layer chip classes in `CmdRow`;
  debounce/abort/recents/`shouldFilter={false}`/Ask-AI preserved. Flag off = classic path unchanged.

**Deliberately deferred (not silently dropped):**
- Per-page context injection — `pageContext` is accepted+bounded by the route schema but unconsumed.
- ~~SERIAL_UNIT deep-link~~ — CLOSED in Phase 2: unit hits deep-link to
  `/inventory/units?unit=<id>` (the workbench's existing ByUnitView param).
- Join-table freshness: changes ONLY to `tech_serial_numbers` / `shipping_tracking_numbers` don't
  re-enqueue their order's doc (triggers live on the 6 parents per locked decision 5); they surface on
  the next parent write or backfill sweep.
- Chat reuse of the search tools, "AI enhanced" badges beyond facet chips, `searchReceiving`-style
  extra typed wrappers — Phase 2.
- `scripts/seed-roles.mjs` doesn't grant `ai.search` (pre-existing registry drift; runtime admins get
  it via live-registry computation — grant to non-admin roles in the Roles editor when rolling out).

---

## 1. Executive Summary

The current search system is highly specialized and exact:

- Many independent implementations (`inventory-search.ts`, `shipped-search.ts`, `global-search/route.ts`, receiving logs search, sku-search, repair search, etc.).
- Field-specific selectors ("search by SKU only", "serial only", "bin barcode", last-8-digits hacks).
- Global Cmd+K (`CommandBar`) already calls `/api/global-search` (classic ILIKE + aggregates).
- `/api/ai/search` exists but is mostly a context-snapshot summarizer.
- Real vector search is limited to document RAG (`rag_document_chunks`) and still uses Gemini embeddings.

This works for barcode-driven station work but creates friction everywhere else.

**Target state (local AI):**
- **CommandBar (⌘K global search) is the primary and eventually the only prominent search surface** for cross-entity discovery.
- All other non-station pointer-driven surfaces (workbenches, monitors, sidebars) move to contextual AI search inputs powered by the same engine.
- LLM routes through a small registry of **typed search tools**.
- Tools return compact, typed `SearchHit[]` that are directly consumable by tables, rails, CommandBar, and future agents.
- Strong per-page + per-commandbar context injection.
- Exact ID/serial paths remain as an ultra-fast deterministic bypass (never removed).
- **Full removal** of the old per-tab field-specific search bars, "search by SKU only", "serial only", etc. on Workbench/Monitor/Canvas (industry standard: one natural-language box + rich structured results + facets).

**Non-goals (ever for core flows):**
- Touching Station scan bars (literal, focus-locked scanners per archetypes).
- Removing exact-match fast paths for serials/IDs/barcodes.

---

## 2. Current State Diagnosis

### 2.1 Search surfaces today

| Area | Implementation style | Pain |
|------|----------------------|------|
| Inventory sidebar tabs | `lib/inventory-search.ts` + per-tab field configs + buckets | Very specific, many dropdowns |
| Shipped / dashboard | `shipped-search.ts` + `useShippedSearch` | Field + type filters |
| Global Cmd+K | `/api/global-search` (ILIKE + last-8 + joins) + CommandBar | Good start, still keyword only |
| Receiving history | Dedicated search route + modes | Fragmented |
| Receiving / tech / repair | Various inline + sku-search endpoints | Inconsistent UX |
| `/api/ai/search` | Snapshot + Hermes JSON prompt | Not true retrieval |
| RAG | `rag_document_chunks` + Gemini embeddings + pgvector | Only for documents; cloud embedding |

### 2.2 Existing AI foundation (strong)

- Hermes local OpenAI-compatible gateway (tool calling supported via `hermes-tool-call.ts`).
- Intent detection + context fetchers (`intent-router.ts`, `context-fetchers.ts`, `buildContextBlock`).
- Deterministic "local ops" answers in `ops-assistant.ts`.
- Partial pgvector usage (1536 dim from Gemini).
- Chat already mixes deterministic + RAG + LLM.
- `CommandBar` already has an "Ask AI" path.

**Opportunity:** Turn the existing chat patterns into the **primary search mechanism** for the whole app, with proper retrieval tools instead of just context snapshots.

### 2.3 Why "remove search bars" is the right direction

Current design is the opposite of modern industry practice (Linear, Notion AI, modern warehouse systems, Raycast-style tools):

- Modern = **one natural language box** that understands context + returns structured results you can act on.
- Tables become surfaces that accept structured filter objects from the AI layer.

---

## 3. Goals & Success Criteria

### Primary goals (in priority order)

1. **Dramatically better recall for complex / natural queries** ("Samsung phones in fair condition received from eBay in June that are still in triage").
2. **Reduce UI fragmentation** — converge on fewer search inputs powered by the same backend tools.
3. **Create reusable, tool-calling friendly search primitives** that chat, future agents, and UI can all consume.
4. **Keep (and improve) lightning-fast exact paths** for IDs, serials, and scanner use cases.
5. **Per-page contextual intelligence** without leaking org boundaries.

### Success metrics (suggested)

- One major surface (e.g. Inventory or Global CommandBar) using the new AI search as the default within 6–8 weeks.
- Measurable reduction in "can't find the unit/order" friction.
- Chat can call the same search tools that the UI uses.
- Traditional per-tab field selectors are secondary or hidden on the prioritized surfaces.

---

## 4. Architecture Principles (Must Follow)

All work **must** obey the project invariants:

- **Archetypes** (see `.claude/rules/contextual-display.md`):
  - **Station**: Never replace the focus-locked scan bar. AI can only be secondary/post-scan.
  - **Workbench / Monitor / Canvas**: AI search is a great fit. Use SidebarRailShell patterns where lists exist.
- **Backend patterns**: Thin routes → domain helpers with `Deps` injection → `withTenantTransaction` → `recordAudit`.
- **Tenant isolation** is non-negotiable everywhere (GUC + explicit scoping).
- **Source of truth** and existing mappers stay authoritative.
- **Hermes** remains the LLM/runtime. Add local embeddings beside it.

**Hybrid retrieval model (recommended):**

1. Fast exact bypass for serial-like / ID-like input (always first).
2. Keyword (Postgres tsvector or improved ILIKE + ranking).
3. Semantic (local embeddings + pgvector cosine).
4. Optional LLM tool routing / re-ranking when query is complex.
5. Return small, stable `SearchHit[]` shapes.

---

## 5. Recommended Local Stack + Codebase Patterns

### 5.1 Best Patterns to Follow (from codebase scan)

After scanning the repo, here are the canonical patterns you should mirror:

**Polymorphic / typed-fact tables (for `entity_search_docs`):**
- Follow `.claude/rules/polymorphic-tables.md` 100% (the ratified contract).
- Best references: `photo_entity_links` (clean `entity_type` + `entity_id` + extra axis `link_role`, org-led unique indexes, modeled in Drizzle) and `part_links`.
- `work_assignments` uses a pg ENUM for a small stable set — **do not** copy for new tables. Use named CHECK constraint + `DO $$` guard.
- Always: `organization_id UUID NOT NULL`, `entity_type TEXT`, `entity_id BIGINT`, tenant-from-birth `enforce_tenant_isolation()`, org-first indexes, parent-delete triggers when needed.
- Model immediately in `src/lib/drizzle/schema.ts`.
- Existence validation in app layer (domain helper), not DB trigger.

**Result normalization & rendering:**
- Global search (`src/app/api/global-search/route.ts`) already normalizes heterogeneous entities into a flat `{ id, entityType, title, subtitle, href, ... }` shape.
- `CommandBar.tsx` consumes this and maps `entityType → Icon` + uses `CmdRow`.
- **New pattern**: Extend to richer `SearchHit` with `score`, `chips[]`, `facets`, `actions[]`. Keep the same rendering path in CommandBar. Create a shared `SearchResultRow` component.

**Tool calling:**
- `src/lib/ai/hermes-tool-call.ts` + `hermesToolCall<T>()` — forces `tool_choice: 'required'`, temperature 0, parses args. Use this for any LLM-orchestrated search.
- Proven in PO extraction. Put tool schemas in `search-tools.ts`.

**Context injection:**
- `src/lib/ai/context-fetchers.ts` + `buildContextBlock(intents, params, orgId)`.
- Pattern: domain-specific fetchers that return prompt-ready text blocks.
- New work: add `getCommandBarContext(query, orgId)` + page-specific `getWorkbenchContext(...)` etc.

**Search infrastructure:**
- `createCrudHandler` (used by global-search) for caching + unified list/search.
- Heavy searches often use raw `tenantQuery` for complex joins/aggregates — fine, but wrap in domain helpers with `Deps`.
- `tenantQuery(orgId, sql, params)` is the tenant-safe primitive.

**Embedding / vector:**
- Only example: `ragDocumentChunks` + custom `pgVector` type (currently hardcoded 1536) in schema.ts.
- Pattern: store as `embedding: pgVector('embedding').notNull()`, org-scoped indexes. Generation happens outside hot path (we will do the same).

**Domain + testability:**
- Public functions accept `Deps` (default real impls) so unit tests can run without DB (`domain-unit-test` skill).

**UI composition:**
- For any new list of results: wrap `SidebarRailShell` or reuse CommandBar/CmdRow patterns. Do not fork new list components.

### 5.2 Local Stack Choices

| Component | Choice | Notes |
|-----------|--------|-------|
| LLM + tool calling | Provider layer: Hermes (dev) / AI Gateway `anthropic/claude-haiku-4-5` (prod) | Use `hermesToolCall` for forced calls (OpenAI wire format either way). |
| Embeddings | Provider layer: `openai/text-embedding-3-small` @ 768 (prod) / Ollama `nomic-embed-text` (dev) | 768-dim pinned. Create `src/lib/ai/embed.ts` behind `provider.ts`. |
| Vector storage | pgvector | Via new `entity_search_docs`. |
| Keyword | Improve Postgres (tsvector + trigram or current ILIKE + ranking) + hybrid scoring (RRF). |
| Orchestration | `src/lib/ai/search-tools.ts` + `hybrid-retrieval.ts` | Single source for all search. |

**Dimension note:** Plan a controlled transition (re-embed RAG documents or keep dual embedding columns temporarily).

---

## 5.3 Deep Codebase Pattern Analysis (Expanded from Scans)

After extensive deep search (greps across src/lib, src/app/api, src/components, src/hooks; full reads of CommandBar, global-search, ai/* files, sql-ranked-search, shipped/inventory-search, polymorphic schema, migrations for trgm/rag/vector/polymorphic, SidebarRailShell, createCrudHandler, intent-router, etc.), here are concrete, actionable details.

### Current Search Landscape — Fragmentation Inventory

The app has **highly specialized, per-surface exact/fuzzy search**:

- **Global/Cmd+K**: `src/app/api/global-search/route.ts` + `src/components/CommandBar.tsx`
  - Uses `createCrudHandler` (org-scoped cache via `cacheNamespace: \`api:global-search:${orgId}\``).
  - 5 per-entity SQL functions (`searchOrders`, `searchRepairs`, `searchFba`, `searchReceiving`, `searchSkus`).
  - Heavy use of `ILIKE %query%`, `CAST(id AS TEXT) =`, last-8 digit extraction via `regexp_replace` + `RIGHT`, aggregates for serials per order (`STRING_AGG`), joins to `tech_serial_numbers` and `shipping_tracking_numbers`.
  - Normalization to `{id, entityType, title, subtitle, href, matchField}`.
  - Client: debounced fetch, mixes static nav (filtered client-side), recents in localStorage, "Ask AI" that just does `router.push('/ai-chat?q=...')`.
  - Icons via `ENTITY_ICONS` map. Renders in `Command.Group`.

- **Shipped / Dashboard**: `src/lib/shipped-search.ts`, `useShippedSearch`, `ShippedFilterDropdown`.
  - Field configs with `fuzzyEnabled`, `fuzzyMinQueryLength`.
  - `all` / `order_id` / `tracking` / `product_title` / `sku` / `serial_number`.
  - Uses `src/lib/search/sql-ranked-search.ts` for ranked variants + pg_trgm similarity.

- **Inventory Workbench (sidebar tabs)**: `src/lib/inventory-search.ts`
  - 8 tabs: activity, bins, skus, units, alerts, counts, triage, pulse.
  - Per-tab `SearchFieldForTab` unions (e.g. `BinSearchField = 'all' | 'bin_barcode' | 'zone' | 'room' | 'sku_contained'`).
  - Very specific helpers + buckets. Mirrors shipped-search structure for alignment.

- **Other surfaces**:
  - Receiving history: `receiving-history-search.ts` + modes.
  - SKU catalog: trigram similarity in `sku-catalog-queries.ts`, pairing routes.
  - Product manuals: dedicated search route with trgm.
  - Repair, tech, FBA, assignments: dedicated `/search` or inline queries with ILIKE.
  - Many places still fall back to raw `tenantQuery` with complex ad-hoc SQL.

**Pain points observed**:
- Duplication of last-8 / normalized / serial aggregation logic.
- Field dropdowns force users into "search by X only".
- No unified result shape beyond global-search.
- No semantic (only keyword + limited trgm fuzzy).
- AI search (`/api/ai/search`) currently just takes a snapshot `context` and prompts Hermes — no retrieval.

### Existing Fuzzy + Ranked Search Primitives (High Reuse Value)

The codebase already has sophisticated keyword fuzzy support — **do not reinvent**:

- `src/lib/search/sql-ranked-search.ts`:
  ```ts
  buildTextSearchVariants({ expression, exactParam, prefixParam, likeParam, fuzzyParam, ... })
  // Produces RankedSearchVariant[] with predicates + scores for exact / prefix / ILIKE / pg_trgm similarity + word_similarity
  buildRankedSearchSql(variants) → { whereClause, rankClause } using GREATEST(CASE WHEN ... )
  ```
- pg_trgm already enabled (migrations: `2026-04-02_enable_pg_trgm_for_shipped_search.sql`, `2026-04-10_sku_catalog_trgm_index.sql`, `2026-05-25_sku_pairing_hub.sql`).
  - GIN indexes: `USING gin (lower(product_title) gin_trgm_ops)`, same for sku, serial_number, tracking_number_raw.
  - Usage: `similarity(...)`, `word_similarity(...)` in receiving-lines, sku pairing, shipped queries.
  - Fallback handling in `orders-queries.ts` when pg_trgm not available.

- RAG vector search (`/api/rag/search` + migration `2026-05-24_rag_tables.sql`):
  - `vector(1536)`, HNSW index `USING hnsw (embedding vector_cosine_ops)`.
  - Query: `1 - (embedding <=> $1::vector) AS similarity`.
  - Tables use GUC default for organization_id + explicit org filter.

**Opportunity**: For the new hybrid engine, use `buildTextSearchVariants` + pg_trgm as the **keyword arm**, pgvector cosine on `entity_search_docs.search_text` embedding as the **semantic arm**, then combine (RRF or weighted score). Extend the ranked builder to support a vector score variant.

### AI / Context / Tool Calling Deep Details

- **Intent routing** (`intent-router.ts`): Regex-based DOMAIN_RULES for 'orders', 'shipped', 'staff', 'repair', 'receiving', 'fba', 'inventory', 'exceptions', 'photos', 'bose_manual'. Plus STAFF_QUESTION_HINTS and REPAIR_STATUS_MAP.
- **Context fetchers** (`context-fetchers.ts`): Many `fetchXxxContext` functions using pool/tenantQuery + work_assignments joins (note: uses string 'ORDER' not enum in some places). Builds blocks like "=== ORDER LOOKUP (live) ===" with live data. Ends in `buildContextBlock`.
- **Hermes tool calling** (`hermes-tool-call.ts`): Forces single tool via `tool_choice: 'required'`. Parses `message.tool_calls[0].function.arguments` as JSON. Temperature 0 by default. Used for disciplined arg extraction (e.g. PO fields).
- Existing `/api/ai/search`: Takes `{page, query, context}`, sends snapshot to Hermes, expects JSON `{answer, matches, followUpQuestions, confidence}`. Legacy note in code.
- Chat has "local ops" deterministic path before LLM.

**Pattern for new AI search**: Extend intent + context fetchers. For CommandBar/P1, create a lightweight `getCommandBarContext(orgId, query)` that pulls recent activity + broad signals. For page contexts, inject URL state + selected items.

### UI List Consumption Patterns (Perfect for SearchHit Results)

- `SidebarRailShell` + `RecentActivityRailBase`: Generic engine for fetch, optimistic updates, pinning, grouping, keyboard nav, hover popovers. Supplies `renderRowMain`, `renderPopover`, `getStatusDot`, etc.
  - Receiving/testing/FBA rails wrap it.
  - **Strong fit**: After AI search returns `SearchHit[]`, render them via a thin wrapper that supplies renderers for the new hit shape. Use `getId`, `onSelect` (to navigate + save recent).
- Rails emphasize: one-row anatomy (title + meta + chips), `bg-blue-50 ring` for selection, `HoverTooltip` for details. No size shift on select.
- CommandBar already demonstrates mixing search results into cmdk groups with icons.

**Recommendation**: Create `AiSearchResultRow` or extend existing that renders `SearchHit` (title, subtitle/chips from facets, score badge optionally). Feed directly into rails or a dedicated results list in CommandBar.

### Polymorphic + Tenant + Migration Patterns

- `photo_entity_links`: Cleanest. `entity_type TEXT`, `entity_id BIGINT`, `link_role`, orgId, unique on (photo_id, entity_type, entity_id, link_role). No polymorphic FK.
- Migrations for polymorphic (e.g. `2026-06-18_photos_platform_side_tables.sql`): Named CHECK constraints with `DO $$ ... EXCEPTION WHEN duplicate_object`.
- Tenant-from-birth: `enforce_tenant_isolation('table_name')` calls in migration (after table create). Many examples in 2026-06-*_enforce_tenant_isolation_* files.
- Vector tables (rag): GUC default `DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid`, plus explicit `WHERE organization_id = $x`.
- HNSW for vectors, org indexes first.

For `entity_search_docs`:
- Follow photo_entity_links + the full contract.
- Add `search_text TEXT NOT NULL`, `embedding vector(768)`, plus denormalized filter columns (condition_grade, status, source_platform, received_at date, etc.) so hybrid can combine vector + structured filters without LLM.
- Write a family of delete triggers: `trg_delete_search_doc_on_<parent>_delete`.

### createCrudHandler + Domain Style

- Used in global-search for tenant-bound list/search with caching.
- `buildHandler(orgId)` pattern — per-request closure over orgId.
- Many CRUD routes use it. Good candidate for a new `/api/ai/retrieve` or evolve global-search to delegate to AI tools internally.

### Other Notable Details

- Lots of denormalization (intake_type, account_source, etc.) — mirror this when building `search_text`.
- sku_catalog vs items name collision explicitly documented (never join on SKU string).
- Station vs workbench separation is strict — any new AI bar must respect archetypes (no scanner replacement).
- Recents, keyboard, motion (framerPresence) are polished in CommandBar — preserve/extend.

This analysis shows we are **not starting from zero**. The upgrade is largely:
- Centralize around `entity_search_docs` + hybrid that reuses `sql-ranked-search` + pg_trgm + new vectors.
- Evolve CommandBar's data source.
- Unify result shapes.
- Layer LLM tool calling + page context on top.
- Delete the fragmented field configs in later phases.

---

## 6. Data & Schema Changes

### 6.1 What to embed

Priority order (CommandBar global first means we need broad coverage early):

**P0 (CommandBar + core entities)**
- `sku_catalog` + product titles
- `serial_units` (serial, sku, condition, status, location summary)
- Orders + shipments (order_id, title, sku, tracking, source, status)
- Receiving + exceptions (tracking, title, notes, source_platform)
- FBA shipments, repairs

**P1**
- Notes, exceptions, key audit facts, repair outcomes
- Bins / locations
- SKU stock / availability facts

**Later / selective**
- High-volume `inventory_events` — only interesting/summary events. Never every row.

### 6.2 Schema approach (confirmed)

**Use `entity_search_docs`** — a new polymorphic typed-fact table following the contract in `.claude/rules/polymorphic-tables.md` **exactly**.

- Discriminator: `entity_type` TEXT with named CHECK constraint.
- `entity_id` BIGINT (matches majority of parents: orders, serial_units, receiving, sku_catalog.id, etc.).
- `organization_id` + `search_text` + `embedding vector(...)` + optional facets (condition, status, platform, dates as real columns for filtering).
- Org-led unique + lookup indexes.
- Tenant-from-birth via `enforce_tenant_isolation()`.
- Parent-delete integrity via trigger family (one per entity_type) or FK where applicable.
- Model in Drizzle schema.ts in same change.
- App-layer validation that the parent entity exists (in the domain helper that writes the doc).

This becomes the single semantic index for the new AI search. Old per-table searches can eventually read from or feed into it.

Use hand-written migration + add model in the same PR. Backfill script required (org-scoped).

### 6.3 Tenant safety

Every vector index and query must lead with `organization_id`. Use the same GUC patterns as everywhere else.

---

## 7. Backend Implementation Plan

### 7.1 New / refactored modules

- `src/lib/ai/local-embed.ts` — local embedding client (Ollama HTTP or equivalent). Mirror the interface of current Gemini functions. Target dim 768.
- `src/lib/ai/search-tools.ts` — the registry of tool-callable functions. Define `HermesTool` schemas here. Start with:
  - `exactIdSerialSearch` (fast path, reuses existing last-8 + exact logic).
  - `hybridEntitySearch` (uses `sql-ranked-search` + vector on entity_search_docs + RRF).
- `src/lib/ai/hybrid-retrieval.ts` — core that calls the ranked builder + pgvector query on the new table.
- Evolve `src/app/api/global-search/route.ts` (or new `/api/ai/retrieve`) to optionally use tools + context.

**CommandBar P1 evolution target** (from deep read):
- Keep existing client structure (debounce, abort, recents via localStorage, cmdk groups, ENTITY_ICONS map, CmdRow, "Ask AI" link).
- Change the searchResults source: first try new AI retrieve endpoint (with minimal "global" context).
- Fall back to or merge with current global-search results during transition.
- Enhance result items with `SearchHit` extras (score, chips from facets like condition/source).
- Add "AI enhanced results" group or badges when using the new path.
- Later phases: make AI the only source; remove direct global-search dependency for results.

Reuse `buildTextSearchVariants` from `src/lib/search/sql-ranked-search.ts` inside the keyword part of hybrid. Leverage existing trgm GIN indexes.
  - `exactIdOrSerialSearch`
  - `hybridEntitySearch(query, entityTypes?, filters?)`
  - `searchUnits(structuredFilters, semanticQuery?)`
  - `searchReceiving(...)`
  - `searchAcrossOrdersAndShipments(...)`
  - Context-aware list tools (recent activity filtered by current page)
- `src/lib/ai/hybrid-retrieval.ts` — the actual keyword + vector implementation + RRF scoring. Returns `SearchHit[]`.
- Enhance `src/lib/ai/context-fetchers.ts` or create `page-context.ts` for standardized per-page context builders.

All tools must accept (and enforce) `orgId`. Use `Deps` injection where unit-testable.

### 7.2 API surface

- Evolve `/api/ai/search` (or introduce `/api/ai/retrieve`) as the canonical NL → results endpoint.
  - Inputs: `{ query, page?, pageContext?, limit?, entityTypes? }`
  - Behavior: exact fast path → hybrid retrieval → optional LLM tool orchestration.
  - Output: `{ hits: SearchHit[], answer?, suggestedActions?, usedTools?, confidence }`

- Keep `/api/global-search` working (or have the new tools power it under the hood).

- Chat can call the same tools (reuse the intent + tool machinery).

### 7.3 Tool-calling friendly result shape (critical)

```ts
export interface SearchHit {
  entityType: 'unit' | 'order' | 'receiving' | 'sku' | 'repair' | 'fba' | ...
  id: string | number
  title: string
  subtitle?: string
  chips: Array<{ label: string; tone?: string }>
  score: number
  href?: string
  facets?: Record<string, any>   // machine-readable for applying filters
  actions?: Array<{ type: string; label: string; payload: any }>
}
```

Tables and rails should be able to render these directly and expose actions back to the AI layer.

---

## 8. UI & Experience Plan

### 8.1 Primary entry points

1. **CommandBar** (`src/components/CommandBar.tsx`): Make the AI search path first-class.
   - Promote natural language input.
   - Show `SearchHit` results in the same style as current results (plus AI confidence / explanation).
   - "Ask AI about this" or direct tool results.

2. **Page-level AI search bars**: Use or extend `OverlaySearch` + a new `AiSearchInput` component for workbenches.
   - Pass explicit page context on every query (current mode from `?mode=`, filters, selected items, visible count).

3. **Inline in rails** (via `SidebarRailShell` wrappers): Offer "AI filter this rail" as progressive disclosure.

### 8.2 Per-archetype rules (do not violate)

- **Station**: Scan bar stays exact. Consider a small "AI insights for this item" card *after* a successful scan.
- **Workbench**: Sidebar picker can become AI-powered or have an AI mode. Right pane updates from AI-selected hits.
- **Monitor**: Excellent fit. AI search + suggested filters on the timeline/rollup views.
- **Canvas**: Semantic search over nodes + "focus on things matching...".

### 8.3 Replacing search bars

Phased approach (never big-bang):

- Phase 1: Add prominent AI bar alongside existing (or as default for "All").
- Phase 2: Hide or collapse field-specific selectors behind "Advanced" or remove for the "All" case.
- Phase 3: On prioritized surfaces, the AI bar is the only prominent search.

Keep power-user keyboard paths and exact matching.

### 8.4 "Tool calling friendly tables"

- New or enhanced table components accept `SearchHit[]` or structured filter payloads from AI.
- Support optimistic application of AI-suggested filters.
- Results should carry enough metadata that the LLM can be given follow-up tool calls ("now filter those to only poor condition").

---

## 9. Phased Rollout (Recommended)

**Phase 0 — Foundations (CommandBar global focus)**
- Local embedding client (`src/lib/ai/local-embed.ts` via Ollama or equivalent).
- Define canonical `SearchHit` shape (extends current global-search result shape).
- Create `entity_search_docs` table (polymorphic per contract) + Drizzle model + migration.
- Basic hybrid retrieval (exact bypass + keyword + pgvector) + `search-tools.ts` skeleton.
- Update `CommandBar` + `/api/global-search` (or new `/api/ai/retrieve`) as the first consumer.

**Phase 1 — Full CommandBar AI + Tool Calling**
- Implement core search tools (hybridEntitySearch, searchUnits, searchOrders, etc.) using the `entity_search_docs` + direct fast paths.
- Wire forced tool-calling via `hermes-tool-call.ts` pattern for complex queries.
- Make CommandBar use AI-powered results by default (exact still fast).
- Add initial per-"global" context injection.
- Keep old exact implementations as internal fast paths.

**Phase 2 — Update Everything + Systematic Removal**
- Build per-page context for major workbenches/monitors.
- Replace OverlaySearch + per-tab field selectors on all non-station surfaces with contextual AI search.
- **Full removal** of old search field dropdowns/configs (inventory-search.ts per-tab fields, shipped-search fields, etc.).
- Normalize all result rendering through `SearchHit` + shared row components.
- Make existing chat use the new search tools.

**Phase 3 — Long-term Hardening + Agent Surface**
- Rich facets + actions on SearchHit.
- AI-suggested filter application that updates URL state / tables.
- Embedding refresh jobs, re-embedding on updates.
- Performance, caching (use createCrudHandler patterns where appropriate).
- Complete cleanup of old search libs/hooks.
- Document as the new source-of-truth for search.

**Phase 4 (future)** — Deeper agent use (the agent proactively searches + proposes work).

---

## 10. Risks, Mitigations & Non-Goals

**Risks**
- Local model latency / quality on complex queries.
- Embedding cost at write time for high-volume tables.
- Dimension mismatch with existing 1536-dim RAG.
- Over-eager removal of exact controls frustrates power users.
- Regressing scanner flows.

**Mitigations**
- Always keep exact bypass as first step (very fast path).
- Selective embedding + async generation.
- Dual-embedding or re-embed plan for RAG.
- Archetype discipline + user testing on one surface before broad changes.
- Feature flags + easy rollback of UI search components.

**Explicit non-goals (Phase 1)**
- Changing Station scan input behavior.
- Full-text search over every inventory_event row.
- Replacing the existing chat UX (complement it).
- ~~Cloud fallback or OpenAI~~ — superseded by Locked Decisions: cloud (AI Gateway) is the prod default; Hermes is the dev config.

---

## 11. Open Questions (narrowed by your priorities)

- Exact embedding model + target dim (recommend `nomic-embed-text` @ 768)?
- How aggressive on deletion of old search config files in Phase 2 (e.g. delete `inventory-search.ts` field maps, `shipped-search.ts` etc. once CommandBar + new inputs are solid)?
- How rich should CommandBar context be in Phase 1 (just query + recent + org signals) vs. later page-specific injection?
- Forced tool-calling on every search or only for complex/ambiguous queries?
- Backfill strategy for `entity_search_docs` (script-driven per-org, or background job)?
- Should we eventually migrate the existing RAG document chunks to also be queryable via the new search tools (unify indexes)?

---

## 12. Recommended Long-Term Architecture for This Codebase

After scanning the patterns (polymorphic contract, global-search normalization, hermes-tool-call, context-fetchers, createCrudHandler, tenantQuery + domain helpers with Deps, SidebarRailShell, etc.), here is the **best long-term shape**:

**Single source of truth for search:**
- `entity_search_docs` (polymorphic) is the semantic + hybrid index. All intelligent search goes through it.
- A central `src/lib/search/` module (or `src/lib/ai/search.ts` + `hybrid-retrieval.ts`) owns:
  - `buildSearchText(entityType, row)` — canonical denormalized text for embedding.

**Deep-scan-backed specifics for long-term:**
- Reuse `sql-ranked-search.ts` (and its trigram variants) inside the keyword component of hybrid retrieval.
- Make `SearchHit` a strict superset of current global-search `SearchResult` so CommandBar and existing result consumers need minimal changes.
- Central tools must support structured facets (condition, source_platform, status, date buckets) so page context + user filters can be applied server-side before/after vector search.
- Embedding writes should be best-effort (like current outbox patterns elsewhere) and never block the primary domain write.
- Delete integrity: add trigger family in the entity_search_docs migration for every supported entity_type (following the 2026-07-01j pattern that closed gaps for work_assignments).
- For CommandBar P1 specifically: evolve the fetch in CommandBar.tsx to call the new retrieve while preserving recents, abort, cmdk `shouldFilter={false}`, and the "Ask AI" group. Use the same ENTITY_ICONS + CmdRow for continuity.
  - `upsertSearchDoc(orgId, entityType, entityId, searchText, facets?)`
  - `hybridSearch(orgId, query, options)` — exact bypass + keyword + vector + scoring.
  - The registry of tool-callable functions.

**Search tools as the narrow waist:**
- Every consumer (CommandBar, future page AI bars, chat, agents, even some internal lists) calls the same small set of tools.
- Tools return only `SearchHit[]` (never raw DB rows).
- LLM is only allowed to call tools from this registry (enforced via hermesToolCall + prompt discipline).

**Context layers (multi-level):**
- System: schema, allowed entity_types, org policies.
- Global/CommandBar context: recent activity, user prefs, broad org stats.
- Per-page context: current archetype/mode, URL filters, selected IDs, visible summary (injected on every AI search call from that page).
- Result context: the hits themselves + facets for follow-ups.

**UI evolution:**
- CommandBar becomes the "universal AI search" (global + deep-linkable).
- All other search inputs on workbenches/monitors become thin wrappers that inject their page context + call the central retrieve endpoint.
- Old field-specific search configs (`INVENTORY_SEARCH_FIELDS`, shipped fields, etc.) are deleted in Phase 2.
- Result lists continue to use existing rail/table primitives but accept `SearchHit` + `onApplyFacets`.

**Lifecycle of docs:**
- Write path (in domain helpers that mutate entities): after successful write, call `upsertSearchDoc`.
- Or use outbox + worker for heavier embedding work.
- Update path: on any change that affects searchable facts (condition change, status, new note), re-embed.
- Delete: cascade via polymorphic delete triggers.

**Why this is the best long-term fit:**
- Matches the project's "single source of truth" philosophy (see source-of-truth.md).
- Reuses the polymorphic contract they already ratified.
- Unifies the current fragmented search + the existing AI chat work.
- Tool-calling friendly by design (the exact request).
- Testable (Deps), tenant-safe (GUC everywhere), auditable.
- Scales to future agentic workflows without giving the LLM raw SQL or broad access.
- Preserves the fast exact paths that ops actually depends on for scanners and barcodes.

**Migration end-state vision (6–12 months):**
- Old `* -search.ts` and per-endpoint search logic become thin shims or are removed.
- `entity_search_docs` + the central search tools are how you "search anything".
- CommandBar + page AI inputs are the only visible search UIs on non-station surfaces.
- Chat, dashboards, and future Studio features all reuse the same tools.

This is the cleanest evolution of what already exists in the repo.

---

## 13. Implementation Notes & References

- Reuse `hermes-tool-call.ts` pattern.
- Follow Deps for search tools.
- New table must obey polymorphic contract + model in Drizzle same PR.
- Global search + CommandBar already give you the normalization + rendering skeleton — extend it.
- For any new result lists: prefer composing `SidebarRailShell`.
- Use `createCrudHandler` where the new retrieve endpoint fits the list/search shape (with org-scoped caching).

---

## Next Steps

1. Confirm this updated plan matches the 6 priorities.
2. Author migration for `entity_search_docs` (use the polymorphic skeleton).
3. Implement `src/lib/ai/local-embed.ts` + update pgVector type for target dim.
4. Create `src/lib/ai/search-tools.ts` with `SearchHit` type + 3–4 initial tools.
5. Prototype CommandBar calling the new path (keep old global-search as fallback initially).
6. Build first hybrid retrieval using the new table.

This now reflects **CommandBar first, full removal + industry standard modernization, polymorphic entity_search_docs, and the actual best patterns from the scanned codebase**.

*Updated with your explicit priorities. Ready for execution or further tuning.*