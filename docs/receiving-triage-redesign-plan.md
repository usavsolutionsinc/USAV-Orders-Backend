# Receiving Triage — Redesign Plan (v4 — grounded + interviewed)

**Status:** PLAN (2026-07-01). **Supersedes** the open items in `receiving-triage-mode-plan.md`,
`receiving-priority-triage-plan.md`, and `receiving-triage-streamline-plan.md` for UX/data-model/street decisions.
v2 (earlier the same day) locked stakeholder decisions from a design conversation without re-checking them
against the live codebase; a v3 grounding pass re-read the codebase line-by-line against every v2 claim and found
the codebase had moved **substantially further** than v2 assumed — several "planned" items were already shipped,
one locked decision (**B4**) directly **contradicted** a deliberately-built, currently-used feature, and 2 of 5
original open questions were already answered by existing infrastructure. This v4 pass **interviewed the owner
on the resulting conflicts** and folds the answers back in as locked decisions (§0.6). **Read §0.5 (what's
already shipped) then §0.6 (what was just decided) before anything else in this doc.**

**Companion docs:**
- `docs/todo/polymorphic-tables-database-refactor-plan.md` — the **in-flight** "streets" refactor (Phase 1
  shipped + verified 2026-06-29; Phase 2 backfill/dual-write shipped; writer-cutover attempted + reverted). Models
  Triage as a **code lane**, not a schema object — see §0.5 and §2.4.
- `src/lib/receiving/intake-classification.ts` — intake-kind SoT (PO vs return vs …)
- `src/lib/receiving/workflow-stages.ts` — fine-grained `workflow_status` lifecycle + coarse projection
- `src/lib/receiving/facts/registry.ts` — `receiving_line_facts(fact_kind, payload)` pattern (line-grain)
- `src/lib/receiving/display/precedence.ts` — priority-rank rules-as-data SoT (supersedes the old
  `scan-priority.ts` name used in earlier plan docs/memory)

---

## 0. Executive summary

Triage and unbox are **different stations** with different jobs, photos, required fields, and durable state.
Today they share **one progress stepper** (confirmed live, see §0.5) and, until recently, shared one mega-form —
that second half is **already fixed**: `TriagePanel` is a de-blended, standalone right-pane component, not
`LineEditPanel` wearing a `variant='triage'` mask. What's left un-split is the **stepper**, the **physical
staging model** (shelf + lane don't exist at all yet), the **terminal "save" action** (still a no-op toast), and
one **direct conflict** between a locked decision and a shipped feature (manual PO search — see §0.5).

**Target:** industry-standard **dock check-in (triage) ≠ deconsolidation (unbox)** at three layers:

| Layer | Triage owns | Unbox owns |
|-------|-------------|------------|
| **UI** | Classify → identify → stage (shelf + lane) → save for unbox | Photos → condition → serial → print/receive |
| **Data** | Intake identity, staging, pairing attempts, `triage_complete` | Unit capture, condition, serials, unbox photos |
| **Queue** | Triage / Prioritize / Unfound / **Done** tabs (3 of 4 already exist) | Unbox rail (may include unstaged cartons) |

**Polymorphic DB:** the in-flight streets refactor (`polymorphic-tables-database-refactor-plan.md`) doesn't
mention a triage-specific table at all — it treats triage as pure business logic over the shared spine. **DECIDED
(§0.6, D2):** the new staging/pairing fields land as **flat columns on `receiving`**, consistent with how
`priority_tier` / `is_priority` / `intake_type` / `exception_code` already live there today, rather than as a new
1:1 side-table — see §2.2.

---

## 0.5 Grounding corrections — read this before the rest of the doc

A full-repo re-scan (2026-07-01) against every claim in v2 found the following. Each row says what v2 assumed,
what's actually true today, and what that changes.

| # | v2 assumed | **Actually true today** | Impact |
|---|---|---|---|
| G1 | Triage reuses "a shared unbox stepper" that needs replacing (implied it might already be gone) | `ReceivingProgressStepper` (Scan→Photos→Condition→Serial→Print) **unconditionally renders for both variants** — `ReceivingLineWorkspace.tsx:117-126` shows it identically whether `variant='unbox'` or `variant='triage'`. It is genuinely still one blended stepper today. | **Confirms** §3.2's `TriageProgressStepper` is real, needed work — not already done. |
| G2 | Triage shares a mega-form via `workspace-capabilities.ts` + `variant='triage'` masking | **That file no longer exists.** `TriagePanel.tsx` is already a fully de-blended, standalone component (own docstring: *"Triage used to ride on LineEditPanel via a variant='triage' prop... That blended two display archetypes... This panel is the de-blended triage surface"*). `ReceivingLineWorkspace.tsx:128-139` is now a plain `variant === 'triage' ? <TriagePanel/> : <LineEditPanel/>` — two whole components, not one masked one. | §3.3's "template split" is **half-done**: the unbox/triage split already happened; only the **intake-kind split** (PO vs Return templates) inside `TriagePanel` remains. |
| G3 | §3.1 tabs are "Triage (combined)/Prioritize/Unfound... unchanged", propose adding **Done** | Confirmed exactly as described — `TriageSidebarBody.tsx` today has `?triview= 'triage' \| 'found' \| 'unfound'`, and the combined **Triage** tab already implements "carton never disappears" (E10) via `buildTriageCombinedFetcher` (`rail/feeds.ts:212-253`): it unions the Prioritize + Unfound queries, dedups by `receiving_id`, prefers matched-over-unmatched, and keeps a stable `client_event_id` so React Query never flickers the row on re-sort. **No `done`/`triage_complete` value or column exists anywhere.** | §3.1's "Done" tab really is 100% new work; everything else in that section is accurately described as already built. |
| G4 | §3.6 "Auto-suggest pairing" + §3.9 "Priority & stock-outs" are proposed as new build | **Both are substantially shipped already.** Zendesk ticket candidates + delivered-email corroboration (`useTriagePanel.ts`, real signals, no fabricated score, exactly per the plan's own "no confidence score" rule) are live inside `TriagePanel`'s pairing hub. Manual priority pill = `receiving.priority_tier` (SMALLINT 0-3, migration `2026-06-09_receiving_priority_tier.sql`, already live) and pending-order auto-flag = `receiving.is_priority` (`markReceivingPriority()` in `lookup-po/route.ts:88-103`) — **F12 is done, not "today/soon."** | Reframe §3.6/§3.9 as "extend the existing pairing hub to PO-matching with the same real-signals rule" rather than "build auto-suggest from scratch." |
| G5 | §2.2 proposes `receiving.priority_tier` be added on a new `receiving_triage` table | `receiving.priority_tier` **already exists directly on `receiving`**, shipped 2026-06-09, wired through `src/lib/receiving/display/precedence.ts` (the renamed/relocated `scan-priority.ts`). | Drop `priority_tier` from any new triage table proposal — it's already a flat spine column and should stay one. |
| G6 | §3.6/§4 imply a **new** manual-PO-search UX doesn't exist yet ("no manual PO search" is achievable by just not building one) | **A manual "Zoho PO" search tab exists today and is actively used.** `LineMatchingSection.tsx` (rendered by `POUnboxingSection` inside **both** `TriagePanel` and unbox's `LineEditPanel`) has 4 tabs — Ecwid, **Zoho PO**, Tickets, Email PO. The Zoho-PO tab is `PoLinkTab.tsx`, backed by `GET /api/receiving/po-search?q=`, whose own docstring says: *"Makes the WEBSITE the source of truth for the carton↔PO link... an operator who knows the right PO can correct a mis-linked carton here instead of editing Zoho and waiting for a sync."* This is a **deliberate, shipped correction mechanism**, not stray dead code. | **Direct conflict with locked decision B4** ("No manual PO# search UX... System attempts pair; carton stays unfound until matched"). This cannot be silently resolved by the plan — see §7 Q6, first interview question. |
| G7 | §4.1 "Shelf (required)... FK to `locations` (or dedicated `staging_shelves` catalog)" — framed as an open question (Q1) | **`locations` already has full shelf/bin addressing**: `row_label`, `col_label`, `bin_type` (SHELF/FLOOR/WALL/PALLET/DRAWER), `capacity`, `parent_id` (zone parent), auto-barcode pattern `Z{zone}-{ROW}-{COL}`, already seeded with real zones/shelves (`2026-04-09_create_locations.sql` + `..._upgrade_locations_bin_addressing.sql`). `handling_units` and `serial_units` already reference locations the same way (`location_id`/`current_location`). | **Q1 is answered**: reuse `locations`, do not build `staging_shelves`. See §4.1 (rewritten). |
| G8 | §2.2 proposes a new `photos.capture_phase` column, nullable, backfilled | **`photos.photo_type`** (a free-text tag) already survives the photos Phase-E refactor and already has an **org-scoped extensible registry**, `photo_image_types` (migration `2026-06-25_photo_image_types.sql`), used to add a brand-new type (`'listing'`) with **zero new migration** (`2026-06-26b_photo_listing_type.sql` just seeds a registry row). | Don't add a `capture_phase` column — add `capture_phase` (or reuse `photo_type` directly, e.g. `'triage_arrival'` vs `'unbox_condition'`) as a **registry row**, mirroring how `'listing'` was added. Zero migration. |
| G9 | §3.9 proposes `priority_lane` as a new hardcoded CHECK-constrained enum column | The **reason_codes / `flow_context` Class-D engine already exists and is the established pattern** for exactly this shape of vocabulary (`serial_absent_reason`, `substitution`, `short_pick`, `repair_failure`, `receiving_exception`, …) — org-extensible, DB-owned code/label, `applies_to` scoping, one `ALTER TABLE reason_codes DROP/ADD CONSTRAINT reason_codes_flow_context_chk` to add a new context. | Prefer `flow_context = 'priority_lane'` (and/or `'pairing_outcome'`) over a hardcoded CHECK enum — see §7 Q8. |
| G10 | (not addressed in v2) | The bigger `polymorphic-tables-database-refactor-plan.md` refactor is **actively in flight**, not just planned — Phase 1 (facts tables + registry + kinds registry + precedence SoT) is live in prod at 0-drift parity; Phase 2 writer-cutover was **attempted and reverted** 2026-06-29 (concrete blockers documented there). It does **not** mention a `receiving_triage` table anywhere. | Any new triage schema work should either (a) wait/ride along with that refactor's Layer-2(a) convention, or (b) explicitly go the "flat column on the current spine" route as a deliberately temporary, pre-refactor shape. See §7 Q7. |

---

## 0.6 Owner decisions from the v4 interview (locked 2026-07-01)

Four conflicts/open questions from §0.5/§7 were put to the owner directly. These **override** the corresponding
v2 language wherever they conflict; the rest of v2's decisions (§1) stand.

| # | Question | Decision | What changes |
|---|----------|----------|--------------|
| **D1** | Manual PO-search conflict (B4 vs shipped `PoLinkTab`) | **Keep `PoLinkTab` as-is** (the Zoho-PO-search-to-relink tab inside the pairing hub is NOT removed). **Additionally add a carton-list search/filter bar at the bottom of the Triage sidebar**, mirroring the tech sidebar's search affordance, so operators can quickly find a carton already in the Triage/Prioritize/Unfound list. | **B4's "no manual PO# search UX" is overridden** — softened to "auto-suggest is the default/primary path; the manual Zoho-PO search stays available as a correction tool." §3.6/§7 Q6 resolved: keep + extend, don't gate or remove. New, distinct piece of work: a sidebar list-filter search (finding a carton already scanned in — not searching Zoho) — see the implementation note below on today's existing partial version of this. |
| **D2** | Schema shape for staging fields (§2.2 Option A vs B) | **Option A — flat columns on `receiving`, built now.** Do not wait for the bigger streets refactor. | §2.2/§7 Q7 resolved in favor of Option A. §7 Q11 (sequencing) resolved as "proceed now" — accept the columns may need to move again if/when `receiving`→`receiving_carton` lands. |
| **D3** | `priority_lane` vocabulary/routing mechanism (§7 Q8) | **Model lane auto-routing as a Studio-editable decision rule** — the same `DecisionRule[]` pattern as `src/lib/receiving/putaway-placement.ts` (`receivingDefaultPutawayPolicy`), pluggable into a `/studio` decision node so an org owner can visually edit "which lane does this carton route to" without a code change. | Neither a bare hardcoded CHECK enum nor a `reason_codes.flow_context` vocabulary alone — the **routing decision** lives in Studio (rules-as-data, `src/lib/workflow/decision-eval.ts`'s `DecisionRule` shape); the **lane values themselves** still need a small stable list (see the open sub-question below). |
| **D4** | Done-tab visibility (§7 Q10) | **Badge only, never hide** — matches the existing matched/unfound badge behavior on the combined Triage tab. | §3.1/§9 confirmed as designed; no change needed to the plan's existing recommendation. |

**Implementation note on D1 (sidebar search) — this is a smaller lift than it sounds.** `ReceivingSidebarPanel.tsx`
**already renders a search input for `mode === 'triage'`** (not a scan bar) — `triageQuery` local state
(`:144`), rendered at `:261-270`, filtering both the Prioritize and Unfound lists client-side via `filterText`
(this is the mechanism `TriageCombinedList`/`TriageRecentRail`/`TriageUnfoundList` already accept as a
`filterText` prop, per §3.1). **What's missing is not the search mechanism itself — it's the position/prominence**
(the owner asked for it "like the tech sidebar," i.e. a bottom-anchored affordance) and possibly URL-backing (today
`triageQuery` is local component state, not a `?q=` param, so it doesn't survive a refresh/deep-link — worth
fixing while touching this). Confirm the exact desired position/component during Phase 1 build (this is a UI
polish decision, not an architecture one) rather than re-interviewing over it.

**Open sub-question under D3:** the lane *values* (`PO_STOCKOUT`/`PO_STANDARD`/`RETURN`/`HOLD`) still need a
label source even once routing is a Studio decision node — either a small fixed TS list (like
`RECEIVING_EXCEPTION_CODES`) or a `reason_codes.flow_context='priority_lane'` vocabulary (org-extensible). This
wasn't part of D3 as asked; default to the small fixed list for v1 (matches `RECEIVING_EXCEPTION_CODES`'s
precedent) and revisit only if a tenant asks for a custom lane.

---

## 1. Stakeholder decisions (locked 2026-07-01) — with build status

### A — Location & sorting

| # | Decision | Status |
|---|----------|--------|
| A1 | **Both** physical shelf (starting requirement) **and** priority lane (stock-outs, PO vs return organization). | **OPEN** — no shelf/lane assignment exists on `receiving` at all. `locations` catalog exists and is reusable (G7). |
| A2 | **Door scanner** sets shelf + lane at triage. | **OPEN** — no UI/API for this yet. |
| A3 | Shelf + lane visible on **triage rail rows** and in the **triage right pane** (door scanner is primary audience). | **OPEN**, blocked on A1. |

### B — PO identification & unfound

| # | Decision | Status |
|---|----------|--------|
| B4 | ~~**No manual PO# search UX.**~~ **REVISED (D1, 2026-07-01):** manual PO search stays; auto-suggest is the default/primary path, the manual Zoho-PO search (`PoLinkTab`) remains available as a correction tool. **Unfound = persistent todo list** for PO pairing (unchanged). System attempts pair; carton stays unfound until matched. Unfound persists across door scan, triage, unbox, and post-unbox until resolved. | **BUILT** (persistent-todo half, `v_unfound_queue` + `checked`/`checked_at`) **+ DECIDED to keep** (manual-search half, D1 overrides the original "no manual search" wording — see §0.6). |
| B5 | **Save for unbox is allowed** while PO is still unfound. | Implicitly true today (nothing blocks it) but there's no real "Save for unbox" transition to gate in the first place (G3/§3.5) — moot until §3.5 ships. |

### C — Returns

| # | Decision | Status |
|---|----------|--------|
| C6 | Returns are treated as **unfound** until a hint exists on the label. **No minimum identity state** when the label has no order/claim hint. | **OPEN** for the triage-side minimum-identity rule specifically, but note a **separate, already-shipped** return-linking path exists at the **unbox serial-scan** step (`returned-serial-unbox-autolink`, `linkReturnedSerial`) that auto-links a scanned serial to its prior SHIPPED order — this is a different mechanism at a different station and should not be duplicated; see §5. |
| C7 | Returns **almost always** arrive without a pre-paired customer claim. | Unchanged; matches the real Zendesk-candidate flow already in `useTriagePanel`. |

### D — Photos

| # | Decision | Status |
|---|----------|--------|
| D8 | Intake photos **not required** for save for unbox. | Not yet enforced (no gate exists at all — moot until §3.5 ships), but trivially satisfiable. |
| D9 | **Unbox mode** owns photo capture (all product/box photos happen there, not at triage). | True today by omission (triage has no photo capture UI) — formalize via `photo_type`/`photo_image_types`, not a new column (G8). |

### E — Save & queues

| # | Decision | Status |
|---|----------|--------|
| E10 | After save, carton **stays in triage universe** (does not disappear). Add a **Done** sub-view tab for staged cartons. | **The "stays in universe" half is already built** (combined Triage tab, G3). **The Done tab and the underlying `triage_complete` flag are pure new work.** |
| E11 | Unboxers **may unbox unstaged** cartons (staging is organizational, not a hard gate). | Trivially true today (no staging exists to gate on yet). |

### F — Priority

| # | Decision | Status |
|---|----------|--------|
| F12 | **Manual priority pill** + **pending-order match** (rank-0) today; automation later. | **DONE, not "today/soon" — fully shipped** (`receiving.priority_tier`, `receiving.is_priority`, `precedence.ts`). See G4/G5. |

### G — Scope

| # | Decision | Status |
|---|----------|--------|
| G13 | Trade-in / local pickup **out of scope** for this redesign. | Unchanged. |
| G14 | **Scan first**, classify second (do not block scan on classification picker). | Already true — `lookup-po` creates the carton before any classification write; `applyIntakeClassification` is optional/best-effort at scan time. |

### Tabs (unchanged, corrected component names)

- Keep **Triage** (combined, default) / **Prioritize** (`?triview=found`) / **Unfound** (`?triview=unfound`) —
  already implemented as `TriageCombinedList` / `TriageRecentRail` / `TriageUnfoundList`, all thin wrappers over
  `ReceivingFeedRail` + named feed descriptors in `src/lib/receiving/rail/feeds.ts`. **Not** the `ReceivingScannedRail`
  / `TriageDetailsPanel` names used in earlier plan docs — those were renamed/replaced along the way.
- **Add** `done` as a fourth `?triview=` value: cartons with `triage_complete = true`.

---

## 2. Industry model — why polymorphic separation is correct (revised)

### 2.1 Two stations, two fact bundles (unchanged from v2)

```
INTAKE (triage)                         UNBOX (deconsolidation)
────────────────                        ───────────────────────
Who is this carton?                     What is inside?
PO vs return vs unknown                 Condition, qty, serials
Staging shelf + priority lane           Product photos
Pairing attempts / unfound todo         Receive into stock
Mark triage_complete                    workflow_status → UNBOXED → …
```

### 2.2 Data shape — DECIDED: flat columns on `receiving` (D2, §0.6)

v2 proposed a single new `receiving_triage` side-table without weighing it against the codebase's actual current
convention. Two shapes were genuinely defensible; **the owner decided Option A (D2, §0.6) — flat columns on
`receiving`, built now, without waiting for the bigger streets refactor.** Option B is kept below only as the
rejected alternative, for context if the bigger refactor later revisits this.

**Option A — flat columns on `receiving` (DECIDED).** `priority_tier`, `is_priority`, `intake_type`,
`source_platform`, `exception_code` **already live directly on the carton row**, not in side tables. Adding
`staging_location_id`, `priority_lane`, `pairing_state`, `triage_complete(_at/_by)` the same way is the
lowest-friction, most-consistent-with-today choice:

```sql
ALTER TABLE receiving
  ADD COLUMN staging_location_id  INTEGER REFERENCES locations(id),  -- reuses the existing shelf/bin catalog (G7)
  ADD COLUMN priority_lane        TEXT,                              -- small fixed list v1; routing is a Studio decision node (D3)
  ADD COLUMN pairing_state        TEXT NOT NULL DEFAULT 'UNFOUND',   -- UNFOUND | MATCHED | WAIVED
  ADD COLUMN last_pair_attempt_at TIMESTAMPTZ,
  ADD COLUMN triage_complete      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN triage_completed_at  TIMESTAMPTZ,
  ADD COLUMN triage_completed_by  INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN triage_client_event_id TEXT UNIQUE;                     -- idempotent save-for-unbox
```

Accepted cost: this is exactly the "monolith" pattern `polymorphic-tables-database-refactor-plan.md` is trying to
shrink (`receiving` is already targeted to drop to ≤14 columns); adding 7 more columns to the very table that
refactor wants thin works against it directly. **The owner accepted this cost explicitly (D2)** — these columns
may need to migrate again into whatever shape `receiving`→`receiving_carton` eventually takes; that's a
follow-up migration for that future project, not a blocker for shipping this one now.

**Option B (REJECTED, D2) — a new 1:1 side-table** (would have been consistent with the in-flight streets
refactor's Layer-2(a) convention). Kept here only for context:
Mirrors `receiving_line_zoho` / `receiving_line_testing` / `receiving_line_return` / `receiving_line_putaway` —
except those are all **line-grain**; staging/pairing here is **carton-grain** (matches `useTriagePanel`'s own
"Matching is grain-ed to the CARTON, not the line" comment), so this would need to be a new carton-grain table,
which the streets refactor doesn't have a template for yet (its Layer 1 spine is `receiving_carton`, not built):

```sql
CREATE TABLE receiving_triage (
  receiving_id           BIGINT PRIMARY KEY REFERENCES receiving(id) ON DELETE CASCADE,
  organization_id        UUID NOT NULL,                     -- tenant-from-birth; enforce_tenant_isolation()
  staging_location_id    INTEGER REFERENCES locations(id),
  priority_lane          TEXT,
  pairing_state          TEXT NOT NULL DEFAULT 'UNFOUND',    -- UNFOUND | MATCHED | WAIVED
  last_pair_attempt_at   TIMESTAMPTZ,
  triage_complete        BOOLEAN NOT NULL DEFAULT FALSE,
  triage_completed_at    TIMESTAMPTZ,
  triage_completed_by    INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  client_event_id        TEXT UNIQUE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Benefit: keeps `receiving` from growing further, is a clean row to `DROP`/migrate later if/when the bigger
`receiving`→`receiving_carton` rename happens, and follows the `.claude/rules/backend-patterns.md` +
`db-migration-author` skill conventions (tenant-from-birth, org-scoped).

**Pairing-attempt history** (either option): use the **existing** `receiving_line_facts` registry
(`src/lib/receiving/facts/registry.ts`) with a **new registered kind** — zero migration, per the registry's own
passthrough design:

```ts
// src/lib/receiving/facts/registry.ts
export const FACT_KINDS = [..., 'triage_pairing_attempt'] as const;
export const triagePairingAttemptSchema = z.object({
  strategy: z.enum(['zendesk_ticket', 'zoho_po', 'ecwid_order', 'manual_waive']),
  candidateId: z.string().optional(),
  outcome: z.enum(['matched', 'no_match', 'waived']),
  at: z.string(), // ISO-8601
});
```

Caveat: the registry today is keyed `(organization_id, line_id, fact_kind)` — **line-grain**, but pairing is
carton-grain. Either (a) attach the attempt fact to the carton's *primary* line once one exists (imprecise for
unfound cartons with zero lines), or (b) extend the registry to also accept a carton-level key. This mismatch is
real and should be resolved explicitly, not papered over — see §7 Q9.

### 2.3 Street ownership (code) — unchanged, cross-reference corrected

Aligns with `docs/todo/polymorphic-tables-database-refactor-plan.md` §1, which **already** names `streets/door`
and `streets/triage` as the target code lanes (not yet extracted from `lookup-po`/`view=scanned ∪ unfound-queue`
respectively — that extraction is still Phase-2/3 future work in that doc, independent of this plan).

| Street | Reads | Writes |
|--------|-------|--------|
| `streets/door` | — | create carton, scan, optional auto-pair attempt |
| `streets/triage` | staging + unfound queue + pairing suggestions | classify, stage shelf/lane, save-for-unbox, pairing attempts |
| `streets/unbox` | line facts + photos | condition, serials, receive, unbox photos |

**Do not** add triage-only fields to the unbox DTO or vice versa — this is already true in practice (`TriagePanel`
and `LineEditPanel` are separate components reading the same `ReceivingLineRow`, not a shared masked DTO).

### 2.4 ID stability (issue A — cartons "jumping") — already solved for the existing 3 tabs

- **Stable key:** `receiving_id` (carton), already used as the merge key in `buildTriageCombinedFetcher`
  (`client_event_id: \`carton:${r.receiving_id}\``) — this is the exact mechanism that must extend to a 4th
  `done` bucket without re-introducing flicker.
- List membership (Triage / Prioritize / Unfound / Done) is a **view filter**, not identity — already the
  pattern (`buildTriageCombinedFetcher` unions two source queries and re-derives membership, it doesn't move rows
  between tables).
- Linking a PO changes **badges**, not existence — already true (a carton promoted from `unfound` to `zoho_po`
  stays the same `receiving_id` row; only `receiving.source` flips, per `recomputeCartonSourceLink`).

---

## 3. UX architecture (revised against G1-G4)

### 3.1 Sidebar tabs (`?triview=`) — corrected component names

| Tab | URL value | Component | Feed | Audience |
|-----|-----------|-----------|------|----------|
| **Triage** (default) | `triage` (or absent) | `TriageCombinedList` | `triageCombined` (union, dedup by carton) | Door scanner — "what did I just scan?" |
| **Prioritize** | `found` | `TriageRecentRail` | `scanned` (`scope="triage"`, `sort=priority`) | Unbox prep — "what to open first" |
| **Unfound** | `unfound` | `TriageUnfoundList` | `triageUnfound` → `unfound-queue?kind=unmatched_receiving` | Pairing role — persistent todo |
| **Done** (new) | `done` | new `TriageDoneList` | new `done` feed → `triage_complete = true` | Door scanner — "what I already staged today" |

Done tab answers E10 without removing cartons from the triage universe (which already doesn't happen for the
other 3 tabs). Combined Triage tab should **additionally** show a "Staged" badge for `triage_complete` rows
rather than hiding them — mirrors how it already shows matched-vs-unfound as a badge, not a filter.

### 3.2 Triage stepper (new — replaces the shared `ReceivingProgressStepper` in triage; confirmed live today, G1)

`ReceivingLineWorkspace.tsx:117-126` renders `ReceivingProgressStepper` unconditionally above **both**
`TriagePanel` and `LineEditPanel`. This is the one piece of "shared unbox chrome in triage" that's still real.

**`TriageProgressStepper`** (new component, mirrors `ReceivingProgressStepper`'s shape/props but a different
step set):

```
Scan → Classify → Stage → Pair → Ready
```

| Step | Done when | Notes |
|------|-----------|-------|
| **Scan** | Carton exists | Always done if workspace open |
| **Classify** | `intake_type` ≠ UNKNOWN (via `columnsToClassification`) | Scan-first allowed (G14); picker can follow |
| **Stage** | `staging_location_id` + `priority_lane` set | Required before save (A1) |
| **Pair** | PO matched **or** unfound acknowledged **or** return with no hint (C6) | Pair step surfaces the existing Zendesk/delivered-email signals (already built, G4) plus a new PO auto-suggest (see §3.6) |
| **Ready** | `triage_complete` | Set only by the real save-for-unbox transition (§3.5) |

Wire into `ReceivingLineWorkspace.tsx:117-126`'s conditional: `variant === 'triage' ? <TriageProgressStepper/> : <ReceivingProgressStepper/>`.

### 3.3 Template split inside `TriagePanel` (revised — the unbox/triage split already happened; only the intake-kind split remains)

`TriagePanel` today is **one** component for every intake kind, composing (in order, per `TriagePanel.tsx:112-137`):
`LineCartonContextSection` → `POUnboxingSection` (pairing hub, `poItems={false} matching serialScan={false}`) →
`WorkspaceNotesCard` → the Save-for-unbox `FloatingButton`. Forking by `columnsToClassification(row)`:

```
TriagePanel
├── TriageProgressStepper                     ← new (§3.2)
├── PoTriageTemplate          — PO (+ UNKNOWN → PO path until classified as return)
│   ├── LineCartonContextSection (existing)
│   ├── StagingSection        shelf picker (locations) + priority lane   ← new (§4)
│   ├── POUnboxingSection      pairing hub — Zendesk/Ecwid/Email tabs UNCHANGED,
│   │                          "Zoho PO" tab (PoLinkTab) kept per D1 — sits alongside PO auto-suggest
│   └── UnfoundTodoStrip      "Still unfound — pairing will retry" + link to Unfound tab   ← new
└── ReturnTriageTemplate      — all `*_RETURN` kinds
    ├── LineCartonContextSection (existing)
    ├── StagingSection        shelf + RETURN lane   ← new
    ├── POUnboxingSection      Zendesk tickets + delivered-email tabs — ALREADY BUILT (G4), just re-scoped
    └── UnfoundTodoStrip      "No claim hint — stays in unfound until paired"   ← new
```

Shared: `WorkspaceNotesCard`, `LineEditToolbar`, `useUnboxLineController` for persistence, `ReceivingPhotoPeek` —
**layout and required steps differ**, not the underlying data plumbing.

Trade-in / local pickup: out of scope (G13).

### 3.4 Unbox stepper (unchanged scope)

Keep `ReceivingProgressStepper` for `variant='unbox'` only:

```
Scan → Photos → Condition → Serial → Print
```

Photos step should count only `photo_type` values tagged as unbox-phase (via the `photo_image_types` registry,
G8) once triage photos become a thing — today triage has no photo capture UI at all, so this is currently a
non-issue, but will need the tag distinction the moment §3.7/A1 lands a "staging photo" affordance (if any is
ever added — not currently planned).

### 3.5 Save for unbox — real transition (unchanged target, corrected "today")

**Today, confirmed exactly as v2 said:** `TriagePanel.tsx:151-161` — `toast.success('Saved for unbox'); onClose();`.
Zero server write, zero column touched.

**Target:**

1. `POST /api/receiving/triage/complete` (new; or a guarded `PATCH /api/receiving/[id]` action)
   - Validates: staging location + lane present (A1)
   - Does **not** require PO link (B5) or intake photos (D8)
   - Sets `triage_complete = true`, `triage_completed_at`, `triage_completed_by` (flat columns on `receiving`, per §2.2/D2)
   - Records audit via `recordAudit()` with a new `AUDIT_ACTION.TRIAGE_COMPLETE` (or similar — never reuse/rename
     an existing action constant per `.claude/rules/backend-patterns.md`)
   - Idempotent via `clientEventId` → the new `triage_client_event_id`/`client_event_id` UNIQUE column
2. UI: `FloatingButton` loading → **"Saved ✓"** state (1.5s), then `onClose()` + rail refresh via
   `invalidateReceivingFeeds(queryClient)` (the existing central invalidation helper, `src/lib/queries/receiving-queries.ts`)
3. Rail chip: **Ready for unbox** (emerald) derived from the server field, following `workflowStageDot`-style
   conventions (never hardcode a new color — reuse the semantic tone tokens)
4. Row appears in **Done** tab; remains in combined Triage tab with badge

**Does not** advance `workflow_status` to `UNBOXED` — that remains the unbox street's job, unchanged, still the
one guarded `transitionReceivingLine()` chokepoint.

### 3.6 Auto-suggest pairing — extend the already-shipped hub, don't rebuild it (revised, G4)

**Already shipped, confirmed live** (`useTriagePanel.ts` + `LineMatchingSection.tsx`):

| Signal | Endpoint | Status |
|--------|----------|--------|
| Zendesk ticket candidates (debounced search) | `GET /api/receiving/zendesk-claim/link?receivingId=&query=` | **BUILT** |
| Delivered-email corroboration | `GET /api/receiving-lines/incoming/details?po_id=` | **BUILT** |
| Manual review note (unmatched only) | `PATCH /api/receiving/unfound-queue/unmatched_receiving/:id` | **BUILT** |
| Ecwid order candidates (repair/return, per-line acknowledgment) | existing Ecwid search hook | **BUILT** |

**Genuinely new work:** a PO-matching auto-suggest tier with the **same "no fabricated confidence score" rule**
`useTriagePanel.ts` already documents — ranked candidates with **reason chips** (tracking match / vendor match /
recent PO), one-click accept, backed by real signals already in the codebase (`lookup-po`'s Zoho tracking search
tiers, `reconcileUnmatchedReceiving`'s tracking-based reconciliation). **Per D1 (§0.6), this sits ALONGSIDE the
existing manual `PoLinkTab` search, not in place of it** — auto-suggest becomes the primary/first-shown path in
the pairing hub; `PoLinkTab`'s manual Zoho-PO search stays available as the correction tool for when auto-suggest
doesn't have (or gets) the right answer.

**Separately (D1), add a carton-list search/filter bar** to the bottom of the Triage sidebar, mirroring the tech
sidebar. This is a distinct feature from the PO-matching auto-suggest above — it's for finding a carton already
in the Triage/Prioritize/Unfound list, not for searching Zoho to link one. Note: a **partial version of this
already exists** — `ReceivingSidebarPanel.tsx` renders a local-state search input for `mode === 'triage'` today
(`triageQuery`, `:144/261-270`) that filters the visible list client-side via the `filterText` prop the three
rail components already accept. What's missing is the desired bottom position/prominence (and, worth fixing
while touching this, URL-backing it as `?q=` so it survives a refresh — today it's local `useState`, unlike most
other durable Workbench filters per `.claude/rules/display/workbench.md`).

On accept (either pairing path) → append to `pairing_state`/`last_pair_attempt_at` per D2's flat-column shape
(full attempt history deferred — see §7 Q9). On fail → stay unfound, show in Unfound todo.

### 3.7 Scan → resolve → auto-focus (`TriageFocusResolver`) — unchanged from v2, still net-new

Pure function `src/lib/receiving/triage-focus.ts`:

```
scan resolved
  if intake UNKNOWN        → focus Classify
  if PO && !staged         → focus StagingSection
  if PO && staged && unfound → focus PairingSection (load suggestions)
  if RETURN && !staged     → focus StagingSection (RETURN lane)
  if RETURN && staged      → focus PairingSection or unfound strip
  if triage_complete       → toast "Already staged" + offer Unbox
```

### 3.8 Unfound as cross-mode todo (B4, first half) — already more real than v2 assumed

`v_unfound_queue` already unions **two** kinds (`unmatched_receiving`, `email_po` — a third, `station_exception`,
was tried and dropped per migration history), with a `checked`/`checked_at` acknowledgment flag and an
`exclude_unbox_intake` filter that already keeps a carton on the todo list once it's been opened in unbox. This
is a **broader, already-working** version of B4's "persists across door scan, triage, unbox, post-unbox" — the
new `receiving_triage`/flat-column `pairing_state` (§2.2) should **read through** this existing view, not
duplicate its logic.

| Mode | Unfound behavior |
|------|------------------|
| Triage | Unfound tab + auto-pair on scan + suggestions in panel (Zendesk/email already; PO new per §3.6) |
| Unbox | Same carton openable; unfound strip visible; pairing retries continue |
| Post-unbox | If PO still unmatched, remains on unfound todo for back-office pairing (already true via `v_unfound_queue`'s `exclude_unbox_intake` toggle) |

### 3.9 Priority & stock-outs (F12) — DONE, listed for completeness only

| Signal | Source | UI | Status |
|--------|--------|-----|--------|
| Manual tier | `receiving.priority_tier` | Priority pill | **DONE** |
| Pending order match | `receiving.is_priority` (auto, `markReceivingPriority`) | Rank-0 "Priority" badge | **DONE** |
| Lane sort | new `priority_lane` + `staging_location_id` | Prioritize tab ordering | **OPEN** — genuinely new |

---

## 4. Physical staging model (A1 — detail, rewritten around the existing `locations` table)

### 4.1 Shelf (required) — reuse `locations`, do not build a parallel catalog

- `locations` already models exactly this: `id, name, room (was zone), barcode, row_label, col_label, bin_type,
  capacity, parent_id, zone_letter, is_active, sort_order`. Seeded zones already exist (`Warehouse`, `Receiving`,
  `Returns`, `Testing`, plus generated `Z1-A-01`…`Z2-F-06` bins).
- Add a **new `bin_type` value**, e.g. `'STAGING'` or `'TRIAGE_LANE'`, so staging shelves are filterable/distinct
  from putaway/pick bins in the same table — zero new table, one `ALTER TABLE locations ... CHECK` update (if
  `bin_type` is even constrained today — verify; it may already be free-text) or just a data convention.
- Door scanner picks a location by scanning its `barcode` (already scannable) or via a picker filtered to the
  staging `bin_type`/`room`.
- Displayed on rail: reuse whatever chip pattern `handling_units`/`bin_contents` already use for a location
  reference (a location-name chip), not a new bespoke "Shelf B-12" component.
- Purpose: **where the physical carton sits** before unbox.

### 4.2 Priority lane (required) — DECIDED: routing via Studio decision node (D3, §0.6)

Lane **values** (v1, small fixed list per §0.6's open sub-question — revisit only if a tenant needs a custom lane):

| Lane | Use |
|------|-----|
| `PO_STOCKOUT` | Pending-order / low-stock unbox first |
| `PO_STANDARD` | Regular vendor PO |
| `RETURN` | Customer returns shelf |
| `HOLD` | Exception / waiting |

Lane **routing** (which lane a given carton auto-lands in) is a **Studio-editable decision rule**, not inline
logic — mirror `src/lib/receiving/putaway-placement.ts`'s `receivingDefaultPutawayPolicy(defaultBinSymbol):
DecisionRule[]` pattern exactly: a new `receivingTriageLanePolicy(...): DecisionRule[]` pure function (no DB),
consumed by whatever calls resolve the org's putaway rules today, and pluggable into a `/studio` decision node so
an org owner can visually edit "which lane does an Amazon return land in" without a code change. The operator's
**manual override** (assigning/changing the lane by hand in the Stage step) always wins over the auto-routed
default — same relationship `priority_tier` already has to the auto `is_priority` flag (manual COALESCEs first).

Lane drives **Prioritize tab sort** and visual grouping (PO vs return organization) — layered **on top of**, not
replacing, the existing `precedence.ts` platform-rank sort (F12, already done). Composing them: lane becomes a
`COALESCE`-first tier ahead of `priorityRankSql()`'s existing chain (`priority_tier` → `is_priority` → platform →
other), mirroring how `priority_tier` already wins via `COALESCE` today.

### 4.3 Unbox without staging (E11)

Unbox rail shows all cartons; unstaged cartons show warning chip **"Not staged"** (reuse the existing dashed/tone
warning-chip convention, not a new component) but remain openable. Staging is strongly encouraged, not enforced
at unbox gate.

---

## 5. Returns flow (C6, C7) — cross-referenced against the shipped serial-scan autolink

Returns are **first-class unfound** at the triage step:

1. Scan → carton created (scan-first)
2. Operator classifies as return platform when known; UNKNOWN allowed briefly
3. No claim on label → **no minimum pairing**; stays unfound
4. Stage to RETURN lane + shelf
5. Save for unbox allowed
6. Pairing role works Unfound tab + Zendesk/email auto-suggest (already built, §3.6)

**Important distinction — do not conflate with `returned-serial-unbox-autolink`.** A separate, already-shipped
mechanism auto-links a *scanned serial* to its prior SHIPPED order at the **unbox** step
(`src/lib/receiving/returned-serial-link.ts`, `linkReturnedSerial`, flag `RECEIVING_RETURN_AUTOLINK` default ON).
That's a **serial-level, unbox-time** match (this exact unit was shipped on order #X); triage's return pairing is
a **carton-level, pre-unbox** match (this package probably relates to claim ticket #Y). Both can be true for the
same carton at different times — the triage pairing hub should **surface**, not duplicate, a serial-level match
if one already landed by the time triage happens (rare, since serial scanning is an unbox action, but the read
model should not disagree if both exist).

Do not block door throughput on Zendesk linkage.

---

## 6. Implementation phases (revised file targets)

### Phase 0 — Spec & schema (planning → build)

- [ ] Finalize `priority_lane` enum/vocabulary values with ops (small fixed list, §4.2/D3)
- [ ] Confirm `locations` `bin_type` convention for staging (new value vs `room`-based filter)
- [ ] Migration: flat `ALTER TABLE receiving` per §2.2 Option A (D2) — `staging_location_id`, `priority_lane`,
      `pairing_state`, `last_pair_attempt_at`, `triage_complete(_at/_by)`, idempotency column
- [ ] New `receivingTriageLanePolicy(): DecisionRule[]` in `src/lib/receiving/putaway-placement.ts`-adjacent module,
      wired into a `/studio` decision node (D3)
- [ ] Resolve §7 Q9 (pairing-attempt history depth — default to no full history for v1, just `last_pair_attempt_at`)
- [ ] `photo_image_types` registry row for a triage-phase photo tag, **if** triage ever gains photo capture (not currently in scope per D9)
- [ ] API: `streets/triage` read/write endpoints (narrow DTOs), or a scoped extension of the existing rail feeds

### Phase 1 — UI split (highest ROI)

- [ ] `TriageProgressStepper` + wire into `ReceivingLineWorkspace.tsx:117-126`'s existing conditional (replacing
      the currently-shared `ReceivingProgressStepper` for `variant='triage'`)
- [ ] `PoTriageTemplate` / `ReturnTriageTemplate` fork inside `TriagePanel.tsx` (the unbox/triage split is done;
      this is the remaining intake-kind split)
- [ ] `TriageFocusResolver` on open + scan resolve
- [ ] Save-for-unbox real API (`POST /api/receiving/triage/complete`) + button feedback + `Ready` rail chip
- [ ] **Done** tab: extend `TriageSidebarBody`'s `resolveTriageView` union + a new `TriageDoneList` + a new `done`
      feed descriptor in `src/lib/receiving/rail/feeds.ts` (mirroring `buildTriageCombinedFetcher`'s pattern)
- [ ] PO auto-suggest block inside the existing `POUnboxingSection`/`LineMatchingSection` pairing hub (extends
      `useTriagePanel`, sits alongside `PoLinkTab` as the primary/first-shown path — D1)
- [ ] Sidebar carton-list filter: reposition/promote the existing `triageQuery` search (`ReceivingSidebarPanel.tsx`)
      to a bottom-anchored affordance per D1, and URL-back it (`?q=`) while touching it

### Phase 2 — Staging

- [ ] Shelf picker (scan `locations.barcode` or select, filtered to the staging `bin_type`/`room`)
- [ ] Priority lane picker (PO vs RETURN vs STOCKOUT)
- [ ] Rail + pane chips for shelf + lane
- [ ] Prioritize sort: extend `priorityRankSql()`/`precedence.ts` with a lane tier ahead of the platform CASE
      (mirrors how `priority_tier` already COALESCEs ahead of it)

### Phase 3 — Data streets cutover (optional; can ride the bigger streets refactor instead of preceding it)

- [ ] `GET /api/receiving/triage/queue` — narrow triage DTO (no unbox fields), or fold into the existing rail
      feed descriptors rather than a new endpoint
- [ ] Move triage writers off wide PATCH `/api/receiving/[id]` onto the new triage-specific route
- [ ] If the `polymorphic-tables-database-refactor-plan.md` Phase-C street cutover reaches `streets/triage`
      before this does, fold this plan's triage fields into that street's lane instead of building a parallel one

### Phase 4 — Intelligence (later)

- [ ] Auto `PO_STOCKOUT` lane from pending-check (extends the already-shipped `markReceivingPriority`)
- [ ] Pairing retry job for unfound queue
- [ ] Metrics: time-in-unfound, save-without-pair rate
- [ ] Keyboard shortcuts

---

## 7. Open questions (v4 — resolved by grounding + owner interview; only genuinely open items remain)

### Resolved by the grounding pass alone (no interview needed)

| # | Original question | Resolution |
|---|----------|--------|
| ~~Q1~~ | Exact shelf catalog — reuse `locations` or new `staging_shelves`? | **Resolved: reuse `locations`** (G7) — it already has row/col/bin_type/capacity/barcode addressing. |
| ~~Q3~~ | Should Done hide from Prioritize/Unfound, or only filter Done? | Superseded by D4 (badge-only, confirmed by interview). |

### Resolved by the owner interview (§0.6) — see D1-D4 there for full reasoning

| # | Original question | Resolution |
|---|----------|--------|
| ~~Q6~~ | Manual PO-search conflict with B4 | **D1: keep `PoLinkTab`; add a sidebar carton-list filter separately.** |
| ~~Q7~~ | Flat columns vs new `receiving_triage` table | **D2: flat columns on `receiving`, now.** |
| ~~Q8~~ | `priority_lane` as CHECK enum vs `reason_codes` vocabulary | **D3: routing is a Studio decision node; values are a small fixed list for v1** (not quite either original option — see §0.6's open sub-question). |
| ~~Q10~~ | Done-tab badge vs hide | **D4: badge only, never hide.** |
| ~~Q11~~ | Sequence before/after the bigger streets refactor | **D2 implies "now"** — proceed without waiting. |

### Genuinely still open (need a decision before the phase that blocks on them, not before starting)

| # | Question | Blocks |
|---|----------|--------|
| Q2 | Can one `locations` row (shelf) hold multiple lanes, or is lane purely logical/independent of the shelf assignment? | Lane picker UX (Phase 2) |
| Q4 | Pairing retry — background Zoho poll only, or on-demand "Retry pair" button in the unfound strip? | Unfound UX (Phase 1/4) |
| Q5 | Return classification — force a platform picker before save, or allow UNKNOWN + RETURN lane through? | Return template validation (Phase 1) |
| Q9 | Pairing-attempt history: register a new **line-grain** `receiving_line_facts` kind (needs a "which line" answer for a zero-line unfound carton — attach to the carton's first-created line once one exists?), or should attempts just live as plain columns/rows alongside the new flat `receiving` columns from D2 instead of going through the facts registry at all? Given D2 already put `pairing_state`/`last_pair_attempt_at` as flat columns, the simplest consistent answer is: **skip the facts registry for this, keep attempt history as a lightweight `receiving_id`-keyed table or just overwrite `last_pair_attempt_at` without full history for v1** — flag this as the default unless full attempt history (not just "last attempt") turns out to matter operationally. | Phase 0 schema — low urgency, can default and revisit. |

---

## 8. Files (expected touch map — corrected to real current file names)

| Area | Files |
|------|-------|
| Plan | `docs/receiving-triage-redesign-plan.md` (this doc) |
| Classification SoT | `src/lib/receiving/intake-classification.ts` |
| Priority/precedence SoT | `src/lib/receiving/display/precedence.ts` (not `scan-priority.ts`) |
| Triage panel | `src/components/receiving/triage/TriagePanel.tsx` — fork into `PoTriageTemplate.tsx` / `ReturnTriageTemplate.tsx`, new `TriageProgressStepper.tsx` |
| Pairing hub | `src/components/receiving/workspace/line-edit/{POUnboxingSection,LineMatchingSection,PoLinkTab,PairingLinkButton}.tsx`, `src/components/receiving/triage/{useTriagePanel.ts,triage-types.ts}` |
| Workspace shell | `src/components/receiving/workspace/ReceivingLineWorkspace.tsx` (the `variant==='triage'` conditional at ~L117-139) |
| Sidebar tabs | `src/components/sidebar/receiving/{TriageSidebarBody,TriageViewToggle,TriageCombinedList,TriageRecentRail,TriageUnfoundList}.tsx`, new `TriageDoneList.tsx` |
| Rails / feeds | `src/lib/receiving/rail/feeds.ts` — new `done` feed descriptor alongside `buildTriageCombinedFetcher`/`buildUnfoundFetcher` |
| Focus resolver | `src/lib/receiving/triage-focus.ts` (new) |
| API | new `src/app/api/receiving/triage/complete/route.ts`; extend `src/app/api/receiving/unfound-queue/route.ts` if `done` needs a queue-side filter |
| Schema | one migration: `ALTER TABLE receiving ADD COLUMN ...` per §2.2 Option A (D2); `locations` `bin_type` staging convention (§4.1) — likely no migration needed |
| Facts | Deferred per §7 Q9 (default: no new fact kind for v1 — `pairing_state`/`last_pair_attempt_at` are flat columns from D2) |
| Priority lane | values = small fixed TS list (mirrors `RECEIVING_EXCEPTION_CODES`); routing = new `receivingTriageLanePolicy(): DecisionRule[]` module + `/studio` decision node wiring, per D3 |
| Photos (if ever needed) | `src/lib/photos/image-types.ts` + a `photo_image_types` registry row — **not** a new `photos.capture_phase` column (§4/G8) |
| Polymorphic | `docs/todo/polymorphic-tables-database-refactor-plan.md` — proceeding now per D2; revisit only if/when that refactor reaches the triage street |

---

## 9. Success criteria

- Door scanner can scan → classify → assign shelf + lane → save in &lt;60s, with auto-suggest as the primary
  pairing path and the manual `PoLinkTab` Zoho-PO search available as a correction tool when auto-pair doesn't
  have the right candidate (D1) — plus a fast sidebar carton-list filter for finding a carton already scanned in.
- Unfound cartons never disappear from lists; they accumulate in Unfound todo until paired (**already true today**
  via `v_unfound_queue` — this criterion is about not regressing it, not building it from scratch).
- Triage and unbox show **different steppers** (`TriageProgressStepper` vs `ReceivingProgressStepper`) — the one
  genuinely-still-shared piece of chrome today (G1).
- `triage_complete` is server-backed (flat column on `receiving`, D2); Done tab shows it and the combined Triage
  tab shows a "Staged" badge without hiding the row (D4).
- Returns without label hints flow through without blocking on Zendesk (**already true** — Zendesk pairing is
  optional/suggestive today, never a hard gate).
- Unboxers can open unstaged cartons but see a clear "Not staged" warning.
- The staging model reuses `locations` — no parallel shelf catalog exists after this ships.
- `priority_lane` **routing** is a `/studio`-editable decision rule (D3), not inline/hardcoded logic; manual
  override always wins over the auto-routed lane. `priority_lane` **sort** composes with, rather than replaces,
  the existing `precedence.ts` platform-rank sort.
- Q2/Q4/Q5/Q9 (the remaining genuinely-open items, §7) get explicit answers before the phase that needs them —
  none of them block starting Phase 0/1.
