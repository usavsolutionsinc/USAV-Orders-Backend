# UX/UI Analysis & Improvement Plan — USAV Orders Backend

> **Skill file.** Future Claude sessions: read this before proposing UI changes. It documents what exists, what's already governed by the design system, and where the real UX pain is. Don't re-derive any of this from scratch.

---

## Executive Summary

USAV Orders Backend is **not** a public marketing site — it's an internal warehouse-ops platform used by receivers, packers, technicians, and admins across **desktop browser, Electron desktop app, and mobile (`/m/*` routes)**. The design system is unusually mature for an internal tool: `src/design-system/` ships tokens, primitives, components, and is governed by `.design-system-rules.md` (hard rules about CopyChip variants, typography presets, motion presets, semantic colors).

The remaining UX debt is concentrated in **feature-layer components that pre-date the design system** — many 1000–1700 LOC, with inline styling, ad-hoc state, and inconsistent loading/empty/error states. Mobile and desktop layouts have diverged enough that `ResponsiveLayout` + `RouteShell` + `m/layout.tsx` have overlapping responsibilities. Priorities below are concrete pointers into real files, not generic advice.

---

## 1. Current UX/UI Assessment

### Strengths
- **Mature design system at `src/design-system/`** — tokens, foundations, primitives (`CardShell`, `ActionButtonGroup`, `ExpandableSection`, `SearchField`, `StickyHeader`), components (`StatusBadge`, `TabSwitch`, `OverlaySearch`, `StatCard`, `DateGroupHeader`). The rules in `.design-system-rules.md` are specific and enforceable.
- **CopyChip family is semantic and color-bound** (`TrackingChip` blue, `FnskuChip` purple, `SerialChip` emerald, `OrderIdChip` gray, `TicketChip` orange) — a real, working pattern, not aspirational.
- **Motion presets centralized** (`framerTransition.*`, `framerPresence.*`) so animation feel is consistent across cards, rows, dropdowns.
- **Three-tier density system** (`density.compact|standard|spacious`) gives a principled answer to spacing questions.
- **Sticky positioning + z-index ladder** are tokenized — no random `z-50` everywhere.
- **Existing audit docs**: `docs/UI-PATTERNS.md`, `docs/architecture.md`, `docs/diagrams/`, `FBA_UX_UI_CONSISTENCY_PLAN.md` already capture historical gaps — read these before re-auditing.

### Weaknesses
- **God-components**: feature-layer files that ignore design-system primitives.
  - `src/components/receiving/workspace/LineEditPanel.tsx` — 1766 LOC
  - `src/components/shipped/details-panel/ShippingInformationSection.tsx` — 1717 LOC
  - `src/components/admin/StaffManagementTab.tsx` — 1454 LOC
  - `src/components/sidebar/ReceivingSidebarPanel.tsx` — 1316 LOC
  - `src/components/barcode/RackLabelPrinter.tsx` — 1255 LOC
  - `src/components/fba/StationFbaInput.tsx` — 1197 LOC
  - `src/components/MultiSkuSnBarcode.tsx` — 1162 LOC (top-level, not even foldered)
  - `src/components/fba/sidebar/FbaShipmentEditorForm.tsx` — 1067 LOC
- **Top-level stragglers in `src/components/`** that should be moved into feature folders or deleted: `PackerDashboard.tsx`, `PackerTable.tsx`, `PendingOrdersTable.tsx`, `ReceivingDashboard.tsx`, `TechDashboard.tsx`, `TechTable.tsx`, `TechSearchPanel.tsx`, `ShippedSidebar.tsx`, `StaffSelector.tsx`, `QuarterSelector.tsx`, `UpdateManualsView.tsx`, `Icons.tsx`, `EmbeddedBrowser.tsx`, `DocxUploader.tsx`, `MultiSkuSnBarcode.tsx`, `CommandBar.tsx`, `UpNextOrder.tsx`. They predate the folder convention.
- **Loading/empty/error states are inconsistent** — `Spinner`, `LoadingSpinner`, `SkeletonCard`, `Skeletons.tsx` all exist; usage isn't unified. Some panels show nothing, some flash a centered spinner, some have skeletons.
- **Form patterns are duplicated** — `FormField` exists but many forms still hand-roll label + required indicator + hint + error.
- **Two parallel mobile surfaces**: `src/app/m/*` (deep mobile-first routes for scan/enroll/pick) and `src/components/mobile/*` + `MobileBottomNav` + `MobileAppHeader` (mobile chrome wrapping the main app). Need to decide which is canonical for each user task.
- **Tailwind config is thin** (`tailwind.config.ts` is 1.3 KB) — most design tokens live in `src/design-system/tokens/` instead. Risk: someone adds `text-blue-500` directly and bypasses tokens.

### Accessibility (WCAG)
Targeted audit needed; nothing in `src/lib/` suggests systematic a11y work. Likely issues based on file scan:
- Many `<div onClick>` instead of `<button>` (inferred from primitives/components mix).
- `IconButton.tsx` exists — good — but icon-only triggers in feature code may lack `aria-label`.
- Color-only status (condition: `text-yellow-500` = New, `text-amber-800` = Parts) — needs text/icon backup for color-blind users.
- Focus rings: design-system tokens have a focus ring; ad-hoc components may strip it.
- **Action**: run `axe-core` against `/`, `/receiving`, `/m/r/[id]`, `/settings/staff`, `/work-orders`, `/tech`. Don't audit blindly — audit the busiest screens first.

### Mobile responsiveness
- Mobile users have **two journeys**: (a) a scan-driven flow at `/m/scan`, `/m/r/*`, `/m/pick`, `/m/b`, `/m/l`, `/m/u` (printed QRs route here via `proxy.ts` rewrites); (b) the main app wrapped in `MobileBottomNav` + `MobileAppHeader`.
- The new migration `src/lib/migrations/2026-05-23_staff_mobile_bottom_nav_enabled.sql` (uncommitted) suggests this is in flight — verify before refactoring.
- `ResponsiveLayout.tsx`, `RouteShell.tsx`, `ResponsiveShell.tsx` all exist — likely overlap, worth consolidating.

### Loading performance
- **Heavy client bundle risk**: `framer-motion`, `@dnd-kit/*`, `signature_pad`, `@zxing/*`, `bwip-js`, `canvas-confetti`, `qrcode`, `react-qr-code` all client-side. Audit which routes actually need each, lazy-load the rest.
- `next.config.ts` should be checked for bundle splitting; `@ducanh2912/next-pwa` is configured — service worker can cache heavy chunks.
- Largest single client file: `src/app/design-compare/page.tsx` (932 LOC, uncommitted) — looks like a comparison harness; should not ship in production bundle.

### Conversion funnels
N/A — internal tool. The analogues are **task-completion funnels**: scan → resolve → act → confirm. Pain points (informed by file structure):
- **Receiving funnel** is overloaded — `LineEditPanel` at 1766 LOC means receivers hit one giant panel for every variation. Worth splitting by mode (PO receive vs unboxing vs manual scan).
- **Station/Tech flow** has its own `ActiveOrderWorkspace`, `OrderPreviewPanel`, `UpNextOrder`, `OrderCard`, `RepairCard`, `FbaItemCard` — good separation, but `StationFbaInput` (1197 LOC) needs decomposition.

### Branding consistency
Logo (`USAV Logo Square Blue.png`) lives at repo root — should move into `public/` or `src/assets/`. Brand color appears to be blue (per logo + Logistics/Tracking token mapping).

---

## 2. User Personas & Journeys

| Persona | Device | Primary surface | Top tasks |
|---|---|---|---|
| **Receiver** | Desktop browser + Electron (label printers) | `/receiving`, `/m/r/[id]`, `/m/scan` | Scan PO → match line → mark received → print labels |
| **Tech (repair)** | Station PC (Electron) + occasional mobile | `/tech`, `/station/*`, `/m/scan` | Pull next order → diagnose → log serial → complete |
| **Packer** | Station PC (Electron) | `PackerDashboard`, `/p/*` | Pick → pack → print shipping label → confirm |
| **FBA prep** | Station PC | `/fba`, `StationFbaInput`, `FbaFnskuChecklist` | Scan FNSKU → assign to shipment → print box label |
| **Admin** | Desktop browser | `/settings/staff`, `/admin/*`, `/audit-log` | Manage staff, roles, permissions; review audit trail |
| **Mobile-only walker** | Phone | `/m/*` (PWA installable) | Scan rack/bin/unit QRs; quick lookups |

**Current vs ideal journey gaps** (read these as hypotheses to verify with real users — don't refactor on assumption alone):
1. **Receiver mode-switching** — `LineEditPanel` tries to be everything; ideal: distinct UIs for "receive against PO" vs "unboxing mystery box" vs "manual line". `Mode2Unboxing.tsx` (803 LOC) suggests the split has started.
2. **Tech context-switching** — `OrderPreviewPanel` + `ActiveOrderWorkspace` may be showing too much at once on station screens. Verify with `verify` skill before changing.
3. **Mobile QR resolution** — `proxy.ts` rewrites `/m/b`, `/m/l`, `/m/u` to canonical paths. If a label is printed wrong, the failure mode is invisible. Consider adding `/m/scan/debug` for diagnosing.

---

## 3. UI Component Inventory

### Design-system layer (canonical)

`src/design-system/primitives/` — atomic, no data fetching:
- `ActionButtonGroup`, `AppTopBar`, `CardShell`, `ChevronToggle`, `ConditionText`, `CopyIconButton`, `DeferredQtyInput`, `DetailCell`, `DetailGrid`, `EmptyState`, `ExpandableSection`, `ExternalLinkButton`, `IconButton`, `PanelRow`, `PrimaryButton`, `ProgressBar`, `SearchField`, `Spinner`, `StatusText`, `StickyHeader`

`src/design-system/components/` — compose primitives, may hold local UI state:
- `AlertLineRow`, `AssignmentOverlayCard`, `CompactSearchInput`, `CopyActionIcon`, `DateGroupHeader`, `DetailLineRow`, `DetailsPanelRow`, `ExternalLinkActionIcon`, `FormField`, `InlineEditableValue`, `InlineNotice`, `InlineSaveIndicator`, `MetricLineRow`, `OverlaySearch`, `PanelSection`, `PlatformBadge`, `ResponsiveShell`, `RouteShell`, `Skeletons`, `StaffBadge`, `StatCard`, `StatusBadge`, `StatusMicroLabel`, `StickyActionBar`, `TabSwitch`, `UnderlineValue`, `WorkOrderAssignmentCard`, `WorkspaceCard`
- Sub-namespaces: `desktop/`, `mobile/`, `sidebar-intake/`

### Legacy / parallel UI layer (`src/components/ui/`)

Pre-design-system primitives still in use:
- `BottomSheet`, `CopyableText`, `CopyChip` (canonical chip family), `DaysLateBadge`, `DeleteButton`, `DesktopDateGroupHeader`, `HorizontalButtonSlider`, `LoadingSpinner`, `OrderStaffAssignmentButtons`, `OutOfStockEditorBlock`, `OutOfStockField`, `OverlaySearchBar`, `PasteTrackingButton`, `PlatformExternalChip`, `ProgressBar`, `QtyBadge`, `SearchBar`, `ShipByDate`, `SkeletonCard`, `TabSwitch`, `ViewDropdown`, `WeekHeader`
- New: `pane-header/PageHeader.tsx` (uncommitted)
- **Action**: dedupe with `src/design-system/components/` — `TabSwitch`, `ProgressBar`, `OverlaySearch(Bar)`, `SearchBar`/`SearchField`, `SkeletonCard`/`Skeletons` are present in both.

### Recommendation: stop building primitives outside `src/design-system/`
- Any new shared primitive lands in `src/design-system/primitives/` only.
- `src/components/ui/` is in **deprecate-and-migrate** mode — no new files, gradually replace usages.
- Headless UI / Radix migration is **not** needed — the current primitives + `cmdk` (`CommandBar.tsx`) + `sonner` (toasts) + `framer-motion` cover the surface.

---

## 4. Design System Recommendations

The system already exists. Recommendations are about **enforcement and gap-closing**, not greenfield design.

### Enforcement (add to CI / pre-commit)
1. **Lint rule: no raw `text-[10px]`/`text-[11px]`/`text-[13px]` Tailwind in `src/components/`** — must use `typographyPresets`.
2. **Lint rule: no inline `motion.div` with `transition={{ duration }}`** — must use `framerTransition`/`framerPresence`.
3. **Lint rule: no `text-blue-500`/`text-emerald-500`/etc. without going through `semanticColors` or `StatusBadge`.**
4. **Lint rule: no new files at the top level of `src/components/`** — must live in a feature folder.

### Gap-closing
- **Standardize empty states**: collapse `EmptyState` (primitives) + `Skeletons` + `SkeletonCard` + ad-hoc loading screens behind a single `<DataState loading empty error>` boundary component.
- **Form patterns**: ban hand-rolled labels/errors; require `FormField`. Add `<Form>` boundary with built-in submission, optimistic state, and toast feedback (use `sonner`).
- **Mobile sheet**: `BottomSheet` is the canonical bottom sheet — replace any drawer hand-rolls with it.
- **Confirmation dialog**: not seeing a `ConfirmDialog` primitive. Add one (currently likely inline-confirmed with `window.confirm` or ad-hoc modals).

### Token additions to consider
- **Loading shimmer token** — currently `Skeletons` likely defines its own; centralize.
- **Toast variants token** — `sonner` is configured; the four variants (success/warn/error/info) should map to `semanticColors`.
- **Print preview token set** — label printers (`RackLabelPrinter`, `BinLabelPrinter`, `MultiSkuSnBarcode`) likely have ad-hoc dimensions. Add `printDimensions.*` tokens for label sizes.

---

## 5. Frontend Update Roadmap

Sized by relative effort: **S** = ½–1 day, **M** = 2–4 days, **L** = 1–2 weeks.

### High priority — Quick wins (S)
1. **Move top-level `src/components/*.tsx` stragglers into feature folders** (Packer, Tech, Receiving, etc.). Pure mechanical move; reduces visual clutter and enforces folder convention.
2. **Delete the obvious garbage at repo root**: `node` (0 B), `209` (0 B), `iBU89E,2OHQk.Dp2Hy6,Yc7co~zDKr4V` (0 B), `usav-orders@0.1.0` (0 B), `snapshot{,2,3,4}.txt`, `receiving_lines_cleanup_backup_*.json`, `Working GAS`, `Repair Service HTML`. Add to `.gitignore` if regenerated. **Verify with user before deleting committed files.**
3. **Move `USAV Logo Square Blue.png` into `public/` or `src/assets/`.**
4. **Dedupe `src/components/ui/` vs `src/design-system/components/`** — pick the winner for `TabSwitch`, `ProgressBar`, `OverlaySearchBar`/`OverlaySearch`, `SkeletonCard`/`Skeletons`, etc. Update imports; delete losers.
5. **Wire `.design-system-rules.md` into an ESLint plugin or `dependency-cruiser` rule** so the rules are enforced, not just documented.

### High priority — Major refactors (L)
6. **Split `LineEditPanel.tsx` (1766 LOC)** by receiving mode. Extract per-mode panels under `src/components/receiving/workspace/modes/`. Verify each path with the `verify` skill before merging.
7. **Split `ShippingInformationSection.tsx` (1717 LOC)** — likely intermixing read view, edit view, address validation, carrier picker.
8. **Split `StaffManagementTab.tsx` (1454 LOC)** into per-tab sub-components (basic info, permissions, schedule, goals, audit).
9. **Consolidate `ResponsiveLayout` / `RouteShell` / `ResponsiveShell` / `m/layout.tsx`** — three+ layout shells with overlapping responsibilities. Pick one mental model: `<RouteShell device="auto|desktop|mobile">`.

### Medium priority (M)
10. **Mobile bottom-nav rollout** (in flight per `2026-05-23_staff_mobile_bottom_nav_enabled.sql`) — confirm feature-flag state in `feature-flags.ts`; document the rollout in `docs/`.
11. **Standardize loading/empty/error** with a `<DataState>` wrapper. Replace direct `Spinner`/`LoadingSpinner`/`SkeletonCard` usages over time.
12. **A11y pass on top 5 screens** by traffic: `/`, `/receiving`, `/tech`, `/m/scan`, `/work-orders`. Use `chrome-devtools-mcp:a11y-debugging`.
13. **Bundle audit** — remove `src/app/design-compare/page.tsx` from production build; lazy-load `@zxing/*`, `bwip-js`, `canvas-confetti`, `signature_pad`.

### Nice-to-haves (S–M)
14. **Dark mode** — themes folder exists (`src/design-system/themes/`) but check if dark theme is built out. Station PCs in dim warehouses would benefit.
15. **Print preview unification** — see "Token additions" above.
16. **Storybook or `design-compare/` formalization** — the design-compare page suggests appetite for it; if it stays, gate it behind a dev-only route.

---

## 6. Accessibility, SEO, Performance Audit

### Accessibility — specific issues to look for
- **Icon-only buttons without `aria-label`**: grep `src/components/` for `<IconButton` and `<button` with only `<svg>` / `<lucide>` children.
- **Color-only state**: `getConditionColor`/`StatusBadge` map to colors — verify each StatusBadge also renders text/icon, not just dot color.
- **Focus traps in modals**: `BottomSheet`, `ConfirmDialog` (when added), and any sidebar slide-ins need `inert` on the background.
- **Keyboard nav for scan workflows**: technicians work one-handed (scanner in other hand) — every action needs a keyboard shortcut. `CommandBar.tsx` (`cmdk`) is the right place to expose them.
- **Touch target ≥ 44 px** on `/m/*` screens — verify `density.compact` isn't used in mobile feature code.

### SEO
- **Skip entirely.** This is an authed internal tool; `proxy.ts` gates everything behind a session cookie. `robots.txt` should be `Disallow: /` (verify in `public/`).
- Marketing copy / OG tags only matter for `/signin` and `/signup` — and only enough to look legit if someone shares a link.

### Performance — concrete asks
1. **Bundle analyzer**: `next build --webpack` with `@next/bundle-analyzer` to identify the heavy client chunks. Likely culprits per dependency list: `framer-motion`, `ebay-api` (should be server-only — verify), `googleapis-common`, `signature_pad`, `@zxing/*`, `bwip-js`, `qrcode`.
2. **Server-only imports**: `ebay-api`, `googleapis-common`, `nodemailer`, `pg`, `postgres`, `multer`, `express` must never reach the client bundle. Audit with `dependency-cruiser` (already configured at `.dependency-cruiser.cjs`).
3. **PWA cache strategy**: `@ducanh2912/next-pwa` is configured — verify the SW caches the right routes (`/m/*` should be cache-first for shell, network-first for data).
4. **Realtime payload size**: Ably + the outbox relay (`scripts/realtime-outbox-relay.js`) — check that messages aren't shipping full row state when a delta would do.
5. **React Query cache**: `@tanstack/react-query` is in deps — verify `staleTime`/`gcTime` are set, not defaulting to 0/5min for heavy queries.
6. **Image audit**: `public/` has no image pipeline mentioned — confirm `<Image>` from `next/image` is used everywhere, not `<img>`.

---

## 7. Visual Mockup Suggestions (screens to redesign)

Ordered by impact on daily ops. These are **starting points**; do a `critique` or `audit` pass on each before designing.

1. **Receiving workspace (`/receiving`)** — the 1766-LOC `LineEditPanel` is the daily home for receivers. A mode-aware redesign with a left rail (PO list, recent rail), center workspace (mode-specific), right rail (Zoho slide-in already exists per recent commit `c4452a1`) would dramatically reduce cognitive load.
2. **Tech station (`/tech` + `ActiveOrderWorkspace`)** — single-screen "what am I working on now" optimized for station monitors (1920×1080). Big up-next card, big serial-entry, big completion button.
3. **Mobile scan landing (`/m/scan`)** — first thing a phone user sees. Should be: massive scan button, recent scans list, single "what now?" prompt.
4. **FBA prep (`/fba` + `StationFbaInput`)** — checklist-driven (FNSKU → location → confirm), not form-driven.
5. **Staff management (`/settings/staff`)** — currently 1454 LOC in one tab. Split into a roster table + per-staff detail drawer (permissions, schedule, goals tabs inside).
6. **Work orders sidebar (`WorkOrdersSidebarPanel`)** — high-density list; standardize against `DetailLineRow` / `MetricLineRow` primitives.
7. **Audit log (`/audit-log`)** — `AuditLogReceivingClient` is 816 LOC. Faceted filter UI with timeline view would beat a single mega-table.

---

## See also

- `Code_Architecture_Logic_Improvements.md` — backend/architecture findings
- `Frontend_Modernization_Skills.md` — concrete technical recipes
- `Feature_Interaction_Map.md` — how the features wire together
- Existing in-repo docs: `docs/UI-PATTERNS.md`, `.design-system-rules.md`, `docs/architecture.md`, `FBA_UX_UI_CONSISTENCY_PLAN.md`
