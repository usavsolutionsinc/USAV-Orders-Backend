# Receiving — door-scan classification + organizing unbox/unfound patterns into Triage

**FINAL STATUS: INITIATIVE A DONE; INITIATIVE B DONE — B1 + B4 (2026-06-28), B2 + B3 (2026-06-29, lower-risk row-action + read-only exception context). Status verified 2026-06-29.**
Initiative A (door-scan classification) finished with no migration — maps onto existing receiving columns per Open-decision #2. Initiative B (organize unbox/unfound into Triage): B1 (triage rail `TriageRecentRail`), B4 (scan-auto-select into triage), B2 (claim row-action on unfound triage rows → existing `ReceivingClaimModal`), and B3 (read-only `tracking_exceptions` state as a dot + tooltip in the unfound popover) all shipped. Per Open-decision #4, B2/B3 took the LOWER-RISK shape — a carton-row action + read-only context, NOT an embedded `unmatched_receiving` queue rewrite. Only two minor Initiative-A residuals remain: the A4 eBay-DH/USAV/MK precision thread and the `LOCAL_PICKUP` carton `intake_type` schema gap.

**Status:** Desktop unfound-triage vertical BUILT (2026-06-06); door classification + mobile add-info pending · **Date:** 2026-06-06

> **Built (desktop Triage):** Found/Unfound toggle in the triage sidebar
> (`TriageSidebarBody`, URL `?triview=`, default Unfound); the **Unfound list**
> (`TriageUnfoundList`) sourced from the existing `GET /api/receiving/unfound-queue?
> kind=unmatched_receiving` (no new backend); and the **identify/add-info pane** in
> `TriageDetailsPanel` for unmatched cartons — `SourcePlatformPills` +
> `ReceivingTypePills` + a **Link Zoho PO#** input (PATCH `zoho_purchaseorder_number`
> → promotes unmatched→matched, drops off the list) + the **same `UnmatchedItemsSection`
> the unbox workspace mounts** (add items/serials). So the unfound add-item flow now
> lives in BOTH triage and unbox, per request. tsc clean; 27 unit tests pass.
> **Clarified reqs folded in (this turn):** triage fields = box-type/platform + Zoho PO#
> + SKU/product + notes/photo (via UnmatchedItemsSection); lives on both mobile + desktop;
> resolves auto-on-Zoho-sync + manual PO link.
> **Built (door classification, 2026-06-06):** Initiative A1 — `src/lib/receiving/
> intake-classification.ts` (`IntakeClassification` ↔ the carton columns, single
> mapping, 6 unit tests) + `lookup-po` accepts optional `classification` and persists
> it onto `receiving` (source_platform/is_return/return_platform) via
> `applyIntakeClassification` at all 4 carton paths (UNKNOWN = no-op). Initiative A2 —
> mobile `/m/receive` sticky **"Receiving as"** selector (localStorage default, set-once-
> scan-many), sends `classification` per scan, shows the tag chip on each scan row. The
> unboxer auto-sees it via the existing `CartonContextCard` (no new display code). tsc
> clean; 31 unit tests pass.
> **DONE 2026-06-28:** A1-step3 (`is_return`/`return_platform` now WRITABLE on
> `PATCH /api/receiving/[id]`, validated against the return-platform vocabulary); A3
> (desktop triage classify pill row in `UnmatchedItemsSection`, triage-gated, PATCHes
> mapped cols + emits `usav-refresh-data`/`receiving-package-updated`); A4 (read-only
> "This is <classification>" banner in `CartonContextCard` via `columnsToClassification`
> + `RECEIVING_VARIANT_THEME`). Initiative A is complete.
> **DONE 2026-06-28 (Initiative B pass 2):** B1 (named `TriageRecentRail` rail,
> composed from `RecentActivityRailBase` via `ReceivingScannedRail` scope=triage,
> surfaced in the triage sidebar's Prioritize tab — driven by the EXISTING
> `view=scanned` query, no new server view, lower-risk per Open-decision #4-style
> reasoning) and B4 (triage scan now select-on-resolve: the triage `onSubmit`
> threads an `onResult` that re-dispatches `receiving-select-line` for the resolved
> carton so it drops straight into the triage detail pane). tsc clean on touched files.
> **Still pending (Initiative B):** mobile unfound add-info (mobile has the Found/Unfound
> filter); notes/photo in triage; B2/B3 claim modal + tracking_exceptions
> (design-gated). Auto-resolve uses the existing tracking-exception cron (already wired).
**Builds on:** `docs/receiving-triage-mode-plan.md` (triage mode is now live, Phases 1–4)
and [[mobile-door-receive-feature]].

**Two initiatives:**
- **A. Door-scan package classification.** At the incoming door (mobile `/m/receive`
  + desktop Triage), staff tag *what kind of package* this is — "FBA return", "Amazon
  return", "eBay return", "PO", "trade-in", "local pickup" — so the **unboxer auto-sees
  it and knows what to do**. The efficiency win is *set-once-scan-many*: pick a type,
  scan a whole pallet, all tagged.
- **B. Organize the unbox + unfound patterns into Triage** so triage is the single
  "identify before unbox" surface (verdict + classification + unfound handling), reusing
  what already exists instead of forking new mechanisms.

---

## 1. What already exists (from the scan)

### Classification model — **fragmented across 4 places** (must reconcile)
| Field | Table | Values | Set by |
|---|---|---|---|
| `source_platform` | `receiving` (carton) | `zoho,ebay,amazon,fba,aliexpress,walmart,goodwill,ecwid,other` | `PATCH /api/receiving/:id` (validated enum) |
| `is_return` / `return_platform` | `receiving` (carton) | `AMZ,EBAY_DRAGONH,EBAY_USAV,EBAY_MK,FBA,WALMART,ECWID` | **DONE 2026-06-28** — now WRITABLE on `PATCH /api/receiving/:id` (validated) |
| `receiving_type` | `receiving_lines` (line) | `PO,RETURN,TRADE_IN,PICKUP` | `PATCH /api/receiving-lines` (unvalidated) |
| `source_platform_pill` / `intake_type` | `receiving_lines` (line) | `ebay,goodwill,amazon,aliexp,walmart,other` / `po,return,trade_in` | `/api/receiving/add-unmatched-line` |

⚠️ **Drift to fix:** `aliexp` (line) vs `aliexpress` (carton); `intake_type` lowercase vs
`receiving_type` UPPERCASE; FBA only expressible via `return_platform`/`source_platform`,
not `receiving_type`. A single classify control needs one normalized mapping.

### The unboxer-facing display already works
`CartonContextCard` renders `SourcePlatformPills` + `ReceivingTypePills`, and
`platformLabel(pkg, type)` computes the human label (prefers `source_platform`, falls
back to `is_return`+`return_platform`). `RECEIVING_VARIANT_THEME` color-codes by type
(PO=blue, RETURN=rose, TRADE_IN=amber, PICKUP=emerald). **So once the door sets the
fields, the unbox workspace shows them with zero extra work** — `useSourcePlatform`
already broadcasts `receiving-package-updated` for live cross-surface sync.

### lookup-po does NOT persist classification on scan
Both insert paths (`upsertMatchedReceiving`, `createUnmatchedReceiving`) write only
source/tracking/timestamps. The door has no way to tag a box today.

### Unfound lifecycle (reusable in triage)
`tracking_exceptions` (open → retry via Zoho cron → `resolveReceivingExceptionsByReceivingId`),
`unfound_overlay` metadata, `v_unfound_queue` view (kinds: `email_po`,
`unmatched_receiving`, `station_exception`), `UnfoundQueueDetailsPanel` (Overview/Extract/
Email tabs + push-to-Zendesk w/ AI draft), `ReceivingClaimModal` (auto-selects `unfound`
for `receiving_source==='unmatched'`), `buildUnmatchedStubRow`, `RecentActivityRailBase`.

---

## 2. The unified classification model (core design)

Introduce **one carton-level "intake classification"** the door picks, mapped to the
existing columns by a single helper — no new column required (start additive; a
consolidated `classification` column is an optional later cleanup).

```ts
// src/lib/receiving/intake-classification.ts  (new — single source of truth)
export type IntakeClassification =
  | 'PO' | 'FBA_RETURN' | 'AMAZON_RETURN'
  | 'EBAY_RETURN_DH' | 'EBAY_RETURN_USAV' | 'EBAY_RETURN_MK'
  | 'WALMART_RETURN' | 'TRADE_IN' | 'LOCAL_PICKUP' | 'UNKNOWN';

// → the four existing columns, normalized
export function classificationToColumns(c: IntakeClassification): {
  receiving_type: 'PO'|'RETURN'|'TRADE_IN'|'PICKUP'|null;
  is_return: boolean;
  return_platform: string | null;   // RETURN_PLATFORM_LABELS keys
  source_platform: string | null;   // SOURCE_PLATFORM_OPTS values
};
// e.g. FBA_RETURN → { receiving_type:'RETURN', is_return:true, return_platform:'FBA', source_platform:'fba' }
//      PO         → { receiving_type:'PO',     is_return:false, return_platform:null,  source_platform:null }
export function columnsToClassification(pkg): IntakeClassification; // reverse, for display
```

A `INTAKE_CLASSIFICATION_OPTS` array (label + tone + icon) drives both the mobile
selector and the desktop triage pills, replacing the ad-hoc split between
`SOURCE_PLATFORM_OPTS` and `RECEIVING_TYPE_OPTS` for the door step (those stay for the
fine-grained workspace edit).

---

## 3. Initiative A — door-scan classification

### A1 · Model + API (backend)
1. New `src/lib/receiving/intake-classification.ts` (above) + a unit test (round-trip
   `classificationToColumns`↔`columnsToClassification`, like `receiving-modes.test.ts`).
2. **Extend `POST /api/receiving/lookup-po`** to accept an optional
   `classification: IntakeClassification` in the body; apply `classificationToColumns`
   and write the fields in **both** insert paths (matched + unmatched) and on the
   dedupe/promote path. One round-trip — the tag lands at scan time. Echo it back in the
   response (`classification`) alongside `unbox_verdict`.
3. **Expose `is_return` + `return_platform`** on `PATCH /api/receiving/:id` (validated
   against `RETURN_PLATFORM_LABELS`) so later correction + the desktop control work.
   Keep `source_platform` as-is. — **DONE 2026-06-28** (now WRITABLE, validated against
   the return-platform vocabulary).
4. Reconcile the enum drift in the helper (map `aliexp`→`aliexpress`, lowercase
   `intake_type`↔UPPERCASE `receiving_type`) so all four columns stay consistent.

### A2 · Mobile `/m/receive` — set-once-scan-many
- Add a sticky **"Intake as ▾"** selector at the top of `Receive.tsx` (session default,
  persisted to `localStorage`), using `GlassButton`/`DesignSystem` tokens. Default
  `UNKNOWN`.
- Each scan's `lookup()` POST includes the current `classification`. Per-scan override
  via a long-press / row action is a v2 nicety.
- Surface the tag on the feed: extend `ScanFeedItem` with `classification?` and render a
  small tone-colored chip in `ScanResultRow` (rose for returns, blue PO, amber trade-in)
  next to the verdict. This reuses the chip pattern just added for verdicts.

### A3 · Desktop Triage — classify control — **DONE 2026-06-28**
- Classify pill row added in `UnmatchedItemsSection` (triage-gated); on change,
  PATCHes the mapped columns + emits `usav-refresh-data`/`receiving-package-updated`
  (same events the workspace listens to).
- A session **batch default** mirrors mobile so desk-side door intake is equally fast.

### A4 · Unboxer auto-sees it (mostly free) — **DONE 2026-06-28**
- Read-only **"This is <classification>"** banner added to `CartonContextCard`, driven
  by `columnsToClassification` + `RECEIVING_VARIANT_THEME` color — the "know what to do"
  cue. (Caveat: `is_return`/`return_platform` not yet threaded from
  `LineCartonContextSection`/`TestingCartonHeader`, so the banner can't yet distinguish
  eBay DH/USAV/MK — see handoff.)

---

## 4. Initiative B — organize unbox + unfound patterns into Triage

### B1 · Triage rail (the deferred Phase-4 item) — **DONE 2026-06-28**
Built `src/components/sidebar/receiving/TriageRecentRail.tsx` composing
`RecentActivityRailBase` (via `ReceivingScannedRail` scope=`triage`, supplying only
renderers — selection highlight, hover preview, status dot) and surfaced it in the
triage sidebar's Prioritize tab (`TriageSidebarBody`), keeping the Found/Unfound
toggle intact. **Data choice (lower-risk, documented):** the rail is driven by the
EXISTING `view=scanned` descriptor — no new `view=triage` was added to the hot,
~2k-line `/api/receiving-lines` route, because `scanned` already returns exactly this
door feed (door-scanned, physically in, not yet unboxed). Unmatched cartons stay
excluded here so they don't double-list with the parallel Unfound tab. A dedicated
verdict/intake status dot remains a future divergence the named component now has a
seam for.

### B2 · Unfound handling inside Triage (reuse, don't rebuild) — **DONE 2026-06-29**
- **Claim row-action.** The unfound triage row's hover popover (`TriageUnfoundList`)
  now carries a **"Claim"** action (Flag icon) that opens the EXISTING
  `ReceivingClaimModal` for that carton — reused exactly, not forked. The modal
  already auto-selects `claimType='unfound'` for `receiving_source==='unmatched'`
  rows with no PO. Because the unfound rail row is a synthetic stub (negative id,
  no real `receiving_line`), the claim is filed at the **carton level** via a new
  additive, backward-compatible `lineIdOverride?: number|null` prop on
  `ReceivingClaimModal` (`null` → `entityType='RECEIVING'`, sets
  `receiving.zendesk_ticket` instead of a phantom negative line). On success the
  list re-dispatches `usav-refresh-data`.
- **Lower-risk shape (Open-decision #4):** a per-row affordance + the existing
  modal, NOT a parallel embedded queue. The popover slots are ADDITIVE optional
  props on the shared `RecentActivityRailBase` (`renderPopoverContext` /
  `renderPopoverActions`) so every other rail renders exactly as before.
- "Open in Unbox" already exists; a dedicated "Find it" affordance is still a
  future nicety (not shipped here).

### B3 · Read-only `tracking_exceptions` state in Triage — **DONE 2026-06-29**
- The unfound popover shows a **read-only Zoho-sync status dot + `HoverTooltip`**
  (house dot+tooltip pattern, semantic shade dots): amber = "Zoho still hasn't
  synced this PO" (waiting), rose = sync erroring; the tooltip carries retry
  count, last-check age, reason, and any `last_error`.
- **No new server view.** The state is pulled additively from the EXISTING
  `GET /api/tracking-exceptions?domain=receiving&status=open` feed and indexed by
  `receiving_id` client-side. The tone/label mapping is the single source of
  truth in `src/lib/receiving/triage-exception-context.ts` (DB-free, 7 unit
  tests). Fetch failure degrades to no-dot (secondary context).
- **Decided (Open-decision #4):** kept triage **carton-only** — did NOT embed the
  `unmatched_receiving` queue subset; the `email_po` split stays in Admin › PO
  Mailbox.

### B4 · Scan-auto-select into triage pane — **DONE 2026-06-28**
When a scan resolves in triage mode the just-scanned carton now drops straight into the
triage detail pane. The triage `onSubmit` in `ReceivingSidebarPanel` threads an
`onResult` callback into `submitTrackingScan` that re-dispatches the existing
`receiving-select-line` event for the resolved carton (picking its first OPEN line, so it
stays consistent with the scan's own pick; falls back to the unmatched stub so it never
clears the selection). Scoped to the triage onSubmit only — the unbox path keeps relying
on `submitTrackingScan`'s internal select. (The shared scan helper already selected in
all modes; this adds an explicit, stale-guard-independent guarantee for triage, mirroring
the deep-link select pattern in `useReceivingWorkspacePane`.)

---

## 5. Files to touch (summary)

| Init | File | Change |
|---|---|---|
| A1 | `src/lib/receiving/intake-classification.ts` (+test) | **new** model + mapping |
| A1 | `api/receiving/lookup-po/route.ts` | accept + persist `classification` (3 insert paths) |
| A1 | `api/receiving/[id]/route.ts` | expose `is_return` + `return_platform` on PATCH |
| A2 | `mobile/redesign/Receive.tsx` | sticky "Intake as" selector; send classification |
| A2 | `mobile/feed/rows/ScanResultRow.tsx` | classification chip |
| A3 | `receiving/triage/TriageDetailsPanel.tsx` | classify pill row + PATCH |
| A4 | `receiving/workspace/line-edit/CartonContextCard.tsx` | "This is: …" banner |
| B1 | ~~`api/receiving-lines/route.ts` `view=triage`~~ | **DONE** — skipped (lower-risk): drove the rail off the existing `view=scanned`; no route change |
| B1 | `sidebar/receiving/TriageRecentRail.tsx` | **DONE** — new rail (composes `RecentActivityRailBase` via `ReceivingScannedRail`) |
| B1 | `sidebar/receiving/TriageSidebarBody.tsx` | **DONE** — Prioritize tab now uses `TriageRecentRail` |
| B2 | `sidebar/receiving/TriageUnfoundList.tsx` | **DONE** — "Claim" row-action opens `ReceivingClaimModal` (carton-level `lineIdOverride={null}`) |
| B2 | `sidebar/receiving/RecentActivityRailBase.tsx` | **DONE** — additive optional popover slots (`renderPopoverContext`/`renderPopoverActions`); all other rails unchanged |
| B2 | `receiving/workspace/claim/hooks/useReceivingClaimController.ts` | **DONE** — additive `lineIdOverride?: number\|null` (default = `row.id`) for carton-level claims |
| B3 | `lib/receiving/triage-exception-context.ts` (+test) | **DONE** — new DB-free SoT: index open receiving exceptions by `receiving_id` + dot tone/tooltip (7 tests) |
| B3 | `sidebar/receiving/TriageUnfoundList.tsx` | **DONE** — reads existing `/api/tracking-exceptions` feed, renders read-only dot + tooltip in popover |
| B4 | `sidebar/ReceivingSidebarPanel.tsx` | **DONE** — triage `onSubmit` `onResult` → `receiving-select-line` |

---

## 6. Open decisions
1. **Persist classification inline in lookup-po (recommended)** vs follow-up PATCH from
   mobile. Inline = one round-trip, tag guaranteed at door; recommended.
2. **No new column (map to the 4 existing fields) [recommended]** vs add a single
   `receiving.classification` column (cleaner long-term, needs a migration + backfill).
3. **Batch-default behavior:** sticky per-session default that auto-applies to every scan
   (recommended for pallet intake) vs require an explicit pick per scan.
4. **How much unfound to pull into Triage (B3):** carton-only triage + link to Admin
   queue [recommended, smaller], vs embed the `unmatched_receiving` queue subset.
   **DECIDED 2026-06-29 → carton-only** (the smaller option): B2/B3 ship as a per-row
   claim action + read-only exception dot on the existing unfound rail; no embedded
   queue rewrite.

## 7. Risks
- **Enum fragmentation** (`aliexp`/`aliexpress`, case mismatch, FBA-only-via-return) — the
  helper must be the *single* mapping and be unit-tested, or carton vs line classification
  will disagree and `platformLabel` will mislabel.
- **lookup-po is the hot path + audited** (`receiving.scan_po`) — adding a body field must
  stay backward-compatible (absent `classification` = today's behavior).
- **Batch default footgun:** a stale sticky default silently mis-tags a pallet. Mitigate
  with a always-visible current-type banner + an easy reset, and never default to a
  return type (default `UNKNOWN`).
- **Triage rail scope (B1):** `view=triage` must exclude already-unboxed cartons or it
  doubles History; mirror the careful `receiving-views.ts` view definitions.

---

## Session 2026-06-29 — Initiative B pass (B2 + B3) — Initiative B COMPLETE
- **B2 (claim row-action):** `TriageUnfoundList` now renders a **"Claim"** action in
  the unfound row's hover popover that opens the EXISTING `ReceivingClaimModal`
  (reused, not forked) for that carton. The modal auto-selects `claimType='unfound'`
  for unmatched/no-PO rows. Because the rail row is a synthetic stub with no real
  `receiving_line`, the claim is filed **carton-level** via a new additive,
  backward-compatible `lineIdOverride?: number|null` prop on the claim modal
  (`null` → `entityType='RECEIVING'`; default `undefined` = today's `row.id`). The
  popover affordance is wired through two ADDITIVE optional slots on the shared
  `RecentActivityRailBase` (`renderPopoverContext` / `renderPopoverActions`) — every
  other rail (Recent/Scanned/Viewed/Testing/Triage) renders byte-for-byte as before.
- **B3 (read-only exception context):** the unfound popover shows a Zoho-sync status
  **dot + `HoverTooltip`** (house pattern): amber = waiting on Zoho, rose = sync
  erroring; tooltip = retry count · last-check age · reason · last_error. State comes
  from the EXISTING `GET /api/tracking-exceptions?domain=receiving&status=open` feed
  (no new server view), indexed by `receiving_id` client-side. The tone/label
  mapping is a new DB-free SoT — `src/lib/receiving/triage-exception-context.ts`
  (`indexReceivingExceptions` + `exceptionDotClass`/`exceptionTooltipLabel`) — with
  7 `node:test` unit tests (all pass). Fetch failure degrades to no-dot.
- **Lower-risk choice (Open-decision #4 → carton-only):** no embedded
  `unmatched_receiving` queue; a per-row action + read-only dot on the live Unfound
  rail. Additive throughout — the Found/Unfound triage is not regressed.
- **No migration.** B2/B3 reuse existing columns/routes; the only schema-coupled
  residual is the unrelated Initiative-A `LOCAL_PICKUP` `intake_type` gap.
- tsc clean on all touched files (the lone repo `tsc` errors are pre-existing in
  `src/components/shipped/*` and `useReceivingLineCore.ts`, both out of scope).

## Session 2026-06-28 — Initiative B pass (B1 + B4)
- **B1 (triage rail):** added `src/components/sidebar/receiving/TriageRecentRail.tsx`
  composing `RecentActivityRailBase` (via `ReceivingScannedRail` scope=`triage` — the
  sanctioned compose-don't-fork pattern) and pointed the triage sidebar's Prioritize
  tab (`TriageSidebarBody`) at it. The Found/Unfound toggle is untouched (additive, no
  regression). **No `view=triage` server view was added** — the existing `view=scanned`
  already returns the triage door feed, so adding a near-duplicate branch to the hot
  ~2k-line `/api/receiving-lines` route was the higher-risk path and was deliberately
  avoided (the route's escape-hatch: drive the rail client-side off an existing view).
- **B4 (scan-auto-select):** the triage `onSubmit` in `ReceivingSidebarPanel` now threads
  an `onResult` into `submitTrackingScan` that re-dispatches `receiving-select-line` for
  the resolved carton (first open line, with an unmatched-stub fallback that never clears
  the selection). Scoped to triage; the unbox path is unchanged. This makes triage
  select-on-resolve explicit and independent of the scan-generation stale-guard.
- tsc clean on all touched files (the only `tsc` errors are pre-existing in
  `src/components/shipped/*`, out of scope).
- **Note:** the repo had already evolved past the plan — `view=scanned` +
  `ReceivingScannedRail` and the shared `submitTrackingScan` selection already delivered
  most of B1/B4's substance; this pass formalizes the named component + the explicit
  triage select wiring without regressing the live Found/Unfound triage.

## Session 2026-06-28 — completion pass
- **A1-step3:** `is_return` + `return_platform` are now WRITABLE on
  `PATCH /api/receiving/[id]`, validated against the return-platform vocabulary. No
  migration — maps onto existing receiving columns (Open-decision #2).
- **A3:** desktop triage classify pill row added in `UnmatchedItemsSection`
  (triage-gated); PATCHes the mapped columns + emits
  `usav-refresh-data`/`receiving-package-updated`.
- **A4:** read-only "This is <classification>" banner in `CartonContextCard` via
  `columnsToClassification` + `RECEIVING_VARIANT_THEME`.
- These flip A1-step3 / A3 / A4 to done; **Initiative A is complete** (the scan-time core
  — `intake-classification.ts`, lookup-po persistence, mobile "Receiving as" selector —
  was already done pre-session).

## Remaining work — handoff (2026-06-28)
- ✅ **[DONE]** Initiative B1 — `TriageRecentRail` (composes `RecentActivityRailBase`),
  surfaced in the triage Prioritize tab, driven by the existing `view=scanned` (no
  `view=triage` server view added — lower-risk).
- ✅ **[DONE]** Initiative B4 — scan-auto-select into the triage pane (triage `onSubmit`
  `onResult` → `receiving-select-line`).
- ✅ **[DONE 2026-06-29]** Initiative B2 — "Claim" row-action on unfound triage rows
  opens `ReceivingClaimModal` (carton-level via `lineIdOverride={null}`), wired through
  additive popover slots on `RecentActivityRailBase`.
- ✅ **[DONE 2026-06-29]** Initiative B3 — read-only `tracking_exceptions` dot + tooltip
  in the unfound popover, from the existing tracking-exceptions feed; SoT +
  unit tests in `src/lib/receiving/triage-exception-context.ts`. **Initiative B is
  complete.**
- **[CODE]** Thread `is_return`/`return_platform` from `LineCartonContextSection`/
  `TestingCartonHeader` so the A4 banner can distinguish eBay DH/USAV/MK (minor).
- **[MIGRATION-DEPLOY-COUPLED]** `LOCAL_PICKUP` intake_type round-trip needs a schema
  change — the carton `intake_type` enum excludes `PICKUP`.
- **[FUTURE NICETY]** A dedicated "Find it" affordance on unfound rows (highlight
  location/notes) was scoped out of B2; "Open in Unbox" already covers the jump.
