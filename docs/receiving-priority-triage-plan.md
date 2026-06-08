# Receiving priority triage + unbox priority queue — plan

Status: **core slice shipped.** What's live:

1. Label rename `Found → Prioritize` (`TriageSidebarBody.tsx`, URL value stays `found`).
2. `?sort=priority` on `GET /api/receiving-lines` — source-platform rank, scoped to
   `view=scanned` (`RECEIVING_PRIORITY_RANK_SQL`).
3. `ReceivingScannedRail` requests `sort=priority`, so the triage **Prioritize** tab
   is platform-priority ordered.
4. Unbox mode (`mode=receive`): a **Recent / Queue** pill toggle pinned (sticky) at
   the top of the rail — above the eyebrow — mirroring the triage Found/Unfound
   pills. URL-backed via `unboxview=queue`. Recent → `ReceivingRecentRail`;
   Queue → `ReceivingScannedRail` (same priority feed as the triage Prioritize tab).

Implementation notes / deviations from the original plan below:

- **Priority sort is scoped to `view=scanned` only**, not activity/all. Those views
  append unmatched-carton placeholders and re-sort in JS by recent activity, which
  would silently clobber the SQL priority order. `view=scanned` excludes unmatched
  and skips that merge, so its SQL order is final. Both Prioritize surfaces use
  `view=scanned`, so this covers the requirement; activity/recent stay as-is.
- **`v_unfound_queue` was NOT changed.** Per the agreed ranking, unfound/unmatched
  cartons are all rank 1, so the Unfound tab is uniformly top-priority — re-sorting
  it by platform would contradict that. It keeps `created_at DESC`.
- Rank uses `r.source = 'unmatched' OR r.source_platform IS NULL` for rank 1 (an
  untagged carton you haven't identified is the most urgent to triage).

Remaining ideas (not built) are in **Open questions** at the bottom.

## Goal

Make receiving work surface by **priority**, driven by the package's source
platform, with the operator able to set/adjust priority on scan (you can see what
the item is the moment it scans in).

### Priority ranking (final, agreed)

Lower rank = higher priority = sorts to the top.

| rank | platform / state                                   |
|-----:|----------------------------------------------------|
| 1    | **unfound / NULL** `source_platform` (unmatched)   |
| 2    | amazon                                              |
| 3    | ebay                                               |
| 4    | goodwill                                            |
| 9    | everything else / known-other                      |

- "Unfound / null = 1" overrides the original amazon-first idea: an unmatched
  carton with no platform yet is the most urgent thing to triage.
- The amazon → ebay → goodwill order applies once a platform is known.

### Platform determination (no auto-detect)

- Read-time sort keyed on the existing carton-level `receiving.source_platform`
  column (CHECK: `zoho|ebay|amazon|fba|aliexpress|walmart|goodwill|ecwid|other`).
- Operator tags/changes platform via the existing `SourcePlatformPills`
  (`source_platform` write path) — no carrier/tracking inference, no new column.
- Because platform → rank is computed at read time, **changing the platform on
  scan immediately re-prioritizes** the package. This is the "update if the
  priority of the package is different based on scan" behavior the Prioritize
  tab is for.

### Why no schema migration

The receiving tables have **no** priority column today (priority enums/cols exist
only on `admin_features`, `staff_availability_rules`, `pipeline_tasks`,
`work_assignments`). We deliberately do **not** add one — priority is derived
from `source_platform` at read time, so it stays a view/query-only change and is
fully reversible.

## UI / flow

### A. Triage sidebar (`/receiving?mode=triage`) — two tabs

`TriageSidebarBody.tsx` already renders the toggle:

- **Unfound** (`triview` absent) — the priority-1 list: unmatched cartons that
  Zoho can't match yet (`TriageUnfoundList` → `/api/receiving/unfound-queue`).
- **Prioritize** (`triview=found`, label already renamed) — found / recently
  scanned cartons, **sorted by priority_rank**. This tab is the *update/edit*
  surface: when a found package is (re)scanned you confirm/adjust its platform,
  which re-ranks it. Renders `ReceivingScannedRail` → `/api/receiving-lines`.

### B. Unbox mode (`/receiving?mode=receive`) — new toggle under the scan bar

Add a `HorizontalButtonSlider` **below `ReceivingUnboxScanBar`** in
`ReceivingSidebarPanel.tsx` (the `motion.div` scan band, ~line 989-1009),
switching the unbox sidebar body between:

- **Prioritize** — the unbox queue sorted by `priority_rank` (highest at top),
  mirroring the triage Prioritize display.
- **Recent** — the current `ReceivingRecentRail` (`/api/receiving-lines`,
  eyebrow "Recent · Unboxing"), unchanged default behavior.

Persist the toggle in URL state per the sidebar-mode contract (e.g. a new
`unboxview=prioritize|recent` param) so refresh/deep-link is stable, matching how
`triview` works. Default = whatever the team prefers (suggest `recent` to avoid
changing current muscle memory; revisit).

## Backend changes

1. **`v_unfound_queue`** (new migration, drop+recreate view): add a derived
   `priority_rank` column via `CASE lower(coalesce(r.source_platform,''))` using
   the table above, and change the read path
   `/api/receiving/unfound-queue/route.ts` ORDER BY to
   `checked ASC, priority_rank ASC, created_at DESC`. (Unfound rows are all
   rank 1, so within the Unfound tab this is effectively `created_at DESC` — the
   rank matters once branches/platforms diverge.)

2. **`/api/receiving-lines`** (feeds both `ReceivingScannedRail` /
   Prioritize tab and `ReceivingRecentRail` / unbox Recent + Prioritize):
   add an optional `sort=priority` param that orders by the same
   `source_platform → rank` CASE, then `created_at DESC`. Keep the default sort
   unchanged so Recent is untouched; Prioritize views pass `sort=priority`.

   Define the CASE once (shared SQL fragment) so the view and the row query can't
   drift.

## Files to touch (when implementing)

- `src/components/sidebar/receiving/TriageSidebarBody.tsx` — label done; ensure
  Prioritize tab requests priority sort.
- `src/components/sidebar/ReceivingSidebarPanel.tsx` — add unbox-mode
  Prioritize/Recent slider under the scan bar + `unboxview` URL state.
- `src/components/sidebar/receiving/ReceivingScannedRail.tsx` /
  `ReceivingRecentRail.tsx` — accept/forward `sort=priority`.
- `src/app/api/receiving-lines/route.ts` — `sort=priority` ordering.
- `src/app/api/receiving/unfound-queue/route.ts` + new migration for
  `v_unfound_queue.priority_rank`.

## Open questions

- Default for the new unbox `unboxview` toggle (recent vs prioritize).
- Whether the Prioritize tab should also surface a quick platform-pill control
  inline (faster re-prioritize) vs requiring the workspace `SourcePlatformPills`.
