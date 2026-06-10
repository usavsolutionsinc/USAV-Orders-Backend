# Z-Index Consistency System — Plan & Reference

**Status:** Complete (2026-06-09). Foundation + full overlay/chrome migration + both primitives (`<Layer>`, `<AnchoredLayer>`) shipped. Portal-trap fixes done (anchored popovers portaled via `<AnchoredLayer>`; full-screen surfaces via `<Layer>`). Lint guard shipped. The few in-flow overlays that are intentional *local* stacking are documented as deliberate exceptions in §8.1.

**Owner SoT:** `src/design-system/tokens/z-index.ts` · **Memory:** `z-index-scale-sot`

---

## 1. Problem

Stacking order was managed ad-hoc across ~60 hand-rolled overlay components (the app uses almost no overlay libraries — only `@radix-ui/react-popover` ×2, `cmdk`, `sonner`). Symptoms found in the audit:

- **No shared scale in practice.** A `tokens/z-index.ts` existed but **nothing imported it**, and its numbers (`sticky:100…tooltip:700`) didn't match reality.
- **Tailwind's bare scale stops at `z-50`**, so the overlay layer was a sea of arbitrary values: `z-[100]`, `z-[120]`, `z-[2000]`, `z-[2147483647]`, inline `zIndex: 9999/99999/999999`, and a dynamic `200 + level*10`.
- **`z-50` was a junk drawer** — 43 occurrences mixing modals, dropdowns, drawers, backdrops, banners, and a sticky header at one number.
- **Latent bug:** centered modals/dialogs (admin, settings, QR overlays) sat at `z-50`, *below* slide-over detail panels (`z-[100]`) — a dialog opened over a panel rendered **behind** it.
- **Tribal knowledge in comments** (`"z-[120] keeps us above the FAB (z-40) and SwitchStaffSheet (z-80)"`) — exactly the fragile coupling a named scale removes.
- **Two parallel "max" hacks:** `z-[2147483647]` (tooltip) and inline `999999` (electron) with no shared ceiling.

---

## 2. Strategy

Adopt **one named scale whose numbers preserve the bands the codebase already converged on** (panel=100, modal=200, command=1000, splash=2000, tooltip=max). This was chosen over the cleaner `0–999` scheme from the original brief because:

- A pure renumber would collide with entrenched 100+ values during any partial migration and force a risky big-bang.
- Preserving numbers makes **every rename a layer-preserving no-op** — a file is safe to migrate at any time without ever inverting two layers.

**Global vs local principle.** Tokens are attached only to components in the **global** overlay/chrome layer (modals, popovers, dropdowns, tooltips, panels, drawers, backdrops, sticky headers, banners, toasts). Purely **local** in-flow stacking stays native Tailwind: `focus-visible:z-30` focus rings, table-corner buttons, `whileDrag zIndex:20` lifts, relative sibling-ordering, decorative masks, and dismiss-backdrops paired directly under their own dropdown. Tokenizing those would conflate local stacking contexts with the global system — the anti-pattern, not the fix.

---

## 3. Where the system lives

| Role | File |
|---|---|
| **Source of truth** — `zIndex` object + `ZIndexToken` type | `src/design-system/tokens/z-index.ts` |
| Barrel re-export (`import { zIndex } from '@/design-system/tokens'`) | `src/design-system/tokens/index.ts` |
| Tailwind class generation (`z-panel`, `z-modal`, …) | `tailwind.config.ts` → `extend.zIndex` |
| CSS variable emission (`--ds-zIndex-*`) | `src/design-system/tokens/css-variables.ts` |
| **Component primitive** — `<Layer>` + `useZIndex()` | `src/design-system/primitives/Layer.tsx` (barrel-exported from `@/design-system`) |
| **Anchored-popover primitive** — `<AnchoredLayer>` | `src/design-system/primitives/AnchoredLayer.tsx` (barrel-exported from `@/design-system`) |
| **Lint guard** — bans global-scale `z-[NN]` / inline `zIndex` | `eslint.config.mjs` (`no-restricted-syntax`) |

**Four ways to consume:**
1. Tailwind class: `className="z-modal"`
2. Import: `zIndex.modal` / `zIndex.panelPopover + 1`
3. CSS var: `var(--ds-zIndex-modal)`
4. Primitive: `<Layer level="modal" />` or `useZIndex('modal')`

---

## 4. The scale

| Token | # | Use |
|---|---|---|
| `base` | 0 | Default document flow |
| `raised` | 10 | In-flow elevation: raised cards, hover lifts |
| `sticky` | 30 | Sticky in-page chrome: filter bars, fixed sub-bands, bottom action bars |
| `header` | 40 | Sticky page/section headers (main app header band) |
| `dropdown` | 50 | Anchored menus/popovers/dropdowns in normal page flow (NOT over a panel) |
| `fab` | 90 | Toggle/FAB chrome above content, under panels |
| `panelBackdrop` | 99 | Scrim directly behind a slide-over panel |
| `panel` | 100 | Right-hand slide-over detail panels, mobile sidebar drawer |
| `panelPopover` | 120 | Popover/dialog launched from inside a panel — must clear `panel` |
| `panelOverlay` | 130 | Loaders / nested sheets stacked above a `panelPopover` |
| `modalBackdrop` | 190 | Scrim behind a centered modal / fullscreen surface |
| `modal` | 200 | Centered modals, fullscreen scanners, drawers |
| `elevatedModal` | 300 | Modal-over-modal (confirm on top of an open modal) |
| `banner` | 350 | Always-on system banners (offline / degraded state) |
| `command` | 1000 | Global command palette (cmdk) |
| `takeover` | 1200 | Full-bleed assignment / takeover overlays |
| `splash` | 2000 | Boot + auth-redirect splash that blocks the whole app |
| `toast` | 2050 | Toasts — above splashes, below only the tooltip ceiling |
| `tooltip` | 2147483647 | Absolute ceiling: copy/hover tooltips + electron window chrome |

**Same-band stacking** (backdrop + panel pairs): use `token + 1` (e.g. `zIndex.panelPopover + 1`, or `<Layer offset={1}>`), or rely on child-renders-above-parent for centered-modal patterns where the panel is a DOM child of the backdrop.

---

## 5. Migration mapping reference (value → token)

Use this table for any future stragglers or when reviewing diffs.

| Old value | Token | Old value | Token |
|---|---|---|---|
| `z-[90]` | `z-fab` | `z-[210]` | `z-modal` |
| `z-[99]` | `z-panelBackdrop` | `z-[300]` (modal) | `z-elevatedModal` |
| `z-[100]` | `z-panel` | `z-[300]` (banner) | `z-banner` |
| `z-[110]` `z-[111]` `z-[118]` `z-[120]` `z-[121]` | `z-panelPopover` | `z-[1000]` `z-[1001]` | `z-command` |
| `z-[130]` `z-[140]` | `z-panelOverlay` | `z-[1200]` `z-[1201]` | `z-takeover` |
| `z-[198]` `z-[200]` | `z-modal` | `z-[2000]` | `z-splash` |
| `z-[80]` `z-[81]` (modals) | `z-modal` | `z-[2147483647]` / inline `999999` | `z-tooltip` |
| `z-[60]` `z-[70]` (selects) | `z-dropdown` | inline `9999` (rail popover) | `zIndex.panelPopover` |
| bare `z-50` modal | `z-modal` | bare `z-50` dropdown | `z-dropdown` |
| bare `z-50` drawer / backdrop | `z-panel` / `z-panelBackdrop` | bare `z-50` banner | `z-banner` |
| bare `z-50` / `z-40` sticky header | `z-header` | bare `z-30` sub-band | `z-sticky` |

**Intentional exception:** `receiving/workspace/SerialCard.tsx` keeps `z-[100]` — an in-flow CSS hover tooltip, not part of the portal/overlay system.

---

## 6. What's done

- **Foundation:** rewrote `tokens/z-index.ts` (20 named tokens), wired `tailwind.config.ts extend.zIndex`, CSS vars auto-emit, `sonner` Toaster pinned to `zIndex.toast`.
- **Wave 1 — shared primitives:** `RightPaneOverlay`, `SlideOverBackdrop`, `BottomSheet` (`200+level*10` → `zIndex.modal + level*10`, with `level` clamped 0–9 so a stacked sheet can't climb into the `elevatedModal` band), `ViewDropdown`, the 2 Radix `Popover.Content` (`DateRangePickerField`, `PickupReportButton`).
- **Wave 2/3 — all arbitrary values:** ~50 files; every `z-[NNN]` and the 3 inline `zIndex` literals (`ElectronDragStrip` 999999→tooltip, `SidebarRailShell` 9999→panelPopover, `PhotoGallery` 99999→modal).
- **Bare standard classes:** the 43 `z-50` classified by role; `z-40`/`z-30` sticky headers/sub-bands → `z-header`/`z-sticky`. The latent modal-behind-panel bug fixed (admin/settings dialogs → `z-modal`).
- **Primitive:** `<Layer>` + `useZIndex()` created.

**Result:** 110+ tokenized occurrences across 15 classes; **zero** arbitrary `z-[NNN]` or stray inline z in the overlay/chrome layer. `tsc` clean; Tailwind verified emitting all tokens at correct values.

---

## 7. The `<Layer>` primitive

```tsx
import { Layer, useZIndex } from '@/design-system';

// Tokenized z + portal-to-body (escapes ancestor stacking-context traps):
<Layer level="modal" className="fixed inset-0 flex items-center justify-center">
  …dialog…
</Layer>

// Stack a panel one above its backdrop within a band:
<Layer level="panelPopover" offset={1} className="fixed inset-y-0 right-0">…</Layer>

// Inline / framer / canvas:
const z = useZIndex('panelPopover');
<motion.div style={{ zIndex: z }} />
```

- `portal` defaults **true** — the safe choice for any `fixed`/`absolute` overlay.
- Owns **no chrome** (no backdrop/scroll-lock/focus-trap/motion). Compose those in the caller, or use the higher-level `RightPaneOverlay` / `BottomSheet` for full modals.
- SSR-guarded (mounts portal target in `useEffect`).
- Forwards standard div attrs (`role`, `aria-*`, `onClick`, …) so a full-screen surface can *be* the `<Layer>` (`<Layer level="panelPopover" role="dialog" className="fixed inset-0 …">`).

---

## 7b. The `<AnchoredLayer>` primitive

The anchored sibling of `<Layer>` — for a popover/dropdown/menu positioned relative to a **trigger**. It portals to `<body>` (escaping ancestor stacking-context traps) AND pins to the trigger's rect, so a high z can't be trapped yet the panel still follows its button.

```tsx
import { AnchoredLayer } from '@/design-system';

const triggerRef = useRef<HTMLButtonElement>(null);
<button ref={triggerRef} onClick={() => setOpen(o => !o)} />
<AnchoredLayer open={open} onClose={() => setOpen(false)}
               anchorRef={triggerRef} placement="bottom-stretch">
  …menu…
</AnchoredLayer>
```

- **`placement`**: `bottom|top` × `start|end|stretch` (`start`=left-aligned, `end`=right-aligned, `stretch`=match trigger width). `gap` = px offset; `matchWidth` forces panel width = trigger width.
- **Rect tracking** modelled on `RightPaneOverlay`: `getBoundingClientRect` + `ResizeObserver` + capture-phase scroll/resize listeners.
- **Owns dismissal**: outside-click (mousedown outside *both* anchor and the portaled panel) + Escape — so callers delete their bespoke `rootRef.contains()` handlers, which can't see the portaled panel. `ignoreClickSelector` exempts nested portaled poppers (e.g. a Radix calendar inside the menu).
- Default `level` = `dropdown`. Renders only while `open` (popover *exit* animations snap rather than play — acceptable; enter animations still work).

---

## 8. Behavioral follow-ups — **DONE** (2026-06-09)

### 8.1 Portal-trap fixes ✅
The in-flow overlays that are part of the **global** overlay/chrome system were portaled:

- **Full-screen / centered → `<Layer>`:** `StationNasFoldersTab`, `FbaQuickAddFnskuModal`, `BinStockNumpadSheet`, `AdminDetailsStack`.
- **Anchored popovers → `<AnchoredLayer>`:** `FilterBar`, `FilterRefinementBar` (dim backdrop kept as a separate `<Layer>`; Radix calendar via `ignoreClickSelector`), `ViewDropdown`, `ZendeskSelect`, `AuditLogFilterStrip`, `InventorySidebarFilters`, `ShippedFilterToolbar`, `labels/unit-detail/popovers` (anchorRef threaded from `UnitDetailHeader`), `QuickAccessButton` (3 popovers), `GlobalHeaderActions` (4 popovers, 2 anchors), `HeaderGoalChip`.

**Intentionally NOT portaled — these are *local* stacking (per §2's global-vs-local principle), and routing them through a body portal would break layout/UX:**

| Component | Why it stays in-flow |
|---|---|
| `StickyActionBar`, `FloatingButton` | Split-button menus shown on **CSS `:hover`/`:focus-within`** — no open state. Portaling would force a JS hover-state rewrite + a cross-portal hover bridge (an anti-pattern for hover menus). The menu is a DOM sibling directly under its own trigger. |
| `FbaQtySplitPopover` | An **in-place overlay that covers its own sidebar row** (`absolute inset-x-0 top-0`), not a below-trigger popover — `AnchoredLayer`'s below/above placement doesn't model "cover this row". |
| `MasterNavView`, `MasterNavDropdown` | A sidebar-region panel **bounded to an `isolate` context** (`absolute inset-x-1 top-[40px] bottom-1`) whose definite top/bottom give the inner menu a height to scroll within the sidebar. The `isolate` is deliberate; portaling would lose the bounded geometry. |

### 8.2 Lint guard ✅
`eslint.config.mjs` gained `no-restricted-syntax` rules (scoped to `src/**/*.{ts,tsx}`, TS parser wired in) banning the **global-scale** offenders:
- Arbitrary `z-[NN]` (2+ digits) in `className` string + template literals — Tailwind's scale stops at `z-50`, so any multi-digit arbitrary value is an overlay number.
- Inline `zIndex: >= 50` literals (the scale's overlay bands start at `dropdown=50`).

Purely-local in-flow stacking is left alone: `z-[1]` decorative masks, `whileDrag zIndex: 20` lifts. The one documented exception (`SerialCard`'s in-flow hover tooltip, `z-[100]`) carries an inline `eslint-disable-next-line no-restricted-syntax`.

> Fixed a latent bug while wiring this: a recursive-glob string in the config's own JSDoc contained a `*/` that closed the block comment early, making `eslint.config.mjs` unparseable by Node ESM (`Unexpected token '*'`). Standalone `npx eslint` had been silently broken; it now runs.

### 8.3 FAB reclassification (optional, still deferred)
Two mobile FABs (`PhotoFab`, `m/rs/[id]` FAB) sit at `z-30` (local). If they should float above sticky headers, lift to `z-fab` (90). Currently left as-is to avoid behavior change.

---

## 9. Edge cases & testing

- **Stacking-context traps** are the #1 gotcha — a parent with `transform`/`opacity<1`/`filter`/`backdrop-blur` traps a non-portaled child regardless of z. Fix = portal (`<Layer>`), not a higher number.
- **Nested `BottomSheet`** — `level` clamped 0–9 so it can't bleed into `elevatedModal` (300).
- **SSR (App Router)** — `createPortal` guarded by a client-mounted target (baked into `Layer`).
- **Dark mode** — z is theme-independent; just verify `backdrop-blur` scrims read in both themes.
- **Mobile** — fullscreen scanners (`z-modal`) must stay above the bottom nav (`z-panel`); preserved.
- **Third-party** — only `sonner` (pinned to `z-toast`) and Radix (inherits the class) inject z.

**Verification per change:**
```bash
# typecheck
npx tsc --noEmit -p tsconfig.json
# confirm no arbitrary/inline z re-introduced in the overlay layer
rg -n 'z-\[[0-9]{2,}\]|zIndex:\s*[0-9]{3,}' src --glob '*.tsx' --glob '*.ts'
# confirm a class emits (Tailwind must rebuild to generate named classes)
npm run build
```
**Smoke test (top→bottom order):** open a detail panel → open a dropdown inside it → fire a toast → ⌘K palette. Expected: `tooltip > toast > splash > takeover > command > elevatedModal > modal > panelOverlay > panelPopover > panel`.

---

## 10. Quick reference — do / don't

- **Do** pick the closest token; for in-band stacking use `+1` / `<Layer offset>`.
- **Do** wrap new overlays in `<Layer>` (portals by default).
- **Don't** hardcode `z-[NNN]` or inline numeric `zIndex` outside the token file.
- **Don't** tokenize purely-local in-flow z (focus rings, table-cell controls, drag lifts, relative columns) — that conflates local and global stacking.
- **Don't** "fix" a hidden popover by raising its z — check for an ancestor stacking-context trap and portal it instead.
