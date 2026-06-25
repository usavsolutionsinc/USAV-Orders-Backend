# Station display — scan → crossfade → display

Deep dive on the **scan-driven operator bench**: the focus-locked scan loop, the single active-entity card that
replaces on each scan, scan-to-confirm gating, station-down state, the throughput HUD, and the phone variant. This is
the **dominant archetype** in the app and the one most often regressed by bolting browse affordances onto it.

Inherits: ../ui-design-system.md (semantic tokens, linear scaffold, one-row anatomy, eyebrow+chips, HoverTooltip, icon
pairing). This doc only adds what is *station-specific*; it does not restate the house style.

> The discriminator (from ../contextual-display.md): **does this region react to a *scanner*, or to a *pointer*?**
> A scanner — keyboard-wedge/barcode/camera — short-circuits straight to Station. Hands are busy; throughput is the job;
> one transient entity at a time.

---

## 1. When to choose Station — the scanner short-circuit

- **If the primary input is a scanner/keyboard-wedge and the operator is standing at a bench, it is a Station — full
  stop.** Pack, receive/unbox, test, ship, mobile scan flows. This is Q1 of the decision algorithm and it wins over
  every other signal: cardinality, feature area, route. *Rationale: the operator's hands are on product and a scanner,
  not a mouse; any affordance that demands a pointer competes with the only thing that matters — the next scan.*
- **The anti-mix guard:** a page may host a station bench *and* a pointer-driven inspector, but **each region obeys
  exactly one archetype** — never blend them in the same region. The classic regression is dropping a browsable,
  clickable list into the scan column "so they can pick one." That is a Workbench; it belongs in a different region or a
  different page. *Rationale: a list invites a pointer and steals focus from the scan input; the moment focus leaves the
  bar, the wedge types into nothing.*

> Rule of thumb: if the input is a scanner and the operator's hands are busy, the **screen serves the scan, not the
> pointer.** No browsable lists, no hover-reveal detail, no persistent selection.

---

## 2. Anatomy

Top-to-bottom, a station is four parts and nothing more:

| Part | Module | Rule |
|---|---|---|
| **Focus-locked scan bar** (top, sticky) | `StationScanBar` / `ThemedStationScanBar` (`src/components/station/scan-bar/`) | One input, auto-focused, the *only* primary control. |
| **Single active-entity card** (replaces on scan) | `ActiveOrderScanFeedback`, `PackChecklist`, `StationPacking` | One card; the new scan's card *replaces* the previous one. |
| **Minimal chrome / goal HUD** | `StationGoalBar` (composed in `StationPacking`) | Ambient throughput only; never a control surface. |
| **Station-down banner** (singleton, app root) | `OfflineBanner` (`src/components/layout/OfflineBanner.tsx`) | First-class, non-blocking, mounted once. |

- **Compose the scan bar, never re-wire its chrome.** Geometry, padding, icon slot, and placeholder styling live in
  `src/components/station/scan-bar/tokens.ts` (`STATION_SCAN_BAR_INPUT_CLASS`, `STATION_SCAN_BAR_ICON_SLOT_CLASS`, …).
  Domain benches (tech, testing, receiving, pack, FBA) wrap `ThemedStationScanBar`, which layers the staff-theme border
  + focus ring + right-rail inset onto the core `StationScanBar`. *Rationale: one geometry SoT keeps every bench
  identical and keeps the focus affordance inside the input box so sidebar bands never clip it.*
- **The card region uses `flex-1 overflow-y-auto`; the scan bar stays pinned above it.** See `StationPacking` — scan
  bar in the header band, results in the scroll body. *Rationale: the bar must never scroll out from under a working
  operator.*

---

## 3. Focus-lock loop

The single most load-bearing behavior. A station that loses focus is a station that drops scans.

- **Every primary bar registers itself as the global hotkey's focus target via `useRegisterScanTarget`**
  (`src/lib/scan-hotkey/useScanHotkey.ts`), which `StationScanBar` calls for free (`hotkey` prop, default `true`).
  *Rationale: the most-recently-mounted bar wins the key (`registerScanTarget` pushes onto a stack in
  `src/lib/scan-hotkey/store.ts`), so the page's active bench always owns the hotkey with zero per-page wiring.*
- **The focus hotkey is global and configurable (default `F2`).** `store.ts` installs exactly one `keydown` listener
  lazily on first subscribe and focuses+selects the top target; the binding hydrates synchronously from `localStorage`
  (durable SoT is `staff_preferences`). *Rationale: an operator who tabbed away or clicked a modal hits one key to slam
  focus back to the bar — without it the wedge fails silently.*
- **Auto-refocus after every submit.** On submit the bar clears the input and the host re-focuses it
  (`setTimeout(() => inputRef.current?.focus(), 0)` in `StationPacking`'s `handleSubmit`). *Rationale: the operator
  scans the next entity immediately; a one-tick defer lets React commit the cleared value before focus returns.*
- **Add a focus-watchdog for blur/`visibilitychange`.** Modals, tab-aways, and on-screen keyboards steal focus — the
  classic wedge failure mode. Re-grab focus when the bar blurs unexpectedly or the tab regains visibility. *(The global
  `F2` target covers the manual case; a watchdog covers the silent one. Do not block the operator while down — just put
  the cursor back.)*
- **Guard against wedge terminators / split scans.** A keyboard-wedge ends a scan with Enter (form submit) but can also
  fire fast partial bursts; debounce or gate re-entrant submits (`inFlight`/`isLoading` guards in
  `StationPacking`, `MobilePackerFlow`, `UniversalScan`). *Rationale: a double-fire must be a no-op, not a double-effect
  — pair this with per-scan idempotency (§7).*

---

## 4. Scan classification

The bar is dumb; classification is a pure layer.

- **Classify the raw value before routing.** `detectStationScanType` (`src/lib/station-scan-routing.ts`) maps a raw
  string to `TRACKING | SERIAL | FNSKU | SKU | REPAIR | COMMAND` by precedence (`:` → SKU, `RS-#` → REPAIR, FNSKU shape,
  command words, then carrier/serial heuristics from `scan-resolver`). *Rationale: one classifier keeps carrier/serial
  heuristics out of every bench; the bench just dispatches on the returned type.*
- **Make classification context-aware.** `resolveScanType` (`useStationTestingController.ts`) overrides the base type
  using the active entity: when an order is still short on serials, a *carrier-unknown* "tracking-looking" barcode is
  treated as a product **SERIAL**, while known carrier prefixes still route as TRACKING. *Rationale: the operator
  shouldn't have to arm a mode mid-flow — the incomplete order tells us the next scan is almost certainly a serial.*
- **Forced types exist for explicit modes** (`handleSubmit({ forcedType })`) but are the exception; default to the
  context-aware resolver.

---

## 5. Single active-entity rule

- **One card. The new scan's card replaces the previous one.** `StationPacking` and `ActiveOrderScanFeedback` render
  the active entity inside `AnimatePresence mode="wait"` keyed on the entity id (`activeOrder.tracking`,
  `activeFba.fnsku`). *Rationale: `mode="wait"` exits the old card before mounting the new one — there are never two
  cards on screen, which would imply a list the operator must choose from.*
- **Selection is ephemeral — never URL-addressable.** The controller (`useStationTestingController`) holds the active
  entity in component state (`activeOrder`), not in `searchParams`. It is resolved → acted on → cleared. *Rationale:
  act-and-clear is the station contract; a durable `?id=` selection is a Workbench tell (see ../contextual-display.md).*
- **Act-and-clear, with an auto-hide for completed work.** On completion the controller starts a timer
  (`COMPLETED_ORDER_AUTO_HIDE_MS`) and then hides the card, falling back to the empty scan-ready state. *Rationale: a
  finished entity must get out of the way so the bench is visibly ready for the next scan.*

---

## 6. Scan-to-confirm + multimodal feedback

- **Gate progress on a *matching* scan, not a click.** `PackChecklist` merges the SKU's kit-parts BOM with its QC verify
  steps; under `block_until_matched` enforcement it raises a hard "items still to include" signal until every critical
  part is confirmed, while `advisory` only warns. The blocked verdict comes from the shared SoT
  (`evaluateKitReadiness` in `src/lib/packing/kit-readiness.ts`) so the banner and the `kit_verify` engine node can
  never disagree. *Rationale: the checklist guards correctness without ever requiring the operator to leave the scan
  loop — a fresh SKU clears every tick (`resetKey`).*
- **Make pass/fail a big card state, not a toast.** `ActiveOrderScanFeedback` shows the running progress meter
  (`scanned/qty`, `complete`), a pulsing "Active" status chip, and a transient "Last serial" row on each new scan —
  all inside the active card. Status tones derive from semantic tokens / the lifecycle dot registry
  (`workflowStageDot`, `src/lib/receiving/workflow-stages.ts`), never ad-hoc hues. *Rationale: an operator three feet
  from the screen with their hands full needs a glanceable card state; a 4-second corner toast is invisible at the
  bench.*
- **Add a non-visual cue for the eyes-down operator.** Pair the visual pass/fail with an audio/haptic confirmation
  (success vs reject tone). *Rationale: the operator is looking at product, not the screen — sound closes the loop when
  the eyes can't.*

---

## 7. Optimistic act + idempotency

- **Mint a per-scan `clientEventId` and thread it through the mutation.** The controller generates one per scan
  (`newStationIdempotencyKey` → `crypto.randomUUID()` in `useStationTestingController`) and passes it into the scan
  handlers' context. *Rationale: a flaky-network retry (or a wedge double-fire) carries the same key, so the server
  collapses it to a no-op via `UNIQUE(client_event_id)` on `inventory_events` (../backend-patterns.md) — re-entering
  the same state returns `idempotent: true`.*
- **Render the acted state immediately and increment the HUD optimistically; reconcile against the server result.**
  The progress meter bumps on the local serial count (`ActiveOrderScanFeedback`) before the server confirms.
  *Rationale: at scan cadence the operator can't wait a round-trip per scan; optimistic UI sits *on top of* the
  idempotent server contract, it never replaces it.*
- **On 409 / reject, revert the card with a big fail state (not a toast).** Status changes go through
  `transition()`/`applyTransition()` with `expectedFrom` (../backend-patterns.md), which returns 409 on a conflicting
  prior state; the bench reverts the optimistic increment and shows the fail card. The reversible secondary action
  (e.g. **Undo last serial** in `ActiveOrderScanFeedback`) lives in a footer row, separated from the primary status.
  *Rationale: a conflict is a real event the operator must see at the card, and undo is a deliberate secondary action,
  not the primary signal.*

---

## 8. Station-down is first-class

- **`OfflineBanner` is a singleton mounted once near app root.** It shows when `navigator.onLine` is false **OR** the
  offline write queue depth (`useOfflineWriteQueue`) is `> 0`, and stays up while syncing
  (`src/components/layout/OfflineBanner.tsx`). It is `fixed inset-x-0 top-0 z-banner` — pinned, non-blocking, color-coded
  (rose offline / amber syncing / emerald back-online). *Rationale: the operator can't fix the network mid-shift; the
  state must be visible and the bench must keep moving.*
- **Degrade-not-block: keep scanning into a durable queue.** A down printer/scale/network never gates a scan; the scan
  enqueues and the idempotent retry (§7) drains it on reconnect. *Rationale: throughput is the job — blocking the bar on
  infra failure stops the line for something the operator can't repair.*
- **Printer-down / scale-down are distinct, non-blocking banners** — separate from the offline banner, because they
  fail independently and the operator needs to know *which* peripheral is down. *Rationale: "station down" is a family of
  orthogonal states, not one boolean.*

---

## 9. Motion

- **Crossfade the *active card* only.** Use the station presets from `src/design-system/foundations/motion-framer.ts`:
  `framerPresence.stationCard` (opacity + small-y) with `framerTransition.stationCardMount`, inside
  `AnimatePresence mode="wait"`. The serial-row and collapse transitions (`framerPresence.stationSerialRow`,
  `framerPresence.collapseHeight` + `framerTransition.stationCollapse`) handle the in-card micro-changes. *Rationale:
  one entity dissolves into the next — there is no list to crossfade, so never animate one.*
- **Route presets through the motion hooks so reduced-motion is automatic.** `useMotionTransition` /
  `useMotionPresence` (`src/design-system/foundations/motion-framer-hooks.ts`) collapse x/y to 0 under
  `prefers-reduced-motion`, leaving a pure opacity crossfade. *Rationale: WCAG 2.3.3 — reduced-motion is "replace slides
  with crossfades," not "no motion," and it must be free, not per-component.*
- **Keep flourishes minimal on a high-frequency scan stream.** The scan-sweep shimmer in `StationScanBar` is a brief
  `motionBezier.easeOut` sweep; the active card uses opacity + transform only. **Never animate layout** (width/height/
  padding) on the card — for height use `grid-template-rows` / the collapse preset. *Rationale: at scan cadence,
  layout animation thrashes and reads as lag; opacity+transform stays on the compositor.*

---

## 10. Mobile (phone) variant

The phone station is **not a distinct archetype** — it is this same Station wearing a `MobileShell`.

- **The mobile scan surface IS the canonical desktop `StationScanBar`.** `ScanInput`
  (`src/components/mobile/redesign/ScanInput.tsx`) wraps `StationScanBar` in compact chrome and tucks a ZXing camera
  toggle into its `rightContent` (`useBarcodeScanner`); the viewfinder expands below. **Do not hand-roll a separate
  mobile input.** *Rationale: one bar means the desktop focus/classification/idempotency rules apply unchanged on the
  phone.*
- **Same endpoints + query keys as desktop.** `UniversalScan` and `MobilePackerFlow` POST the same routes
  (`/api/receiving/lookup-po`, `resolveTestingScan`, `/api/orders/lookup/:id`) and invalidate the same
  TanStack keys the desktop sidebar uses, so a phone scan lands in the same triage rails. *Rationale: the phone is a
  second terminal onto one station, not a parallel data path.*
- **Phone-specific affordances stay inside the station contract.** Fullscreen camera portal, bottom sheets
  (`PrepackedProductSheet`), and a swipeable mode pager (`MobilePackerFlow`'s two-step machine, `UniversalScan`'s mode
  slider) are layout, not archetype changes: still scan-driven, still act-and-clear, still one active entity.
  *Rationale: only one camera stream can be live at a time (`cameraSuspended` parks the page scanner while a sheet's
  scanner runs) — mount/un-suspend one at a time.*

---

## 11. Anti-patterns checklist

- **Don't put a browsable, clickable list in the scan column.** That's a Workbench; split the region (§1).
- **Don't make the station react to hover/click.** It reacts to *scans* only; pointer-reactive detail is a Workbench
  tell.
- **Don't let focus drift.** No un-refocused submit, no missing `useRegisterScanTarget`, no modal that swallows the bar
  without a watchdog (§3).
- **Don't animate layout on the active card.** Opacity + transform only; height via `grid-template-rows` / the collapse
  preset (§9).
- **Don't make selection URL-addressable.** Station selection is ephemeral state; `?id=` is a Workbench (§5).
- **Don't surface pass/fail as a generic corner toast.** Use the big active-card state + an audio/haptic cue (§6).
- **Don't block the bench on infra.** Printer/scale/network down → distinct non-blocking banner + durable queue, never a
  gated scan (§8).
- **Don't invent hex or hardcode `z-[NNN]`.** Color from `src/design-system/tokens/colors/semantic.ts`, z-index from the
  named scale, status tones from `workflowStageDot`.

---

## At a glance

| | Station rule |
|---|---|
| Driven by | a scanner / keyboard-wedge / camera |
| Primary input | focus-locked `StationScanBar`, global hotkey target |
| Selection | ephemeral, one at a time, **never** in the URL |
| What crossfades | the **active card** (`framerPresence.stationCard`, `mode="wait"`) |
| Confirm model | scan-to-confirm (`PackChecklist`), optimistic + `clientEventId` idempotency |
| Feedback | big card pass/fail + audio/haptic, not a toast |
| Down state | `OfflineBanner` singleton + durable queue; degrade-not-block |
| Mobile | same Station on `MobileShell` via `ScanInput`; same endpoints/keys |

## Background — industry references

- **Serial single-tasking** — one transient entity at a time; the bench is optimized for the *next* item, not for
  navigating a set. ([NN/g — serial vs. parallel task switching](https://www.nngroup.com/articles/serial-task-switching/))
- **Keyboard-wedge scanning** — the scanner types into the focused input and ends with Enter; focus-lock is the whole
  game. ([Barcode scanners simplified](https://medium.com/@mypascal2000/barcode-scanners-simplified-1a4fb7ef621b))
- **Idempotency keys** — a per-scan `clientEventId` makes a retry a safe no-op.
  ([Stripe — idempotency](https://stripe.com/blog/idempotency))
- **Graceful degradation / single-app kiosk** — "station down" is a designed-for state on a locked-down bench, not an
  error page. ([Designing systems that fail gracefully](https://www.cleverence.com/articles/business-blogs/how-to-design-systems-that-fail-gracefully-4827/))

---

Indexed by ../contextual-display.md.
