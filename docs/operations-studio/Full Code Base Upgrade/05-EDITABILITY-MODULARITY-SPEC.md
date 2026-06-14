# Editability & Modularity Spec — Everything as Data

> How pages, modes, tabs, columns, panels, flows, and nav become **editable inside
> Studio** — incrementally, safely, and without rewriting the app. The thesis:
> **blocks/nodes stay code; composition/config becomes data.**

---

## 1. The pattern to generalize (you already built it once)

Three things in the repo already prove the model:

| Thing | Code | Data | Storage |
|---|---|---|---|
| Workflow graph | `NodeDefinition` (`workflow/contract.ts`) | nodes/edges/config | `workflow_definitions` / `workflow_nodes` |
| Station UI | `BlockDefinition` + source/action (`stations/contract.ts`) | slot composition + bindings | `station_definitions.config` |
| Admin sections | `ADMIN_SECTION_OPTIONS` | `?section=` selection | code (partial) |

Each editable thing is **addressable + versioned**: stable id, `version`,
`is_active`, draft lifecycle. **Generalize this exact shape** to pages and nav — do
not invent a second versioning scheme. (See `02-URL-VERSIONING-AND-ADDRESSING.md`.)

---

## 2. The layers of "editable"

```
nav            ← which pages exist, grouped, with which modes      (nav_definitions, NEW)
 └ page        ← a page mode's layout: regions + blocks            (page_definitions, NEW)
    └ block    ← a list/checklist/scan/workspace piece             (stations registries, EXISTS)
       └ binding ← source filters · field mapping · actions · display (station config, EXISTS)
flow           ← how units route between process steps             (workflow_definitions, EXISTS)
 └ node        ← one process step (thin adapter over src/lib/*)     (workflow registry, EXISTS)
```

Two of these layers (block, node) already exist as data. The upgrade adds **page**
and **nav** as data on the same pattern.

---

## 3. Pages-as-data (the big one)

Today a page mode is a hard-coded React tree (e.g. `/receiving?mode=triage`).
Target: a page mode is a **`page_definitions` row** describing regions and the blocks
in them, rendered by a generic `PageRenderer`.

### Proposed `page_definitions` (copy `workflow_definitions` exactly)

```
page_definitions
  id, organization_id
  page_key   (e.g. 'receiving'),  mode_key (e.g. 'triage')
  label
  config jsonb   -- { regions: { header[], sidebar[], main[], inspector[] } of BlockInstanceConfig }
  version int,   is_active bool,   updated_by,  updated_at
  UNIQUE (organization_id, page_key, mode_key, version)
```

This is **identical** to `station_definitions` (which already has
`page_key`/`mode_key`) — in fact a station *is* a page region. Decide early whether
pages are a superset of stations or a sibling table; the cleanest path is: a page
mode references one or more station regions, reusing `station_definitions` for the
work surfaces and adding only the region/layout wrapper.

### The `'legacy'` escape hatch is the migration engine

`StationConfig.slots` already supports `'legacy'`: render the original hard-coded
component tree for a mode. Apply the same to pages:

```ts
type PageConfig = { regions: Record<RegionId, BlockInstanceConfig[]> } | 'legacy'
```

So a page mode is either composed-from-data or falls back to today's code.
**Migrate one mode at a time**, lowest-risk first, flipping `'legacy'` → composed
only when the data version reaches parity. No big-bang rewrite.

### Render path

```
PageRenderer(page_key, mode_key)
  → load active page_definitions row (or 'legacy' → existing component)
  → for each region, render its BlockInstanceConfig[] via the block registry
  → blocks receive rows from their bound DataSourceDefinition (existing GET routes)
  → actions fire via bound ActionDefinition (existing mutation routes)
```

Blocks never fetch (`BlockProps` contract); the renderer wires sources → blocks. This
is the station builder, widened from "a station mode" to "any page mode."

---

## 4. Nav-as-data

`src/lib/sidebar-navigation.ts` is already pure data + pure functions — it's one step
from being a versioned definition. Two options:

- **Lightweight:** keep `sidebar-navigation.ts` as the *default* nav, add an optional
  per-org `nav_definitions` override row (same versioned shape) that the nav loader
  merges over the defaults. Studio edits the override.
- **Full:** move the seed into a definition row and edit it entirely in Studio.

Either way: page rows (`kind`, `icon`, `requires`, `href`), groups (Main/Stations/
More), and modes (`to()`/`resolveMode()` contracts) become editable data, gated by
`studio.manage`. **The Studio tab itself is already `kind:'bottom'` (More)** —
nav-as-data just lets the owner re-group it without a code edit.

---

## 5. The Studio editor surfaces (where editing happens)

Reuse the existing semantic zoom — no new pages:

| Zoom | Edits | Surface |
|---|---|---|
| **L0** | (read-only business map) | aggregate group nodes |
| **L1** | the flow graph: add/wire/configure nodes | canvas + Inspector |
| **L2** | a node's bound **station/page region**: arrange blocks in slots | Inspector hosts the station/page builder |
| **L3** | one **block binding**: source filters, field mapping, actions, display | Config Sheet (schema-driven from `ConfigField`/`FilterDef`/`BlockRole`) |

All edits are draft-scoped; Save draft → Publish (diagnostics-gated, step-up). The
Issues rail re-lints on every change.

---

## 6. Permissions & edit-mode gating

- **View** anything modular: `studio.view`.
- **Edit/publish**: `studio.manage` (+ step-up on publish).
- A block/source/action only renders for users holding its declared `permission` /
  `requiredPermissions` (already in the contracts) — so a composed page is **safe by
  construction**: you can't wire a surface a viewer isn't allowed to see.
- Edit mode is a **gate**, never stored as data. Permission taxonomy stays in
  `permission-registry.ts` (code); changes pair with the manifest test.

---

## 7. Diagnostics extend to pages

`runDiagnostics` (`workflow/diagnostics.ts`) currently lints the graph. Widen the rule
set so composition gaps surface the same way (Issues rail + Gaps lens, `error` blocks
publish):

- Block bound to a source the page's viewers lack permission for → `warning`.
- Required `BlockRole` left unmapped → `error`.
- Region empty in a mode that needs a trigger/queue → `warning`.
- Action referencing a removed route/permission → `error`.
- Node with no path to a terminal → `error` (already the kind of rule it does).

No one-off banners — every "this is misconfigured" is a `Diagnostic`.

---

## 8. "How to add a new modular X" recipes

> The whole point of registries: adding capability is a small, typed, PR-reviewed
> change — then it's available to compose in Studio with zero further UI code.

| Add a… | Do this | Skill |
|---|---|---|
| **Node type** (process step) | Register a `NodeDefinition` in `workflow/registry.ts`; `run` delegates to an existing `src/lib/*` module; declare `outputs[]` + `configSchema`. | `/workflow-node` |
| **Block** (UI piece) | Register a `BlockDefinition` (slots, accepts, roles, configSchema, lazy component) in `stations/blocks/`. | `/station-block` |
| **Data source** | Register a `DataSourceDefinition` wrapping an **existing GET route** (`endpoint`+`buildUrl`+`parse`, `permission`, `realtime.ablyChannel?`). | `/station-block` |
| **Action** | Register an `ActionDefinition` wrapping an **existing mutation route** (`endpoint`, `appliesTo`, `permission`, `confirm`). | `/station-block` |
| **Page mode** | Add a `page_definitions` row (or extend `station_definitions`); compose blocks into regions; leave `'legacy'` until parity. | this spec |
| **Nav entry** | Add to `sidebar-navigation.ts` (or the `nav_definitions` override) with `kind`/`icon`/`requires` and `to()`/`resolveMode()`. | `/sidebar-mode` |
| **Lens** (new view of the graph) | Add a render layer in the Studio canvas; never a new route. | `ops-studio` skill |
| **Diagnostic** (new gap warning) | Add a rule to `workflow/diagnostics.ts` returning a `Diagnostic`. | `ops-studio` skill |

---

## 9. Migration sequencing (incremental, safe)

1. **Receiving Incoming** is already the station-builder pilot — finish it (dnd drag,
   attach-tracking action) as the reference composed mode.
2. Pick the **next-lowest-risk mode** (a read-mostly list, e.g. a History or Pulse
   view) and compose it; keep everything else `'legacy'`.
3. Add `page_definitions` + `PageRenderer` once two station regions exist that need a
   layout wrapper.
4. Add `nav_definitions` override only after pages-as-data proves out.
5. Each step ships behind a flag and a `'legacy'` fallback; rollback = re-publish the
   prior version or flip back to `'legacy'`.

### Definition of done (modularity)

- [ ] A new node/block/source/action is composable in Studio with **zero new UI code**.
- [ ] At least one **page mode** renders from data with `'legacy'` fallback intact for the rest.
- [ ] Composition gaps surface as **diagnostics**, not banners; `error` blocks publish.
- [ ] Every editable thing is **versioned + addressable** (`?v=`); rollback is one publish.
- [ ] No route renamed; no active version mutated in place.

_Part of the Full Code Base Upgrade spec — see README.md for the index._
