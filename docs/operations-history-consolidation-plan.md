# Operations History Consolidation — Unified Observability Plan

> **Status:** Not started · Created 2026-07-05  
> **Goal:** One filterable Operations **History** surface for forensic “what happened” (browse + record trace), absorbing fragmented audit-log and domain-history UIs — while **keeping Signals as a separate mode** (Studio-driven “why” layer) and **keeping station rails local** (fast scan-session UX).  
> **Owner:** TBD  
> **Related:**  
> - `docs/unified-global-search-consolidation-plan.md` (header search + History browse `?q=`)  
> - `docs/todo/studio-driven-operator-surfaces-refactor-plan.md` (surface URLs, `SurfaceGate`)  
> - `docs/operations-studio/Full Code Base Upgrade/04-DATA-FLOW-OBSERVABILITY.md` (static map vs live overlay)  
> - `docs/receiving-history-improvement-plan.md` (carrier/delivery — orthogonal; receiving history *display* migrates here)  
> - `src/features/operations/workspace/OperationsHistoryView.tsx`  
> - `src/lib/operations/journey.ts` + `journey-helpers.ts`  
> - `src/lib/surfaces/registry.ts` (`SIGNAL_KINDS`, `FEED_KEYS`)  
> - `src/features/signals/SignalsWorkspace.tsx`

> **⚠️ Transition constraint:** Ship additively behind feature flags. Station rails, Signals mode, and audit-log routes **stay live** until redirects are signed off. No big-bang deletion. Work on `main`; do not commit secrets.

---

## Execution status

| Phase | Scope | Status |
|-------|--------|--------|
| 0 | Taxonomy + flags + doc alignment | Not started |
| 1 | Enable History browse API | Not started |
| 2 | History browse UI (default landing) | Not started |
| 3 | History sidebar filters + saved views | Not started |
| 4 | Audit-log redirects + saved-view presets | Not started |
| 5 | Receiving history → History shortcut | Not started |
| 6 | History ↔ Signals cross-links | Not started |
| 7 | Remove audit-log UI + nav entry | Not started |

---

## 0. Executive summary

Cycle Forge today has **many surfaces that all look like “history”** but serve different jobs:

| Layer | Examples today | Correct home after this plan |
|-------|----------------|------------------------------|
| **Station session rail** | `RecentActivityRailBase`, `useStationHistory` | **Stay at station** — unchanged |
| **Forensic event log** | `/audit-log/*`, `/receiving/history`, History trace-only | **`/operations?mode=history`** — browse + trace |
| **Structured “why” facts** | `entity_signals`, Signals mode | **`/operations?mode=signals`** — **keep separate** |
| **Search query memory** | `/search/history` | **Unchanged** — not operational history |

**Industry standard** ([activity feed vs activity log UX](https://uxpatternsguide.com/compare/activity-feed-vs-feed-vs-activity-log-vs-notification-center/), [SaaS audit design](https://www.averagedevs.com/blog/audit-logs-saas-compliance-trust), Salesforce Event Monitoring vs Setup Audit Trail, Datadog Events vs Audit Trail): **separate read models and UIs for separate questions**, with cross-links — not one infinite merged page.

**Decision D1 — No new Operations mode.** Upgrade existing **History** from record-lookup-only to a **dual-region Monitor**:

1. **Browse** (default) — org-wide, filterable, paginated event feed  
2. **Trace** (drill-down) — focused order / serial / tracking journey (shipped behavior)

**Decision D2 — Keep Signals as its own mode.** `entity_signals` is the AI read substrate, Studio `nodeId` / `workflowDefinitionId` anchor, and tenant-extensible `signal_kind` registry. Merging into History would bury tenant workflow intelligence inside a generic event firehose.

**Decision D3 — Station rails never move global.** Scan-first session recency is a **Station** archetype; global History reads the same `station_activity_logs` spine asynchronously via browse — stations write, History reads.

---

## 1. Problem statement

### 1.1 Symptom

Operators and admins must discover **which “history” to open**:

- Operations ▸ History — paste a record number (empty until you do)
- Operations ▸ Signals — `entity_signals` timeline + browse
- `/audit-log/receiving|packing|tech|sku|staff|trace` — six section pickers
- `/receiving/history` — receiving-lines table monitor
- `/admin/inventory/events` — raw `inventory_events` explorer
- Per-station rails — recent scans beside the scanner
- `/search/history` — typed query recents (unrelated)

Each has its own sidebar search, filter params, and mental model. Audit aggregators (`receiving-aggregator.ts`, `packing-aggregator.ts`, …) overlap the five spines already merged in `mergeJourney()` / `buildBrowseQuery()`.

### 1.2 What is already built (high leverage)

| Piece | Location | Notes |
|-------|----------|-------|
| Journey entity reader | `src/lib/operations/journey.ts` | `readJourneyEntity` — five-spine fan-out |
| Journey browse SQL | `src/lib/operations/journey-helpers.ts` | `buildBrowseQuery` — keyset UNION, unit-tested |
| Journey API (entity only) | `src/app/api/operations/journey/route.ts` | **Browse intentionally 400s** today |
| History URL state | `useOperationsTimelineUrlState.ts` | `q`, `stations`, `types`, `from`/`until`, `staffId`, `cursor`, `sources` |
| Filter vocabulary | `operations-sidebar-shared.ts` | `JOURNEY_STATION_ITEMS`, `JOURNEY_TYPE_ITEMS`, scoped params |
| Saved views API | `/api/operations/saved-views` | Personal + org-shared filter presets |
| History UI (trace) | `OperationsHistoryView.tsx` | Record lookup + `EventTimeline` |
| Browse results (flag) | `OperationsResultsView.tsx` | Global search hits when `NEXT_PUBLIC_UNIFIED_HEADER_SEARCH` |
| Timeline primitive | `EventTimeline` + `src/lib/timeline/*` | Shared adapters — do not fork |
| Signals mode | `SignalsWorkspace`, `SignalsBrowseWorkspace` | Workbench; `nodeId` detail |
| AI substrate | `entity_signals` + `SIGNAL_KINDS` registry | Descriptions written for the model |
| Audit UI | `src/app/audit-log/*`, `AuditLogSidebarPanel` | `admin.view_logs` |
| Station rails | `RecentActivityRailBase` | Optimistic, navigate events |

**Gap:** Browse backend exists but is API-gated; History UI shows empty state instead of browse; audit-log duplicates spine readers in six pages.

### 1.3 Non-goals

- Merging **Signals** into History (see Decision D2)
- Moving **station rails** to Operations (see Decision D3)
- Replacing `/search/history` (query memory)
- Deleting raw aggregators before redirects are stable
- Numeric/versioned paths in main nav
- Changing external short links (`/o/`, `/p/`, …)

---

## 2. Target architecture — three observability layers

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  LAYER 1 — STATION (local, fast)                                            │
│  RecentActivityRailBase · useStationHistory · scan-band reflex              │
│  Archetype: Station · optimistic · prev/next · pin selected row             │
│  Writes → station_activity_logs (+ inventory_events at chokepoints)         │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │ same events, async
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  LAYER 2 — OPERATIONS HISTORY (global forensic)                             │
│  /operations?mode=history                                                     │
│  Browse: filter/sort/paginate all spines                                      │
│  Trace:  ?order= | ?serial= | ?tracking= full journey                       │
│  Archetype: Monitor · URL-driven · observe-only                             │
│  Absorbs: audit-log display, receiving history monitor shortcuts            │
└─────────────────────────────────────────────────────────────────────────────┘
          cross-link ?entityType=&entityId=              cross-link ?serial=
                                    │
┌─────────────────────────────────────────────────────────────────────────────┐
│  LAYER 3 — OPERATIONS SIGNALS (global “why”, Studio-driven)                 │
│  /operations?mode=signals                                                     │
│  Timeline + Browse (?signalId=) · signalKind · nodeId filters               │
│  Archetype: Workbench · durable ?signalId= selection                        │
│  Data: entity_signals only · registry-extensible per tenant workflow        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Operations mode map (final)

| Mode | Question | Changes in this plan |
|------|----------|----------------------|
| **Live** | What’s happening right now? | None |
| **Analytics** | How are we trending? | None |
| **Insights** | What should I do? (AI) | May summarize History + Signals; does not own either UI |
| **History** | What happened? Show proof. | **Major upgrade** — browse + trace + audit absorption |
| **Signals** | Why did this outcome occur? | **Keep separate** — cross-links only |

### 2.2 History dual-region UX

```
/operations?mode=history
┌──────────────── Sidebar ────────────────┐  ┌──────── Main (Monitor) ────────────────┐
│ Mode rail (if not MasterNav)            │  │                                         │
│ Time window · Staff · Stations · Types  │  │  REGION A — Browse (default)            │
│ Source spines · Saved views               │  │  EventTimeline · cursor load-more     │
│ Dimension toggle (order|serial|tracking)  │  │  OR                                     │
│ Search → ?q= (header when unified flag)   │  │  REGION B — Trace (when entity set)     │
│                                           │  │  Record chip · export CSV/PDF           │
└───────────────────────────────────────────┘  │  OR                                     │
                                               │  REGION C — Search hits (?q= fuzzy)     │
                                               │  OperationsResultsView (existing)       │
                                               └─────────────────────────────────────────┘
```

**Region precedence** (URL-driven, matches `OperationsHistoryView` `region` key):

1. `?order=` / `?serial=` / `?tracking=` → **Trace** (focused entity)
2. Else `?q=` + unified header flag + not identifier-shaped → **Search hits**
3. Else any browse filter or empty → **Browse** (never empty dashed box)

### 2.3 Signals stays separate — rationale

| Concern | History | Signals |
|---------|---------|---------|
| Primary table(s) | SAL, inventory_events, audit_logs, carrier, warranty | `entity_signals` |
| Question | What happened? | Why / exception / outcome reason? |
| Studio coupling | Station spine filters | `workflowDefinitionId`, `nodeId`, `node_surfaces` |
| Tenant extension | Saved filter views | New `signal_kind` via registry (no DDL) |
| AI contract | Trace context for assistant | **Primary read substrate** (`registry.ts` descriptions) |
| UI archetype | Monitor (timeline bands) | Workbench (list + `?signalId=` detail) |

Industry parallel: Salesforce **Event Monitoring** (operational events) vs structured exception/reason objects; Datadog **Logs/Events** vs **Audit Trail** — correlated, not collapsed.

---

## 3. Data model & API contract

### 3.1 History browse — enable existing backend

**Route:** `GET /api/operations/journey`

**Today:** Requires `order` | `serial` | `tracking` → `mode: 'entity'` or 400 `RECORD_REQUIRED`.

**Target dispatch:**

```ts
// Pseudocode — route.ts
const entityValue = resolveEntityParam(dim, searchParams);
const filters = parseJourneyFilters(searchParams);
const cursor = decodeCursor(searchParams.get('cursor'));

if (entityValue?.trim()) {
  // ENTITY — unchanged
  const events = await readJourneyEntity(client, orgId, anchors, filters);
  return { success: true, mode: 'entity', entity: anchors, events, nextCursor: null };
}

// BROWSE — new branch
const { events, nextCursor } = await readJourneyBrowse(client, orgId, filters, cursor);
return {
  success: true,
  mode: 'browse',
  events,
  nextCursor: nextCursor ? encodeCursor(nextCursor) : null,
  limit: filters.limit,
};
```

**Browse query params** (already in `JourneyFilters` / URL state):

| Param | Purpose |
|-------|---------|
| `from`, `until` | ISO date bounds (default: last 7d browse, 30d max window via `BROWSE_WINDOW_MS`) |
| `stations` | CSV — `RECEIVING`, `TECH`, `PACK`, `SHIP`, `FBA` |
| `types` | CSV — `RECEIVED`, `PACK_COMPLETED`, … (`JOURNEY_TYPE_ITEMS`) |
| `staffId` | Actor filter |
| `status` | Optional status facet |
| `sources` | CSV — `sal`, `inventory`, `audit`, `carrier`, `warranty` |
| `q` | Free-text (LIKE escaped, length-capped — tested in `journey-helpers.test.ts`) |
| `cursor` | Keyset pagination token |
| `limit` | Clamped 1–200 (default 60) |

**Explicitly excluded from History browse:** `entity_signals` rows — those remain Signals-only (Decision D2). Cross-link instead of UNION.

### 3.2 Permissions

| Surface | Permission today | Notes |
|---------|------------------|-------|
| History browse/trace | `operations.view` | Floor supervisors |
| Audit spine rows (`sources=audit`) | Consider gating | Option A: visible to all with `operations.view`. Option B: `audit` source only when `admin.view_logs`. **Recommend B** for field-level diffs. |
| Signals | `operations.view` | Unchanged |
| Old audit-log pages | `admin.view_logs` | Redirect preserves admin-only audit diffs until Phase 7 |

### 3.3 Saved views

Seed org presets (via migration script or admin bootstrap) mapping old audit sections:

| View name | Filters |
|-----------|---------|
| `receiving-audit` | `stations=RECEIVING`, `sources=inventory,audit,sal` |
| `pack-audit` | `stations=PACK` |
| `tech-audit` | `stations=TECH` |
| `shipping-carrier` | `sources=carrier`, `stations=SHIP` |
| `floor-today` | `from=<today>`, all sources except `audit` |

Stored in existing `operations_saved_views` table; applied via `?view=<id>` or `applyView()` in sidebar.

---

## 4. Audit-log absorption

### 4.1 Redirect map

Implement in `src/proxy.ts` (302) or Next.js redirects; preserve query params where possible.

| Legacy URL | Target |
|------------|--------|
| `/audit-log` | `/operations?mode=history` |
| `/audit-log/trace?serial=X` | `/operations?mode=history&dim=serial&serial=X` |
| `/audit-log/receiving?po=X` | `/operations?mode=history&stations=RECEIVING&q=X` or PO entity drill when PO resolver exists |
| `/audit-log/packing?tracking=X` | `/operations?mode=history&dim=tracking&tracking=X` |
| `/audit-log/tech?session=S` | `/operations?mode=history&stations=TECH&staffId=S` (map session → staffId) |
| `/audit-log/sku?sku=X` | `/operations?mode=history&q=X&types=` (SKU-scoped browse) |
| `/audit-log/staff` | `/operations?mode=history` + staff picker in sidebar |

### 4.2 UI port (not reimplementation)

| Audit component | History destination |
|-----------------|---------------------|
| `AuditLogFilterStrip` (date + staff) | `HistorySidebar` — map `day`/`start`/`end` → `from`/`until`, reuse staff directory fetch |
| Section nav slider | Saved views + station/source chips |
| `PODetailView` / pickers | Trace region for focused PO **or** browse row drill |
| `AuditEventCard` | Deprecate — render via `EventTimeline` adapters |

**Keep server modules:** `src/lib/audit-log/*-aggregator.ts`, `entity-history.ts` — become entity-drill helpers or browse branch inputs; do not delete until Phase 7.

### 4.3 Nav

- Remove `audit-log` from `APP_SIDEBAR_NAV` in Phase 7
- Until then: sidebar item label “Audit log” → links to `/operations?mode=history&view=receiving-audit` with tooltip “Moved to Operations History”
- Settings ▸ Admin logs tab: update copy + link

---

## 5. Receiving history (`/receiving/history`)

**Decision D4:** Keep URL as **operator shortcut**; single filter engine underneath.

| Option | URL | Implementation |
|--------|-----|----------------|
| A (recommended) | `/receiving/history` stays | Thin page: redirect or `ReceivingSurfacePage` embed that sets `?mode=history&stations=RECEIVING&view=receiving-lines` |
| B | Remove route | Nav points directly to Operations History saved view |

**Deprecate over time:** `ReceivingHistorySearchSection` sidebar — params map 1:1 to History URL (`q`, `field` → browse `q` + `types`, `scope` → saved view).

Receiving history **carrier/delivery** work (`docs/receiving-history-improvement-plan.md`) remains in receiving domain APIs; only the **display shell** consolidates.

---

## 6. Station rails — explicit contract

### 6.1 What stays local

| Component | Route context | Why |
|-----------|---------------|-----|
| `RecentActivityRailBase` | Unbox, triage, testing rails | Optimistic updates, `navigateEvent`, pin selection |
| `useStationHistory` | Pack/test dashboards | Today’s count KPI |
| `TechRailSearchBar`, triage search | Station bottom bars | Scan archetype — exempt per unified-search plan §5 |

### 6.2 Optional bridge (Phase 6, low priority)

Rail row overflow action: **“Open in Operations”** →

```
/operations?mode=history&dim=serial&serial={serial}
/operations?mode=signals&signalsView=browse&entityType=SERIAL_UNIT&entityId={id}
```

No realtime sync requirement — History browse refetches on focus.

---

## 7. History ↔ Signals cross-links

### 7.1 From History trace

When `useOperationsJourney` returns entity anchors, fetch related signals:

```
GET /api/entity-signals?entityType=SERIAL_UNIT&entityId=123&limit=20
```

Render compact strip above timeline: “2 signals” → `/operations?mode=signals&signalsView=browse&…`

### 7.2 From Signals detail

`SignalsBrowseWorkspace` detail pane footer:

- **Full event trace** → `openInHistoryHref({ dim, value })` using `journeyKeyOf` / existing serial journey helpers
- Show `nodeId` + workflow definition link → Studio graph (when `/studio` deep link exists)

### 7.3 Shared URL helpers

Add `src/lib/operations/history-links.ts`:

```ts
export function operationsHistoryTraceHref(args: {
  dim: JourneyDimension;
  value: string;
  filters?: Partial<JourneyUrlFilters>;
}): string;

export function operationsSignalsBrowseHref(args: {
  entityType?: SurfaceEntityType;
  entityId?: number;
  signalKind?: string;
  nodeId?: string;
}): string;
```

Single SoT for assistant tools, CommandBar, and UI chips.

---

## 8. Unified header search integration

When `NEXT_PUBLIC_UNIFIED_HEADER_SEARCH=true` (see unified-global-search plan):

| Context | Header behavior |
|---------|-----------------|
| `mode=history`, not focused | `?q=` → browse or `OperationsResultsView`; Enter on identifier → `setEntity` fast-path |
| `mode=history`, focused | Header shows record chip; Clear → back to browse |
| `mode=signals` | Existing `usePageHeaderSearch` — unchanged |

Recents scope: `operations:history` (already in `HistorySidebar`).

---

## 9. Phased implementation

### Phase 0 — Taxonomy, flags, tests (1–2 days)

**Deliverables:**

- [ ] Add `NEXT_PUBLIC_OPERATIONS_HISTORY_BROWSE` (default `false`) in `src/lib/feature-flags.ts`
- [ ] Rename user-facing copy where misleading: station rail eyebrow “Recent” not “History” if ambiguous
- [ ] Update `operations-sidebar-shared.ts` comment block to match this plan
- [ ] Add `docs/operations-history-consolidation-plan.md` (this file) to assistant `OPERATIONS_SKILL` fragment

**Acceptance:** Flag off → byte-identical History empty state; flag on → browse region visible in dev.

---

### Phase 1 — Browse API (2–3 days)

**Files:**

- `src/app/api/operations/journey/route.ts` — add browse branch
- `src/lib/operations/journey.ts` — verify `readJourneyBrowse` export
- `src/lib/operations/journey-helpers.test.ts` — extend if new filter combos

**Deliverables:**

- [ ] `GET /api/operations/journey` returns `mode: 'browse'` without entity param
- [ ] Keyset `cursor` round-trips; `nextCursor` null at end
- [ ] `sources=audit` requires `admin.view_logs` (if Decision §3.2 Option B)
- [ ] Route tests: entity unchanged; browse 200; org isolation

**Acceptance:** `curl`/integration test returns merged events newest-first for `?stations=PACK&limit=10`.

---

### Phase 2 — History browse UI (3–5 days)

**Files:**

- `src/features/operations/workspace/OperationsHistoryView.tsx` — default browse region
- New: `src/hooks/useOperationsJourneyBrowse.ts` — React Query + cursor load-more
- `src/components/ui/TimelineSection.tsx` — optional footer “Load more”

**Deliverables:**

- [ ] Landing `/operations?mode=history` shows last 7d browse (flag on)
- [ ] Replace empty dashed state with timeline (loading + empty filters message)
- [ ] Row click on identifier chip → `url.setEntity` (trace drill)
- [ ] Preserve trace region + `OperationsResultsView` behavior

**Acceptance:** Operator can scroll floor events without pasting a record number.

---

### Phase 3 — History sidebar filters + saved views (3–5 days)

**Files:**

- `src/components/sidebar/OperationsSidebarPanel.tsx` — `HistorySidebar` expansion
- Port patterns from `AuditLogFilterStrip.tsx` (staff, date presets)
- Wire `/api/operations/saved-views` — list + apply + create from active filters

**Deliverables:**

- [ ] Station chips (`JOURNEY_STATION_ITEMS`)
- [ ] Event type chips (`JOURNEY_TYPE_ITEMS`)
- [ ] Date presets → `from`/`until`
- [ ] Staff filter → `staffId`
- [ ] Source spine toggles (`sal`, `inventory`, `audit`, …)
- [ ] Saved views dropdown; “Save current view”
- [ ] `activeFilterCount` badge on filter popover

**Acceptance:** Deep-link `?stations=TECH,PACK&types=TEST_PASS&from=2026-07-01` reproduces on reload.

---

### Phase 4 — Audit-log redirects + presets (2–3 days)

**Files:**

- `src/proxy.ts` — redirect table §4.1
- Script or seed: default saved views per org
- `src/lib/sidebar-navigation.ts` — audit nav href update (soft)

**Deliverables:**

- [ ] All `/audit-log/*` URLs redirect to History equivalents
- [ ] Seeded saved views for former audit sections
- [ ] Banner on legacy audit pages (if any remain briefly): “This moved to Operations → History”

**Acceptance:** Bookmark `/audit-log/trace?serial=ABC` lands on trace view.

---

### Phase 5 — Receiving history shortcut (1–2 days)

**Files:**

- `src/app/receiving/history/page.tsx`
- `src/lib/receiving-history-search.ts` — mapping doc comment to History params

**Deliverables:**

- [ ] `/receiving/history` opens History browse with `stations=RECEIVING` preset
- [ ] Sidebar receiving History mode links to same preset (nav already at `RECEIVING_HISTORY`)

**Acceptance:** Receiving supervisor workflow unchanged; one filter engine.

---

### Phase 6 — Cross-links + station bridge (2–3 days)

**Files:**

- `src/lib/operations/history-links.ts` (new)
- `OperationsHistoryView` — related signals strip
- `SignalsBrowseWorkspace` — trace footer link
- Optional: `RecentActivityRailBase` row action

**Deliverables:**

- [ ] Trace → Signals deep link
- [ ] Signal detail → History trace link
- [ ] Assistant / CommandBar can emit both link types

---

### Phase 7 — Remove audit-log UI (2–3 days, flag-gated)

**Delete or archive:**

- `src/app/audit-log/**` pages
- `src/components/audit-log/AuditLog*Client.tsx` (after adapter parity verified)
- `AuditLogSidebarPanel` — remove from `RouteShell`
- `audit-log` route key from nav (keep permission for `sources=audit`)

**Keep:**

- `src/lib/audit-log/**` server aggregators until all drill paths use journey API
- `/admin/inventory/events` — admin debug surface (document as internal)

**Acceptance:** No `/audit-log` route in app router; redirects still work via proxy for external bookmarks.

---

## 10. File-level map

| Action | Path |
|--------|------|
| **Extend** | `src/app/api/operations/journey/route.ts` |
| **Extend** | `src/features/operations/workspace/OperationsHistoryView.tsx` |
| **Extend** | `src/components/sidebar/OperationsSidebarPanel.tsx` (`HistorySidebar`) |
| **Add** | `src/hooks/useOperationsJourneyBrowse.ts` |
| **Add** | `src/lib/operations/history-links.ts` |
| **Port** | `AuditLogFilterStrip` patterns → History sidebar |
| **Redirect** | `src/proxy.ts` |
| **Keep** | `src/lib/operations/journey.ts`, `journey-helpers.ts` |
| **Keep** | `src/features/signals/*`, `SignalsWorkspace` |
| **Keep** | `src/components/sidebar/receiving/RecentActivityRailBase.tsx` |
| **Deprecate** | `src/app/audit-log/**` (Phase 7) |
| **Deprecate** | `ReceivingHistorySearchSection` as separate search SoT (Phase 5) |
| **Unchanged** | `src/app/search/history/page.tsx` |

---

## 11. Testing plan

| Area | Tests |
|------|-------|
| Browse SQL | `journey-helpers.test.ts` — extend station/source pruning |
| Journey API | New route tests: browse pagination, tenant isolation, audit permission |
| URL state | `useOperationsTimelineUrlState` — browse vs focus mutual exclusion |
| Redirects | `proxy.test.ts` or e2e: audit-log → history |
| UI | Playwright: History landing shows events; trace drill; saved view apply |
| Regression | Station rail e2e unchanged (`table-column-config.spec.ts` receiving history) |
| Permissions | `admin.view_logs` required for `sources=audit` if Option B |

---

## 12. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Browse query cost at scale | Keyset pagination; 30d window cap; indexes on SAL/inventory_events already exist |
| Operators lose familiar audit pickers | Saved views + redirects; 30-day parallel banner |
| History feels like noise | Default 7d + station filter; not infinite firehose |
| Signals buried if merged | **Keep separate mode** (Decision D2) |
| Permission regression | Audit diffs gated; floor staff see SAL/inventory/carrier only |
| Flag proliferation | Two flags: `UNIFIED_HEADER_SEARCH` + `OPERATIONS_HISTORY_BROWSE`; document matrix |

---

## 13. Success metrics

- **One** forensic surface for supervisors (`mode=history` browse sessions/week)
- Audit-log page views → 0 (redirects only) within 30d of Phase 7
- Median time-to-answer “what happened to serial X?” ≤ 2 clicks (browse → trace)
- Signals mode engagement stable or up (not cannibalized)
- Station scan throughput unchanged (rail latency, today count)

---

## 14. Open questions

| # | Question | Default if unresolved |
|---|----------|------------------------|
| Q1 | Audit spine visible to `operations.view` or `admin.view_logs` only? | Admin only for `sources=audit` |
| Q2 | `/receiving/history` redirect vs embed? | Embed preset (Option A) |
| Q3 | Default browse window: 7d or 24h? | 7d |
| Q4 | Absorb `/admin/inventory/events` into History? | No — keep admin debug |
| Q5 | Rename mode label “History” → “Activity”? | Keep “History” for nav stability |

---

## 15. Claude Code invariants (all phases)

- **Archetype:** History = Monitor; Signals = Workbench; station rail = Station — never blend in one region (`.claude/rules/contextual-display.md`)
- **Timeline:** All event rendering via `EventTimeline` + `*ToTimeline` adapters
- **Backend:** New routes via `withAuth` → validate → domain → `recordAudit` where mutating; tenant via `withTenantTransaction`
- **SoT:** Filter vocab in `operations-sidebar-shared.ts`; signal kinds in `registry.ts`; no inline duplicates
- **Compose rails:** Do not fork `RecentActivityRailBase` / `SidebarRailShell`
- **Flags:** Additive migration; default OFF until signed off

---

## Appendix A — Journey source spines

| Source | Origin table(s) | Station mapping |
|--------|-----------------|-----------------|
| `sal` | `station_activity_logs` | RECEIVING, TECH, PACK, … |
| `inventory` | `inventory_events` | Per `event_type` + `station` column |
| `audit` | `audit_logs` | Field-level diffs |
| `carrier` | `shipment_tracking_events` | SHIP (org-gated via orders) |
| `warranty` | warranty events spine | WARRANTY |

Signals (`entity_signals`) — **not** a journey browse source; linked via entity keys only.

---

## Appendix B — Feature flag matrix

| Flag | Default | Effect |
|------|---------|--------|
| `NEXT_PUBLIC_UNIFIED_HEADER_SEARCH` | `false` | Header drives `?q=` browse + recents |
| `NEXT_PUBLIC_OPERATIONS_HISTORY_BROWSE` | `false` | History landing = browse feed vs empty state |
| (future) `NEXT_PUBLIC_AUDIT_LOG_DEPRECATED` | `false` | Hide audit-log nav; redirects only |

Enable order for dogfood: `OPERATIONS_HISTORY_BROWSE` → `UNIFIED_HEADER_SEARCH` → audit deprecation flag.
