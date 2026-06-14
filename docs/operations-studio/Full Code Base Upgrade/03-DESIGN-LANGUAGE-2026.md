# Design Language — Notion × Linear, Icons-First, 2026

> The visual + interaction language for the Studio and the modular system. It
> **extends the existing design system** (`src/design-system/`) — it does not
> restyle from scratch. The goal: a calm, dense, keyboard-first, icons-first
> enterprise surface that reads like Notion and moves like Linear.

---

## 0. Principles

1. **Calm, not loud.** Restrained color, generous neutrals, one accent. Color carries
   *meaning* (status, severity), never decoration.
2. **Icons-first.** Every row, node, block, action, and nav entry leads with one
   consistent icon. One concept → one icon, forever (resolved from
   `src/components/Icons.tsx`).
3. **Density is a choice.** Default to comfortable; offer a compact density for
   power users (Linear-style). Spacing comes from tokens, never magic numbers.
4. **Keyboard-first.** Everything reachable without the mouse; `cmd-k` is the front
   door.
5. **Motion is feedback, not decoration.** Spring physics for state changes; respect
   `prefers-reduced-motion`.
6. **Tokens are law.** No hardcoded hex, z-index, or spacing. Theme is data.

---

## 1. Build on what exists (do not reinvent)

| Need | Use | Path |
|---|---|---|
| Color / spacing / radii / shadows / borders | tokens | `src/design-system/tokens/` |
| **Z-index** | the named scale SoT (`z-panel/z-modal/z-panelPopover/z-toast/z-tooltip`) | `src/design-system/tokens/z-index.ts` |
| Buttons | canonical `Button` (5 variants); `PrimaryButton` is an alias | `src/design-system/primitives/Button.tsx` |
| Icon buttons, empty states, cards, fields | primitives | `src/design-system/primitives/` |
| Motion presets | framer spring presets | `src/design-system/foundations/motion-framer.ts`, `motion.ts` |
| Icon set | lucide-based registry | `src/components/Icons.tsx` |
| Label SoTs | grade / platform / serial | `conditions.ts`, `source-platform.ts`, `copy-chip-format.ts` |
| Reference adoption plan | the 2026 modernization plan | `docs/design-system/2026-component-adoption-plan.md` |

> Rule of thumb: if you're reaching for a raw hex, a `z-[999]`, or a hand-rolled
> `<button className="...">`, stop — there is a token or primitive for it.

---

## 2. Color & tone

- **Neutrals do the work.** The Studio chrome is slate/white (as `StudioShell`
  already uses): `bg-slate-50` canvas, `bg-white` panels, `border-slate-200`.
- **One accent — blue** — for selection/active (matches the master-nav active row
  `bg-blue-600`).
- **Semantic tones, from tokens, mapped to meaning:**
  | Tone | Meaning | Where |
  |---|---|---|
  | blue | active / selected / in-flight | selection, Live counts |
  | amber | draft / warning | draft badge, `warning` diagnostics |
  | emerald | publish / success / healthy | Publish button, on-SLA |
  | rose | error / blocked | `error` diagnostics, blocked units |
  | slate | neutral / idle | static map, empty nodes |
- **Dark mode** is a token swap (`tokens/colors` + `css-variables.ts`), never a
  parallel stylesheet. Author components against semantic token names, not literal
  colors.

---

## 3. Typography

- One type scale, tabular numerals for all counts/metrics (`tabular-nums`, as the
  nav mode-count already uses).
- Tight, confident headings (`tracking-tight`, `font-bold`); muted secondary text
  (`text-slate-400/500`).
- Studio-proven sizes to standardize as tokens: title `text-sm font-bold`, meta
  `text-[11px]`, micro-labels `text-[10px] uppercase tracking-widest` (already the
  master-nav group-heading style). Promote these to named tokens so they're reused,
  not re-typed.

---

## 4. Iconography (icons-first)

- **One registry:** `src/components/Icons.tsx`. Adding a concept = adding an icon
  there; components import from it, never inline an SVG.
- **One icon per concept, system-wide.** A node category, a block type, a nav page, a
  data source, an action each carry a stable lucide icon name (the engine and station
  contracts already store `icon: string` — `NodeDefinition.icon`,
  `BlockDefinition.icon`, `ActionDefinition.icon`). The canvas/inspector resolve the
  name → component.
- **Sizing scale:** 14px (inline/meta), 16px (rows), 18px (nav), 20px (node headers).
  Standardize as tokens; the master-nav already uses `h-[18px]`/`h-4`.
- **Icon-first rows:** `[icon] [label] … [meta/affordance]` — the master-nav row and
  `RowMetaColumns` primitive are the reference pattern.

---

## 5. Layout & surfaces

- **Three-pane Studio chassis** (already in `StudioShell`): Library (left, palette +
  Issues) · Canvas (center) · Inspector (right). Side panels are `border` +
  `bg-white`, scroll independently.
- **Inspectors over modals.** Editing happens in the right-hand Inspector / Config
  Sheet (L3), not in popups — this is the Linear/Notion pattern and the station
  builder's Config Sheet model.
- **Rounded, soft elevation:** `rounded-xl/2xl`, `shadow-sm` for resting, `shadow-xl`
  for floating (dropdown uses `shadow-xl shadow-slate-900/10`). Pull these into
  `tokens/shadows.ts` usage, not inline.
- **Gutters/bands:** reuse `SIDEBAR_GUTTER` and the 40px search band conventions so
  Studio chrome aligns with the rest of the app.

---

## 6. Keyboard-first & command palette

- **`cmd-k` command palette** is the front door: jump to any page (nav registry),
  drop any node (`listNodeMeta()`), add any block (block registry), switch lens, pin a
  version. `src/components/CommandBar.tsx` already consumes the nav registry — extend
  it to the node/block palettes rather than building a second launcher.
- **Canvas shortcuts (Linear-grade):** `1`/`2` zoom L0/L1; `B`/`L`/`G` lens
  Build/Live/Gaps; `⌘S` save draft; `⌘↵` publish (then step-up); `/` focus search;
  `?` shortcut cheatsheet.
- Every interactive control has a `title`/`aria-*` (the shell already does) and a
  visible focus ring.

---

## 7. Motion

- **Spring, not ease.** Use the existing framer presets
  (`foundations/motion-framer.ts`); the nav already uses
  `{ stiffness: 520, damping: 36 }` (snappy) and `{ 320, 30 }` (soft). Standardize a
  named set: `snappy`, `soft`, `gentle`.
- **Purposeful only:** node enter/exit, panel expand/collapse, lens cross-fade, edge
  flow (Live). Layout animations must not thrash — animate `transform`/`opacity`.
- **Always** honor `prefers-reduced-motion` (drop to instant). The Motion skill /
  MotionScore can audit jank.

---

## 8. State coverage (production-grade)

Every surface must define all four states; use the primitives:

| State | Primitive |
|---|---|
| Empty | `primitives/EmptyState.tsx` (e.g. "No workflow yet — seed one") |
| Loading | `components/Skeletons.tsx` / `Spinner.tsx` (BootGate pattern for the page) |
| Error | inline rose text / `InlineNotice.tsx` |
| Populated | the real view |

The Studio already models empty ("No workflow definition yet"), loading ("Loading the
operations graph…"), and error states — match that bar everywhere.

---

## 9. The canvas aesthetic

- Nodes: rounded card, icon + label + category tint, output-port handles on the
  right (one per declared `NodeDefinition.output`). Numbered states show the circled
  digit from `studio-types.ts` `circledNumber()` reading `workflow-stages.ts` order.
- Edges: thin slate by default; **Live** lens animates flow + colors by health;
  **Gaps** lens highlights diagnosed nodes/edges in rose/amber.
- L0 map: large department group nodes, calm, read-only.
- Selection: blue ring + Inspector focus; never a modal.

---

## 10. Component standardization queue (after `Button`)

Promote/standardize next, in order (each replaces hand-rolled variants):

1. **`IconRow` / `ListRow`** — the icon-first row (generalize `RowMetaColumns`).
2. **`InspectorPanel` + `ConfigField` renderer** — schema-driven config (nodes +
   blocks share it).
3. **`CommandPalette`** — the `cmd-k` surface (from `CommandBar.tsx`).
4. **`StatPill` / `Badge`** — counts, draft/active, severity (unify `StatusBadge`,
   `StatusMicroLabel`, `PlatformBadge`).
5. **`Toolbar` / `SegmentedControl`** — the zoom + lens bars (Studio has bespoke ones;
   extract).
6. **Theme provider** — light/dark + density, reading `tokens/`.

_Part of the Full Code Base Upgrade spec — see README.md for the index._
