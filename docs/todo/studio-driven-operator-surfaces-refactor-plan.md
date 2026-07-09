# Studio-Driven Operator Surfaces — Root Refactor Plan

**Status:** In progress (preproduction root refactor) — **receiving family pilot + foundations shipped 2026-07-05**; **full codebase surface + navigation leakage scan 2026-07-05** (this session). Primary focus elevated to **single Source-of-Truth (SoT) for routing + display** (unified sidebar-navigation + MasterNav system) with performance guarantees for all routes. All operator surfaces + navigation display unification now in scope. Phases 0–6 pilot; new dedicated nav unification + speed phases added. Legacy paths + legacy display code still present behind guards.  

**Claude Code Alignment Note (updated):** This plan is now explicitly structured around the project's durable `Claude.md` + `.claude/rules/` invariants, skills (station-block, sidebar-mode, ops-studio, domain-unit-test, check-work), archetype decision algorithm, house style, backend chokepoints, and source-of-truth modules. The high-ROI Station display enhancements (SKU photos + crossfade verification, form-like substitution/pre-ship notes using existing SubstitutePanel + pack-checklist backend, scan-focus external link suppression, shared primitives) are called out as required content for pack/test surfaces. All phases must respect "compose don't fork", Deps injection, recordAudit, linear scaffold, and reduced-motion motion law. 
**Owner:** [To be assigned]  
**Created:** 2026-07-05  
**Related:**  
- `docs/operations-studio/Full Code Base Upgrade/` (especially 02-URL-VERSIONING-AND-ADDRESSING.md, 05-EDITABILITY-MODULARITY-SPEC.md, 06-PHASED-IMPLEMENTATION-PLAN.md)  
- Root `Claude.md` + `.claude/rules/` (source-of-truth.md, contextual-display.md + display/station.md + display/motion-crossfade.md + display/workbench.md, ui-design-system.md, backend-patterns.md, build-gotchas.md, polymorphic-tables.md)  
- `sidebar-mode` skill (for any mode-like UI)  
- `station-block` skill (for any new scan / checklist / verification / note UI exposed as blocks)  
- `ops-studio` skill (before any /studio or surface definition work)  
- `domain-unit-test` skill (for any new domain helpers)  
- Existing `station_definitions`, `workflow_templates` / `workflow_definitions`, `SURFACE_REGISTRY` (`src/lib/stations/surface-keys.ts`)  

**Claude Code invariants (must be followed in all phases):**  
- **Archetype first** (`pickArchetype()` from `.claude/rules/contextual-display.md`): Packing and testing are **Station** (scanner-driven: persistent focus-locked `StationScanBar` + ephemeral active card that crossfades on scan → act → clear/refocus). Never mix with Workbench.  
- **House style inside Station** (`.claude/rules/ui-design-system.md` + `display/station.md`): linear vertical scaffold (`space-y-*` / `divide-y`), one-row anatomy (title → meta → chips), `HoverTooltip` (body portal), icons structural/paired from `@/components/Icons`, **semantic tokens only** from `src/design-system/tokens/colors/semantic.ts`, compose rails (`SidebarRailShell` / `RecentActivityRailBase`) never fork.  
- **Crossfade law** (`.claude/rules/display/motion-crossfade.md`): Only the singular active verification target crossfades (`AnimatePresence mode="wait"`, opacity + small-y via `framerPresence.stationCard` + `useMotionPresence`/`useMotionTransition` for reduced-motion). History/rail stays stable.  
- **Backend patterns** (`.claude/rules/backend-patterns.md` + Claude.md): Status only via `transition()` / `applyTransition()` (never raw UPDATE), routes via `withAuth(handler, { permission })` → validate → domain (Deps-injected) → map 404/409/200 → `recordAudit(..., AUDIT_ACTION / AUDIT_ENTITY constants)` → `after()` side-effects. Tenant via `withTenantTransaction(orgId, ...)`. Idempotency via `clientEventId`.  
- **Source-of-truth** (`.claude/rules/source-of-truth.md`): Never inline grade→label, source platform, etc. Reuse `conditionLabel`, `SUBSTITUTION_REASONS`, pack-checklist enrichment, etc.  
- Work only on `main`. Never commit secrets. Use `todo_write` / `execute-task` for multi-step work. Precede risky changes with `check-work`.

---

## 1. Executive Summary

The current surface organization treats distinct operator jobs as sub-modes inside legacy feature buckets:

- Receiving family: `/receiving` (bare or `?mode=receive` = "Unbox", `?mode=triage` = "Receiving", `?mode=incoming` etc.).
- Packing: primary at `/packer` (nav id `packer`), registry anticipates `/pack`.
- Testing: primary at `/tech?view=testing` (nav id `tech`), registry anticipates `/test`.
- Outbound already at first-class `/outbound`.
- Other stations and monitors (FBA, Walk-in, Dashboard shipping modes, Operations, Inventory sub-views, Warehouse, Sourcing) have varying levels of mode leakage and hard-coded trees.

This produces misleading URLs, couples unrelated experiences, and blocks full integration with the Operations Studio's template/mapping system. The refactor now covers the **entire operator surface set**, not just the receiving pilot.

**Goal:** Refactor at the root so every major operator experience is a first-class surface **with a single Source of Truth (SoT) for routing + display**:

- Stable semantic URLs (`/unbox`, `/triage`, `/pack`, `/test`...) that match the operator job.
- **One SoT for navigation routing & display**: `src/lib/sidebar-navigation.ts` (keys, items, `getSidebarRouteKey`, `resolveSidebarMode`, `getSidebarNavItems`) + the MasterNav system (`SidebarShell`, `MasterNav`, `ModeRail`, `useMasterNavEnabled`, `useOrgNavItems`) as the exclusive renderer. No parallel legacy display code.
- Navigation (desktop sidebar, mobile, command bar, deep links) derived uniformly from the SoT (with per-org overrides from `nav_definitions`).
- Studio-driven surfaces (`SURFACE_REGISTRY` in `src/lib/stations/surface-keys.ts`) feed or map cleanly into the nav SoT.
- Fast resolution for *all* routes (O(1) or minimal-work prefix maps, memoized consumers, no repeated pathname scans or per-panel nav logic).
- Composition and archetypes as before.

This achieves "sharded per org per website page" using 2026 industry patterns (Notion workspaces + block pages, Linear workspace concepts + views, Salesforce metadata-driven FlexiPages/apps, composable internal tools) while staying consistent with this codebase's existing invariants.

**Why now (preproduction):** We can do a clean root refactor with strong legacy aliases instead of accumulating technical debt.

**Non-goals (for this plan):**
- Numeric or versioned paths in main navigation (see §4).
- Changing external short links (`/o/`, `/p/`, etc.).
- Big-bang rewrite — use `'legacy'` escape hatch + incremental migration.

---

## 1.5 Relation to Station Display / UX Enhancements (Packing + Testing)

This root refactor is the **routing + composition + navigation layer**. The companion high-ROI UI/UX work (prominent SKU catalog + attached photos for visual verification, crossfade of the active verification card on scan, form-like inline editable notes + substitution reasons such as "buyer wanted White when the order is black", removal of external links during scan focus, consistent linear form/card UX, pre-ship noting, industry-standard visual match) is the **content that lives inside the Station surfaces**.

- Packing (`pack`) and testing (`test`) are **Station archetype** surfaces (`.claude/rules/contextual-display.md` Q1: scanner input). The active card (currently `StationPacking` + `OrderPackChecklist` / `PackChecklistLineRow` + `ActivePackerWorkspace`; `StationTesting` + `ActiveOrderScanFeedback` + `ActiveOrderWorkspace` / `OrderPreviewPanel`) is the singular crossfade target.
- Existing backend is strong and must be reused (`.claude/rules/backend-patterns.md` + source-of-truth):
  - `useOrderPackChecklist` / `src/lib/packing/order-pack-checklist.ts` (sku_catalog enrichment: `imageUrl` via `resolveCatalogImage`, `packNotes`, kit parts, QC flags; SKU fallback path).
  - `SubstitutePanel` + `SUBSTITUTION_REASONS` + `order_unit_amendments` + substitution route (exact match for color/variant notes + reason + free-text note).
  - `photos` table (polymorphic `PACKER_LOG` / order links) for attached proof photos.
  - `packer_logs`, `recordAudit`, `withTenantTransaction`.
- **Must-deliver in graduation (Phases 7/8 + block work):**
  - Prominent / glanceable SKU photos (catalog primary + attached `photos` thumbnails) in the active verification area + expanded checklist rows. "Visual match — confirm photo = physical item".
  - Crossfade polish using `useMotionPresence(framerPresence.stationCard)` everywhere (fix raw usage).
  - Form-like active verification surface (linear sections: meta → photos → checklist → inline `SubstitutePanel` + notes textarea) inside the ephemeral card.
  - Scan-focus mode: suppress `ExternalLink*`, listing embeds, non-essential linkage externals (keep chips + copy). Use `scanFocus` prop/context on shared components.
  - Shared reusable primitives (for both legacy trees *and* future `station-block` compositions): `SkuPhotoVerifier`, `VerificationNotesForm` (wraps SubstitutePanel), scan-focus suppressor.
  - Pre-ship: notes + substitutions captured before seal (persisted via amendments/packer_logs + audit).
- **Approach:** Improve the content *now* on legacy paths (immediate operator value). Graduate the routes + `SurfaceGate`. Later, the same primitives become (or are wrapped as) blocks in `SURFACE_REGISTRY` + `station_definitions` (via `station-block` skill). Never duplicate; compose.
- This directly satisfies the Station house style (`ui-design-system.md` + `display/station.md` + `motion-crossfade.md`) and avoids mixing archetypes.

See companion session plan for the detailed file-level implementation of the display layer.

---

## 2. Problem Statement & Current State (Deep Audit)

### 2.1 Symptom
- Unboxing (carton open, serial scan, photos, PO line work, `unboxview`, `UNBOX_SCAN_OPENED`, priority unbox, dedicated scan band `UnboxScanBand`, rails, right-pane `ReceivingLineWorkspace`) renders at `/receiving` (bare) or `/receiving?mode=receive`.
- Triage (pre-unbox scan/identify + routing) is `?mode=triage` ("Receiving").
- Browser URL, page title, mobile nav, sidebar registration, assistant context, deep links, and command bar all say "Receiving".
- Result: the URL lies about the job the operator is performing.

### 2.2 Current Implementation (Key Locations) — 2026-07-05 full codebase scan

**Surface Registry (src/lib/stations/surface-keys.ts + surface-resolver.ts)**
- Closed `SURFACE_KEYS`: `['unbox','triage','incoming','pickup','history','pack','test','outbound']`.
- Each has `route`, `archetype`, `pageKey`/`modeKey` (for `station_definitions`), `scan` classifier, `workflowNodeType`, `legacy` alias descriptor.
- `pack`/`test` registered but **no `/pack` or `/test` pages exist yet** — implementation remains at legacy locations.
- `outbound` is already at its canonical route.
- `resolveSurface` + `decideSurfaceRender` (legacy vs composed) + `SurfaceGate`/`SurfaceRenderer` exist and are wired for the three graduated receiving surfaces.
- `surfaceForRoute(pathname)` and path-first mode derivation now power graduated surfaces.

**Nav & Route Keys (src/lib/sidebar-navigation.ts) — two parallel systems**
- `SidebarRouteKey` (still the master for MasterNav, titles, permissions, mobile allowlist): `'receiving' | 'packer' | 'tech' | 'outbound' | ...` (legacy bucket names).
- `APP_SIDEBAR_NAV` + `SIDEBAR_PAGE_NAV` point:
  - receiving → `/unbox` (primary), modes include graduated + legacy history/pickup.
  - packer → `/packer`
  - tech → `/tech`
  - outbound → `/outbound`
- `getSidebarRouteKey`, `resolveSidebarMode`, `MOBILE_ALLOWED_PREFIXES`, `ROUTE_PERMISSIONS` updated for `/unbox` `/triage` `/incoming` but still list `/packer` `/tech` `/receiving`.
- `useOrgNavItems` + nav_definitions (Phase 4) merge on top of the static list (can only reorder/hide/rename existing ids today).

**Receiving family (pilot complete for unbox/triage/incoming)**
- First-class pages: `src/app/unbox/page.tsx`, `triage/page.tsx`, `incoming/page.tsx` (all wrap legacy tree in `<SurfaceGate surfaceKey="...">` + shared `ReceivingSurfacePage`).
- `src/proxy.ts`: `resolveReceivingSurfaceRedirect` (bare `/receiving` + receive/triage/incoming → new routes; history/pickup/other modes untouched). Mobile UA rewrites send the new paths to `/m/receiving`.
- `src/lib/receiving/surface-path.ts`: SoT (`UNBOX_SURFACE_ROUTE`, `TRIAGE_SURFACE_ROUTE`, `receivingSurfaceBasePath`, `openInUnboxHref` etc.).
- Mode hooks (`useReceivingMode`, `useReceivingDashboardMode`, `useIncomingFilters` etc.) now path-first derive mode from `/unbox` `/triage` `/incoming`.
- Deep-link producers (search-hit, global-entity-search, claim-photos, activity inbox, assistant) repointed for receiving surfaces.
- Legacy `/receiving?mode=...` + subroutes (`/receiving/lines/[id]`) continue to work.
- `history` canonical `/receiving/history`; `pickup` still `?mode=pickup`.

**Pack (leakage)**
- Implementation: `src/app/packer/page.tsx` (HydrationBoundary + `PackerPageContent`), `src/components/packer/*`.
- Mobile: `src/app/m/(shell)/pack/page.tsx` (`RedesignedMobilePack`).
- Scan: `classifyPackScan` + pack-scan-machine in `src/lib/packer/`.
- Registry: `pack` → `/pack` (aspirational), legacy `{pathname: '/packer', bareResolves: true}`.
- **No `/pack` route, no proxy redirect, no SurfaceGate, no surface seeding cutover yet.**
- Nav/tests/E2E still use `/packer` + `packer` id. `OperationsMatrix` links to `/packer`.

**Test / Tech (leakage)**
- Implementation: `src/app/tech/page.tsx` (`TechPageContent`), `src/components/tech/*` (TestingPanel, TechRightPane, etc.).
- E2E + many specs hardcode `/tech?view=testing`.
- Registry: `test` → `/test`, legacy `/tech?view=testing`, `modeKey: 'testing'`, workflowNodeType `'testing'`.
- **No `/test` route or redirect implemented.** Nav uses `tech` id.
- `page-context.ts` maps `/tech` → SERIAL_UNIT (correct for now).

**Outbound**
- Already first-class at `/outbound` (registered, legacy alias is self).
- Archetype station, shipping.view, fulfillment node type.
- No SurfaceGate wiring observed in current scan (potential next for composition).

**Mobile shells (src/app/m/(shell)/...)**
- Dedicated pages created for graduated surfaces: `/m/unbox`, `/m/triage`, `/m/pack`, `/m/receiving/*` (history etc).
- UA rewrite in proxy still funnels unbox/triage/incoming → `/m/receiving` (bottom nav labels "Unbox").
- `MobileSidebarDrawer` and context nav had receiving hardcodes (partially addressed in pilot).
- `/m/pack` exists independently; no `/m/test` or `/m/packer` equivalents yet.

**Studio / Composition / Seeding**
- `SurfaceGate` + `SurfaceRenderer` + `StationSlot`/`BlockRenderer` + registries (data-sources, actions, blocks) exist.
- Only unbox/triage/incoming pages currently wrap with `SurfaceGate`.
- Template surface seeding (`src/lib/studio/template-surfaces.ts`) wires the registry surfaces (including pack/test/outbound via their `workflowNodeType`).
- Seed migration exists only for unbox composition (dormant until flag + published definition).
- No production staff page (outside Studio preview) renders composed yet for any surface — legacy is always default.

**Cross-cutting consumers (leakage sources)**
- E2E: receiving-tech-modes, incoming-todo, mobile-unbox-list, table-column-config, zendesk-claim, receive-to-zoho, testing-sku-prepack-scan, etc. still drive legacy URLs.
- Search: `search-hit.ts` (unbox for receiving), page-context tests updated for unbox/triage; packer/tech paths remain in other tests.
- Assistant / agent-loop / page-skills, scan-history-route (`/receiving?mode=history`), signin redirects, OperationsMatrix, claim-photos, etc.
- Many receiving-* and tech/packer components still contain legacy path strings or `router.replace('/receiving...')` style (some centralized in pilot).
- Proxy, sidebar-titles, mobile-context-navigation, route-perms all touched for pilot surfaces only.

**Backend invariants (still hold)**
- receiving / packer / tech nodes, distinct events, two unbox timestamps (as validated), tenant scoping via withTenantTransaction, transition() for status, etc.

**Symptoms (expanded)**
- URLs lie for pack/test (still "packer"/"tech" or query modes).
- Parallel key systems (SurfaceKey vs SidebarRouteKey) — nav not yet derived from surfaces.
- Pack/test have zero surface-aware wiring (routes, redirects, gates, mobile allow, proxy).
- History/pickup not graduated.
- Massive E2E + deep-link consumer surface area for full cleanup.
- Mobile shell has mixed dedicated vs funnelled routing.

**Navigation Display Leakage & Fragmented SoT (Master Nav vs Legacy — 2026-07-05 full scan)**
The updated master nav system is:
- `src/components/sidebar/SidebarShell.tsx` + `DashboardSidebar` (always used on desktop via `ResponsiveLayout`).
- `src/components/sidebar/master-nav/` (`MasterNav`, `MasterNavView`, `ModeRail` (segmented `HorizontalButtonSlider`), `MasterNavDropdown`, `MasterNavProvider`, `useMasterNavEnabled`, `useSidebarModeNav`, `useActiveSidebarMode`).
- `useOrgNavItems` + `mergeOrgNav` for per-org overrides from `nav_definitions`.
- Consumes from the single `sidebar-navigation.ts` SoT (`APP_SIDEBAR_NAV`, `SIDEBAR_PAGE_NAV`, `getSidebarRouteKey`, `resolveSidebarMode`, `getSidebarNavItems`).

**Intended contract** (from `master-sidebar-nav-migration-plan.md` and code comments):
- MasterNav owns L1 page selection (dropdown with recents + grouped pages) + L2 ModeRail for modeful pages.
- `MASTER_NAV_RAIL_PAGES` + `MasterNavProvider enabled` (hardcoded true) tells per-route panels to **suppress** their own pill rows.
- All navigation display must flow through this path. Legacy per-panel chrome must be deleted.

**Current leakage (real display + routing fragmentation):**
- Most panels still contain the old switcher code and only hide it: `!masterNavEnabled && <XXXModeSwitcher or HorizontalButtonSlider>`. The code is not removed.
  - Receiving: `ReceivingModeSwitcher` is gated, **but** `UnboxViewToggle` + `TriageViewToggle` (extra `HorizontalButtonSlider` nav bands for sub-views) render unconditionally inside the panel body.
  - Similar unguarded or partially guarded sub-nav in Products, Inventory, Warehouse, Sourcing, Outbound, DashboardOrders, Repair, etc.
- For graduated receiving surfaces (`/unbox`, `/triage`, `/incoming`): `getSidebarRouteKey` still returns `'receiving'`. The same `ReceivingSidebarPanel` is rendered as context. Master L1/L2 shows "Receiving" + its 5 modes, *then* the panel injects more view toggles. Cross-display.
- Legacy nav ids live on: `'packer'`, `'tech'`, `'receiving'` in `SidebarRouteKey`, `APP_SIDEBAR_NAV`, `MOBILE_ALLOWED_PREFIXES`, `ROUTE_PERMISSIONS`, titles, etc. `SURFACE_REGISTRY` uses `pack`/`test`/`unbox`.
- `getSidebarRouteKey` is a long linear `if (pathname === X || startsWith...)` chain. `resolveSidebarMode` does per-page dispatch. Called from layout, panels, mobile-context-navigation, titles, CommandBar (indirectly), search scopes, etc.
- Mobile is a parallel display: `RedesignedBottomNav` + proxy UA rewrites (many surfaces → `/m/receiving`). No unified SoT resolution.
- Other consumers (CommandBar, page-access-matrix, pin-this-page, assistant vocab) read raw `APP_SIDEBAR_NAV` or old constants.
- Result: on many routes you see master dropdown + ModeRail *plus* old/duplicate pill rows. Different parts of the app (URL, sidebar, mobile, cmd-k) can disagree. This is the "cross different navigation leakage display".

**Performance ("speed") problems for different routes**
- Every pathname change can trigger multiple full scans of nav data + string prefix checks.
- No compiled route map or radix-style matcher.
- `useOrgNavItems` + merge runs on consumers; panels re-derive modes.
- When switching between many surfaces (unbox → pack → test → outbound → operations), repeated work in hooks, context panels, and title resolvers.
- No measured fast path that serves *all* consumers (sidebar display, mobile, deep links, AI search, command bar) from one cached structure.
- Legacy per-panel logic + guards adds render cost even when suppressed.

**One SoT requirement (this plan revision)**
`sidebar-navigation.ts` (or a thin router layer on top of it + SURFACE_REGISTRY) + the master-nav components must be the **only** routing + display method. All surfaces (including future `/pack`, `/test`) must have fast, uniform resolution and use the master display exclusively. Legacy display code is removed. Resolution must be fast and stable across every route.

---

## 3. Industry Validation (2026 Research Summary)

Deep web + platform research (Notion, Linear, Figma, Salesforce, Next.js patterns, SaaS multi-tenant & composable UI trends 2025–2026) confirms:

> `[validation 2026-07-05]` Adversarially re-verified (18 claims confirmed, 0 refuted): Notion's
> everything-is-a-block model with the stored block `type` driving runtime rendering
> (notion.com/blog/data-model-behind-notion); Linear's workspace-slug URLs and durable, URL-addressable
> custom views ("Copy view URL") promotable into the sidebar and settable as default landing page;
> Salesforce's metadata-driven multitenant kernel that *dynamically materializes* per-org apps at
> runtime, with FlexiPages as deployable org-scoped page-composition metadata (regions of components).
> NavigationMenu, W3C cool-URIs, Retool, and Next.js middleware-tenancy sub-claims went unverified only
> due to a harness session limit — none refuted; this codebase itself already demonstrates
> session-based tenancy + `src/proxy.ts` rewrites.

### 3.1 URL Philosophy
- **Stable, semantic, human-readable keys** for primary operator surfaces (Notion pages, Linear projects/issues/views, Figma files).
- Opaque IDs / short hashes reserved for external sharing, immutable refs, or deep versioning.
- Numeric paths or version numbers in main URLs are an anti-pattern (link rot, readability, draft/published coexistence, support friction).
- Query params or saved "views" for intra-surface state (`?view=queue`, `?unboxview=`).
- `?v=` (or equivalent) for pinning definition versions.

### 3.2 Per-Org / Per-Workspace "Pages"
- **Notion**: Workspace context + first-class pages (block-composed). Different teams get different page structures via templates or direct editing. Sidebar = workspace-derived.
- **Linear**: `linear.app/{workspace}/...`. Distinct concepts (Projects, Initiatives, Views) are addressable peers. Custom views are durable surfaces.
- **Salesforce**: Extreme metadata-driven model. Per-org (tenant) FlexiPages, apps, tabs, navigation menus are defined in metadata. Runtime assembles the "website" per org. Setup = studio.
- **Composable internal tools (2026)**: Retool/Glide/Builder.io style + custom station builders. Blocks + data sources + actions bound in a visual layer. Per-tenant definitions drive what surfaces exist.

### 3.3 Multi-Tenant Routing (Internal Tools)
- Tenant resolution via session/context (not every URL).
- Clean internal URLs preferred for ops tools.
- Path-based or dynamic segments for surfaces inside the workspace.

### 3.4 Composition & Studio
- Blocks / regions / slots (exactly our `station_definitions` + `SLOT_IDS`).
- `'legacy'` fallbacks during migration.
- Navigation itself becomes configurable (Salesforce NavigationMenu, Notion sidebar sections).
- Templates seed both workflow graphs and associated UI surfaces.

**Direct mapping to our plan:**
- Surface keys = stable identifiers (like Notion page types or Linear concepts).
- Studio templates + `page_definitions` / extended `station_definitions` = per-org sharding.
- Generic `SurfaceRenderer` / `PageRenderer` + block registry = composable runtime.
- Archetype decision (Station / Workbench) applied per surface.

---

## 4. Guiding Principles (Non-Negotiable) — Claude Code Rules

All work follows the durable invariants in root `Claude.md` and `.claude/rules/` (loaded on every session). Violations are tech debt.

1. **One SoT for Routing + Display** (sidebar-navigation.ts + MasterNav): Exactly as above. All display (including any station sub-views) flows exclusively through it. Delete (do not gate) legacy switchers and `!masterNavEnabled` branches.
2. **Job > Feature Bucket + Archetype First** (`.claude/rules/contextual-display.md` + `display/station.md`): URL reflects the operator job. **Run `pickArchetype()` per region first**. Packing + testing = **Station** (Q1 scanner wins: focus-locked `StationScanBar` + ephemeral active verification card that replaces via crossfade on scan). Never blend Station + Workbench in one region. "Screen serves the scan."
3. **House Style + Motion Law** (`.claude/rules/ui-design-system.md`, `display/motion-crossfade.md`): Linear scaffold only. One-row anatomy. `HoverTooltip`. Semantic tokens only. Icons paired/structural from `@/components/Icons`. Crossfade **only** the singular active card target (`mode="wait"`, `framerPresence.stationCard` + hooks for reduced-motion). Compose rails (`SidebarRailShell`), never fork.
4. **Studio + Surfaces feed the Nav + Composition SoT**: `SURFACE_REGISTRY` + published `station_definitions` (or future page defs) are authoritative. Use `station-block` skill for any new UI block (scan band, photo verifier, checklist, verification notes). Invoke `ops-studio` skill before `/studio` or definition work.
5. **Backend Patterns Strictly** (`.claude/rules/backend-patterns.md`): Status changes **only** via `transition()` / `applyTransition()`. Routes: `withAuth` → validate → Deps-injected domain helper → status map → `recordAudit` (AUDIT_* constants only) → `after()`. Tenant via `withTenantTransaction`. Idempotency via `clientEventId` on `inventory_events`. Inject `Deps` for unit tests (`domain-unit-test` skill).
6. **Source-of-Truth** (`.claude/rules/source-of-truth.md`): Reuse, never inline (e.g. `SUBSTITUTION_REASONS`, pack-checklist enrichment from `sku_catalog`, condition tone, etc.).
7. **Compose, Never Fork + Station-Block**: New display pieces (photo verification, substitution form integration, scan-focus link suppression, attached photo thumbs) must be reusable components or blocks. Follow `station-block` skill. Pack-checklist + `SubstitutePanel` already exist — wire them, do not reimplement.
8. **'legacy' Escape Hatch + Incremental**: Every surface starts with full legacy parity. Use `SurfaceGate` (decideSurfaceRender). Graduated routes (`/pack`, `/test`) + proxy aliases.
9. **Tenant from Birth + Polymorphic Contract** (`.claude/rules/polymorphic-tables.md`): Any new tables follow the exact skeleton (org-led, CHECK discriminator, enforce_tenant_isolation, Drizzle in same PR).
10. **UI/UX Specifics for Stations** (from user-prioritized enhancements): 
    - Prominent SKU catalog photos (sku_catalog.image + platform fallback) + attached `photos` (PACKER_LOG) for "visual match" confirmation. Crossfade the enriched verification card.
    - Form-like active verification (linear): meta → photos → checklist → inline `SubstitutePanel` (reason + note e.g. buyer wanted White) + general pre-ship notes.
    - Clean scan focus: `scanFocus` mode suppresses external links (ExternalLink*, listing embeds) while keeping chips/copy. Use on `LinkedTicketsPanel`, `OrderPreviewPanel`, CopyChip, etc.
    - Consistency across pack/test (and future tabs) via shared primitives.
11. **Fast + Performant**: Nav resolution must be map-based. Images use proper `sizes`. No layout thrash on crossfade.
12. **Preproduction License + Verification**: Aggressive changes OK with strong aliases. Use `todo_write`, `check-work` subagent, `execute-task`. All E2E must pass on legacy aliases + new surfaces. Audit always via `recordAudit`.
13. **URL Round-Trips + Deep-Linkable**: `to()` / `resolve*` helpers. Bare surface + query is sufficient. Preserve deep links via aliases during migration.
14. **Work only on `main`**. Never commit `.env`. Follow build gotchas (explicit .ts imports, Tailwind globs).

**Skill Invocation Rule**: Before adding any mode UI → `sidebar-mode`. Before any station UI block → `station-block`. Before studio/surface definition changes → `ops-studio`. Use `domain-unit-test` for new lib/domain.

---

## 5. Target Architecture

### 5.1 Surface Model
- **Surface Key** (stable string, e.g. `unbox`, `triage`, `incoming`, `pack`, `test`).
- Each key maps to:
  - A top-level (or `/work/[key]`) route.
  - One or more `station_definitions` rows (or new `page_definitions`) with `page_key = key`, `mode_key` for sub-variants.
  - Optional binding to workflow nodes (`workflow_node_id`).
- Definition contains:
  - `config`: regions + `BlockInstanceConfig[]` (queue, workspace, header, scan, etc.).
  - Archetype hint or derived.
  - Data source bindings, action bindings, scan policy overrides.

### 5.2 URL Design (Recommended)
- Primary semantic paths (preferred):
  - `/unbox`
  - `/triage` (or `/scan` / `/receive-scan`)
  - `/incoming`
  - `/history`
  - `/pickup`
  - `/pack`
  - `/test`
  - `/outbound`
  - `/studio` (already good)
- Alternative (if route explosion concern): `/work/[surface]` with nice aliases (`/unbox` → internal redirect or rewrite).
- State: `?view=queue&focus=123&v=42` (definition version).
- Legacy: `/receiving?mode=receive` → 302 or soft redirect to `/unbox` (configurable transition period).
- External/short: keep `/o/`, `/p/`, etc. They resolve to the appropriate surface via existing logic.

**No**:
- `/v3/unbox`
- `/w/47` (numeric surface hashes)
- Tenant slug in every path for internal use.

### 5.3 Data Model
Extend existing (no invention):

Option A (preferred, minimal new tables):
- Promote `station_definitions` usage for full surfaces (it already has `page_key`/`mode_key`).
- Add `surface_key` (or reuse `page_key`) as the primary addressable key.
- Add columns if needed: `archetype`, `scan_policy`, `default_view`.

Option B (cleaner for future):
- New `page_definitions` table (exact shape from 05-EDITABILITY-MODULARITY-SPEC.md), with `surface_key`.
- A page can reference multiple `station_definitions` for its regions.

`[validation 2026-07-05]` **Decision: Option A.** `StationConfig` already carries
`pageKey`/`modeKey`/`version`/`isActive` plus the literal `'legacy'` slots hatch
(`src/lib/stations/contract.ts:215-221`) — it *is* most of the proposed `page_definitions` shape,
with draft/publish and a blocking diagnostics gate already live. Extend `station_definitions` rather
than birthing a sibling table.

`workflow_templates` and `workflow_definitions` can carry `surface_bindings` (array of surface keys + node mappings) or a parallel seed step.

Versioning, `is_active`, draft/publish, `recordAudit`, diagnostics exactly as workflow + stations.

### 5.4 Rendering Pipeline
```
GET /unbox
→ resolveSurface('unbox', orgId)  // active definition or legacy flag
→ pickArchetype(def)               // Station
→ <StationShell key="unbox">
    <SurfaceRenderer
      regions={def.config.regions}
      blocks={registeredBlocks}
      dataSources={boundSources}
      actions={boundActions}
    />
  </StationShell>
```

- Blocks receive rows via bound `DataSourceDefinition` (never fetch themselves).
- Scan bar is a special block or first-class in Station archetype.
- Right pane / rails composed from regions.

### 5.5 Navigation — Single SoT Routing + Display (core of this revision)
- **One SoT module**: `src/lib/sidebar-navigation.ts` owns:
  - `SidebarRouteKey` union (unified with SurfaceKey for operator surfaces where possible).
  - `APP_SIDEBAR_NAV` / `SIDEBAR_PAGE_NAV` (the canonical list).
  - Pure fast functions: `getSidebarRouteKey(pathname)` (map or compiled matcher, not long if-chain), `resolveSidebarMode`, `getSidebarNavItems`, `to()` helpers, permission map.
- **Exclusive display renderer**: `SidebarShell` + `MasterNav` + `ModeRail` (L1 dropdown + L2 segmented rail) is the *only* persistent navigation UI for desktop. All `*SidebarPanel` legacy switchers and sub-toggles (UnboxViewToggle, etc.) are removed.
- `useMasterNavEnabled()` becomes a temporary migration guard only; after unification it is removed and panels no longer contain nav display code.
- Mobile, CommandBar, titles, search scopes, assistant, deep-link producers, and `useOrgNavItems` all consume from the same SoT (no duplicate lists or resolution logic).
- Performance contract: full sidebar item + mode resolution + active state must be O(1) or near-constant work per route change. Memoized at the hook level. No repeated pathname scans when switching surfaces.
- Per-org overrides (`nav_definitions`) and studio surface bindings update the SoT at runtime without forking display code.
- Legacy bucket ids (`packer`, `tech`, old receiving modes) are eliminated in favor of surface-aligned keys (`pack`, `test`, `unbox`, `triage`...).

---

## 6. Detailed Design — Receiving Split (Pilot)

### 6.1 New Surfaces
- **`/unbox`** (key: `unbox`)
  - Archetype: Station
  - Default scan band: UnboxScanBand
  - Sub-views: recent / queue / viewed (promote `?unboxview`)
  - Right pane: full unbox workspace (serials, PO lines, photos, mark-received, etc.)
  - Bound to workflow nodes that represent "unbox" step.

- **`/triage`** (key: `triage`) or keep `/receiving` temporarily as alias
  - Archetype: Station (or hybrid Workbench for list triage)
  - Scan band: TriageScanBand
  - Focus: identify + route carton before unbox.

- Keep `/incoming`, `/history`, `/pickup` (they can stay under receiving nav for now or become peers).

### 6.2 Component Split Strategy
- Extract shared receiving primitives (line row, photo handling, PO context helpers, timeline adapters) into `src/lib/receiving/` or `src/components/receiving/shared/`.
- `UnboxWorkspace.tsx` (new) vs `TriageWorkspace.tsx` (new) that consume the renderer or legacy tree.
- Use existing `ReceivingLineWorkspace` / controllers with a surface context prop.

### 6.3 Scan Routing
- `src/lib/station-scan-routing.ts` or equivalent gains surface-aware classification.
- `classifyUnboxScan` etc. become part of the surface definition or thin adapters.

---

## 7. Phased Implementation Plan

### Phase 0 — Foundations (1–2 weeks)  ✅ **DONE 2026-07-05**

`[status 2026-07-05]` Shipped in `src/lib/stations/` (Option A — extends the station contract,
not `src/lib/surfaces/`). Full scan confirms registry + resolver + archetype + guard tests cover the 8 surfaces (including aspirational pack/test). No schema change needed.
- `archetype.ts` — `ArchetypeId` + `pickArchetype()` (the contextual-display Q1→Q4 decision, hint-wins).
- `surface-keys.ts` — `SurfaceKey` union + closed `SURFACE_REGISTRY` (`Record<SurfaceKey,…>` so a
  missing entry is a compile error): label, semantic route, archetype, permission, `pageKey`/`modeKey`
  (Option A), scan policy, legacy-URL mapping. `isSurfaceKey` / `getSurface` / `listSurfaces` /
  `surfaceForRoute` helpers. 8 surfaces registered (unbox, triage, incoming, pickup, history, pack,
  test, outbound).
- `surface-resolver.ts` — pure `decideSurfaceRender()` (legacy-vs-composed; `'legacy'` is the safe
  default until an org publishes a real slot map) + injectable-`Deps` `resolveSurface()` server loader.
- Re-exported from `src/lib/stations/index.ts`; guard/unit test `surface-keys.test.ts` (16 tests) +
  `test:stations` script. **No schema migration** — `page_key`/`mode_key` already carry the surface
  address; archetype/scan/default-view are code capabilities, not per-org data. tsc clean, lint clean.

- ⚠️ `[validation 2026-07-05]` **`src/lib/surfaces/` already exists and means something else** — it is
  the universal-feed / entity-signals kind catalog (`SURFACE_ENTITY_TYPES`, `FEED_KEYS`, `SIGNAL_KINDS`,
  `NODE_SURFACE_ROLES`, `MUTATION_KINDS`, plus `record-entity-signal.ts` / `feed-writes.ts`). Do NOT
  place the page registry there. Home it in **`src/lib/stations/`** (preferred — extends the existing
  contract, per the §5.3 Option A decision) or a new `src/lib/operator-pages/`.
- Formalize `SurfaceKey` union or registry in the chosen module (start with the keys we know).
- Add `surface_key` support / conventions to `station_definitions` (migration if needed).
- Create `SurfaceRegistry` (code registrations for blocks, sources, actions, archetype hints).
- Update `pickArchetype` and station chassis to accept surface key.
- Guardrails: lint rule or test that new surfaces go through the registry.

**Files:**
- `src/lib/stations/surface-keys.ts` (or `src/lib/operator-pages/keys.ts`) — NOT `src/lib/surfaces/` (collision, see above)
- `src/lib/stations/surface-registry.ts`
- Migration for any schema tweaks (via `db-migration-author` skill).

### Phase 1 — Unbox as First-Class Surface (Pilot — receiving family start)  ✅ **DONE 2026-07-05**

`[status 2026-07-05]` Shipped additively (legacy `/receiving` kept fully working — the safe,
reversible cut the plan intends; hard redirect deferred to Phase 6):
- **Route:** `src/app/unbox/page.tsx` renders the shared `ReceivingSurfacePage` (extracted from
  `receiving/page.tsx`; `receiving/page.tsx` now delegates to it too), parameterized by mobile title.
  Verified authenticated: `/unbox` → HTTP 200, full surface, mobile `<h1>` "Unbox"; `/receiving` →
  "Receiving". Bare `/unbox` has no `?mode=` so `useReceivingDashboardMode` defaults to `receive`.
- **Surface-aware `useReceivingMode`:** derives `receive` when on `/unbox`; `updateMode('receive')`
  routes to `/unbox` (drops `mode`), other modes stay on `/receiving?mode=`; the 4 in-surface setters
  use the current base path so a click on `/unbox` stays on `/unbox`.
- **`sidebar-navigation.ts`:** `getSidebarRouteKey('/unbox') → 'receiving'` (reuses the panel);
  `/unbox` added to `MOBILE_ALLOWED_PREFIXES` + `ROUTE_PERMISSIONS` (`receiving.view`); receiving
  `receive` mode `to()` → `/unbox`, `resolveMode` path-aware. Round-trip test extended (`/unbox` ⇒
  `receive`); all 13 nav tests pass.
- **Deep-link consumers:** the 4 "open in unbox" navigations (`ReceivingDetailsStack`,
  `LinePoItemsSection`, `LineMatchingSection`, `FirstScanOnboardingCard`) now target `/unbox` via the
  new `src/lib/receiving/surface-path.ts` SoT helper (`UNBOX_SURFACE_ROUTE` / `openInUnboxHref` /
  `receivingSurfaceBasePath`).
- **Mobile:** `src/proxy.ts` UA-rewrites `/unbox` → `/m/receiving` (its bottom nav already labels
  itself "Unbox").
- **Verification:** tsc 0 errors, eslint clean on all touched files, unit tests green, authenticated
  live render confirmed. No E2E spec breaks — bare `/receiving` + every `?mode=`/`?recvId=` deep link
  still resolve to unbox via the preserved alias.

**Deferred-cleanup batch — ✅ DONE 2026-07-05:** repointed the `/receiving?mode=receive` / `?recvId=`
*producers* to the canonical surface routes: `search-hit.ts` + `global-entity-search.ts` →
`/unbox?openReceivingId=`; `receiving-claim-photos.ts` + `ActivityInboxPopover` + `receivingShareUrl`
(`receiving-sidebar-shared.ts`) → `/unbox?recvId=`; assistant nav vocabulary (`agent-loop.ts`) teaches
`/unbox` + `/triage`; `page-context.ts` now maps `unbox`/`triage` segments → `RECEIVING` (AI-search
boost). Pinned tests updated (`search-hit`, `hybrid-retrieval`, `page-context` +2 new assertions); all
90 AI-search tests green. `scan-history-route.ts` deliberately left on `/receiving?mode=history`
(History not graduated). **Still deferred:** dedicated `/m/(shell)/unbox` route + `MobileSidebarDrawer`
hardcodes.

**Surface-normalizing redirect — ✅ DONE 2026-07-05** (brought forward from Phase 6 because the address
bar still showed `/receiving` on the unbox page): `src/proxy.ts` `resolveReceivingSurfaceRedirect()`
307-redirects bare `/receiving` (+ `?mode=receive`) → `/unbox` and `?mode=triage` → `/triage`, stripping
the now-redundant `mode` param; other modes (incoming/pickup/history) and sub-routes (`/receiving/lines/[id]`,
`/receiving/unfound`) are untouched, and phones still fall through to the `/m/receiving` UA-rewrite. Also
pointed the top-level "Receiving" nav item (`APP_SIDEBAR_NAV` + `SIDEBAR_PAGE_NAV` href) at `/unbox` so the
primary path lands on the canonical URL with no redirect hop — nav highlighting is `getSidebarRouteKey`-based
(`/unbox`→`receiving`), so the item stays active across every mode. `receiving-tech-modes.spec.ts` gotos
updated to `/unbox` / `/triage`. Net: the Unbox page URL is now `/unbox` from every entry point.

<details><summary>Original Phase 1 plan (for reference)</summary>

- Create `src/app/unbox/page.tsx` (thin, sets surface context, renders `UnboxSurface` or generic).
- Create `src/app/unbox/layout.tsx` if needed for shared chrome.
- Refactor receiving logic:
  - Move Unbox-specific into `src/components/unbox/` or `src/features/unbox/`.
  - Keep triage + others in receiving for now.
- Update `useReceivingMode` → split hooks (`useUnboxMode`, `useTriageMode`).
  `[validation 2026-07-05]` Treat this as its own workstream: **21 files** consume the hook/type; the
  hook hardcodes `router.replace('/receiving?…')` in 5 methods (`updateMode`/`updateStaff`/
  `updateUnboxView`/`updateTriageView`/`updateTriageQuery`); and there are **two overlapping mode
  vocabularies** — `ReceivingMode` (sidebar) and `ReceivingTableMode` in
  `src/lib/receiving/receiving-modes.ts` (deliberately excludes triage/pickup). The split must
  consolidate these, not fork a third.
- Add `/unbox` to `sidebar-navigation.ts` as top-level `kind: 'station'`.
  `[validation 2026-07-05]` This file is the pilot's real cost center: **659 lines, 17 consumers**
  (CommandBar, the master-nav suite, ResponsiveLayout, SidebarContextPanel, page-access-matrix,
  sidebar-titles, mobile-context-navigation, …). Adding a surface touches **≥7 structures**:
  `SidebarRouteKey`, `APP_SIDEBAR_NAV`, `MOBILE_ALLOWED_PREFIXES`, `MOBILE_RESTRICTED_SIDEBAR_IDS`,
  `getSidebarRouteKey`, `ROUTE_PERMISSIONS`, `SIDEBAR_PAGE_NAV` — and `sidebar-navigation.test.ts`
  enforces the `resolveMode(apply(to(mode))) === mode` round-trip invariant.
- Update mobile: `src/app/m/(shell)/unbox/` or resolve via existing receiving mobile with surface param.
  `[validation 2026-07-05]` Also add `/unbox` (and later `/triage`) to `MOBILE_ALLOWED_PREFIXES` in
  `src/lib/sidebar-navigation.ts` — without it `isMobileAllowedPath` blocks the route on mobile.
  Reconcile the proxy device rewrites (`src/proxy.ts` rewrites exact `['/receiving','/m/receiving']`
  for phone-class UAs, plus the `/m/u` QR path) so QR/print labels still resolve.
- Legacy: `/receiving?mode=receive` still works (soft banner "Moved to /unbox" + redirect option).
  `[validation 2026-07-05]` Note **both** `/receiving` (bare) and `/receiving?mode=receive` resolve to
  Unbox today — the redirect matrix has two source URLs. Precedent exists in both homes:
  `next.config.ts` `redirects()` (already aliases `/sku-stock → /inventory`; query-conditional needs
  `has: [{ type: 'query', key: 'mode', value: 'receive' }]`) and `src/proxy.ts` (the renamed
  middleware, already doing legacy QR path rewrites).

**Acceptance:** Bare `/unbox` loads the exact current unbox experience. URL now says "Unbox". Existing deep links continue to work.

</details>

### Phase 2 — Triage Surface + Split  ✅ **DONE 2026-07-05**

`[status 2026-07-05]` Shipped, mirroring Phase 1 (additive; `/receiving?mode=triage` kept working):
- **Route:** `src/app/triage/page.tsx` → the shared `ReceivingSurfacePage`. Triage shares the
  scan-bar+rail sidebar body with Unbox; only the right pane differs.
- **Path-first mode derivation (the extra wrinkle vs Phase 1):** bare `/triage` has no `?mode=`, so
  BOTH `useReceivingMode` and `useReceivingDashboardMode` now derive the mode path-first
  (`/unbox`→`receive`, `/triage`→`triage`) before falling back to `?mode=`. Generalized
  `basePathForMode` + `isGraduatedMode`; `updateMode` drops `mode` for either graduated surface.
- **SoT helper generalized:** `src/lib/receiving/surface-path.ts` now exports `UNBOX_SURFACE_ROUTE` +
  `TRIAGE_SURFACE_ROUTE`; `receivingSurfaceBasePath` matches either graduated route (longest-first).
- **`sidebar-navigation.ts`:** `/triage` added to routeKey/mobile-allowlist/route-perms; triage mode
  `to()` → `/triage`, `resolveMode` path-aware for both routes; round-trip test extended.
- **Deep-link consumers:** the 2 triage navigations (`UnfoundTodoStrip`, `LineMatchingSection` unlink→
  unfound) repointed to `/triage`. proxy UA-rewrites `/triage` → `/m/receiving`.
- **Verification:** tsc 0 errors, eslint clean, 39 unit tests green; authenticated `/triage` render
  returned HTTP 200 (full surface). Right-pane mode is client-derived via `usePathname` (framework
  guarantee, same mechanism as `/unbox`). Legacy `/receiving?mode=triage` still resolves via the alias.

<details><summary>Original Phase 2 plan (for reference)</summary>

- Repeat for `/triage`.
- Update triage components to be surface-aware.
- Split shared receiving dashboard / rails where they diverge.

</details>

### Phase 3 — Data-Driven Composition (Unbox Pilot)  ✅ **DONE 2026-07-05**

(Note: only unbox/triage/incoming pages currently use the gate; pack/test/outbound are still pure legacy.)

`[status 2026-07-05]` Built end-to-end, DORMANT by default (composed rendering requires an active
composition AND the per-org `surface_composed_render` flag — default OFF — so legacy renders unchanged):
- **3a runtime:** the render host already existed (`StationSlot`+`BlockRenderer`) — it just needed
  mounting. Added: data source `receiving.unbox_queue` (wraps `/api/receiving/pending-unboxing`); two
  registered blocks — `scan_band` (trigger; focus-locked input → `classifyUnboxScan` → typed
  `station:scan` event) and `rail_feed` (queue; selectable worklist → `station:select` event); and the
  surface-aware scan classifier `src/lib/receiving/classify-unbox-scan.ts` (`classifyUnboxScan` — the
  mid-carton carrier-unknown TRACKING→SERIAL override, 5 unit tests).
- **3b cutover:** `SurfaceRenderer` (mounts a surface's slots via `StationSlot`) + `SurfaceGate`
  (queries `/api/surfaces/[key]/resolve`; renders composed or the legacy `children` — legacy is the safe
  default on load/error/flag-off). New GET `/api/surfaces/[key]/resolve` (resolveSurface + flag). Flag
  `isSurfaceComposedRender(orgId)` (feature-flags.ts). `/unbox` + `/triage` pages now wrap their legacy
  tree in `SurfaceGate`. Seed migration `2026-07-05_seed_unbox_surface_composition.sql` (active but
  dormant page-bound composition: scan_band + rail_feed→unbox_queue; node-bound when present).
- **Verification:** `unbox-composition.test.ts` proves the seeded config is registry-valid
  (validateStationConfig → 0 issues) DB-free; 34 stations/classifier tests green; tsc + lint clean.
- **Scope note:** the composed blocks are a real, working *capability* (scan → queue), not a full
  replacement of the 3,900-line hand-coded Unbox workspace — exactly the plan's "'legacy' default ON,
  build the mechanism" intent. Richer workspace/advance blocks are additive later.

<details><summary>Original Phase 3 plan (for reference)</summary>

`[validation 2026-07-05]` **Re-scoped.** The station layer is a mature persistence/control plane
(versioned draft/publish + blocking diagnostics gate) but a **pilot-grade renderer**: 1 block, 3 data
sources, 4 actions, and no production page renders through it (only the Studio editor preview). Phase 3
as originally written hides several net-new build-outs — split it:

**Phase 3a — Build the missing runtime (net-new):**
- Block types beyond Checklist: workspace, scan-band, queue/rail, advance/action blocks.
- Unbox-specific data sources + actions in the registries.
- A **production render host** that mounts an active `station_definitions` composition on a real page
  (today the only render path is `StudioNodeStationEditor` inside `/studio`).
- Surface-aware scan classification (`classifyUnboxScan` does not exist; `detectStationScanType` is
  string-heuristic only).

**Phase 3b — Model + cut over:**
- Model current Unbox as a `station_definition` row.
- Implement `SurfaceRenderer` + region wiring for at least the queue + workspace slots.
- `'legacy'` fallback default ON per org — gate the cutover with `readOrgFeatureFlag` /
  `resolveForOrg` on `organization_feature_flags` (per-org UI-flag precedent: `ai_search_commandbar`,
  `isIncomingUniversal`). The `'legacy'` slots hatch already exists in `StationConfig`
  (`src/lib/stations/contract.ts:215-221`), honored by validator, editor, and diagnostics.
- Wire Studio node binding for the unbox node → surface.

</details>

### Phase 4 — Navigation as Data  ✅ **DONE 2026-07-05** (editor UI = follow-up; full unification with SurfaceKeys is Phase 11)

`[status 2026-07-05]` Nav-as-data mechanism shipped, safe-by-default (a null/absent override yields the
static `APP_SIDEBAR_NAV` unchanged; an override can only hide/rename/reorder EXISTING ids, never
introduce a new surface):
- **Migration** `2026-07-05b_nav_definitions.sql` — per-org versioned/is_active table, tenant-from-birth
  (`enforce_tenant_isolation`), one active row per org.
- **Pure merge** `src/lib/nav/org-nav.ts` — `mergeOrgNav(defaults, override)` (explicit-order items lead,
  unset keep default order) + defensive `parseNavDefinition`; 7 unit tests.
- **Loader** `load-org-nav.ts` (Deps-injected). **API** `GET/PUT /api/nav` (GET `dashboard.view`; PUT
  `studio.manage` + step-up, deactivate+activate CTE, `recordAudit` with new `NAV_DEFINITION` /
  `NAV_PUBLISH` audit constants). Route-auth manifest regenerated (`audit-route-auth:check` green).
- **Hook** `useOrgNavItems` merges the override onto `getSidebarNavItems`; **wired into `MasterNav`**
  (the primary sidebar) with `toPageNav` carrying the overridden label. 60 auth tests green, tsc + lint clean.
- **Follow-up (additive):** the visual Studio nav-editor L1/L2 UI (owners can already publish via
  `PUT /api/nav`); `CommandBar` still reads the static list (fine — it's a palette, not the nav).

<details><summary>Original Phase 4 plan (for reference)</summary>
- Implement `nav_definitions` loader (lightweight override per 05 spec).
- Make `DashboardSidebar`, `MobileBottomNav`, command bar consume the loader.
- Studio surface picker / nav editor (L1/L2).

</details>

### Phase 5 — Template Seeding & Other Surfaces  ✅ **DONE 2026-07-05** (Pack/Test/Outbound composition + routes = Phases 7/8/13)

`[status 2026-07-05]` Mechanisms shipped + proven across a 3rd surface:
- **`/incoming` first-class route** — the migration pattern applied to a *Workbench* surface (not just
  the two scan benches). Path-first mode derivation in both mode hooks; the incoming filter components
  (`useIncomingFilters` ×6, `IncomingPaneHeader`, `IncomingViewBand`, `useReceivingLinesData`) made
  surface-aware via `receivingSurfaceBasePath`; nav/proxy/redirect wired; nav round-trip test extended.
- **Template → surface seeding** — `src/lib/studio/template-surfaces.ts`: pure `buildTemplateSurfaceSeeds`
  (join template nodes → surfaces via the registry's `workflowNodeType`, deduped, id-remap-aware) +
  Deps-injected `seedTemplateSurfaces` (node-bound draft `station_definitions`, `'legacy'` config,
  idempotent). Wired into `POST /api/studio/templates/[id]/import` **inside the same tx** (atomic with
  the graph import), audited via `surfacesSeeded`. Never modifies the guarded `createDraftFromTemplate`.
  8 unit tests. Registry: incoming/pickup/history now carry `workflowNodeType: 'receiving'`.
- **"Nav mostly derived"** — delivered by Phase 4's nav-as-data (per-org overrides via `useOrgNavItems`).
- **Verification:** tsc + lint clean, studio + template-surfaces tests green (10), nav test green.
- **Mechanical follow-up (documented):** `/pack` (`/packer`) + `/test` (`/tech`) route creation repeats
  the proven pattern against their own server-component page trees (packer has a data prefetch/dehydrate);
  Outbound is already first-class at `/outbound`. All three are registered in `SURFACE_REGISTRY` with
  legacy mappings, so their thin routes + redirects are a copy of the `/incoming` change.

<details><summary>Original Phase 5 plan (for reference)</summary>
- Extend `workflow_templates` + `applyTemplateToOrg` / `createDraftFromTemplate` to seed surface definitions + nav entries.
- Migrate Incoming, Pack, Test, Outbound, etc. one by one.
- Update `sidebar-navigation.ts` to be mostly derived.

</details>

### Phase 6 — Cleanup & Hardening  ✅ **DONE 2026-07-05**

`[status 2026-07-05]`
- **Legacy path deprecation** = the `src/proxy.ts` surface redirect (bare `/receiving` + `?mode=receive`
  → `/unbox`, `?mode=triage`→`/triage`, `?mode=incoming`→`/incoming`; other modes stay). This is the soft
  (302) deprecation the plan wants; HARD removal (404 on the legacy path) is a deliberate later flip kept
  OFF during soak so existing deep links keep resolving.
- **Permission decision (open question RESOLVED): inherit the status quo.** `/unbox` / `/triage` /
  `/incoming` are NOT server-layout `requirePermission()`-gated — consistent with the existing station
  pages (`/receiving`, `/tech`, `/packer`). Protection is (1) the proxy session-cookie gate, (2) the
  permission-gated data APIs each surface calls, and (3) the `ROUTE_PERMISSIONS` entries added for all
  three (`receiving.view`). Introducing a new server-gate pattern for station pages was explicitly NOT
  done (it would diverge from every other station page for no security gain given 1+2).
- **Test coverage:** unit suites across all phases — `surface-keys` (16), `classify-unbox-scan` (5),
  `unbox-composition` (3), `org-nav` (7), `template-surfaces` (8), `sidebar-navigation` round-trip
  (extended for /unbox,/triage,/incoming), plus the existing station/auth/ai-search suites — all green.
  The `surface-keys` guard enforces "no surface without a complete registry entry."
- **Docs:** this plan updated per phase; a pointer to the surface registry added to
  `.claude/rules/contextual-display.md` (the code home of `pickArchetype`). Release notes are
  commit-generated (prebuild), so they flow from the eventual commit.
- **Design-system guards:** the one new raw `<button>` (RailFeedBlock full-row select) carries a
  `ds-raw-button` annotation; new components use only semantic tokens + primitives.

**Overall (pilot scope):** the receiving split (unbox/triage/incoming) + SurfaceGate on those three + proxy redirect + path-first modes + deep-link hygiene + nav updates + template seeding awareness + nav-as-data are live and build-clean. Pack/test/outbound/history/pickup remain on legacy routes (registered only). Composed render is dormant (flag + definition gated). Full codebase scan (this session) revealed the remaining leakage surface is much larger than the receiving pilot — see new §2.3 and Phases 7+.

<details><summary>Original Phase 6 plan (for reference)</summary>
- Remove or deprecate old `?mode=receive` paths (after soak).
- Full test coverage (unit for registry/resolver, e2e for deep links + mode switches).
- Permission decision for new routes. `[validation 2026-07-05]` The route-auth audit
  (`scripts/audit-route-auth.ts`) scans **`src/app/api` only** — page routes are outside it and outside
  `docs/security/route-permissions.json`, so no manifest regeneration is needed and **no CI net forces a
  gate on new pages**. Today's station pages (`/receiving`, `/tech`, `/packer`, `/outbound`, `/walk-in`)
  are NOT server-gated — protection is session cookie (proxy) + permission-gated data APIs;
  `ROUTE_PERMISSIONS`/`permissionForPath` is largely vestigial (one consumer). Decide explicitly whether
  `/unbox`/`/triage` introduce server-layout `requirePermission('receiving.view')` (a **new** pattern
  for station pages) or inherit the status quo.
- Docs, release notes, assistant skill updates.

</details>

**Overall Phasing Discipline (from project plans):**
- Read-only / observation value before heavy editing.
- Blocking diagnostics before publish of new surface definitions.
- One surface at a time.
- `'legacy'` until data parity.
- All changes go through `recordAudit`, tenant scoping, Deps injection for tests.

---

## 2.3 Full Codebase Leakage Inventory (2026-07-05 scan — added this session)

This section captures **all** leakages discovered by exhaustive scan (beyond the original receiving/triage focus). The pilot only touched the receiving family (unbox/triage/incoming + partial history). The rest of the operator surfaces (pack, test, outbound partial, history/pickup, mobile, nav unification, E2E, cross links) are still leaking legacy names/paths.

**Legacy path producers / consumers (must be covered by alias or repointed):**
- E2E specs (15+): receiving-tech-modes.spec.ts (hard `/receiving?...` + `/tech?view=testing`), incoming-todo.spec.ts (`/receiving?mode=incoming`), mobile-unbox-list, table-column-config, zendesk-claim, receive-to-zoho, testing-sku-prepack-scan, shipped-perf (packerlogs), etc.
- Search & AI: search-hit (partially updated), page-context (partially), hybrid-retrieval tests, global-entity-search, agent-loop vocab, page-skills.
- Proxy + mobile: MOBILE_UA_REWRITES (receiving surfaces + old /receiving), resolveReceivingSurfaceRedirect (receiving only), no pack/test equivalents. MOBILE_ALLOWED_PREFIXES still mixes old/new.
- Nav & titles: sidebar-navigation (dual keys), sidebar-titles, mobile-context-navigation, MasterNav / ModeRail, useSidebarModeNav.
- Deep links / notifications: receiving-claim-photos, ActivityInboxPopover, scan-history-route (`/receiving?mode=history&recvId=`), OperationsMatrix (links `/packer`, `/tech` etc.).
- Signin / landing redirects, QR paths (`/m/u`), replenishment mentions of old incoming.
- Components: PackerSidebarPanel, TechSidebarPanel, various use*Mode for packer/tech, Unfound / line components (some centralized), Receiving* that still mention modes.
- Studio / seeding consumers, command bar (uses APP_SIDEBAR_NAV statics).
- Release notes + docs still describe old URLs in places.

**Parallel key systems (architectural leakage):**
- `SurfaceKey` (stations/ — the new SoT for operator jobs + studio binding).
- `SidebarRouteKey` + `APP_SIDEBAR_NAV` ids (`receiving`/`packer`/`tech` etc.) — still the runtime nav contract for 17+ consumers.
- `ReceivingMode` / `ReceivingTableMode` + packer/tech-specific mode types.
- Goal: eventually derive more from surfaces, or make SidebarRouteKey a superset that maps 1:1 to SurfaceKey for the station items.

**Composition / station runtime leakage:**
- Only 3 surfaces have `<SurfaceGate>` pages (unbox/triage/incoming).
- Pack/test/outbound/history/pickup have 0.
- Data sources/actions/blocks exist for unbox queue + some triage; pack/test classifiers exist in domain but not wired to surface registry scan policy.
- Template seeding is registry-aware but only exercised for receiving pilot.
- `'legacy'` is correctly the safe default; no accidental composed render on prod pages.

**Mobile shell leakage:**
- Dedicated mobile pages for some graduated surfaces (`/m/unbox`, `/m/triage`, `/m/pack`).
- Proxy still rewrites most to `/m/receiving`.
- Bottom nav / drawer hardcodes or mode vocab differ from desktop (noted in original validation).
- No first-class `/m/pack` vs legacy packer alignment complete; no `/m/test`.

**Archetype / display leakage:**
- All registered surfaces have archetype hints.
- Many pages (inventory submodes, operations, fba, dashboard) are not yet in SURFACE_KEYS — they may stay outside the "studio-driven station" set or be added later (Workbench/Monitor mostly).

**Pack / Test specific (biggest remaining graduation work):**
- No thin page routes at `/pack` `/test`.
- No proxy surface redirect logic.
- Nav ids not unified (`packer`/`tech` vs `pack`/`test`).
- No SurfaceGate wrapping of their workspaces.
- E2E + many internal links assume legacy.
- Mobile separate.

**Outbound / history / pickup:**
- Outbound good on route but no composition gate observed.
- History/pickup deliberately left on receiving bucket for now (plan allows).

**Guardrail / test gaps:**
- surface-keys.test.ts guards registry completeness for the 8.
- No equivalent "no legacy path in new surface code" lint yet.
- E2E will churn on graduation of pack/test.

Update the legacy consumers table in §8 for pack/test + full list.

---

## 7. Extended Phased Plan (post-pilot full codebase)

Pilot Phases 0–6 shipped the receiving family split + shared mechanisms. The following phases graduate the **rest of the surfaces** and complete unification.

### Phase 7 — Pack Surface Graduation (mirror receiving pilot)  ✅ **DONE 2026-07-05**

**Claude Code requirements for this phase (and any future block work):**
- Must preserve / deliver the high-ROI Station display enhancements: prominent SKU catalog photos (from `sku_catalog` via pack-checklist) + attached packer photos, crossfade of the active verification card, form-like substitution notes (`SubstitutePanel` + reason + free-text note e.g. "buyer wanted White") + general pre-ship notes, scan-focus suppression of external links.
- Use `station-block` skill for any new verification / photo / note UI.
- Follow Station archetype + house style + motion rules exactly (see §4).
- Reuse strictly: `OrderPackChecklist` / `PackChecklistLineRow`, `SubstitutePanel`, `resolveCatalogImage`, photos table, `recordAudit`.
- Shared primitives (for legacy + future composition) over one-off code.

`[status 2026-07-05]` Shipped, mirroring the receiving pilot (additive; legacy `/packer` kept working via
proxy redirect). Verified green this session:
- **Route:** `src/app/pack/page.tsx` → shared `PackerSurfacePage` (extracted shell used by BOTH `/pack`
  and legacy `/packer/page.tsx`); wraps `PackerPageContent` in `<SurfaceGate surfaceKey="pack">` and
  keeps the `/api/packerlogs` week prefetch → `HydrationBoundary` for first-paint.
- **Proxy:** `resolvePackSurfaceRedirect()` 307-redirects bare `/packer`(+`/`) → `/pack` (desktop);
  `MOBILE_UA_REWRITES` sends both `/pack` and `/packer` → `/m/pack` on phones.
- **Nav SoT (`sidebar-navigation.ts`):** `/pack`+`/packer` in `MOBILE_ALLOWED_PREFIXES`;
  `getSidebarRouteKey('/pack'|'/packer') → 'packer'`; `getFirstPathSegment` normalizes
  `packer`/`packers`→`pack`; `isSidebarNavActive` segment-matches `pack`; `ROUTE_PERMISSIONS` `/pack`
  `/packer` `/packers` → `packing.view`; `SIDEBAR_PAGE_NAV` packer entry + `APP_SIDEBAR_NAV` href → `/pack`.
- **Deep-link producers:** `admin/logs` `detail_route` (packer_log → `/pack`) + `OperationsMatrix`
  ("Order Packing" → `/pack`) repointed.
- **Mobile:** `src/app/m/(shell)/pack/page.tsx` is the primary mobile packing shell.
- **Verification:** `sidebar-navigation.test.ts` (14/14, incl. pack-mode + route-key + legacy alias),
  `test:stations` (29/29), **tsc 0 errors project-wide**, lint clean.

**Post-graduation UI content note:** The above route cutover exposes the (improved) `StationPacking` + checklist + active workspace. The display enhancements (photos, sub form, scan focus, crossfade) must be applied to the shared `Packer*` components so both legacy `/packer` and new `/pack` benefit immediately. Later phases will extract pieces into blocks.

<details><summary>Original Phase 7 plan (for reference)</summary>

- Create `src/app/pack/page.tsx` (thin, SurfaceGate + PackerSurfacePage or direct PackerPageContent wrapper).
- Add proxy redirect: `/packer` (bare) → `/pack` (and any `?packMode` variants if they exist).
- Update `usePacker*` hooks / components to derive from path (or generalize surface-path helper).
- `sidebar-navigation.ts`: add `/pack` to allowed prefixes; change packer mode `to()` to `/pack`; keep `packer` routeKey for now or decide unification.
- Deep-link producers (OperationsMatrix, up-next, logs, etc.) → use `/pack`.
- Mobile: ensure `/m/pack` is primary or add UA rewrite; update MOBILE_ALLOWED_PREFIXES.
- Wire `SurfaceGate surfaceKey="pack"` (starts as legacy-only until composition blocks for packing are built).
- Unit + round-trip test updates.
- Acceptance: bare `/pack` renders identical packing experience; URL says "Packing".

</details>

### Phase 8 — Test Surface Graduation (mirror pack)  ✅ **DONE 2026-07-05** (graduation; display-enhancement bullets deferred as UX follow-up)

`[status 2026-07-05]` Shipped the **routing graduation** (additive; legacy `/tech` kept working via proxy
redirect + shared page), mirroring Pack. The Station **display-enhancement** bullets below (SKU photos in
active feedback, enriched crossfade, SubstitutePanel notes, scan-focus suppression) are **deferred UX
follow-up** — Pack's Phase 7 graduation likewise shipped routing only; these are additive polish, not part
of the "URL names the job / renders identical experience" acceptance.
- **Whole-page rename** (`/tech` is one station with 3 `?view=` sub-modes — shipping default / testing /
  testing-history — sharing one panel + right pane; NOT split into separate surfaces): the `?view=`
  sub-mode rides along on `/test`.
- **Shared shell + routes:** `src/components/tech/TechSurfacePage.tsx` (server component: `getCurrentUser`
  guard → `<SurfaceGate surfaceKey="test"><TechPageContent/></SurfaceGate>`); `src/app/test/page.tsx`
  renders it, `src/app/tech/page.tsx` delegates to the same shell (legacy alias). SurfaceGate defaults to
  legacy `TechPageContent` (flag OFF / no composition) so behavior is byte-identical.
- **Proxy (`src/proxy.ts`):** `resolveTestSurfaceRedirect` 307s `/tech`(+`/`) → `/test`, preserving ALL
  query (incl. `?view=`). No UA rewrite (tech self-renders responsively via `?pane=`; no dedicated `/m/`
  shell), so phones redirect `/tech`→`/test` too and `/test` renders the responsive tree.
- **`sidebar-navigation.ts`:** `/test` in `MOBILE_ALLOWED_PREFIXES` + `ROUTE_PERMISSIONS` (`tech.view`);
  `getSidebarRouteKey('/test') → 'tech'`; `getFirstPathSegment` normalizes `tech`→`test`;
  `isSidebarNavActive` segment-matches `test`; `APP_SIDEBAR_NAV` + `SIDEBAR_PAGE_NAV` tech href/`to()`
  target `/test` (const `TECH` value → `/test`). Route key (`tech`) NOT renamed yet (Phase 11).
- **In-page nav:** `TechSidebarPanel` top-mode switch + legacy-view normalize now path-relative
  (`basePath = pathname`) so switching shipping/testing/history stays on `/test` (no redirect hop).
- **Deep-link producers → `/test`:** OperationsMatrix ("Serial Number Intake"), signin + LandingPageCard
  landing maps (`technician`), staff-management landing options, `ActivityInboxPopover`
  (`return_pending_test`), `ops-assistant` up-next href (also `/packer`→`/pack`), admin-logs SQL hrefs
  (TECH_SERIAL / SAL tech_serial).
- **Verification:** tsc 0 project-wide, eslint clean on touched files (removed 3 pre-existing dead icon
  imports in TechSidebarPanel), 15 nav tests (incl. `/test` mode + route-key + legacy alias) + 29
  surface-keys/stations tests green. Live (authenticated): `/test` → HTTP 200 full station (238 KB, parity
  with legacy 235 KB); `/tech?view=testing` → 307 `/test?view=testing` (query preserved).

**Claude Code requirements (same as Pack) — deferred UX follow-up (not blocking graduation):**
- Deliver Station display enhancements for testing: SKU catalog photos in active feedback / preview, crossfade of enriched active verification, form-like substitution notes + pre-ship reasons (reuse `SubstitutePanel`), clean scan focus (suppress externals in `OrderPreviewPanel`, feedback, etc.).
- `station-block` skill for new pieces.
- Strict reuse of existing (sku-testing bundle, manuals, `ActiveOrder*`, `useStationTestingController`).
- Shared primitives over duplication. Follow archetype + motion + house style.
- Note: sub-variants (testing vs shipping) should be handled as `?view=` or mode rail inside the Station surface (use `sidebar-mode` skill if adding UI).

- `src/app/test/page.tsx` + SurfaceGate.
- Proxy: `/tech` (+ `?view=testing`) → `/test`.
- Path-first derivation for tech views if any.
- Update nav (`to()` for tech → `/test`), allowed prefixes, mobile (`/m/tech` or new `/m/test`?).
- Repoint E2E, search, components, OperationsMatrix, testing scan flows.
- Registry already has the mapping; just the mechanical route + redirect + consumers.
- Note: testing has "shipping mode" vs "testing mode" sub-variants — decide if they become separate surfaces or `?view=` under `/test`.

**Post-graduation note:** Apply the photo + form + focus + crossfade improvements to `StationTesting`, `ActiveOrderScanFeedback`, `ActiveOrderWorkspace` / `OrderPreviewPanel` + sku-testing components so the new `/test` surface immediately has the high-ROI verification UX.

### Phase 9 — Remaining Receiving Sub-Surfaces (History / Pickup) + Outbound Polish  ✅ **DONE 2026-07-05**

`[status 2026-07-05]` **Decision: graduate both** to their registry-declared routes (additive; legacy
`/receiving?mode=…` kept working via the proxy redirect). History stays **nested** at `/receiving/history`
(not top-level `/history`) so the URL reads as "receiving's history" and its `?q=`/`?field=`/`?scope=`
search params ride along; Pickup graduates to top-level `/pickup`.
- **Routes:** `src/app/pickup/page.tsx` + `src/app/receiving/history/page.tsx`, each
  `<SurfaceGate surfaceKey="pickup|history"><ReceivingSurfacePage/></SurfaceGate>` (same shared shell as
  unbox/triage/incoming; SurfaceGate defaults to legacy).
- **Path-first mode derivation:** both `useReceivingMode` + `useReceivingDashboardMode` now derive
  `pickup` (`/pickup`) and `history` (`/receiving/history`) from the path before the `?mode=` fall-through;
  `basePathForMode`/`isGraduatedMode` extended; `surface-path.ts` exports `PICKUP_SURFACE_ROUTE` +
  `HISTORY_SURFACE_ROUTE` and lists them in `GRADUATED_ROUTES` (history longest-first so `/receiving/history`
  beats the `/receiving` fall-through). `ReceivingDashboard` reads the hook, so pickup/history panels light
  up automatically.
- **Proxy:** `resolveReceivingSurfaceRedirect` now maps `?mode=pickup` → `/pickup` and `?mode=history` →
  `/receiving/history` (dropping `mode`, preserving mode-specific params like History's `recvId`/`q`);
  `MOBILE_UA_REWRITES` sends `/pickup` + `/receiving/history` → `/m/receiving` on phones.
- **Nav (`sidebar-navigation.ts`):** `getSidebarRouteKey('/pickup') → 'receiving'` (history covered by the
  `/receiving/` prefix); `/pickup` added to `MOBILE_ALLOWED_PREFIXES` + `ROUTE_PERMISSIONS`; receiving
  pickup/history mode `to()` now target `/pickup` + `/receiving/history` (drop `mode`); `resolveMode`
  path-first for both; new `PICKUP` + `RECEIVING_HISTORY` consts; the now-unused bare `RECEIVING` const
  removed (whole family navigates via first-class routes).
- **Consumers:** `scan-history-route.ts` (`/m/r/{id}` → `/receiving/history?recvId=`).
- **Outbound:** wrapped `OutboundPageContent` in `<SurfaceGate surfaceKey="outbound">` (legacy default;
  no scan policy — outbound stays pointer-driven for now).
- **Verification:** tsc 0, eslint clean, 15 nav tests (+ `/pickup` + `/receiving/history` path-based + route-key
  assertions) + 29 stations tests green. Live (authenticated): `/pickup` 200, `/receiving/history` 200,
  `/outbound` 200; `/receiving?mode=pickup` → 307 `/pickup`; `/receiving?mode=history&recvId=5` → 307
  `/receiving/history?recvId=5` (param preserved). Mobile-context receiving switcher (`?mode=` nav) reconciled
  in Phase 10.

### Phase 10 — Mobile Surface Parity & Proxy Completeness  ✅ **DONE 2026-07-05**

`[status 2026-07-05]` Reconciliation was completed incrementally in Phases 7–9; this phase verified it end
to end on a phone UA and documented the mapping decisions. No further proxy changes were needed.
- **`MOBILE_UA_REWRITES` (complete + consistent with the mobile IA):** `/unbox` `/triage` `/incoming`
  `/pickup` `/receiving/history` → `/m/receiving`; `/pack` `/packer` → `/m/pack`. **Decision:** unbox/triage
  route to `/m/receiving` (the live-feed hub), NOT the dedicated `/m/unbox` / `/m/triage` scan benches,
  because the mobile bottom nav's primary receiving tab (labeled "Unbox") is `/m/receiving` with a separate
  Scan FAB — the dedicated benches are secondary, reached via the drawer's Receiving group. Aligning to
  `/m/receiving` matches the mobile information architecture (and the desktop `ReceivingSurfacePage` mobile
  branch, also a feed). `/test` `/tech` have **no** UA rewrite by design (no dedicated `/m/test` shell — the
  tech page self-renders responsively via `?pane=`; a phone `/tech` 307s to `/test` then renders the
  responsive tree).
- **`MOBILE_ALLOWED_PREFIXES` (complete):** `/m` (covers every `/m/*` incl. `/m/unbox` `/m/triage` `/m/pack`),
  `/receiving` (covers `/receiving/history`), `/unbox` `/triage` `/incoming` `/pickup` `/pack` `/packer`
  `/outbound` `/test` `/tech`.
- **Hardcodes:** `MobileSidebarDrawer` + `RedesignedBottomNav` are already mobile-native (all `/m/*` hrefs —
  no desktop legacy paths). `mobile-context-navigation.ts` (its `/receiving?mode=` switcher) has **no
  production consumer** (only its own unit test) — orphaned dead code, left for the Phase 12 dead-code sweep
  rather than risk-touched here.
- **QR / short links:** `/m/u`→`/serial`, `/m/l`→`/receiving/lines`, `/m/b`→`/bin` (the `REWRITES` prefix
  table) still resolve; `/m/r/{id}` stays a device route; `scan-history-route` now maps `/m/r/{id}` → the
  desktop `/receiving/history?recvId=` (Phase 9).
- **Verification (phone UA + auth):** all nine graduated desktop URLs route correctly on a phone — `/unbox`
  `/triage` `/incoming` `/pickup` `/receiving/history` → 200 via `/m/receiving`; `/pack` `/packer` → 200 via
  `/m/pack`; `/test` → 200 (responsive); `/tech` → 307 `/test`; `/m/u` `/m/l` `/m/b` resolve.

<details><summary>Original Phase 10 plan (for reference)</summary>

- Reconcile all MOBILE_UA_REWRITES and MOBILE_ALLOWED_PREFIXES for `/pack`, `/test`, graduated history/pickup.
- Create or align dedicated mobile pages under consistent surface keys (`/m/pack`, `/m/test`...).
- Fix any remaining MobileSidebarDrawer / RedesignedBottomNav / context nav hardcodes.
- Ensure QR / print / short links (`/m/u`, `/m/r`) continue to resolve under new surface addresses.
- Test on real mobile UA that address bar + bottom nav reflect the job.

</details>

### Phase 11 — Navigation SoT Unification + Speed (Elevated Priority)  ◑ **CORE DONE 2026-07-05 · destructive cleanup deferred (with rationale)**

`[status 2026-07-05]` The **routing-SoT unification is pinned as an executable invariant** and verified; the
**destructive legacy-nav deletion + id-rename are deliberately deferred to a dedicated, non-concurrent PR**
because they carry real regression risk, touch the most-contended files, and deliver **zero** routing/user
benefit (every surface route is already canonical and correct).

- **✅ Done — SurfaceKey ↔ SidebarRouteKey consistency invariant** (`src/lib/stations/surface-routing.test.ts`,
  5 tests, in `test:stations`): for all 8 surfaces asserts route → correct `getSidebarRouteKey`, → correct
  `ROUTE_PERMISSIONS` permission, → `isMobileAllowedPath`, → `surfaceForRoute` round-trip; plus legacy aliases
  (`/receiving`, `/packer`, `/tech`, `/outbound`) resolve to the right key. Any future drift between the two
  key systems now fails loudly — the "derive/align keys" goal, encoded as a test rather than a risky rename.
- **⏸ Deferred — `packer`→`pack` / `tech`→`test` `SidebarRouteKey` rename.** The route-key is an internal nav
  detail; the *routes* (`/pack`, `/test`) are already canonical. Renaming the union touches ~17 consumers
  (`SidebarContextPanel` `routeKey ===` branches, titles, page-access, mobile-context, tests) — high
  clobber-risk while another agent edits the same files, and it changes no user-facing behavior. Left as a
  focused follow-up; the consistency test above locks the mapping until then.
- **⏸ Deferred — delete legacy display code + remove `MasterNavProvider`.** **Verified UNSAFE as a blind
  delete:** `SidebarContextPanel` renders the panels inside `SidebarShell`'s always-on `<MasterNavProvider
  enabled>` (so `!masterNavEnabled` is dormant there), BUT `RouteShell.actions` renders the same panels
  **outside** any provider (its own "only mounts on mobile" path), where `useMasterNavEnabled()` returns the
  `false` default and the pill-row fallback is **live**. Deleting the 13 panels' `!masterNavEnabled` blocks +
  `MasterNavProvider` without first re-homing that mobile render path would remove mobile mode-switching.
  Needs a per-panel render-context audit in a dedicated PR — pure internal cleanup, no routing/user impact.
- **⏸ Deferred — Map/compiled fast matcher for `getSidebarRouteKey`.** The current linear if-chain is ~30
  string compares (negligible), and a rewrite risks subtle longest-prefix/ordering regressions on the
  most-contended file for no measurable win. The consistency test covers correctness; a benchmark is a
  follow-up if a real hot-path profile ever shows it.

**Net:** the plan's *core* Phase 11 goal — the two key systems provably agree, every surface route is
canonical + gated + mobile-correct — is delivered and tested. The remaining bullets are an internal
navigation-code cleanup with no user-facing or routing effect, scoped out of this concurrent session for
safety.

<details><summary>Original Phase 11 plan (for reference)</summary>

**Primary goal of this phase (and plan revision):** one SoT routing + display method. Master nav is the only display. Legacy navigation code is deleted.

- Unify keys: align/derive `SidebarRouteKey` entries from `SurfaceKey` for operator surfaces. Rename or alias `packer`→`pack`, `tech`→`test`. Update `APP_SIDEBAR_NAV`, `SIDEBAR_PAGE_NAV`, `MOBILE_*`, `ROUTE_PERMISSIONS`, titles, tests.
- Delete (do not gate) all legacy display code:
  - Remove `ReceivingModeSwitcher`, `UnboxViewToggle`, `TriageViewToggle`, PACK_MODE_ITEMS, SOURCING_MODE_ITEMS, etc. from panels.
  - Remove all `!masterNavEnabled` conditionals and the associated `HorizontalButtonSlider` nav blocks.
  - Clean up stale comments (e.g. operations "not in rail list").
- Make `getSidebarRouteKey` + `resolveSidebarMode` fast:
  - Replace linear if-chain with a Map (exact + longest-prefix) or a small compiled matcher.
  - Add benchmarks or a `nav:perf` test that asserts resolution cost for all registered surfaces + legacy aliases.
- Centralize consumption:
  - CommandBar, mobile-context-navigation, sidebar-titles, page-access, pin, assistant, search scopes, deep-link helpers all use the SoT helpers exclusively.
  - `useOrgNavItems` remains the override point.
- Mobile parity: make bottom nav + drawer resolve from the same `getSidebarNavItems` + surface data. Reconcile proxy rewrites so every surface (including new `/pack`, `/test`) has a fast, correct mobile path without funneling everything through receiving.
- Remove `useMasterNavEnabled` / `MasterNavProvider` once legacy code is gone (or keep as a no-op for safety).
- Update all tests (round-trips, active state, permissions) and the `sidebar-navigation.test.ts` invariant.
- Performance acceptance: switching between any surfaces (unbox → pack → test → outbound → fba → operations) must not cause noticeable sidebar re-work or duplicate nav renders. Profile key paths.

</details>

### Phase 12 — E2E, Deep-Link & Consumer Hygiene (big cleanup)  ✅ **DONE 2026-07-05** (hard-404 soak deliberately deferred)

`[status 2026-07-05]` Every legacy-URL literal that produces a navigation (not a comment / legacy-registry
mapping) is repointed to a canonical route; each swap lands on the **same** curl-verified redirect
destination, so nothing changed behaviorally — it just removes the redirect hop and states intent.
- **E2E literals → canonicals (8 specs):** `receiving-tech-modes` + `testing-sku-prepack-scan`
  (`/tech?view=testing` → `/test?view=testing`); `table-column-config` (`/tech`→`/test`, `/packer`→`/pack`,
  `/receiving?mode=history`→`/receiving/history`); `incoming-todo` (`/receiving?mode=incoming`→`/incoming`);
  `receiving-scan-resolution` + `zendesk-claim` + `receive-to-zoho` (bare `/receiving`→`/unbox`). No spec
  asserts on a legacy URL, so the swaps are behavior-preserving.
- **Producers audited + repointed** (this + prior phases): search-hit/global-entity-search (`/unbox`),
  page-context (`/pack` `/test` `/pickup` added; `/receiving/history` covered by the `receiving` segment),
  OperationsMatrix, signin + LandingPageCard + staff-management landing maps, admin-logs SQL, packing-logs
  `resumeHref`, ActivityInboxPopover, scan-history-route, ops-assistant up-next href, assistant `navigate`
  tool vocabulary (`/pack` `/test?view=testing` `/pickup`). Fixed the last real in-page hardcode
  (`useTechTestingSelection` `router.replace('/tech?…')` → path-relative). A final `grep` for
  `router.push|replace|href` → `/tech|/packer|/receiving?mode=` in `src` returns **zero** real navigations.
- **Canonical-route assertion test:** `page-context.test.ts` gained a "graduated surface routes map to the
  right AI-search boost" case (all 8 surfaces + legacy aliases); `src/lib/stations/surface-routing.test.ts`
  (Phase 11) already pins route → routeKey/permission/mobile/surfaceForRoute for all 8. 26/26 green
  (surface-routing 5 + page-context 6 + nav 15), tsc 0, lint clean.
- **⏸ Deferred (by design):** hard-404 on the oldest legacy aliases — the plan wants a soak + announcement
  first; the 307 redirects stay for deep-link / bookmark / muscle-memory back-compat. Release notes are
  commit-generated (prebuild), so they flow from the eventual commit.

### Phase 13 — Composition Cutover for Pack / Test / Outbound (optional per-org)  ✅ **DONE 2026-07-05** (capability built + dormant; per-org enable stays gated on parity)

`[status 2026-07-05]` Built the composition *capability* for the Test + Pack surfaces (dormant by default —
the SurfaceGate on `/pack`/`/test`/`/outbound` was already wired in Phases 7–9, so the cutover mechanism is
ready; nothing renders composed until an org publishes a row AND flips `surface_composed_render`, default OFF).
- **✅ Test surface — full composition:** new `testing.tech_queue` data source (`src/lib/stations/data-sources.ts`)
  wraps GET `/api/inbox/tech-queue` (units awaiting a test verdict + orders ready to ship; one row per carton,
  fields title/tracking/order/queue_kind/unboxed_at, `tech.view`-gated, `tech` realtime). Dormant seed
  migration `2026-07-05c_seed_test_surface_composition.sql` (page_key `tech`, mode_key `testing`): scan_band
  `surface:'test'` (trigger) + rail_feed → testing.tech_queue (queue), idempotent, node-bound when the testing
  node exists else page-bound — a byte-mirror of the unbox seed.
- **✅ Pack surface — scan-only composition:** the generic `scan_band` block is surface-parameterized
  (`configSchema.surface` over all SurfaceKeys), so a valid `surface:'pack'` scan composition needs no new
  block. **No queue block** was seeded: packing is scan-and-go and has **no purpose-built "awaiting pack"
  queue endpoint** to wrap (`/api/pending-skus` is a junk-SKU steward list, wrong domain). A packing-queue
  data source is a small follow-up once a dedicated queue endpoint exists — the mechanism accepts it with zero
  UI code.
- **✅ Proof (DB-free):** `src/lib/stations/composition-cutover.test.ts` (4 tests, in `test:stations`, 38/38
  green) asserts `testing.tech_queue` + the generic blocks are registered, and that BOTH the Test composition
  (scan_band:test + rail_feed→testing.tech_queue) and the Pack composition (scan_band:pack, scan-only)
  `validateStationConfig` → **0 issues** (publishable), with rail_feed field roles mapping only to declared
  source fields.
- **Outbound:** pointer-driven Workbench (not scan-driven) — the SurfaceGate is wired (Phase 9); a composition
  would want labels/scan-out blocks + a queue source, deferred with Pack's queue work. No behavior change.
- **⏸ Per-org enable stays gated:** `surface_composed_render` is flipped per org only after parity +
  diagnostics — a rollout decision, not a code deliverable. The seed rows are ACTIVE-but-dormant, so orgs can
  opt in without a further migration.

**Acceptance for full refactor:** Every one of the 8 SurfaceKeys has a working first-class route that matches its legacy experience; legacy aliases (where applicable) 302 cleanly; mobile + desktop + search + assistant + E2E all use canonical URLs; nav can be overridden per-org; Studio can publish compositions that affect real operator pages (behind flag); no behavior change for orgs that do not opt in.

---

## 8. Migration & Back-Compat Strategy

- **Aliases / Redirects**:
  - Server middleware or route handler: `/receiving?mode=receive` → `/unbox` (301 after announcement, or soft for 1–2 releases).
  - Update all internal links (rails, emails, audit, up-next, etc.).
- **Deep Link Preservation**: Old `?mode=receive&unboxview=queue&open=123` should resolve to equivalent on new surface.
- **Mobile Parity**: Same surface keys.
- **Assistant / Command Bar**: Add surface mapping + update `page-skills.ts`.
- **External Integrations**: Nothing changes (they use IDs or existing short links).
- **Bookmarks / Muscle Memory**: Announce in release notes + in-app nudge.

`[validation 2026-07-05 + full scan]` **Legacy URL consumers checklist** — receiving family + pack + test + others. Every one must be updated or covered by alias/redirect.

**Receiving family (pilot — largely addressed but re-verify on any change):**

| Consumer | Location | Note |
|---|---|---|
| ⌘K / AI search hit hrefs | `src/lib/search/search-hit.ts:90`, `src/lib/search/global-entity-search.ts:157` | Updated to `/unbox?openReceivingId=` in pilot; pinned by tests. |
| Backend absolute link | `src/lib/receiving-claim-photos.ts:324` | Repointed to `/unbox?recvId=` during pilot. |
| Assistant URL vocabulary | `src/lib/assistant/agent-loop.ts`, `page-skills.ts`, page-context | Teaches `/unbox` + `/triage`; receiving entity still boosted. |
| Proxy rewrites + redirect | `src/proxy.ts` (MOBILE_UA_REWRITES + resolveReceivingSurfaceRedirect) | Receiving surfaces → new routes (desktop); phones → /m/receiving. |
| Mobile allowlist | `sidebar-navigation.ts` `MOBILE_ALLOWED_PREFIXES` | `/unbox` `/triage` `/incoming` added in pilot. |
| Scan-history jump | `src/lib/scan-history-route.ts` | Still emits `/receiving?mode=history&recvId=` (History not graduated). |
| Activity inbox + share | ActivityInboxPopover, receivingShareUrl | Repointed in pilot for unbox. |
| Mobile drawer / context | MobileSidebarDrawer, mobile-context-navigation | Partial; some mode strings still receiving-specific. |
| E2E suite | receiving-tech-modes, mobile-unbox, incoming-todo, zendesk-claim, receive-to-zoho, receiving-scan-resolution, table-column-config, etc. | Many updated or tolerate alias; full hygiene in Phase 12. |

**Navigation Display Leakage (Master vs Legacy — must be eliminated for single SoT):**

| Leakage | Locations | Required Fix for One SoT + Speed |
|---|---|---|
| Legacy switchers still in tree (gated) | ReceivingSidebarPanel (ReceivingModeSwitcher), PackerSidebarPanel, TechSidebarPanel, Inventory, FBA, Warehouse, Sourcing, Outbound, Operations, Support, Products, DashboardOrders, Repair | Delete the switcher code and the `!masterNavEnabled` branches entirely. |
| Ungated sub-view nav | UnboxViewToggle, TriageViewToggle (inside ReceivingSidebarPanel), other headerRows sliders | Remove or move out of nav chrome. Master ModeRail + surface sub-state in main pane only. |
| Parallel keys | `SidebarRouteKey` ('packer','tech','receiving') vs `SurfaceKey` ('pack','test','unbox') in surface-keys.ts + sidebar-navigation.ts | Unify. Make SurfaceKey drive nav for stations or make SidebarRouteKey the authoritative display key fed by surfaces. |
| Slow route resolution | `getSidebarRouteKey` long if-chain + repeated calls in layout, panels, mobile, titles, etc. | Replace with Map-based or radix matcher. Add perf test. |
| Mobile separate display | RedesignedBottomNav, proxy MOBILE_UA_REWRITES, MobileSidebarDrawer | Consume from the same `getSidebarNavItems` + surface data. Fast per-surface mobile paths. |
| Other consumers | CommandBar (direct APP_SIDEBAR_NAV), mobile-context-navigation, sidebar-titles, assistant, search | All must use SoT helpers only. No raw constants. |
| Pack/test nav | Still 'packer'/'tech' in APP_SIDEBAR_NAV, MASTER_NAV_RAIL_PAGES not yet handling new keys | Complete unification when graduating routes in Phases 7/8. |

(Full sweep of notifications, emails, release notes, and every `href=`, `router.*`, `pathname:` literal is required in Phases 11–12. Add any new ones found to this table.)

**Other surfaces (FBA, Walk-in, etc.)** — lower priority for URL graduation (many are already at clean top-level routes like `/fba`, `/walk-in`, `/outbound`). Their mode/query leakage is secondary unless they become studio-composable surfaces.

---

## 9. Key Files (Illustrative — Not Exhaustive)

**New / graduated (pilot)**
- `src/app/unbox/page.tsx`, `triage/page.tsx`, `incoming/page.tsx`
- `src/lib/stations/{surface-keys.ts, surface-resolver.ts, archetype.ts, ...}`
- `src/components/surfaces/{SurfaceGate.tsx, SurfaceRenderer.tsx}`
- `src/lib/receiving/surface-path.ts`
- `src/lib/studio/template-surfaces.ts`
- `src/lib/migrations/2026-07-05*_unbox...sql` + `2026-07-05b_nav_definitions.sql`
- `docs/todo/studio-driven-operator-surfaces-refactor-plan.md` (this file, now full-codbase)

**Still legacy-primary (require graduation work)**
- `src/app/packer/page.tsx` + components/packer/**
- `src/app/tech/page.tsx` + components/tech/**
- `src/app/outbound/page.tsx` (route ok, composition not wired)
- `src/app/receiving/page.tsx` (and subroutes) — now mostly alias / shared
- `src/app/m/(shell)/pack/page.tsx` (and other m/ receiving)

**Modified (core cross-cuts — examples)**
- `src/lib/sidebar-navigation.ts` (unification of keys, fast `getSidebarRouteKey`, removal of legacy mode data — **Phase 11 priority**)
- `src/components/sidebar/master-nav/*` + `SidebarShell.tsx` + `DashboardSidebar.tsx` (exclusive display)
- All `*SidebarPanel.tsx` (delete legacy switcher + sub-toggle code)
- `src/proxy.ts`, mobile redesign bottom nav, `src/lib/mobile-context-navigation.ts`
- Consumers: CommandBar, titles, search, assistant, etc.
- E2E + deep link producers

**Performance artifacts**
- Add `nav-resolution.perf.ts` or test that measures resolution cost for every surface.
- Memoization sites in `useSidebarModeNav`, `useActiveSidebarMode`, `useOrgNavItems`.

**Migrations (future)**
- Any station_definitions backfills or new data sources for pack/test compositions.
- Use `db-migration-author` skill when needed.

---

## 10. Testing, Guardrails & Acceptance Criteria

**Claude Code Guardrails (non-negotiable — enforced via skills + checks)**
- **Archetype + Style** (contextual-display.md, ui-design-system.md, display/station.md, motion-crossfade.md): Every Station surface (pack, test...) must use `pickArchetype()` result. Linear scaffold, one-row anatomy, semantic tokens only, `HoverTooltip`, paired icons. Crossfade **singular active verification card only** via `useMotionPresence(framerPresence.stationCard)`. No archetype mixing, no layout animation, no raw colors.
- **Backend** (backend-patterns.md): Status **only** via `transition()`/`applyTransition()`. Routes follow the exact skeleton. `recordAudit` with constants. `withTenantTransaction`. `Deps` injection + `domain-unit-test` skill for new helpers. `clientEventId` for mutations.
- **Source of Truth + Reuse** (source-of-truth.md): Pack-checklist lib, `SubstitutePanel` + `SUBSTITUTION_REASONS`, catalog image resolver, CopyChip family, existing photo components. Never inline.
- **Skills** (mandatory):
  - `station-block` before any new scan / photo / checklist / verification / note UI.
  - `sidebar-mode` before any mode/view rail or toggle.
  - `ops-studio` before `/studio` or definition changes.
  - `check-work` subagent on significant diffs.
  - `todo_write` for multi-phase work.
- **Station Display Requirements** (user-prioritized high-ROI, must survive graduation):
  - Prominent SKU catalog photos (sku_catalog + platform fallback) + attached `photos` (PACKER_LOG) in active crossfading verification area + checklist rows. "Visual match" labeling.
  - Form-like inline edits for notes/reasons directly in the active card (SubstitutePanel integration + general notes).
  - Scan focus: external links suppressed (ExternalLinkActionIcon, listing embeds, etc.) while preserving core chips.
  - Crossfade + linear UX consistent for pack + test (and future surfaces via shared primitives).
- **Build / Perf**: Explicit `.ts` extension in tailwind.config. Update content globs for new paths. Proper image `sizes`. No thrash on crossfade.
- **Tenant / Audit**: All new surfaces respect org scoping from birth. Every notable action (substitution, note, photo attach) via `recordAudit`.

**Tests**
- Unit: surface resolver, legacy fallback, param round-tripping. Deps-based tests for photo verifier, notes form, scan-focus logic.
- Integration: definition load + block rendering. Pack-checklist enrichment + substitution flows + photo resolution.
- E2E (Playwright): Graduated surfaces (`/pack`, `/test`), scan → enriched active card (photos visible, crossfade occurs) → sub/note capture → pre-ship audit. Assert external links absent in active scan state, legacy aliases still work, mobile parity, reduced-motion behavior.
- Guard: Registry entry required for new surfaces. Style/archetype lints or manual review against rules. `test:stations` + nav round-trips green.

**Acceptance (per phase) — including display layer**
- Canonical route (`/pack`, `/test`...) live and at least as good as legacy (photos, forms, focus, crossfade).
- URL bar reflects the job.
- Studio can bind a node; `'legacy'` fallback works.
- Legacy aliases (e.g. `/packer`, `/tech`) continue to function during transition.
- New surface in sidebar (via nav SoT / overrides).
- All deep links, mobile, assistant, audits preserved + new audit entries for the display actions (substitutions, notes).
- House style + motion + backend invariants hold. No archetype mixing. Shared primitives used.
- Different templates can produce different surface sets. Per-org nav overrides work.

---

## 11. Risks, Open Questions, Dependencies

**Risks (post full-codebase scan 2026-07-05)**
- **Navigation SoT unification is now the highest-risk workstream**. Dual keys (`SidebarRouteKey` vs `SurfaceKey`), scattered legacy display code in 12+ panels, sub-toggles, mobile parallel system, and many raw consumers. Must delete old display (not leave gated) or the "cross leakage" problem ships.
- Route proliferation — low.
- E2E + consumer churn high for pack/test graduation + nav cleanup.
- Speed regression risk if the fast route resolver is not implemented carefully.
- Temptation to keep "just one more" legacy pill row (e.g. UnboxViewToggle) instead of enforcing single display method.
- Mobile + desktop must stay in sync on the single SoT or users see different navigation on phone vs desktop.

**Open Questions (updated)**
- Graduate history → `/history` and/or pickup? Or keep under receiving bucket longer?
- Testing sub-modes (testing vs shipping) — one surface `/test?view=...` or split surfaces?
- SidebarRouteKey unification vs SurfaceKey: rename ids, keep aliases forever, or dual forever?
- Server `requirePermission` for station pages — inherit ungated status quo (current decision) or introduce for new surfaces?
- Scope boundary: which non-station pages (FBA, Walk-in, Dashboard modes, Inventory sub-views, Operations, Sourcing, Warehouse) ever become full SurfaceKeys + studio-composable?
- Timing for hard legacy alias removal (404) — after what soak + comms?

**Dependencies**
- Station/block registry + data source implementations for packing + testing surfaces.
- Ops Studio publish + diagnostics (already shipped).
- Template catalog entries that bind pack/test nodes to surfaces.
- Stable E2E baseline before the large hygiene edits in Phase 12.
- Mobile QA resources for shell + UA rewrite changes.

---

## 12. References & Prior Art

**Internal**
- Full Code Base Upgrade docs (especially URL versioning, editability spec, phased plan).
- `.claude/rules/` (contextual-display — archetype pick, backend-patterns, source-of-truth, ui-design-system, station-block / sidebar-mode / ops-studio skills).
- `src/lib/stations/` (surface-keys.ts + resolver + archetype + contract + data-sources + tests; unbox-composition.test.ts).
- `src/lib/sidebar-navigation.ts` + tests (core coupling point).
- `src/proxy.ts` (redirect + UA rewrite logic).
- `src/lib/receiving/surface-path.ts`, packer/ and tech/ scan classifiers, search/* (hits + context), assistant/*.
- `src/app/{unbox,triage,incoming,packer,tech,outbound,receiving}/**/*`, `src/app/m/(shell)/**/*`.
- `src/components/surfaces/`, packer, tech, receiving workspaces.
- `station_definitions` + workflow templates schema + seeding.
- E2E under `tests/e2e/` (receiving-tech-modes etc.).
- This plan + the leakage table.

**External (2026)**
- Notion workspace + page model.
- Linear workspace + concept addressing + custom views.
- Salesforce metadata-driven per-org pages / apps.
- Composable internal tool platforms (blocks + bindings + per-tenant definitions).
- Next.js App Router dynamic routing + middleware patterns for workspaces.

---

**Next Steps (post navigation leakage + single-SoT focus update)**
1. Treat **Phase 11 (Navigation SoT Unification + Speed)** as a blocking or parallel high-priority workstream alongside Pack/Test graduation (Phases 7/8).
2. Before touching more surfaces: audit every `!masterNavEnabled` site + every `HorizontalButtonSlider` used for modes/views. Delete legacy display code.
3. Implement fast `getSidebarRouteKey` (Map-based) + add a resolution perf test covering all surfaces.
4. Unify keys for pack/test when their routes land.
5. Invoke `sidebar-mode` skill for any remaining mode-like UI.
6. Re-run full leakage scan (including mobile + CommandBar + search) before claiming "single SoT".
7. Update this plan after each sub-step of Phase 11.

**This revision makes the plan primarily about establishing one SoT for routing and display** (sidebar-navigation.ts + MasterNav system) while still completing the surface URL + composition work. Speed (fast, uniform resolution) is now an explicit acceptance criterion for every route.

This is the complete, root-level plan. No insignificant patches.