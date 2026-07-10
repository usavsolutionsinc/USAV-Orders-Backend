# Unbox / Receive screen — UX comparison & improvement plan

> Source: Mobbin-grounded comparison of the unbox-mode receive screen (stepper → header → PO item +
> condition chips + serial → label notes → label preview → receive). Comparison only — no code in this
> plan. References cite real shipped screens on Mobbin; effort estimates assume existing repo SoTs
> (conditionLabel, condition-tone, reason_codes, labelFace, station-scan-routing, HoverTooltip,
> kit-readiness). Written 2026-07-10.

## Verdict in one line

The screen already beats most consumer references on density and single-screen speed (right call for a
Station archetype); the two biggest gaps are (1) **no structured defect capture** — "Untested, No Power
Cord" lives in a free-text title instead of chips — and (2) **the stepper models navigation, not data
completeness**, so it lies about progress and doesn't gate the Receive action.

## What the current screen gets right (vs Mobbin field)

- **Single-screen workbench** — eBay/Mercari/Depop force 3–6 screens for photos→condition→details;
  ours is one surface. For repetitive daily use this is a genuine throughput advantage.
- **One-tap condition chips** — faster than every marketplace's radio-list-with-descriptions pattern.
- **Live label preview with QR before print** — none of the surveyed consumer apps show a pre-print
  artifact preview; Eventbrite/Luma only show post-issue tickets. Differentiator; keep.
- **Per-grade tones on chips** (condition-tone SoT) — no surveyed app color-codes grades.

## Top opportunities (ranked)

### 1. Structured defect capture (HIGH ROI, Medium effort)
- **Problem:** defects are baked into the item title ("Untested, No Power Cord") — unsearchable,
  unauditable, invisible to pricing/QC/claims.
- **Pattern:** GOAT defect toggles (https://mobbin.com/screens/258b7f70-c4a8-450f-b3dd-b9f7cf35090d),
  alias defect chips Odor/Scuffs/Tears/B-Grade + "Other issues" free text
  (https://mobbin.com/screens/19e33a1c-699d-4103-b195-bef3fde520c1), Bird's 2-step scan→issue-chips
  (https://mobbin.com/screens/7b72160f-9aa8-409d-946e-7c04017eddb3).
- **Shape:** picking a grade below NEW reveals a one-row defect chip group (No Power Cord, Untested,
  Cosmetic, Missing Parts, No Remote…) + optional free text. Chips feed the label, the QC checklist,
  and audit.
- **Repo fit:** vocab = `reason_codes` (Class-D engine) with a new `flow_context`; storage = typed-fact
  table per `.claude/rules/polymorphic-tables.md`; per-tenant vocab for free.
- **Component:** `ConditionDefectPicker` (grade chips + conditional defect chip row).

### 2. Stepper → per-item readiness model (HIGH ROI, Medium effort)
- **Problem:** SCAN→PHOTOS→CONDITION→SERIAL→PRINT reads as a wizard, but the screen is parallel-entry;
  condition is already set while CONDITION shows "not started". Progress state is decorative, not true.
- **Pattern:** Deel's per-section COMPLETED checklist
  (https://mobbin.com/screens/d4f1afe2-8c96-44e2-923d-043c11be46ab), Gopuff's segments that fill as
  facts land (https://mobbin.com/screens/7dd7a488-ec6b-44b7-a2a9-f1f4231b7161), Shopify PO per-line
  received meters (https://mobbin.com/screens/44aa57ce-d57f-495e-aaef-f62748691266).
- **Shape:** replace step-navigation semantics with data-completeness ticks per item (photos ≥ n,
  grade set, serial ok, label ready). Any order; the bar is derived state and gates Receive. Mirrors
  `evaluateKitReadiness` (kit-readiness SoT) — same engine idea, receive-side.
- **Component:** `ReceiveReadinessBar` (+ `useReceiveReadiness`).

### 3. Explicit commit bar + big success state (HIGH ROI, Low–Med effort)
- **Problem:** primary action is a small icon-only green check beside the serial field; ambiguous
  (confirm line? receive PO?) and undersized for a bench.
- **Pattern:** Gopuff "Delivered!" full-state, eBay/Mercari full-width labeled CTAs; house station rule
  already mandates big card pass/fail, never a toast.
- **Shape:** sticky bottom bar "Receive & Print · 1 item" with disabled-reason text ("Add serial to
  receive"); on commit → success flash card → auto-print → clear → re-focus scan bar.
- **Component:** `StationCommitBar`.

### 4. Grade teaching layer — ✅ ALREADY SHIPPED (verified in code 2026-07-10)
`ConditionPills.tsx` already wraps every grade chip in `HoverTooltip` with
`conditionDescription()` from `src/lib/conditions.ts` (`CONDITION_DESCRIPTIONS`). Remaining upside is
optional: per-tenant description overrides via the labels layer + a first-N-sessions inline teaching
mode. Original rationale kept below for that follow-up.
- **Problem:** NEW/L-NEW/REFURB/A/B/C/PARTS is expert shorthand; new staff at a new tenant get zero
  definition. Every marketplace pairs grade with a one-liner: eBay
  (https://mobbin.com/screens/e07ff2a2-1c32-446d-918c-80faf2023d63), Vinted
  (https://mobbin.com/screens/b25abbd8-c0a7-401b-bf57-4b41c28fa4cb), Mercari
  (https://mobbin.com/flows/b3c21b91-4d37-4b59-a167-5acba09546ba), Vestiaire, Depop; alias adds an
  example photo (https://mobbin.com/screens/e9bba745-1d35-4ba1-ab1a-dacd6e9a0cbe).
- **Shape:** HoverTooltip/long-press on each chip → `conditionLabel(code, 'full')` definition +
  optional example photo; optional per-staff "teaching mode" that shows one-liners inline for the
  first N sessions. Definitions overridable per tenant via the label-vocabulary layer.
- **Component:** `GradeDefinitionPopover` (wraps existing chip row; no new SoT).

### 5. Serial capture hardening (HIGH error-reduction ROI, Low–Med effort)
- **Problem:** bare text input; no scan affordance, format validation, dupe check, or feedback.
- **Pattern:** MyDyson dedicated serial scan + manual fallback
  (https://mobbin.com/screens/b82c0b71-ea01-47ab-80fe-051adf9e0bee), ZARA camera/NFC/keyboard mode
  toggle (https://mobbin.com/screens/bbe6d64b-2667-4dec-876d-fddbd287cdca), Crate & Barrel manual-entry
  dialog (https://mobbin.com/screens/4c587eb7-af4b-4bbc-9160-1f9c5fc653d3).
- **Shape:** field advertises "scan or type"; on entry → classify via station-scan-routing, validate
  shape, org-scoped dupe check (serial_units per-org unique), render as chip via resolveSerialDisplay;
  reject/dupe = inline red state on the field, not a toast.
- **Component:** `SerialCaptureField`.

### 6. Grade-conditional guided photos (MED ROI, Medium effort)
- **Problem:** header camera chip counts photos but nothing guides or requires shots; claims (CLAIM
  chip) depend on evidence quality.
- **Pattern:** alias "Outer · 1 OF 8" silhouette-guided capture
  (https://mobbin.com/screens/4f52c1f4-b905-4ce5-9648-35da46cebe48), Vestiaire per-angle photo
  checklist with examples (https://mobbin.com/screens/5aa4b3d5-34a4-463f-887b-2d60afab8752), eBay AI
  camera hint (https://mobbin.com/screens/d93f7537-4ac7-49b7-8902-f8484e1c1dcd).
- **Shape:** per-tenant photo policy: grade ≤ B or any defect chip ⇒ required "defect photo" slot;
  slots shown as a thumbnail tray with empty ghosts. Feeds readiness (#2).
- **Component:** `GuidedPhotoTray` (policy in Settings Registry).

### 7. Unify label notes + label preview (MED ROI, Low–Med effort)
- **Problem:** two disconnected LABEL sections — a notes composer and a separate preview card; the
  relationship (notes → printed label?) is implicit.
- **Pattern:** Eventbrite ticket = QR hero + human-readable meta in one card
  (https://mobbin.com/screens/d1cd354e-9440-44d3-aace-a549a31e8373); Alan printable-card preview.
- **Shape:** one `LabelComposer`: live labelFace-driven preview, tap-to-edit regions, "+ Insert" token
  chips (grade, serial last-4, date, defects from #1). LabelFaceModel stays the render SoT.
- **Component:** `LabelComposer`.

## Flow / IA notes

- **Archetype hygiene:** this is a Station (scanner input) hosting Workbench affordances (editable
  title underline, EDIT PO, notes composer). Keep the scan→grade→serial→commit loop pure station;
  move PO editing behind an explicit secondary region/panel (Shopify PO header keeps supplier
  read-only with an explicit Edit action — https://mobbin.com/screens/780af3a7-0da7-4068-b1ef-c15eabc68cda).
- **Multi-line POs:** adopt Shopify's receive-all/reject-all bulk bar + per-line meters
  (https://mobbin.com/screens/df6cdd24-2698-4c65-969c-48ca3ce84d6b) on top of CollapsibleGroupRow when
  PO ITEMS > 1; 7-Eleven's scan-accumulate basket
  (https://mobbin.com/flows/12393b33-b078-4193-b3fd-8853983cabd0) is the model for continuous scanning
  into a batch then committing once.
- **Post-receive:** success big-state → auto-print → auto-clear → focus scan bar (station lifecycle
  act-and-clear). Reason-coded discrepancies (short-ship, damage-on-arrival) mirror Shopify's
  inventory-adjust Reason picker (https://mobbin.com/screens/ee506676-fb77-4659-a814-7b71d600a76d) via
  reason_codes.

## Implemented — 2026-07-10, branch `worktree-unbox-ux` (worktree `.claude/worktrees/unbox-ux`)

- **Stepper truth-fix (#2, interim):** `deriveReceivingStepStates` no longer chain-gates completion —
  each step shows done when its own data gate passes; active = first failing gate (completeness
  checklist, not a wizard). Tests updated (`derive-receiving-step-states.test.ts`, 6/6 pass).
- **Serial capture hardening (#5, client half):** `SerialCard` now (a) blocks duplicate serials
  already saved on the line (inline rose notice with last-4, comma-paste batches filtered), and
  (b) warns when a scan classifies as a carrier tracking number via `classifyInput` — re-submitting
  the same value overrides. Inline notice under the field, never a toast. Org-scoped server dupe
  check remains the backstop.
- **Receive-bar disabled reason (#3, UI half):** `useUnboxLineController` exposes
  `combinedReviewDisabledReason` (link / PO-or-SKU / serial-confirmation blockers);
  `LineReceiveActionBar` renders it as a visible amber line above the pill when disabled.

Verified: stepper tests 6/6; `tsc --noEmit` introduces no new errors (19 pre-existing on main);
DS ratchet-guard failures on this commit are pre-existing baseline drift in untouched files.

## Quick wins vs strategic bets

**Quick wins (days):** grade tooltips (#4) · commit bar relabel + disabled reasons (#3, UI half) ·
serial validation + dupe check (#5) · stepper truth-fix (bind existing steps to real data state,
interim before #2) · parse "No Power Cord/Untested" out of titles into chips as a seeding pass for #1.

**Strategic bets (weeks):** defect capture end-to-end (#1: vocab + storage + label + QC) · readiness
model (#2) · guided photo policy (#6) · batch receive mode for multi-line POs · per-tenant grade
vocabulary registry (labels layer) for white-label grading.

## Multi-tenant thread (applies to every item)

Grade + defect vocabularies, teaching copy, photo policy, and label templates are all per-tenant
configuration over canonical codes — reuse reason_codes, the label-vocabulary layer, Settings
Registry, and labelFace rather than inventing per-feature config. Canonical codes stay stable so
cross-tenant analytics and the state machine never fork.
