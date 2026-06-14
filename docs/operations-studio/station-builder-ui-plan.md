# Station Builder — Block Palette, Drag-and-Drop Composition & Data Binding

> **Status:** Design plan (companion to `NODE_WORKFLOW_ARCHITECTURE.md` / `NODE_UI_PLAN.md`).
> **Scope:** Make station pages (receiving, tech, packing, FBA…) composable from a library of
> reusable blocks. An operator opens "Customize", drags a block (e.g. **Checklist**) from a
> right-side palette into the sidebar, then binds it to a data source ("unmatched PO emails →
> extract PO#") and selects which actions it exposes. Per-staff modularity falls out of the
> existing permission registry.
> **Driving example:** add a checklist to the receiving **Incoming** mode that lists unmatched
> PO emails, pulls the PO# out of each, and lets staff attach tracking / dismiss — i.e. the
> `incoming-tracking-todo` plan, achieved through configuration instead of bespoke code.

---

## 0. The recommended method (TL;DR)

**Hybrid: drag-and-drop for *placement*, generated forms for *behavior*.**

- A right-side **Block Palette** (RightPaneOverlay) lists every registered block, grouped by
  category. Drag a block card into a **slot** in the live sidebar (dnd-kit — already a dep).
- Dropping never creates a "blank" block: it immediately opens a **Config Sheet** with three
  tabs — **Source** (what data feeds it), **Display** (how it renders), **Actions** (what
  buttons/mutations it exposes). All three tabs are *generated from registries*, not hand-built
  per block.
- The page being customized is the **real page in edit mode** (same pattern as the existing
  rail edit-mode pencil), not a separate abstract canvas. You see the checklist live-populate
  with real emails the moment the Source tab is bound.

Why not the two "pure" alternatives:

| Approach | Verdict |
|---|---|
| **Full node-canvas for UI layout** (drag blocks on a React Flow board) | ❌ for station UI. Canvas is right for the *process graph* (it already exists as the Operations board); page layout has fixed slots, so free-form XY placement adds choice without meaning. |
| **Form-only "Add block" button** (no drag) | ❌ alone. Works functionally but loses the spatial "I put the checklist *here*" mental model the whole builder is for. Keep it as the accessibility/keyboard fallback. |
| **Palette → slot drag + config forms** | ✅ **Recommended.** Drag answers *where*, forms answer *what/how*. This is the Notion/Retool/WordPress-Gutenberg model, and it maps 1:1 onto the SidebarShell slot anatomy below. |

---

## 1. Vocabulary

| Term | Meaning | Backed by |
|---|---|---|
| **Station** | One staff-facing page/mode: a configured arrangement of blocks (e.g. "Unbox", "Incoming", "FBA Combine") | `station_definitions` row (new) |
| **Slot** | A named region of the station chassis a block can occupy: `trigger`, `queue`, `workspace`, `advance`, `header` | SidebarShell layout (existing) |
| **Block** | A reusable UI component with a declared config schema and slot compatibility (Scan Bar, Checklist, Rail Feed, Photo Step…) | Block registry (new, mirrors `src/lib/workflow/registry.ts`) |
| **Data source** | A named, typed read feed an integration exposes ("Unmatched PO emails", "Pending unboxing", "AWAITING_TRACKING POs") | Data-source registry (new) |
| **Action** | A named, permission-gated mutation ("Attach tracking to PO", "Mark received", "Dismiss email") | Action registry (new) |
| **Binding** | The saved wiring: block ⇄ data source (+ field mapping) ⇄ actions | `station_definitions.config` JSON |

The split that makes "add more integrations" cheap: **blocks are generic, integrations ship
data sources and actions.** A Checklist block doesn't know about Gmail; the po-gmail
integration registers a `po_gmail.unmatched_emails` data source whose shape (`from`,
`subject`, `extracted_po_number`, `extracted_tracking`) any list-ish block can consume.
Adding a new integration = registering its sources + actions; every existing block can
immediately display and act on it with zero new UI code.

---

## 2. The three registries (code) + one config store (data)

### 2.1 Block registry — `src/lib/stations/blocks/registry.ts`

Same shape and discipline as the workflow node registry (`src/lib/workflow/registry.ts`):

```ts
export interface BlockDefinition {
  type: string;                       // 'checklist' | 'scan_bar' | 'rail_feed' | 'photo_step'…
  label: string;
  icon: string;                       // lucide name
  category: 'trigger' | 'list' | 'workspace_step' | 'action_bar' | 'integration';
  slots: SlotId[];                    // which slots it may be dropped into
  /** Shape of data it can consume; palette greys out incompatible sources. */
  accepts: 'rows' | 'single' | 'none';
  /** JSON-schema-ish; the Config Sheet's Display tab renders from this. */
  configSchema: Record<string, ConfigField>;
  /** Permissions implied by mounting it (shown as chips on the palette card). */
  requiredPermissions: string[];
  /** The actual component, lazy-loaded. */
  component: () => Promise<React.ComponentType<BlockProps>>;
}
```

Initial library — extracted from the receiving dissection, all are existing components
parameterized rather than new builds:

| Block | Extracted from | Slots | Notes |
|---|---|---|---|
| **Scan Bar** | `ReceivingUnboxScanBar` / `StationScanBar` | trigger | config: scan modes, lookup data source |
| **Import Feed** | `IncomingSidebarPanel` sync section | trigger | config: source + sync cadence |
| **Rail Feed** | `ReceivingRecentRail` / `ReceivingScannedRail` | queue | config: source, sort (priority/recent), row chip set |
| **Checklist** | new, thin — list + check/act affordances | queue | the driving example; variants in §4 |
| **Grouped Table** | `ReceivingLinesTable` (post God-component split) | workspace | history-style main table |
| **Condition Step** | `ActiveLineConditionSerial` | workspace | |
| **Serial Scan Step** | `ActiveLineConditionSerial` | workspace | |
| **Photo Step** | `ReceivingPhotoButton` + `PhotosCard` + NAS attach | workspace | |
| **Print Step** | `LineLabelPreviewCard` | workspace | |
| **Notes Step** | `LineNotesCard` | workspace | |
| **Advance Bar** | `LineReceiveActionBar` | advance | config: action + target workflow stage |

### 2.2 Data-source registry — `src/lib/stations/data-sources.ts`

```ts
export interface DataSourceDefinition {
  id: string;                          // 'po_gmail.unmatched_emails'
  label: string;                       // 'Unmatched PO emails (Gmail)'
  integration: string;                 // 'po-gmail' | 'zoho' | 'receiving' | 'carrier'…
  endpoint: string;                    // existing GET route it wraps
  shape: FieldDef[];                   // [{key:'extracted_po_number', label:'PO #', kind:'po_ref'}…]
  filters?: FilterDef[];               // user-tunable in the Source tab (date range, status…)
  realtime?: { ablyChannel?: string }; // live invalidation if available
}
```

"Filter and pull PO# from the emails" lives **here**, not in the block: the po-gmail pile
already extracts PO candidates server-side (`/api/admin/po-gmail/*`); the data source simply
declares `extracted_po_number` as a field with kind `po_ref`. Field kinds are what make
binding smart — a field of kind `po_ref` automatically gets the PO-popover renderer and makes
PO-scoped actions available; `tracking_ref` gets the carrier chip; `timestamp` gets the
relative-time renderer. (Same philosophy as the chip/tone registries in
`copy-chip-format.ts` / `receiving-constants.ts` — one renderer per semantic kind.)

### 2.3 Action registry — `src/lib/stations/actions.ts`

```ts
export interface ActionDefinition {
  id: string;                          // 'incoming.attach_tracking'
  label: string;                       // 'Attach tracking'
  icon: string;
  endpoint: { method: 'POST'|'PATCH'|'DELETE'; path: string };  // existing route
  permission: string;                  // existing permission-registry key
  appliesTo: FieldKind[];              // ['po_ref'] → only offered when source has a PO field
  confirm?: 'none' | 'soft' | 'step_up';  // step_up reuses the existing PIN/passkey flow
}
```

Actions are thin descriptors over **existing API routes** — never new business logic. The
Config Sheet's Actions tab is just "all registered actions whose `appliesTo` intersects the
bound source's field kinds, filtered to ones the *editing* admin may grant."

### 2.4 Config store — `station_definitions` (new table)

```ts
export const stationDefinitions = pgTable('station_definitions', {
  id: serial('id').primaryKey(),
  organizationId: uuid('organization_id').notNull(),
  pageKey: text('page_key').notNull(),       // 'receiving'
  modeKey: text('mode_key').notNull(),       // 'incoming' — one row per sidebar mode
  label: text('label').notNull(),
  workflowNodeId: text('workflow_node_id'),  // optional tie to the process graph
  config: jsonb('config').notNull(),         // ordered slots → block instances → bindings
  version: integer('version').notNull().default(1),
  isActive: boolean('is_active').notNull().default(false),
  updatedBy: integer('updated_by'),
  updatedAt: timestamp('updated_at').defaultNow(),
});
```

`config` example (the driving checklist):

```jsonc
{
  "slots": {
    "queue": [
      {
        "block": "checklist",
        "id": "blk_8f2",
        "source": {
          "id": "po_gmail.unmatched_emails",
          "filters": { "age": "30d", "has_po_candidate": true },
          "fields": { "title": "subject", "ref": "extracted_po_number", "meta": "from" }
        },
        "display": { "variant": "check_act", "group_by": null, "sort": "newest" },
        "actions": ["incoming.attach_tracking", "incoming.open_po", "incoming.dismiss_email"],
        "done_when": "action:incoming.attach_tracking"   // what checks the item off
      }
    ]
  }
}
```

Versioning + `isActive` publish semantics copy `workflow_definitions` exactly. Editing
requires a new `stations.manage` permission; **viewing** a station renders only the blocks
whose `requiredPermissions` ∪ bound-action permissions the viewer holds — a staff member who
can't `receiving.mark_received` simply doesn't get the Advance Bar, which is how "one person
plans, one person combines" works with one shared definition.

---

## 3. The builder UX, end to end

### 3.1 Entering edit mode

A pencil toggle in the station header — deliberately the same affordance as the existing rail
edit-mode pencil, escalated one level (gated on `stations.manage`). The page stays **live**:
real data keeps rendering inside the blocks while slot outlines appear around them.

### 3.2 Layout in edit mode

```
┌──────────┬─────────────────────────────────────┬──────────────────────┐
│ SIDEBAR  │  RIGHT PANE (live workspace/table)  │  BLOCK PALETTE       │
│          │                                     │  (RightPaneOverlay)  │
│ ┌╌╌╌╌╌╌┐ │   ┌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐   │ ┌──────────────────┐ │
│ ┆TRIGGER┆ │   ┆ WORKSPACE slot              ┆   │ │ 🔍 search blocks │ │
│ ┆ Scan  ┆ │   ┆  [Condition][Serials]       ┆   │ ├──────────────────┤ │
│ ┆ Bar ⚙✕┆ │   ┆  [Photos][Print]   ⚙ reorder┆   │ │ TRIGGERS         │ │
│ └╌╌╌╌╌╌┘ │   └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘   │ │  ▤ Scan Bar      │ │
│ ┌╌╌╌╌╌╌┐ │                                     │ │  ▤ Import Feed   │ │
│ ┆QUEUE  ┆ │                                     │ │ LISTS            │ │
│ ┆ Rail  ┆ │                                     │ │  ▤ Rail Feed     │ │
│ ┆ Feed ⚙┆ │                                     │ │  ▤ Checklist ←drag │
│ ┆╔══════╗ │                                     │ │  ▤ Grouped Table │ │
│ ┆║ drop ║◄┼───── drag ─────────────────────────┼─│ WORKSPACE STEPS  │ │
│ ┆╚══════╝ │                                     │ │  ▤ Photos  ▤ …   │ │
│ └╌╌╌╌╌╌┘ │                                     │ │ each card shows: │ │
│ ┌╌╌╌╌╌╌┐ │                                     │ │ icon · name ·    │ │
│ ┆ADVANCE┆ │                                     │ │ perm chips       │ │
│ └╌╌╌╌╌╌┘ │                                     │ └──────────────────┘ │
│ [modes: Incoming·Receiving·Unbox·History·(+)]  │  [Save draft][Publish]│
└──────────┴─────────────────────────────────────┴──────────────────────┘
```

Mechanics (all existing deps):

- `DndContext` wraps the station in edit mode only. Palette cards are draggables with a
  `DragOverlay` ghost; slots are droppables; blocks within a slot are a `SortableContext`
  (reorder workspace steps by dragging — the stepper order *is* the array order).
- Slot compatibility enforced live: dragging Checklist highlights `queue` slots green and
  dims `trigger`/`advance`; an invalid drop animates back.
- The **mode strip** is itself a drop target: dropping a list-block onto `(+)` creates a new
  sidebar mode (a fresh `station_definitions` row) — "mounting it to the sidebar" literally.
- Every mounted block gets a hover toolbar: ⚙ (reopen Config Sheet) · ✕ (remove) · ⠿ (drag
  handle). Keyboard fallback: an "Add block" button per slot opens the palette as a command
  list — same registry, no drag required.

### 3.3 The Config Sheet (opens on drop, and on ⚙)

A right overlay (reuse `RightPaneOverlay`) with three tabs. **Nothing in it is bespoke per
block** — it renders entirely from the three registries:

**① Source** — pick a data source (grouped by integration, filtered to shapes the block
`accepts`). Then two generated sections:
  - *Filters:* the source's declared `filters` (e.g. `has_po_candidate`, age window).
    This is the "filter… from the emails" knob.
  - *Field mapping:* the block declares the roles it needs (Checklist: `title`, `ref`,
    `meta`); each role is a dropdown of the source's fields, pre-filled by kind matching
    (`ref` auto-selects the `po_ref` field — the "pull PO#" knob). A live preview row renders
    underneath using real data.

**② Display** — generated from the block's `configSchema`. For Checklist: variant
  (`check_only` simple tick · `check_act` tick requires an action · `check_assign` tick +
  claims ownership), grouping, sort, empty-state text, badge/chip set per field kind.

**③ Actions** — checkbox list of compatible registered actions, each showing its permission
  chip; plus a `done_when` selector (which action, or a manual tick, marks the row complete).
  Selecting an action the current roles can't use surfaces an inline warning with a link to
  the staff-access editor — the builder never silently grants permissions.

Footer: **Save draft** (version bump, `isActive=false`) · **Publish** (flips `isActive`;
in-flight users pick it up on next nav, mirroring workflow-definition versioning).

### 3.4 The driving example, walked through

Goal: *"checklist on Incoming: filter PO emails, pull the PO#, attach tracking."*

1. Open Receiving → Incoming mode → pencil → edit mode. Palette opens on the right.
2. Drag **Checklist** from LISTS into the sidebar `queue` slot, below the existing incoming
   list (or onto `(+)` to make it its own "To-Do" mode).
3. Config Sheet → **Source**: choose `Unmatched PO emails (Gmail)`. Filters: `has PO
   candidate = yes`, `age ≤ 30d`. Mapping auto-fills: title←subject, ref←extracted PO#,
   meta←sender. Preview shows three real emails.
4. **Display**: variant `check_act`, sort newest-first.
5. **Actions**: tick `Attach tracking` (opens the existing attach-tracking popover with
   `presetPo` from the bound `po_ref` — exactly the hook the incoming-tracking-todo plan
   specified), `Open PO`, `Dismiss`. `done_when = Attach tracking`.
6. Publish. Staff with `receiving.view` see the checklist; the Attach button renders only
   for staff holding that action's permission. No deploy, no new route, no new component.

Tier 2 of the original todo plan ("POs still AWAITING_TRACKING") is the *same block again*,
bound to a `receiving.awaiting_tracking_pos` data source — which is the proof the
abstraction earns its keep: the second checklist costs one drag and four dropdowns.

---

## 4. How integrations plug in (the extensibility contract)

An integration contributes, via one `register*()` file imported at startup (same
side-effect-import pattern as `src/lib/workflow/index.ts`):

1. **Data sources** — wrapping its existing GET routes with a declared field shape.
2. **Actions** — wrapping its existing mutations with permission + `appliesTo` kinds.
3. *(Rarely)* a bespoke **block**, only when generic list/table/step blocks genuinely can't
   render it (e.g. the warehouse map). Bias hard against this; the palette growing slowly is
   a feature.

The palette's INTEGRATIONS group is therefore emergent: install/build the Square sidecar →
its sources and actions appear in every Config Sheet's dropdowns automatically. This is the
same "registry meta drives the UI, the canvas never hard-codes node types" rule the node
engine already established — applied to station UI.

---

## 5. Guardrails (lessons pre-applied)

- **Blocks are code, composition is data.** No formula language, no arbitrary fetch URLs in
  config, no user-defined JS. If a need can't be expressed as source+mapping+actions, it's a
  new registered block/source — a PR, on purpose.
- **Actions never bypass auth.** They call existing `withAuth`-wrapped routes; the builder
  only *selects* among them. `step_up` confirm levels carry through unchanged.
- **The escape hatch is explicit.** Existing bespoke panes (Electron Zoho pane, pickup mode)
  stay hard-coded; a station definition may declare `"slots": "legacy"` to mean "render the
  original component tree". Migrate modes one at a time; never block on full coverage.
- **Don't fork label systems.** Field-kind renderers must delegate to the existing SoTs
  (`conditions.ts`, `source-platform.ts`, chip registries) — the builder is a consumer of
  those registries, never a second copy.

---

## 6. Phasing

| Phase | Work | Size | Depends on |
|---|---|---|---|
| **S1. Registries + renderer** | Block/source/action registries; `station_definitions` table; generic `StationPage` that renders a config; re-express **Incoming** mode as the pilot definition (legacy fallback for the rest) | ~5–7d | God-component hook extraction for the blocks being registered (already on the cleanup track) |
| **S2. Checklist vertical slice** | Checklist block (3 variants) + `po_gmail.unmatched_emails` + `receiving.awaiting_tracking_pos` sources + attach/dismiss actions → ships the incoming-tracking-todo feature *through* the system | ~3–4d | S1 |
| **S3. Builder edit mode** | Pencil → DndContext + palette (RightPaneOverlay) + slot drop zones + Config Sheet (Source/Display/Actions) + draft/publish | ~5–7d | S1; S2 as the demo case |
| **S4. Mode creation + per-staff views** | `(+)` drop target → new mode rows; permission-filtered block rendering; staff-access editor link-through | ~3–4d | S3 |
| **S5. Graph tie-in** | `workflowNodeId` linkage: clicking a node on the Operations board opens its station; node config panel embeds the station's Config Sheet (converges with `NODE_UI_PLAN.md` §4) | ~3–5d | S3 + node UI plan resumption |

S1+S2 deliver user-visible value (the email checklist) even if the drag-and-drop builder
(S3) were never built — the same de-risking shape as the node plan's read-only Phase 1.

---

*Companion docs: `NODE_WORKFLOW_ARCHITECTURE.md` (process graph), `NODE_UI_PLAN.md` (editable
canvas), `incoming-tracking-todo-plan.md` (the feature S2 reproduces), `god-component`
cleanup memory (the refactor track S1 rides on).*
