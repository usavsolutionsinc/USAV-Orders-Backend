# Receiving — door-scan classification + organizing unbox/unfound patterns into Triage

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
> **Still pending:** desktop Triage classify currently sets `source_platform` only (no
> is_return/return_platform) — wire the unified `INTAKE_CLASSIFICATION_OPTS` selector
> into `TriageDetailsPanel`/`UnmatchedIdentify` for full return-type parity with mobile;
> mobile unfound add-info (mobile has the Found/Unfound filter); notes/photo in triage;
> auto-resolve uses the existing tracking-exception cron (already wired).
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
| `is_return` / `return_platform` | `receiving` (carton) | `AMZ,EBAY_DRAGONH,EBAY_USAV,EBAY_MK,FBA,WALMART,ECWID` | **no API today** — exist in table, never PATCHable |
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
   Keep `source_platform` as-is.
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

### A3 · Desktop Triage — classify control
- In `TriageDetailsPanel`, add an `IntakeClassification` pill row (reuse
  `INTAKE_CLASSIFICATION_OPTS`); on change, `PATCH /api/receiving/:id` with the mapped
  columns + emit `receiving-package-updated` (same event the workspace listens to).
- A session **batch default** mirrors mobile so desk-side door intake is equally fast.

### A4 · Unboxer auto-sees it (mostly free)
- `CartonContextCard` already shows platform/type. Add a single prominent **"This is: FBA
  Return"** banner at the top of the unbox workspace driven by `columnsToClassification`
  + `RECEIVING_VARIANT_THEME` color — the "know what to do" cue. ~1 component, no new data.

---

## 4. Initiative B — organize unbox + unfound patterns into Triage

### B1 · Triage rail (the deferred Phase-4 item)
Add a `view=triage` to `/api/receiving-lines` + a `receiving-modes.ts`-style descriptor:
the **door feed** = cartons scanned-in (received) incl. `receiving_source='unmatched'`,
NOT yet unboxed — the opposite scoping from the unbox rail's `view=activity`. Build
`TriageRecentRail` on `RecentActivityRailBase` with a verdict/intake status dot
(rose=expedited, amber=unfound, type-tone otherwise). Swap the triage sidebar from the
reused unbox rail to this one.

### B2 · Unfound handling inside Triage (reuse, don't rebuild)
- Wire `ReceivingClaimModal` into the triage panel for `unfound` rows (it already
  auto-selects `claimType='unfound'`) → one-tap Zendesk claim from triage.
- Show the `tracking_exceptions` state on an unfound carton (retry count,
  `last_zoho_check_at`) so staff see "Zoho still hasn't synced this PO."
- "Open in Unbox" already exists; add "Find it" affordance (highlight location/notes).

### B3 · Surface the door-relevant unfound queue in Triage (optional)
Reuse `UnfoundQueueDetailsPanel`'s tab/action patterns to show the
`unmatched_receiving` subset of `v_unfound_queue` as a triage sub-list (leave `email_po`
in Admin › PO Mailbox per the existing split). Or keep triage carton-only and link out.
**Decision below.**

### B4 · Scan-auto-select into triage pane
The deferred item: when a scan resolves in triage mode, dispatch `receiving-select-line`
so the just-scanned carton drops straight into `TriageDetailsPanel` (today the rail
refreshes and the user taps). Have `submitTrackingScan` branch on `mode==='triage'`.

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
| B1 | `lib/receiving/receiving-modes.ts` + `api/receiving-lines/route.ts` | `view=triage` |
| B1 | `sidebar/receiving/TriageRecentRail.tsx` | **new** rail |
| B1 | `sidebar/ReceivingSidebarPanel.tsx` | use triage rail in triage mode |
| B2 | `receiving/triage/TriageDetailsPanel.tsx` | claim modal + exception state |
| B4 | `sidebar/ReceivingSidebarPanel.tsx` | scan-auto-select in triage |

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
