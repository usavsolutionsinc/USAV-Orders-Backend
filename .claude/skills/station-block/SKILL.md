---
name: station-block
description: Build a station-builder block, data source, or action for the composable station system (src/lib/stations registries). Use when adding any list/checklist/scan/workspace-step UI that staff interact with, or when exposing a new integration's feeds and mutations to the station builder — instead of hand-wiring a bespoke panel.
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---

# Station blocks, data sources & actions — composition over bespoke panels

Stations (receiving Unbox, Incoming, FBA Combine, tech testing…) are composed from
registered **blocks** bound to **data sources** and **actions**, saved as data in
`station_definitions`. Full spec: `docs/operations-studio/station-builder-ui-plan.md`.
Once the registries exist (phase S1), this skill replaces the old reflex of building a new
sidebar panel per feature.

## Decision tree — what are you actually adding?

1. **A new feed of things to look at / work through** (emails, POs awaiting tracking,
   units awaiting test, eBay orders to ship) → a **data source**. ~20 lines. No UI work.
2. **A new button/mutation on existing rows** (attach tracking, relist, dismiss, print) →
   an **action**. ~15 lines. No UI work.
3. **A genuinely new way of displaying/interacting** that Checklist, Rail Feed, Grouped
   Table, scan bars, and the workspace step blocks cannot express → a **block**. This
   should be RARE — challenge it twice before building. The palette growing slowly is a
   feature.
4. **A new arrangement of existing blocks** → not code at all; it's a `station_definitions`
   config (built in the Studio/edit mode, or seeded in a migration for templates).

## The slot anatomy (every station, no exceptions)

`trigger` (scan bar / import feed) · `queue` (checklist / rail / table) · `workspace`
(ordered step blocks: condition, serials, photos, print, notes) · `advance` (the done
action → workflow stage transition). A block declares which slots it may occupy; the
builder enforces it. If a feature doesn't fit a slot, it's probably a Studio lens or a
workflow node — check `/ops-studio` routing.

## Authoring a DATA SOURCE (`src/lib/stations/data-sources.ts`)

- Wrap an **existing GET route** — never write a new query path just for a source. If the
  feed doesn't exist as an endpoint yet, build the endpoint first (house API rules: withAuth,
  Zod, audit — the api-route-reviewer agent checks this), then wrap it.
- Declare `shape: FieldDef[]` with **semantic kinds** — this is the magic that makes
  binding smart. Existing kinds: `po_ref`, `tracking_ref`, `order_ref`, `sku_ref`,
  `serial_ref`, `condition_grade`, `source_platform`, `timestamp`, `money`, `text`,
  `staff_ref`. A field's kind selects its renderer (PO popover, carrier chip, condition
  pill…) and which actions become offerable (`appliesTo` matching). Add a new kind only
  with a renderer that delegates to the existing label SoTs (`conditions.ts`,
  `source-platform.ts`, `copy-chip-format.ts`, `workflow-stages.ts`) — NEVER an inline
  grade/status/platform → label map.
- Declare user-tunable `filters` (the Config Sheet Source tab renders them) and
  `realtime.ablyChannel` if the feed has live invalidation. Extraction logic ("pull PO#
  out of the email") lives server-side in the integration (e.g. the po-gmail pile already
  extracts candidates) and is exposed as just another field — sources never run client-side
  parsing.

## Authoring an ACTION (`src/lib/stations/actions.ts`)

- A descriptor over an **existing mutation route**: `{ id, label, icon, endpoint,
  permission, appliesTo, confirm }`. No business logic, no fetch wrappers with side
  decisions — the route already owns validation, auth, idempotency, audit.
- `permission` MUST be a real key in `src/lib/auth/permission-registry.ts`. If you add a
  permission, pair it with `route-permission-manifest.test.ts` (permission-registry-guard
  enforces). The builder *selects* among permitted actions; it never grants.
- `confirm: 'step_up'` for destructive/outward actions (void, hard delete, publish to
  marketplace) — reuses the existing PIN/passkey step-up. Soft-delete semantics where the
  domain has them (e.g. warranty claims never hard-delete).

## Authoring a BLOCK (`src/lib/stations/blocks/`)

- Register a `BlockDefinition` (type, label, icon, category, `slots`, `accepts`,
  `configSchema`, `requiredPermissions`, lazy `component`). The palette card, config sheet
  Display tab, and renderer all derive from this — adding a block touches ZERO builder UI
  code. If it does, the registry contract is being violated.
- The component receives resolved rows + bound actions as props; it must NOT fetch on its
  own, hard-code a data source, or know which integration feeds it. Checklist doesn't know
  Gmail exists.
- Reuse the primitives: design-system `Button`, `RowMetaColumns`/`RowTitle`, CopyChip
  family, receiving display chips, `SidebarRailShell` + rail-edit-mode for bulk select,
  the 40px `sidebarHeaderSearchRowClass` band for any search row. Match `SIDEBAR_GUTTER`
  and the z-index token scale.
- Variants go in `configSchema` (e.g. Checklist `check_only | check_act | check_assign`),
  not as sibling block types, unless interaction models genuinely diverge.

## Worked example to imitate

The Incoming checklist: generic `checklist` block + `po_gmail.unmatched_emails` source
(fields: subject, `extracted_po_number`:po_ref, from) + actions
`incoming.attach_tracking` / `incoming.open_po` / `incoming.dismiss_email`, `done_when =
attach_tracking`. Tier 2 ("POs still awaiting tracking") = same block, different source —
if your second use case costs more than a binding, the abstraction is being bypassed.

## Checklist

- [ ] Chose the lightest tier (config > source/action > block)
- [ ] Source wraps an existing GET; fields carry semantic kinds; no client-side parsing
- [ ] Action wraps an existing mutation; permission key real + manifest test updated
- [ ] Block fetches nothing itself; renders from props; registered, not hard-wired
- [ ] All labels/tones via existing SoT registries
- [ ] Bulk-select via rail-edit-mode provider, not bespoke checkboxes
- [ ] Works for a staff member who LACKS some bound action permissions (buttons hidden, no crash)
