# Redis caching implementation plan — hot stations first

> **BUILD STATUS (updated 2026-07-04):**
> - **Phase 0 — DONE.** Substrate live behind the kill-switch, zero behavior change. Consolidated
>   `src/lib/redis/client.ts` (`lock.ts`/`api-guard.ts` migrated to it); `upstash-cache.ts` bumped to
>   `cache:v2:` with **org-scoped keys AND tags** (legacy org-less callers route to a `_global`
>   sentinel via overloads — no regression); `getOrSet` workhorse + `withCacheLock` single-flight
>   (`src/lib/redis/cache-lock.ts`); `cache-flags.ts` (`REDIS_CACHE_DISABLED` + `REDIS_CACHE_NS`);
>   `cache-metrics.ts` + `GET /api/admin/cache-stats`; typed `tags.ts` (`CACHE_TAGS`/`CACHE_NS`).
>   Tests: `src/lib/cache/upstash-cache.test.ts` (cross-org isolation + single-flight + fail-open). `tsc` clean.
> - **Phase 1 — DONE (items 1,2,6,7); items 4/5 subsumed; item 3 deferred.**
>   `get-title-by-sku` caches the STABLE slice, `sku_stock` kept live (items 1+1b); `manuals/resolve`
>   cached; `resolveSkuByGtin` cached; `reason_codes` cached inside the read SoT. Kit/QC/catalog-sync/
>   pairing/manual writers wired to org-scoped `invalidateCacheTags`. Kit-parts (item 4) + QC (item 5)
>   are carried inside the title bundle's tags, so no separate cache. **Item 3 (fba_fnskus) DEFERRED** —
>   its reads are read-before-write existence gates inside scan mutations (`tech/scan` `findFnsku`,
>   `fba/logs` `fnskuCheck`); caching them risks a stale stub-create decision. Revisit as a pure-read
>   enrichment cache alongside Phase 2's fba board.
> - **Phase 2 — DONE.** Prereq 2.0 landed: `lookupShipmentId` (read-only) extracted from
>   `resolveShipmentId`; `GET /api/sku/by-tracking` repointed to it (now side-effect-free + org-scoped).
>   Cached read models: `order-detail` (`orders/lookup/[orderId]`, 20s), `fba/board` (20s),
>   `fba/shipments/today` (20s), `po-by-ref` (`resolvePoIdLocally`, 5 min, found-only). Invalidation:
>   `invalidateOrderViews` now org-scopes `orders`/`order-detail`; `tech/scan` org-scopes
>   orders/tech-logs/order-detail; **all 19 FBA write sites** org-scope `fba-board`/`fba-today`/
>   `fba-stage-counts`. Skipped: `pack-policy` (folded into Phase 3's org-cache promotion — redundant
>   with the existing 30s org Map); `findOrderByShipment` + mobile scan-order lookups (read-before-write
>   gates inside scan mutations — same hazard as fnsku item 3).
> - **Phase 3 — DONE (headline item).** The plan's "UNCACHED — every request ⚠️ highest-hit gap"
>   (`loadStaffOverrides` in `current-user.ts`, on the `withAuth → getCurrentUserBySid` path) is now
>   cached. Chosen shape for this **permission-revocation-sensitive** read: **L2-Redis-only (no
>   per-instance L1) + 30s TTL**, so a staff PATCH's org-scoped purge takes effect fleet-wide
>   immediately (a revocation never lingers in a per-instance Map — safer than two-tier here). Purge
>   wired at all 5 override writers (`admin/staff/[id]/permissions|roles`, `admin/staff/update|
>   deactivate`, `admin/staff/[id]`). Also **`org-catalog.ts` promoted to two-tier L1 Map + L2 Redis**
>   (JSON-safe string timestamps; `invalidateCatalogCache` clears both; 9 write routes already call it).
>   **Remaining (deferred by design):** `org` Map→Redis (org row has `Date` fields → JSON round-trip
>   corrupts them, needs loader-side re-hydration per §8); `roles` Map→Redis (marginal cold-read-only
>   savings on an already-Map-cached auth path); `feature-flags` Map→Redis (`invalidateFeatureFlagCache`
>   has **zero** writer callers today → unbustable, would violate "no cache without a wired
>   invalidation"). These keep their existing per-instance Maps.
> - **Phase 4 — DONE (uncached pollers).** The operations dashboard's 3 uncached polled endpoints are
>   now org-scoped short-TTL caches: `/api/dashboard/operations` (45s), `/api/operations/benchmarks`
>   (120s), `/api/operations/roi` (120s) — N tabs collapse to one DB read per window; order/tech writes
>   bust `[orders,tech-logs]`. The other pollers (`/api/orders`, receiving/shipped/tech-logs) were
>   **already** server-cached (legacy). **Remaining (optional):** cut aggressive client refetch cadences
>   (mostly already 60s+; a few <30s) and org-scope the legacy poller busts — the plan's secondary step.
>
> **Scope:** a codebase-wide Redis caching layer, prioritizing the scan **stations** (the hottest
> per-scan Neon traffic) and the reference data they depend on. Grounded in a full discovery pass
> (2026-07-04). This is a plan doc; nothing here is implemented yet.
>
> **The headline:** we are NOT building a cache from scratch. `src/lib/cache/upstash-cache.ts`
> (Upstash Redis over REST, tag-based, fail-open, unconfigured-noop) already exists and is wired into
> ~100 route files, and `redisAdvanceLock` (`src/lib/workflow/lock.ts`) is a ready Redis mutex. This
> plan **extends and systematizes** that foundation, closes its correctness gaps (global tags →
> org-scoped; stampede protection; the write-in-lookup trap), and rolls it across the stations.

---

## 0. Decisions (locked unless flagged OPEN)

1. **Extend `upstash-cache.ts`, do not introduce a second cache system.** One shared cross-instance
   layer (REST, cold-start-friendly, Fluid-Compute-safe). No new in-process server caches.
2. **Cache-aside (lazy) reads, invalidate-on-write.** Read-through helper `getOrSet`; writes call an
   org-scoped `invalidate*` at the existing chokepoint (inline after the durable write, before
   `after()` — the house convention).
3. **Every key AND every tag is org-scoped.** Today keys fold org in but **tags are global** — the
   single biggest tenancy risk (a `receiving-lines` bust flushes every org). Phase 0 fixes this.
4. **Fail-open, kill-switchable, observable from day one.** Unconfigured Redis → straight to DB
   (already true). A `readBoolEnv('REDIS_CACHE_DISABLED')` global kill-switch + per-namespace
   disable. Hit/miss counters per namespace.
5. **Stations first, but the reference-data substrate they share is Phase 1** — caching
   `get-title-by-sku`/`manuals`/`fnsku`/`kit-parts` accelerates *every* station at once and is the
   lowest-risk, highest-hit-rate win. Station-specific read models are Phase 2.
6. **Never cache a mutation response or live lifecycle state.** Hard registry (§11). The scan POSTs
   (`/api/tech/scan`, `/api/receiving/lookup-po`, `/api/*/scan-serial`) and the `serial_units` row
   are authoritative writes/state — we cache only their *stable sub-lookups*.
7. **OPEN — client-side staleTime tuning is out of scope of this doc.** The `QueryClient` 3-min
   `staleTime` + Ably-invalidation model already leans on server-side invalidation; this plan makes
   the *server* cache authoritative and correct, and the client keeps working unchanged.

---

## 1. Current state — the foundation to extend (not rebuild)

| Piece | Where | State |
|---|---|---|
| **Response/JSON cache** | `src/lib/cache/upstash-cache.ts` | `getCachedJson(ns,key)` / `setCachedJson(ns,key,val,ttl,tags[])` / `invalidateCacheTags(tags[])` / `createCacheLookupKey`. Keys `cache:v1:{ns}:{key}`; tag sets `cache_tags:v1:{tag}`. **Fully fail-open + unconfigured-noop.** Wired into ~13 read routes + their write-side `invalidateCacheTags`. |
| **Redis mutex** | `src/lib/workflow/lock.ts` `redisAdvanceLock` | `SET NX PX` + Lua CAS-delete, fail-open, unconfigured-noop, per-instance `heldTokens` map. Key `wf:advance:{unitId}`. **The ready-made stampede/single-flight primitive.** |
| **Distributed rate limiter** | `src/lib/api-guard.ts` | ZSET sliding window, org-scoped, Map fallback + loud "ineffective under autoscale" warning. |
| **Env** | — | `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`. `@upstash/redis` installed but **unused** (everything is hand-rolled REST `/pipeline`). |
| **Per-instance module Maps** (the de-facto metadata cache) | many | org (30s, `invalidateOrgCache`), roles/staff_roles (60s, `invalidateRoleCache`), permissions (60s), feature flags (30s, `invalidateFeatureFlagCache`), org catalog (5min, `invalidateCatalogCache`), workflow entry node (60s), warehouses (5min), entitlements (60s). **Per-instance → stale/duplicated under Fluid Compute.** All have clean invalidation hooks already. |
| **DB layers** | `src/lib/db.ts` (owner pool), `src/lib/tenancy/db.ts` (`tenantQuery`+GUC), `src/lib/drizzle/db.ts` (neon-http) | Org scoping = GUC `app.current_org` (RLS backstop) + mostly-explicit `organization_id` predicates. |
| **Invalidation chokepoints** | `src/lib/orders/invalidation.ts`, `applyTransition()`, `transition()`, `createCrudHandler`, `after()` | House pattern: `invalidateCacheTags(...)` + `publish*(...)` inline after the durable write, before `after()`. **Not** in `recordAudit` (swallows errors). |
| **Ably realtime** | `src/lib/realtime/publish.ts` + `channels.ts` | ~40 org-namespaced publishers (`org:{orgId}:...`). Already the cross-instance *client* nudge; best-effort (no durability). |
| **Idempotency/single-flight** | `src/lib/api-idempotency.ts` `claimOrReplay`, `ops-events` `UNIQUE(client_event_id)` | "one writer wins, others replay" — reusable for "one cache rebuild wins." |

**Known correctness gaps to close (all in Phase 0):**
- **Tags are global, not org-scoped** — `invalidateCacheTags(['receiving-lines'])` flushes *all* orgs. Cross-tenant blast radius + wasteful.
- **No stampede protection** — a cold key under scan load = N concurrent identical DB rebuilds.
- **`resolveShipmentId` writes inside a "lookup"** (`shipping/resolve.ts:59`) — `GET /api/sku/by-tracking` and the `tech/scan` TRACKING path both call it; wrapping them in a read-through cache would **silently skip shipment registration**. Any caching near these must extract the write first.
- **`get-title-by-sku` mixes stable + volatile** — title/catalog/qc/kit (slow) are returned alongside `sku_stock.stock/location` (decremented every pick/pack). Caching the whole envelope serves stale stock.

---

## 2. Guiding invariants (non-negotiable)

1. **Org-scoped everything.** Key = `cache:v2:{ns}:{orgId}:{…}`; tag = `{tag}:{orgId}`. A cache read for org A can never return org B's payload, and an invalidation for org A never flushes org B. (`items`/`sku_catalog` specifically collide across orgs on the same SKU string — the per-org "H4" design — so this is a data-integrity requirement, not just hygiene.)
2. **Fail-open, always.** Redis down/unset/slow → run the DB query. Never let the cache break a scan. Wrap every Redis op in try/catch → `console.warn` → fall through (the existing layer already does this; keep it).
3. **Cache-aside + explicit invalidation. No cache without a wired invalidation.** A new cached read PR must also wire its bust at the write path, or it doesn't merge. TTL is a backstop, not the primary freshness mechanism.
4. **Never cache writes or live state.** §11 registry is authoritative. When in doubt, cache the *stable sub-lookup* (catalog/gtin/manual), never the *envelope*.
5. **Bounded staleness matches the data.** Reference/authoring data: minutes. Order/assignment state: 15–30s. Lifecycle/stock: don't cache (or ≤10s write-through). Every cached value's TTL is chosen against its write cadence + blast tolerance and documented in the appendix.
6. **Single-flight hot rebuilds.** A cache miss on a hot key acquires a short `withCacheLock` before rebuilding; losers wait-and-read. Reuses the `redisAdvanceLock` shape.
7. **Kill-switch + observability before rollout.** Global + per-namespace disable env; per-namespace hit/miss/error counters exported to the existing readiness/metrics surface.

---

## 3. Phase 0 — the cache substrate (foundation)

Goal: a small, correct, observable core that every later phase builds on. No behavior change yet.

**0.1 — Consolidate the Redis client.** One `src/lib/redis/client.ts` exposing `redisPipeline(cmds)` /
`redisCmd(cmd)` (extract the REST helper currently copy-pasted in `lock.ts`/`api-guard.ts`/
`upstash-cache.ts`), `isRedisConfigured()`, fail-open. Migrate the three call sites to it (no behavior
change). Optionally adopt the installed `@upstash/redis` client here.

**0.2 — Org-scope keys and tags (the correctness fix).** Bump to `cache:v2:`. New signatures:
`getCachedJson(ns, orgId, key)`, `setCachedJson(ns, orgId, key, val, ttl, tags[])`,
`invalidateCacheTags(orgId, tags[])`. Tag storage becomes `cache_tags:v2:{tag}:{orgId}`. Provide a
compat shim for the ~100 existing callers (a global-org sentinel) and migrate them incrementally;
new code uses the org form only. **This is the load-bearing change — do it first, verify with a
tenancy test that org-A invalidation leaves org-B keys intact.**

**0.3 — `getOrSet` cache-aside helper (the workhorse).**
```ts
getOrSet<T>(ns, orgId, key, ttl, tags, loader: () => Promise<T>): Promise<T>
// miss → withCacheLock(ns:orgId:key) → re-check → loader() → setCachedJson → return
// hit  → return cached; on any Redis error → loader() (fail-open)
```
Single-flight built in (0.4). DB-free unit-testable via an injected redis fake + loader spy.

**0.4 — `withCacheLock(key, fn)` single-flight.** Generalize `redisAdvanceLock` into a reusable
lock (`cachelock:{ns}:{orgId}:{key}`, ~2s TTL, fail-open → run `fn` anyway). Prevents the cold-key
stampede on hot scan paths.

**0.5 — Kill-switch + flags.** `isRedisCacheEnabled()` = `!readBoolEnv('REDIS_CACHE_DISABLED')` and
a per-namespace allowlist (`REDIS_CACHE_NS`), plus per-org via `resolveForOrg` for staged rollout.
`getOrSet` short-circuits to `loader()` when disabled.

**0.6 — Metrics.** Per-namespace `{hits, misses, errors, rebuildMs}` counters (Redis HINCRBY or a
lightweight sampler), surfaced at `/api/ready` (which already PINGs Redis) or a new
`/api/admin/cache-stats`. Without hit-rate visibility we can't tune TTLs or prove the Neon savings.

**0.7 — Invalidation registry.** `src/lib/cache/tags.ts` — a typed catalog of tag names + the write
functions that own them (mirrors `src/queries/keys.ts` for the client). Prevents the "silent
invalidation break" from stringly-typed tags. Wire org-scoped `invalidateCacheTags(orgId, …)` into
the canonical writers: `invalidateOrderViews`, `applyTransition`/`transition` (lifecycle),
`createCrudHandler`, the Zoho/Ecwid sync jobs (catalog), and the studio publish path (workflow).

**0.8 — (optional) Ably invalidation nudge.** For any data ALSO held in a per-instance Map (Phase 3),
publish a tiny `cache.invalidate {ns, tags}` on the org channel so every instance drops its local
copy. Supplementary to the authoritative Redis bust, never the only signal (Ably is best-effort).

**Exit criteria:** substrate merged behind the kill-switch (default ON in prod, OFF in preview/CI),
tenancy test green (cross-org isolation of keys + tags), metrics visible, zero behavior change
(no read is cached yet).

---

## 4. Phase 1 — station reference-data cache (the stations-first payoff)

The stations share a handful of reference reads that fire on nearly every scan and change only on
batch syncs or rare operator authoring. Caching these accelerates **all** stations at once, at the
lowest risk. Each item: cache-aside via `getOrSet`, org-scoped key, invalidate at the listed write.

| # | Target | Fires on | Key | TTL | Invalidate on |
|---|---|---|---|---|---|
| 1 | **`get-title-by-sku` — STABLE slice** (title, gtin, image, `packNotes`, `qcFlags`, kit-parts, qc) | every SKU/pre-pack scan (packing, labels, mobile) — 4–7 DB round-trips today | `title-by-sku:{org}:{normSku}:{cond}` | 5–15 min | `sku_catalog`/`items`/`sku_platform_ids` writes (Zoho/Ecwid sync, pairing), kit-part/QC writes → tag `sku-catalog:{org}` |
| 1b | **`sku_stock` (stock/location) — split out** | same scan | do NOT bundle; fetch live, or `sku-stock:{org}:{sku}` | ≤30s or uncached | pick/pack/move (tag `sku-stock:{org}` — already flushed by scan writes) |
| 2 | **`product_manuals` resolve** (`/api/manuals/resolve`) | every matched tracking/FNSKU order-load at the tech bench | `manual:{org}:{catalogId‖itemNumber}` | 30–60 min | `product_manuals` upsert |
| 3 | **`fba_fnskus` catalog** (fnsku → title/asin/sku) | every FBA scan (inside a write path — cache only the catalog sub-read) | `fnsku-catalog:{org}:{fnsku}` | 30–60 min | `fba_fnskus` upsert (tag `fba-fnskus:{org}`) |
| 4 | **`sku_kit_parts` (BOM)** | every pack scan (`PackChecklist`, get-title-by-sku) | `sku-kit:{org}:{catalogId}:{cond}` | 5–30 min | `create/update/deleteKitPart` |
| 5 | **`qc_check_templates`** | every pack/test scan | `sku-qc:{org}:{catalogId}:{cat}:{published}` | 5–30 min | `create/update/deleteQcCheck` + publish |
| 6 | **`resolveSkuByGtin`** (gtin → sku) | mobile cockpit scans | `sku-by-gtin:{org}:{gtin}` | 30 min | `sku-catalog:{org}` |
| 7 | **`reason_codes` pickers** | per station panel that opens a reason picker | `reasons:{org}:{flow}:{cat}:{dir}:{node}` | 5–15 min | reason-code CRUD (tag `reason-codes:{org}`) |

**Load-bearing gotcha (item 1):** keep the two-scheme SKU collision rule intact — cache the
*resolved* output of `get-title-by-sku` (which already applies the `items.name`-wins + 0.25
trigram-guard logic), keyed on `(org, normSku, condition)`; never cache a raw `sku_catalog`-by-string
lookup that could bind the wrong product. And **split the volatile `sku_stock` fields out** of the
cached bundle (item 1b) — this is the difference between a correct cache and one that shows stale
on-hand counts at the pack bench.

**Payoff:** collapses the 4–7 round-trip `get-title-by-sku` to ~0 on a hit, removes the
`manuals/resolve` query from 100% of matched scans, and removes the fnsku-catalog read from every FBA
scan — the three highest-frequency reference reads across all benches.

---

## 5. Phase 2 — station per-scan read models + the write-extraction prerequisite

Now the station-specific short-TTL read models. These are the order/assignment/board reads each bench
reloads per scan cycle — volatile, so **short TTL + invalidate-on-write** (and the scan writes
*already flush the right tags*, so invalidation is largely free).

**2.0 — Prerequisite: extract writes out of "lookups."** Before caching anything near them, split
`resolveShipmentId`'s shipment-registration write (`shipping/resolve.ts:59`) out of the read path so
`GET /api/sku/by-tracking` and the `tech/scan` TRACKING read become side-effect-free. Until then,
these stay on the never-cache list (§11). This is a correctness refactor, not a cache change.

| Station | Read model | Key | TTL | Invalidate on |
|---|---|---|---|---|
| Tech / Packing | **`GET /api/orders/lookup/[id]`** (order VM + activity strip) | `order-detail:{org}:{orderId}` | 15–30s | tags `orders:{org}`+`tech-logs:{org}` — already flushed by `tech/scan`, `add-serial` |
| Tech | **`findOrderByShipment`** (only if hoisted out of the write txn) | `order-by-ship:{org}:{shipmentId}` | 30–60s | `orders:{org}` |
| Mobile cockpit | order-match lookups in `/api/scan/resolve` (by tracking/serial/id) | `scan-order:{org}:{kind}:{value}` | 15–30s | `orders:{org}` |
| FBA | `GET /api/fba/shipments/today` + `/api/fba/board` snapshots | `fba-today:{org}` / `fba-board:{org}` | 15–30s | `fba-board:{org}`/`fba-stage-counts:{org}` — already flushed by FBA scans |
| Packing | `GET /api/packing/policy` (org enforcement) | promote its 5-min client cache to shared `pack-policy:{org}` | 5 min | org settings write |
| Receiving | `zoho_po_mirror` ref# → poId sub-lookup inside `lookup-po` (skips the "Opening your PO" Zoho path) | `po-by-ref:{org}:{ref}` | 5 min | Zoho PO sync |

**Do NOT cache** the scan POST responses themselves, `resolveTestingScan`'s fan-out result (live line
state), or the `serial_units` row (§11). The `tech/scan`, `lookup-po`, `scan-serial` endpoints stay
DB-authoritative; we accelerate the *reference joins inside them* (via Phase 1's `sku-catalog` cache)
and the *read models around them* (above).

---

## 6. Phase 3 — promote per-instance Maps to shared Redis (identity/authz hot path)

The per-instance module Maps (org, roles, staff overrides, flags, catalog, workflow entry) are read
on **every authenticated request** (`withAuth` → `getCurrentUserBySid`) but are per-instance under
Fluid Compute — so each cold instance re-hits Neon, and a bust on one instance doesn't reach others.
Promoting them to shared Redis (behind the *same* `getOrSet`) makes the cache window cross-instance
and the existing `invalidate*` hooks authoritative fleet-wide. **They already have clean invalidation
functions** — this is a backing-store swap, not new invalidation.

| Target | Today | Move to | TTL | Invalidation (exists) |
|---|---|---|---|---|
| **`staff` overrides row** (name, added/removed perms, mobile cfg) | **UNCACHED — every request** ⚠️ highest-hit gap | `staff-ovr:{org}:{staffId}` | 30–60s | purge on staff PATCH |
| `roles` + `staff_roles` | Map 60s | `roles:{org}` / `staff-roles:{org}:{staffId}` | 60s | `invalidateRoleCache`/`invalidateStaffRolesCache` |
| `organizations` (settings JSONB, plan) | Map 30s | `org:{orgId}` | 30–60s | `invalidateOrgCache` |
| `organization_feature_flags` | Map 30s | `flag:{org}:{flag}` | 30–60s | `invalidateFeatureFlagCache` |
| platform/account/type catalog | Map 5min | `catalog:{org}` | 5 min | `invalidateCatalogCache` |
| workflow active entry/returns node | Map 60s (no explicit inval) | `wf-entry:{org}` | 60s | **add** publish-triggered purge |
| `workflow_nodes`/`edges` (per hop, immutable per version) | uncached | `wf-node:{defId}:{nodeId}` | 10–60 min | purge on publish of that def |

**Caveats:** `staff_sessions` mutates `last_seen_at` on the heartbeat (write-on-read) — **do not
cache the session row** unless the heartbeat is decoupled (leave uncached or write-through only). And
keep the per-instance Map as an L1 in front of Redis L2 if the extra Redis round-trip on the auth
hot path is a latency concern (measure first).

**OPEN:** whether to keep L1-Map + L2-Redis (two-tier) or Redis-only for the auth path. Decide with
the Phase 0 metrics + a latency probe; two-tier is safer for the every-request reads, Redis-only is
simpler for the reference reads.

---

## 7. Phase 4 — dashboards / feeds + polling→push (broaden)

Lower priority than stations, but the biggest raw Neon-CU consumers per the cost review: the
operations-dashboard and receiving/incoming **React-Query pollers** (15s–300s `refetchInterval`,
one Neon-touching request per interval per open tab).

- **Server-cache the polled endpoints** (`/api/orders`, `/api/receiving-lines`, incoming summaries,
  fba board, operations rollups) with short TTLs so N polling tabs collapse onto one DB read per TTL
  window — the poll interval becomes a cache-hit, not a query.
- **Then reduce the poll cadences** (or replace with the existing Ably nudges) per the
  `neon-cost-reviewer` guidance (`refetchInterval < ~30s` flagged). Realtime already exists for most
  of these; polling is the fallback.
- `feed_memberships` / `getFeedState` (just shipped) and the operations `EventTimeline` are natural
  short-TTL cache targets here.

---

## 8. Cross-cutting concerns

- **Tenancy (the #1 risk):** org in every key AND tag (Phase 0.2). A dedicated DB-free test asserts
  cross-org isolation of both reads and invalidations. `orgChannelPrefix`-style throw-on-non-UUID
  guard for key construction so a missing org can never build a global key.
- **Invalidation discipline:** no cached read merges without its wired bust; tags centralized in
  `src/lib/cache/tags.ts`; bust lives inline after the durable write (not in `recordAudit`). The
  `applyTransition`/`transition` chokepoint gets a lifecycle bust so all 26 handlers invalidate for
  free.
- **Stampede/single-flight:** `withCacheLock` on hot rebuilds; `claimOrReplay` shape available for
  expensive one-writer rebuilds.
- **Observability:** per-namespace hit/miss/error + rebuild latency; alert on hit-rate < target or
  error-rate spike (Redis degradation). Log the first cache-hit-rate numbers before tuning TTLs.
- **Kill-switch:** global `REDIS_CACHE_DISABLED`, per-namespace allowlist, per-org staged rollout via
  `resolveForOrg`. Flip to DB instantly if a staleness bug surfaces.
- **Serialization:** JSON (matches the existing layer). Watch for `Date`/`bigint` — the `id`/
  `entity_id` string-vs-number issue we just hit in the signals work applies to cached rows too;
  normalize at the loader, not the reader.
- **Cold start / Fluid Compute:** REST client (no socket) is cold-start-safe; prefer shared Redis
  over new in-process server caches (which are per-instance and never cross-invalidated).

---

## 9. Cost model (why this pays)

Rough per-scan arithmetic at the two hottest benches:
- **Packing:** every SKU scan = `get-title-by-sku` 4–7 round-trips. Phase 1 → ~0 on a hit. At even a
  modest scan cadence across packers, that's the single largest reference-read reduction.
- **Tech:** every matched order-load = `manuals/resolve` (2–3 RT) + the order VM. Phase 1 removes the
  manuals read (near-static) from 100% of matched scans; Phase 2 collapses the order VM to a 15–30s
  cache shared across the bench.
- **Auth:** `staff` overrides on *every* authed request, uncached today (Phase 3) — the highest
  request-frequency read in the app.
- **Dashboards:** N polling tabs × (15s–300s) → one DB read per TTL window (Phase 4).

Neon bills Active-CPU + connections; collapsing repeated identical reads onto cache hits is a direct
CU reduction. **Instrument first (Phase 0 metrics), then quantify** — the hit-rate numbers turn this
from "should help" into a measured $/CU saving, and guard against caching cold data for no benefit.

---

## 10. Testing + rollout

- **DB-free unit tests** (house `domain-unit-test` pattern): `getOrSet` (hit/miss/error fail-open),
  `withCacheLock` (single-flight), key/tag org-scoping, the invalidation registry. Inject a redis
  fake + a loader spy; assert loader called once on a stampede, zero times on a hit, and that org-A
  invalidation leaves org-B keys.
- **Tenancy regression test** in the `tenancy:*` guard family: cross-org key + tag isolation.
- **Integration smoke** against a real Upstash (preview env): hit-rate > 0, invalidation observed.
- **Rollout:** Phase 0 behind kill-switch (default ON prod, OFF preview/CI). Each subsequent
  namespace flips on via the per-namespace allowlist + per-org `resolveForOrg`, watched on the
  metrics dashboard. Any staleness bug → flip the namespace off (DB fallback is always live).
- **Neon-cost-reviewer** runs on every cache PR (it's the agent that flags missing-cache/short-TTL).

---

## 11. Anti-patterns / never-cache registry (authoritative)

**NEVER cache the response of:**
- `POST /api/tech/scan` (both TRACKING + FNSKU paths — writes TESTED status, SAL, logs).
- `POST /api/receiving/lookup-po` (creates/updates cartons, records scans, syncs Zoho).
- `POST /api/receiving/scan-serial`, `POST /api/tech/add-serial[-to-last]` (append serials).
- `POST /api/shipped/scan-out`, `POST /api/fba/shipments/*/items` (mutations).
- `GET /api/sku/by-tracking` and the `tech/scan` TRACKING read **until §5's write-extraction lands** —
  they call `resolveShipmentId`, which INSERTs/syncs a shipment. Caching them skips registration.

**NEVER cache (live authoritative state):**
- The `serial_units` row in `GET /api/serial-units/[id]` — it *is* the lifecycle state; a stale read
  shows wrong status/location. (Cache only its title/catalog *joins* via the `sku-catalog` cache.)
- `sku_stock.stock/location` — decremented every pick/pack. Split out of any cached SKU bundle.
- `staff_sessions` row — write-on-read (`last_seen_at`); caching masks revocation.
- `resolveTestingScan` fan-out result — live receiving-line state.

**DO NOT cache (already static code constants — Redis adds latency, removes nothing):**
- `src/lib/conditions.ts`, `condition-tone.ts`, `source-platform.ts`, the Settings Registry
  *definitions*, `priority-override` tiers, label seed `LABEL_DEFAULTS`. These compile into the
  bundle.

**Other traps:**
- Global (non-org) tags — the current bug; org-scope in Phase 0.
- Caching a bundle that mixes stable + volatile fields (the `get-title-by-sku` stock trap).
- Putting invalidation in `recordAudit` (swallows errors) or the domain helper (bypassed by other
  callers) — put it at the route chokepoint or `applyTransition`.
- New in-process server Map caches — per-instance, never cross-invalidated under Fluid Compute.

---

## 12. Sequencing summary

```
Phase 0  Substrate: client consolidation · org-scoped keys+tags (v2) · getOrSet · withCacheLock ·
         kill-switch · metrics · tag registry.           [no behavior change; tenancy test green]
Phase 1  Station reference cache: get-title-by-sku (stable slice) · manuals · fnsku · kit/qc · gtin ·
         reason_codes.                                   [stations-first payoff, lowest risk]
Phase 2  Station read models: order-detail · fba today/board · pack policy · po-by-ref.
         Prereq: extract resolveShipmentId write.        [short-TTL, scan writes already bust tags]
Phase 3  Promote per-instance Maps → shared Redis: staff overrides (uncached today) · roles · org ·
         flags · catalog · workflow entry/nodes.         [every-request auth hot path; cross-instance]
Phase 4  Dashboards/feeds + polling→push: cache polled endpoints, then cut refetch cadences.
```

Each phase is independently shippable behind the kill-switch, verified by the metrics dashboard, and
reversible to DB in one flag flip.

---

### References
- Foundation: `src/lib/cache/upstash-cache.ts`, `src/lib/workflow/lock.ts` (`redisAdvanceLock`),
  `src/lib/api-guard.ts`, `src/lib/api-idempotency.ts`.
- Invalidation: `src/lib/orders/invalidation.ts`, `applyTransition`/`transition`,
  `src/lib/api/crud.ts`, `src/lib/realtime/publish.ts` + `channels.ts`.
- Client cache: `src/queries/keys.ts` (`qk`), `src/lib/queries/*` (queryOptions factories),
  `src/components/Providers.tsx`.
- Hot reads: `get-title-by-sku/route.ts`, `manuals/resolve/route.ts`, `tech/scan/route.ts`,
  `receiving/lookup-po/route.ts`, `orders/lookup/[id]/route.ts`, `sku-catalog-queries.ts`.
- Rules: `.claude/agents/neon-cost-reviewer.md`, `.claude/rules/backend-patterns.md`,
  `.claude/rules/display/station.md`, `.claude/rules/source-of-truth.md` (SKU collision).
```
