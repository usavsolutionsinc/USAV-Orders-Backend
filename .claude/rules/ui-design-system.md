# UI / design-system conventions

The house style is **simple, linear, icon-based, contextual** (Notion-like). These conventions recur across the
sidebar rails, triage panels, inspectors, and modals. Reuse them — don't reinvent layout per feature.

## Compose rails; never rebuild rail infrastructure

- `SidebarRailShell<TRow>` (`src/components/sidebar/SidebarRailShell.tsx`) owns everything infrastructural:
  fetch + `queryKey`, optimistic `updateEvent`/`deleteEvent`/`deleteGroupEvent` listeners, selection, pinning,
  `topCount` vs `limit`, collapse-grouping, `visibleIndices` keyboard nav, chevron `navigateEvent`, stagger reveal.
- A thin domain wrapper supplies only the renderers. `RecentActivityRailBase`
  (`src/components/sidebar/receiving/RecentActivityRailBase.tsx`) is the reference: it passes `renderRowMain`,
  `renderPopover`, `getStatusDot`, `getStatusDotLabel`. All 5 receiving/testing rails wrap it with minimal per-rail logic.
- New rail → wrap `RecentActivityRailBase`/`SidebarRailShell`, don't fork a new list component.

## Linear vertical scaffold — no grids

- Panels, modals, inspectors, lists stack vertically: `space-y-{1|2|3|4}` for sections, or `divide-y` for row lists
  (dividers, not gaps). Scroll region is `flex-1 overflow-y-auto`; sticky header/footer use a `border-t` rule.
- Field group = label above, value below: `<div className="space-y-1"><p class="text-[10px] font-black uppercase">…</p>{value}</div>`.

## One row anatomy

- Left-aligned, content order: **title → meta → chips(right)**. Do not center or `flex-1`-stretch row content.
  - Title: `truncate text-caption font-bold text-gray-900`.
  - Meta: `truncate text-eyebrow font-semibold uppercase tracking-widest text-gray-500`.
- **Selection is background + ring only, never a size/height shift.** Keep row content identical across states:
  - selected: `bg-blue-50 ring-1 ring-inset ring-blue-400`
  - focused (no click): `bg-gray-50 ring-1 ring-inset ring-gray-200`
  - default: `hover:bg-gray-50`; constant `py-1.5`.

## Eyebrow headers + chips (micro-typography scale)

- Section/rail header = an eyebrow: `text-eyebrow font-black uppercase tracking-widest text-gray-500`, optional
  right action slot. Use `leading-none` on suffixes so they don't inflate row height.
- Action buttons in a header bleed their hit-box with negative margin (`-my-0.5` / `-my-1.5`), they don't grow the row.
- Chip/badge = 3 layers: `rounded {bg-x-50} {text-x-700} ring-1 ring-inset {ring-x-200} px-1.5 py-0.5
  text-[8.5px|9px|10px] font-black uppercase tracking-widest`. Pills (`rounded-full`) drop vertical padding to keep row height.

## Contextual info via HoverTooltip — not `title=`

- Use `HoverTooltip` (`src/components/ui/HoverTooltip.tsx`) for any label/explanation: it renders in a body portal,
  positions off-screen then clamps to the viewport, so it is never clipped by a scrolling sidebar.
- Pass `focusable={false}` when the tooltip wraps something already inside a focusable row/button.
- Status indicator = a small dot (`h-2 w-2 rounded-full {semantic color}`) wrapped in `HoverTooltip` for its label.

## Icons: structural and paired, never decorative

- Import from `@/components/Icons`. Always pair an icon with text (e.g. `<Check className="h-3.5 w-3.5"/> Resolve`),
  except the status dot.
- Size by context: row dot `h-2 w-2` · field/inline `h-3.5 w-3.5` · button/loader `h-4 w-4` (`Loader2 animate-spin`).

## Color only from semantic tokens

- Source: `src/design-system/tokens/colors/semantic.ts` (+ CSS vars in `src/styles/globals.css`). No hardcoded hex,
  no arbitrary Tailwind shades. (Existing hardcoded colors, e.g. in `KpiDetailsModal`, are tech debt — don't copy them.)
- Status dots/tones derive from the lifecycle registry (`workflowStageDot(status)`), not ad-hoc choices.
- Pick `gray-` **or** `slate-` per feature and stay consistent (studio panels use `slate-`).

## Async / empty / error states

- Loading = spinner + text: `<Loader2 className="h-4 w-4 animate-spin" /> Loading…`.
- Error/empty = dashed bordered box, centered: `rounded-xl border border-dashed {border-rose-200|border-gray-200}
  {bg-rose-50|bg-gray-50} px-4 py-6 text-center`.
