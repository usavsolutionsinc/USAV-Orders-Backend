# Motion / crossfade engine — the transition law for every archetype

The single cross-cutting motion law shared by all four display archetypes (Station, Workbench, Monitor, Canvas).
Names the canonical crossfade recipe, the per-archetype crossfade *target*, the spring-vs-tween division, and the
reduced-motion mandate — all keyed to the real presets in `src/design-system/foundations/motion-framer.ts` and the
reduced-motion bridge in `src/design-system/foundations/motion-framer-hooks.ts`. The canonical workbench-pane preset is
in place; one residual reduced-motion adoption gap is flagged inline.

**Inherits:** `../ui-design-system.md` (scaffold, row anatomy, chips, color tokens). This doc is motion only — it does
**not** restate the house scaffold.

---

## The transition law, in one paragraph

**Animate `opacity` + a small `transform` (`x`/`y`/`scale`) only; never animate layout (`width`/`height`/`padding`).**
GPU-composited properties (opacity, transform) don't trigger reflow, so a crossfade stays at 60 fps under load while a
height/width tween thrashes layout. For height changes use `grid-template-rows` (or Framer's `height: 'auto'` *only* on
low-frequency expand/collapse, e.g. `framerPresence.collapseHeight`), never an animated box you also crossfade.
**Swap one keyed entity for another with `AnimatePresence mode="wait"`, `initial={false}` so the first paint doesn't
animate, and a stable key** (entity id / `skuId` — *never* an array index). The previous element exits, then the next
enters; never two on screen at once. Durations are **sub-300ms, ease-out by default** (`motionBezier.easeOut` =
`[0.22, 1, 0.36, 1]`).

> Rule of thumb: if a transition touches `width`, `height`, `top`, `left`, or `padding`, it is wrong. Re-express it as
> opacity + transform, or as `grid-template-rows` for height. Layout animation is the #1 source of jank here.

---

## Canonical crossfade recipe (the 7 steps)

The reference is the Station active card (`framerPresence.stationCard` + `framerTransition.stationCardMount`) and the
workbench right pane (`ReceivingRightPane.tsx`). Every archetype's crossfade is this same 7-step shape:

1. **Wrap the swapping region in `<AnimatePresence mode="wait" initial={false}>`.** `mode="wait"` = exit completes
   before enter starts (no overlap); `initial={false}` = the first-ever mount is instant, not animated.
2. **Key the inner `motion.*` by the entity identity** — `key={activeOrder.tracking}` (StationPacking),
   `key={`workspace-${workspace.row.id}`}` (ReceivingRightPane). A changed key is what triggers the exit→enter swap.
3. **`initial` = entered-from offset:** `{ opacity: 0, y: 8 }` (station card) / `{ opacity: 0, y: 6 }` (right pane).
4. **`animate` = rest:** `{ opacity: 1, y: 0 }`.
5. **`exit` = leave-toward offset, opposite sign and smaller:** `{ opacity: 0, y: -6 }` (station) so the old card lifts
   up and out while the new one rises in. Asymmetric in/out is intentional — it reads as forward motion.
6. **`transition` = a named tween preset:** `framerTransition.stationCardMount` (`0.26s`, `easeOut`) for the station
   card; `framerTransition.workbenchPaneMount` (`0.18s`, `easeOut`) for the workbench / Monitor right pane.
7. **Route the whole thing through the reduced-motion bridge** (`useMotionPresence` / `useMotionTransition`) so steps
   3–6 collapse to pure opacity when requested. `ReceivingRightPane` is the reference — it consumes
   `framerPresence.workbenchPane` + `framerTransition.workbenchPaneMount` through the hooks, with **no inline
   `prefersReducedMotion` ternary.**

The horizontal-swipe variant (mobile tab pager) is `tabPagerVariants` + `framerTransition.tabPager`, with its own
reduced fallback `framerTransition.tabPagerReduced` already baked in — copy that pattern for any directional pager.

---

## Per-archetype crossfade TARGET

The recipe is shared; **what** crossfades is archetype-specific and **singular**. This is the most-violated rule.

| Archetype | What crossfades | What stays put |
|---|---|---|
| **Station** | the **active entity card** (replaces on each scan) | scan bar, goal/throughput HUD — never animate |
| **Workbench** | the **right pane** (empty/overview ⇄ selected detail) | the sidebar picker / list — the map is stable |
| **Monitor** (detail) | the **detail pane / slide-over** on row select | the timeline / KPI list — stream stays mounted |
| **Canvas** | the **overlay / inspector repaint** on lens/zoom | the node graph — pan/zoom is direct, never a fade |

- **Station = the active card.** `StationPacking.tsx` / `ActiveOrderScanFeedback.tsx` crossfade the single result card
  on entity change. The scan bar and `StationGoalBar` are persistent chrome — they must not be inside the
  `AnimatePresence`.
- **Workbench / Monitor-detail = the right pane.** `ReceivingRightPane.tsx` is the reference: the History/Incoming table
  is **kept mounted** behind a `display: none` toggle (`style={{ display: isTableOnlyMode ? 'block' : 'none' }}`) so its
  react-query cache + scroll survive; the focused workspace crossfades *over* it keyed on `workspace.row.id`.
- **Canvas = overlay repaint, never the graph.** Lens/zoom changes repaint overlays and the inspector; the React-Flow
  graph itself pans/zooms directly. **Never crossfade the graph** — it destroys spatial continuity.
- **Never crossfade a list, map, or graph.** A list re-fading on every keystroke/selection reads as flicker and loses
  scroll. The list is the stable navigator; only the *detail* transitions.

> Rule of thumb: there is exactly **one** crossfading region per archetype. If you're fading two regions, or fading the
> list, you've picked the wrong target — re-read the table.

---

## Stable-mounting patterns

**Keep the navigator mounted; transition only the detail.** Unmount-on-swap throws away cache, scroll, and in-flight
fetches, and re-fires first-mount effects.

- **Display-toggle, don't unmount** for a region you re-show often: `ReceivingRightPane` keeps the table at
  `position: absolute; inset-0` with `display` flipped, "so the auto-select / first-mount effects don't re-fire on every
  close." A `key`-swap or conditional unmount would lose the cache and scroll.
- **Scope the `key` to the row/selection id**, not to a boolean or a counter — that is what scopes the crossfade to a
  genuine identity change. `key={`workspace-${workspace.row.id}`}`, `key={activeOrder.tracking}`.
- **Put `<AnimatePresence>` OUTSIDE the unmounting conditional**, with the conditional *inside* it
  (`<AnimatePresence>{show ? <motion.div .../> : null}</AnimatePresence>`). If `AnimatePresence` is itself behind the
  `&&`, it unmounts before it can play the exit and the exit animation silently never runs.
- **A slide-over that swaps contents keeps one stable key** so only its body changes: the Incoming panel uses
  `key="incoming-details-panel"` "so only the contents swap" as rows flip — the panel does not re-enter per row.

---

## Spring vs cubic-bezier — pick by surface physics

**Springs for physical / gesture surfaces; cubic-bezier tweens for discrete view swaps.** A spring models momentum and
settle — right when a finger or a value is "thrown"; wrong for an abstract A→B view change, where its variable duration
and tail read as imprecise.

- **Cubic-bezier `easeOut` (discrete swaps):** active-card crossfade, right-pane crossfade, table rows, dropdowns,
  chevrons, scrims. Presets: `framerTransition.stationCardMount` / `tableRowMount` / `dropdownOpen` / `overlayScrim`,
  all on `motionBezier.easeOut [0.22, 1, 0.36, 1]`. Height/layout tweens use the softer `motionBezier.layout`.
- **Spring (physical / gesture):** bottom sheets (`framerTransitionMobile.sheetSlide`), fullscreen photo paging
  (`viewerPaging` — `damping: 38` for *no overshoot*, "bounce reads as tacky on a photo"), the sliding tab/button
  indicator (`framerTransition.sliderIndicator`), numeric bumps (`quantityBump`), modal shells (`workOrderModalSpring`).
- **Durations sub-300ms, ease-out default.** Longest routine tween here is the tab-pager x-slide at `0.32s`; card mounts
  are `0.26s`, right-pane `0.18s`, scrims `0.15s`. Anything past ~300ms for a *routine* transition feels sluggish
  (Nielsen Norman: 100–300ms is the sweet spot for UI feedback).

---

## Reduced-motion is a hard mandate

**`prefers-reduced-motion` is not optional polish — honor it on every animated surface.** WCAG 2.3.3 (Animation from
Interactions) and Apple HIG both require that motion-sensitive users get the content without the movement. The accepted
technique is "**replace slides with crossfades**" — not "no motion." A pure opacity fade is the reduced form, not a
hard cut.

- **Route every preset through the bridge** in `motion-framer-hooks.ts`:
  - `useMotionTransition(transition)` → returns the transition unchanged, or `{ duration: 0 }` when reduced.
  - `useMotionPresence(presence)` → returns the full `initial/animate/exit`, or an **opacity-only** shape when reduced
    (collapses `x`/`y`/`scale` to nothing, keeps the fade).
- **Reduced means collapse transforms to 0 + fade, never "instant cut" everywhere.** `framerTransition.tabPagerReduced`
  shows the baked-in form: same opacity crossfade, `x` duration dropped to `0.01s`.
- **Where the hook isn't used, do the inline ternary** (`ReceivingRightPane` reads `prefersReducedMotion` and swaps
  `{ opacity: 0, y: 6 }` → `{ opacity: 1 }`). Acceptable, but the hook is the SoT — prefer it.

---

## RESOLVED — the named `workbenchPane` preset

The Workbench / Monitor right-pane swap now has a shared preset: **`framerPresence.workbenchPane`**
(`initial { opacity:0, y:6 }` → `animate { opacity:1, y:0 }` → `exit { opacity:0, y:-6 }`) +
**`framerTransition.workbenchPaneMount`** (`0.18s`, `easeOut`). `ReceivingRightPane.tsx` and `TechRightPane.tsx` consume
it through `useMotionPresence` / `useMotionTransition`, so the reduced-motion collapse is automatic and there are no
inline literals left to drift. **New right-pane crossfades call `useMotionPresence(framerPresence.workbenchPane)`** —
never re-inline the values.

## GAP — residual raw reduced-motion consumers

**The workbench right panes now route through the bridge, but some surfaces still consume presets raw.** The station
cards consume `framerPresence.stationCard` directly, and `StationPacking.tsx` hand-rolls its keyed-card crossfade inline
with no reduced-motion handling at all — so a reduced-motion user still gets the `y`-slide there.

**Fix (one of):** (a) bake the reduce-to-opacity collapse *into* the presets so consuming a preset is automatically
safe, or (b) make "always go through `useMotionPresence`/`useMotionTransition`" a lint-enforced rule. Until one lands,
**new animated code must call the hook bridge** — never consume `framerPresence.*` / `framerTransition.*` raw on a
user-facing surface.

---

## Frequency & continuity discipline

- **Don't animate high-frequency or keyboard-driven actions.** A crossfade on every scan is fine (the operator paces
  it); a crossfade on every keystroke in a filter, or on each arrow-key row move, is flicker — render those instantly.
- **Keep station flourishes minimal.** The bench serves the *next scan*; the active card's crossfade is the whole budget.
  No decorative entrances, no per-field animation competing for the eye.
- **`layoutId` only for genuine spatial continuity** — one element that physically travels (the sliding tab/button
  indicator under `framerTransition.sliderIndicator`). **Never** use `layoutId` for the list→detail swap: that is a
  *replace*, not a *move*, and shared-layout there produces a morphing artifact, not continuity.

---

## Anti-patterns

- **Array-index `key`** on `AnimatePresence` children — reorders mis-animate; key by entity id.
- **`<AnimatePresence>` inside the conditional** (`{show && <AnimatePresence>…}`) — exit never plays; put it outside.
- **Springs on a discrete view fade** — variable duration + tail reads as imprecise; use `easeOut` tween.
- **Bounce/overshoot on a photo or an opacity fade** — `viewerPaging` deliberately uses `damping: 38` for none;
  "bounce reads as tacky on a photo."
- **Routine transitions over ~300ms** — sluggish; reserve longer only for large physical slides (sheet, pager).
- **Animating `width`/`height`/`padding`** — layout thrash; use `grid-template-rows` for height, transform for the rest.
- **Crossfading the list / map / graph** — only the detail/active-card/overlay transitions; the navigator stays put.
- **Consuming `framerPresence.*` raw on a user-facing surface** — skips reduced-motion (see the residual-consumers gap);
  go through the hooks.

---

## Do / Don't

**Do**
- Crossfade exactly one region per archetype (card / right pane / overlay), keyed by entity id.
- Use `mode="wait"` + `initial={false}` + opacity-and-transform-only presets from `motion-framer.ts`.
- Route every preset through `useMotionTransition` / `useMotionPresence`.
- Keep the navigator (list/sidebar/graph) mounted; display-toggle, don't unmount.
- Pick spring for gesture/physical surfaces, `easeOut` tween for discrete swaps; stay sub-300ms.

**Don't**
- Animate layout (`width`/`height`/`padding`), or crossfade a list/map/graph.
- Key by array index, or put `AnimatePresence` behind the `&&`.
- Ship a transform-based animation with no reduced-motion path.
- Invent new right-pane crossfade literals — use `framerPresence.workbenchPane` via `useMotionPresence`.
- Use `layoutId` for a list→detail replace.

---

## Background — industry references

- Motion — `AnimatePresence` (mount/unmount, `mode="wait"`, `initial={false}`): <https://motion.dev/motion/animate-presence/>
- Motion — layout animations / `layoutId` (when shared-layout is appropriate): <https://motion.dev/docs/react-layout-animations>
- Emil Kowalski, *Great Animations* (sub-300ms, ease-out, purposeful motion): <https://emilkowal.ski/ui/great-animations>
- Nielsen Norman Group, *Animation Duration* (100–300ms feedback window): <https://www.nngroup.com/articles/animation-duration/>
- WCAG 2.1 SC 2.3.3, *Animation from Interactions* (reduced-motion mandate): <https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions>
- Apple HIG, *Motion* ("replace slides with crossfades" for reduced motion): <https://developer.apple.com/design/human-interface-guidelines/motion>

---

Indexed by ../contextual-display.md
