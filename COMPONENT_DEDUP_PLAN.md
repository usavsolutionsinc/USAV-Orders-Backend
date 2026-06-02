# Component Reuse & Deduplication Plan

**Generated:** 2026-06-01
**Codebase:** USAV-Orders-Backend (Next.js App Router, TypeScript, Tailwind, Framer Motion, dnd-kit)
**Scope:** Whole-codebase audit of component reuse — shared UI layer + feature components (~716 `.tsx` files).
**Method:** 8 parallel exploration passes (shared layer, badges, inputs, feedback states, overlays, buttons, cards/forms/rows, structural/data-fetching), then manual verification of load-bearing counts.

> This plan is a **report first**. No code has been changed. Each section is sequenced so you can implement safely, lowest-risk-first. Effort estimates are rough.

---

## 0. Executive summary

The codebase already has a **real design system** (`src/design-system/` with tokens, themes, primitives, providers and a `DESIGN_SYSTEM.md`). The problem is not *absence* of shared components — it's that:

1. **Two shared homes compete** (`src/design-system` and `src/components/ui`) with **bidirectional re-export shims** and no documented ownership rule.
2. **Good primitives exist but are under-adopted.** `PrimaryButton` (2 importers), `ActionButtonGroup` (0), `FormField` (2), `PanelSection` (0), `DetailGrid`/`DetailCell` (0) are orphaned while features hand-roll the same thing inline.
3. **The same patterns are re-implemented inline hundreds of times**: status pills, spinners, empty states, modals/overlays, cards, label+input field groups, and the `useState(data/loading/error)+useEffect(fetch)` quartet.
4. **Infrastructure to fix #3 already exists** (`useFetch`/`useMutation` in `src/hooks/_data.ts`, `createCrudHandler` in `src/lib/api/crud.ts`) but is barely used.

**The fix is mostly adoption + consolidation, not new architecture.** Highest leverage, in order:

| Rank | Theme | Why | Risk |
|---|---|---|---|
| 1 | Lock the layering rule (design-system vs components/ui) + kill re-export shims | Removes the root ambiguity; every later step depends on it | Low |
| 2 | One `<StatusPill>` + colocated status→tone maps | ~18 duplicate status-color maps, 25-35 inline pills | Low |
| 3 | Overlay primitives (`useBodyScrollLock`, `useEscapeClose`, `<Modal>`, `<SidePanel>`, z-index tokens) | 64 inline `fixed inset-0`, 30 Escape handlers, 10 scroll-locks, ~50 ad-hoc z-index values, fixes ≥4 latent bugs | Medium |
| 4 | Adopt `useFetch`/`useMutation` for the fetch quartet | ~70 components, 600 raw `fetch()` calls | Medium |
| 5 | Card / button / field-group primitives | 160+ inline cards, 25-30 ad-hoc button styles, 40+ inline field groups | Medium |
| 6 | Decompose 8 god components | 2,257-line files mixing state + fetch + inline subcomponents | High |
| 7 | Folder/naming cleanup + delete dead code | Orphaned primitives, dead `CompactSearchInput`, etc. | Low |

---

## 1. Duplicated / similar components (findings)

### 1.1 The two shared homes overlap

| Concept | `src/design-system/` | `src/components/ui/` | Reality |
|---|---|---|---|
| EmptyState | `primitives/EmptyState` (12 imports) | `EmptyState` | ui re-exports design-system ✅ |
| ProgressBar | `primitives/ProgressBar` (3) | `ProgressBar` | ui re-exports design-system ✅ |
| Spinner | `primitives/Spinner` (13) | `LoadingSpinner` (12) | ui aliases design-system ✅ |
| TabSwitch | `components/TabSwitch` (0) | `TabSwitch` (real impl) | **design-system re-exports ui ⚠️ (wrong direction)** |
| Search input | `SearchField` (primitive, 6) | `SearchBar` (wrapper, 35) | complementary, keep both |
| Copy | `CopyActionIcon`, `CopyIconButton` | `CopyChip` (39), `CopyableText` | fragmented |

**Root issue:** ownership flows both ways. There is no rule a developer can follow to know where a component should live or be imported from.

### 1.2 Status badges / pills — the worst duplication

- **10 dedicated** badge components (`StatusBadge`, `FbaStatusBadge`, `CarrierBadge`, `DaysLateBadge`, `QtyBadge`, `PlatformExternalChip`, `StatusChip`, `ActiveStaffChip`, `StatPill`, `PaneHeaderStatusPill`).
- **~18 separate `status → Tailwind color` maps** scattered across features. Verified exact duplicates:
  - `src/components/inventory/InventoryFilterChips.tsx`, `EventRow.tsx`, `ByFilterResultList.tsx` — **three identical** 15-status `STATUS_COLOR` maps.
  - `src/components/labels/UnitHistoryWorkspace.tsx` + `RecentlyPrintedList.tsx` — overlapping 10-status `STATUS_TONE` (and they *disagree* on some colors — a bug surface).
  - `src/components/fba/FbaBoardTable.tsx` (`STATUS_PILL_COLOR`) + `FbaFnskuChecklist.tsx` (`STATUS_CFG`) — overlapping FBA status maps, both separate from `FbaStatusBadge`.
  - `src/components/work-orders/SkuStockAssignPanel.tsx` (`STATUS_BADGE`) + `work-orders/types.ts` (`STATUS_COLOR`) — same statuses, different tones.
- **~25-35 fully inline** `rounded-full ... text-xs bg-x-100 text-x-700` pills with no shared component.

### 1.3 Overlays / modals / panels

- Shared primitives exist and are good: `BottomSheet` (10 imports, portaled, scroll-lock, esc, drag-dismiss), `SlideOverBackdrop` (8), `AssignmentOverlayCard` (1).
- But **64 files** hand-roll `fixed inset-0`, **30** hand-roll Escape listeners, **10** hand-roll `document.body.style.overflow` scroll-lock (several without restoring it → **latent bugs**: `StationDrawer`, `ResponsiveLayout`, `PhotoGallery`).
- **~50 distinct z-index values** (z-50 … z-[2147483647]) with no scale → real stacking conflicts (e.g. z-[118] vs z-[120]).
- **Zero focus-trap** anywhere — an accessibility gap across ~92 overlay surfaces.
- **82 `*Panel` components** each rebuild the same slide-over chrome (backdrop + fixed right + header + close + scroll body + footer).

### 1.4 Feedback states

- **151 files** with inline `animate-spin` despite `Spinner` existing.
- **3 skeleton libraries** (`design-system/Skeletons`, `ui/SkeletonCard`, `station/SkeletonRow`) + ~60 inline `animate-pulse` blocks.
- `EmptyState` exists but features build their own — e.g. a private `EmptySlate` in `UpNextOrder.tsx` (used 9×) **copy-pasted** into `MobileUpNextOrder.tsx`.
- `InlineNotice` (5 tones) exists but is used 14× while ~20-30 inline `bg-red-50` error banners exist.

### 1.5 Buttons & action bars

- `PrimaryButton` is fully featured (tones, sizes, mobile-adaptive, loading) but used in **2 files**. `ActionButtonGroup`, `ExternalLinkButton`, `DeleteButton` have **0** importers.
- ~25-30 ad-hoc button styles inline (`bg-gray-900 hover:bg-black`, `bg-blue-600`, etc.).
- `StickyActionBar` (10) used well, but 14 files roll custom `sticky bottom-0` footers.
- **Copy-to-clipboard is fragmented across 6 components + 21 inline** `navigator.clipboard.writeText` call sites.

### 1.6 Cards, forms, rows

- 5 shared card components but **160+ files** inline `rounded-lg border border-gray-200 bg-white shadow-sm`.
- `FormField` (2 imports), `SidebarIntakeFormField` (1) exist; **40+ inline** `<label><span/><input/></label>` field groups.
- **Detail-row sprawl**: `PanelRow` → `DetailLineRow` / `DetailsPanelRow` (thin wrappers differing only in divider color) + `MetricLineRow` (parallel reimpl) + orphaned `DetailCell`/`DetailGrid` (0 imports) + orphaned `PanelSection` (0 imports, despite being the intended wrapper).

### 1.7 Structural / data-fetching

- **8 god components** >1,000 lines: `LineEditPanel` (2,257), `ShippingInformationSection` (1,729), `StaffManagementTab` (1,454), `RackLabelPrinter` (1,255), `StaffAccessDetail` (1,223), `ReceivingSidebarPanel` (1,222), `StationFbaInput` (1,217), `MultiSkuSnBarcode` (1,158). Each mixes 12-31 `useState`, 8-26 `fetch()`, and 10-24 inline subcomponents.
- **600 raw `fetch()`** in the UI layer; **~70 components** repeat the `data/loading/error + useEffect` quartet.
- `useFetch`/`useMutation` (`src/hooks/_data.ts`) and `createCrudHandler` (`src/lib/api/crud.ts`, used by ~8/485 routes) exist but are under-adopted.
- React Query referenced in 111 files but with no shared query-key/factory convention → two coexisting paradigms.

---

## 2. Anti-patterns & how to fix them

| Anti-pattern | Symptom | Fix |
|---|---|---|
| **Bidirectional re-export shims** | design-system and ui import from each other | One-directional rule (§3) + thin deprecation shims only |
| **Orphaned primitives** | `PrimaryButton`/`ActionButtonGroup`/`FormField`/`PanelSection` ~0 imports while inline copies proliferate | Adopt or delete; lint rule against the inline equivalent |
| **Copy-paste color maps** | 18 `STATUS_*` maps | Single tone scale + colocated domain maps feeding one `<StatusPill>` (§4.2) |
| **Hand-rolled overlay plumbing** | 64 `fixed inset-0`, 30 esc, 10 scroll-lock (some leak) | `<Modal>`/`<SidePanel>` + `useBodyScrollLock`/`useEscapeClose` hooks (§4.3) |
| **Magic z-index** | ~50 distinct values | `z-index.ts` token scale (already exists in `design-system/tokens/z-index.ts` — enforce it) |
| **Fetch quartet in components** | ~70 components, 600 `fetch()` | `useFetch`/`useMutation` or RQ query factory (§4.4) |
| **God components** | 8 files >1k lines | Extract data hooks + inline subcomponents into colocated files (§4.6) |
| **Inline subcomponents** | 24 inner functions in one file | Promote to sibling files when reused or >~40 lines |
| **No focus trap** | 0 overlays trap focus | Bake into `<Modal>`/`<SidePanel>` once |

---

## 3. Proposed structure & ownership rule

Keep both folders, but give each **one job** and make imports flow **one direction only**: `components/ui` and features may import `design-system`; **`design-system` imports nothing app-specific.**

```
src/
  design-system/            # CONTEXT-FREE. No app hooks, no domain types, no fetch.
    tokens/                 # colors, spacing, radii, z-index, typography  (source of truth)
    foundations/            # breakpoints, motion, icons
    primitives/             # Button, IconButton, Input, Spinner, EmptyState, ProgressBar,
                            #   CardShell, FormField, PanelRow, Modal, SidePanel, Overlay
    components/             # composed-but-still-generic: StatusPill, TabSwitch, StatCard, shells
    hooks/                  # generic UI hooks: useBodyScrollLock, useEscapeClose, useFocusTrap
    providers/ themes/ utils/
    index.ts                # single public entrypoint

  components/
    ui/                     # APP-AWARE shared UI. May use design-system + app hooks + domain.
                            #   CopyChip (SKU parsing), SearchBar (mobile UX), badges-with-domain
    <feature>/              # feature-owned components (receiving, fba, shipped, …)

  hooks/                    # app data hooks (_data.ts useFetch/useMutation live here)
  lib/                      # non-UI logic (api/crud.ts, auth, domain, etc.)
```

**Rules to enforce (eslint `no-restricted-imports` + a `knip`/depcruise check — you already run depcruise):**

1. `design-system/**` may **not** import from `@/components`, `@/hooks` (app), `@/lib` (domain), or feature dirs.
2. A shared component lives in `design-system` if it has **no** app/domain dependency; otherwise `components/ui`.
3. **No bidirectional re-exports.** A re-export shim is allowed only as a *temporary, one-directional deprecation* with a `@deprecated` JSDoc and a tracking note.
4. Feature code imports shared UI from `@/design-system` or `@/components/ui` — never reaches into another feature's folder.

**Immediate cleanups under this rule:**
- Fix the **TabSwitch direction**: move the real impl to `design-system/components/TabSwitch` (it's generic), make `components/ui/TabSwitch` the deprecation shim — not the other way around.
- Delete dead code: `CompactSearchInput` (0), `DetailCell`+`DetailGrid` (0), `AlertLineRow` (0), and unused button primitives if not adopted.
- Resurrect `PanelSection` as the detail-panel wrapper (see §4.5).

---

## 4. Concrete refactors (with code)

### 4.1 Phase 0 — Lock layering, kill shims (low risk, ~1 day)

Add an ESLint guard so the rule can't regress:

```jsonc
// .eslintrc / eslint.config — no-restricted-imports for the design-system boundary
{
  "files": ["src/design-system/**/*.{ts,tsx}"],
  "rules": {
    "no-restricted-imports": ["error", {
      "patterns": [
        { "group": ["@/components/*", "@/hooks/*", "@/lib/*", "@/features/*", "@/contexts/*"],
          "message": "design-system must stay context-free. Move app-aware code to components/ui." }
      ]
    }]
  }
}
```

Standardize re-export shims to one direction with a deprecation marker:

```tsx
// src/components/ui/EmptyState.tsx  (KEEP as a one-line shim — already correct)
/** @deprecated Import from '@/design-system' instead. Shim kept for back-compat. */
export { EmptyState } from '@/design-system/primitives/EmptyState';
```

### 4.2 Phase 1 — One StatusPill + colocated tone maps (low risk, high payoff, ~2-3 days)

**Step 1.** A single generic pill keyed by *semantic tone*, not raw colors. Tones map to existing color tokens.

```tsx
// src/design-system/components/StatusPill.tsx
import { clsx } from 'clsx';

export type StatusTone =
  | 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent' | 'muted';

const TONE_CLASS: Record<StatusTone, string> = {
  neutral: 'bg-gray-100 text-gray-700 ring-gray-200',
  info:    'bg-blue-100 text-blue-700 ring-blue-200',
  success: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
  warning: 'bg-amber-100 text-amber-800 ring-amber-200',
  danger:  'bg-red-100 text-red-700 ring-red-200',
  accent:  'bg-purple-100 text-purple-700 ring-purple-200',
  muted:   'bg-gray-50 text-gray-500 ring-gray-200',
};

export function StatusPill({
  tone = 'neutral', children, dot = false, size = 'sm', className,
}: {
  tone?: StatusTone; children: React.ReactNode; dot?: boolean;
  size?: 'sm' | 'md'; className?: string;
}) {
  return (
    <span className={clsx(
      'inline-flex items-center gap-1 rounded-full font-semibold ring-1 ring-inset',
      size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
      TONE_CLASS[tone], className,
    )}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />}
      {children}
    </span>
  );
}
```

**Step 2.** Replace each duplicated color map with a colocated `status → { tone, label }` table that feeds `StatusPill`. Example for the 3 identical inventory maps:

```ts
// src/components/inventory/inventory-status.ts   (NEW — single source)
import type { StatusTone } from '@/design-system/components/StatusPill';

export const INVENTORY_STATUS: Record<string, { tone: StatusTone; label: string }> = {
  IN_STOCK:   { tone: 'success', label: 'In stock' },
  LOW:        { tone: 'warning', label: 'Low' },
  OUT:        { tone: 'danger',  label: 'Out' },
  // …the 15 statuses, defined once
};
```

```tsx
// InventoryFilterChips.tsx / EventRow.tsx / ByFilterResultList.tsx — all three now:
import { StatusPill } from '@/design-system/components/StatusPill';
import { INVENTORY_STATUS } from './inventory-status';

const s = INVENTORY_STATUS[status] ?? { tone: 'neutral', label: status };
return <StatusPill tone={s.tone}>{s.label}</StatusPill>;
```

Do the same for `labels/*` (`STATUS_TONE`), `work-orders/*` (`STATUS_BADGE`/`STATUS_COLOR`), and fold `FbaBoardTable`/`FbaFnskuChecklist` into `FbaStatusBadge`. **Net: ~18 maps → ~6 colocated tables + 1 component, and the label/work-order color disagreements get resolved.**

> Keep domain-specific badges (`CarrierBadge`, `DaysLateBadge` with its day-threshold logic) as thin wrappers around `StatusPill` rather than deleting them.

### 4.3 Phase 2 — Overlay primitives (medium risk, ~1 week)

**Step 1. Extract the duplicated plumbing into hooks.**

```ts
// src/design-system/hooks/useBodyScrollLock.ts
import { useEffect } from 'react';
export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;   // capture & restore — fixes the leak bugs
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [active]);
}
```

```ts
// src/design-system/hooks/useEscapeClose.ts
import { useEffect } from 'react';
export function useEscapeClose(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, onClose]);
}
```

**Step 2. A `<SidePanel>` that absorbs the 82 `*Panel` chrome reimplementations.** Wraps the existing `SlideOverBackdrop` + `PaneHeader`.

```tsx
// src/design-system/components/SidePanel.tsx
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { SlideOverBackdrop } from '@/components/ui/SlideOverBackdrop';
import { PaneHeader } from '@/components/ui/pane-header/PaneHeader';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { zIndex } from '../tokens/z-index';

export function SidePanel({
  open, onClose, title, eyebrow, icon, actions, footer, width = 480, children,
}: {
  open: boolean; onClose: () => void;
  title: React.ReactNode; eyebrow?: React.ReactNode; icon?: React.ReactNode;
  actions?: React.ReactNode; footer?: React.ReactNode; width?: number;
  children: React.ReactNode;
}) {
  useBodyScrollLock(open);
  useEscapeClose(open, onClose);
  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <SlideOverBackdrop onClick={onClose} />
          <motion.aside
            role="dialog" aria-modal="true"
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            style={{ width, zIndex: zIndex.panel }}
            className="fixed inset-y-0 right-0 flex flex-col bg-white shadow-2xl"
          >
            <PaneHeader leftSlot={<>{icon}{eyebrow}{title}</>} rightSlot={actions} onClose={onClose} />
            <div className="flex-1 overflow-y-auto">{children}</div>
            {footer && <div className="border-t border-gray-100 p-3">{footer}</div>}
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
```

A sibling `<Modal>` (centered dialog variant) shares the same two hooks + portal + a `useFocusTrap`. Migrate the ~15 inline `fixed inset-0` modals (`ReceivingAuditModal`, `KpiDetailsModal`, `SwitchStaffSheet`, `StepUpModal`, `OrderSyncDialog`, …) onto it.

**Step 3. Enforce the z-index scale** (already at `src/design-system/tokens/z-index.ts` — extend with `panel`, `modal`, `modalNested`, `commandPalette`, `toast` and ban raw `z-[…]` in overlays via lint).

### 4.4 Phase 3 — Fetch quartet → existing hooks (medium risk, incremental)

You already have the hooks. Standardize on them; migrate opportunistically (and inside the god-component work in §4.6).

```tsx
// BEFORE — repeated ~70× (e.g. MultiSkuSnBarcode.tsx)
const [title, setTitle] = useState<string|null>(null);
const [loading, setLoading] = useState(false);
const [error, setError] = useState<string|null>(null);
useEffect(() => {
  let active = true;
  setLoading(true);
  fetch(`/api/get-title-by-sku?sku=${sku}`)
    .then(r => r.json())
    .then(d => { if (active) setTitle(d.title); })
    .catch(e => { if (active) setError(String(e)); })
    .finally(() => { if (active) setLoading(false); });
  return () => { active = false; };
}, [sku]);

// AFTER — useFetch already handles race conditions + loading + error
import { useFetch } from '@/hooks/_data';
const { data, loading, error } = useFetch(
  () => fetch(`/api/get-title-by-sku?sku=${sku}`).then(r => r.json()),
  [sku],
);
const title = data?.title ?? null;
```

For mutations, use the existing `useMutation` from `_data.ts`. **Decision (2026-06-01): React Query is the standard** for *server* data shared across components (already in 111 files). Add a shared query-key factory and migrate in-house `useFetch` usages toward it over time; keep `useFetch`/`useMutation` for purely local one-off fetches.

```ts
// src/queries/keys.ts
export const qk = {
  receivingLine: (id: string) => ['receiving-line', id] as const,
  skuTitle: (sku: string) => ['sku-title', sku] as const,
};
```

### 4.5 Phase 4 — Card / field / row primitives (medium risk)

**InlineCard** to absorb the 160+ inline card surfaces:

```tsx
// src/design-system/primitives/InlineCard.tsx
import { clsx } from 'clsx';
export function InlineCard({ as: As = 'div', tone = 'plain', className, ...rest }: {
  as?: React.ElementType; tone?: 'plain' | 'warning' | 'danger'; className?: string;
} & React.HTMLAttributes<HTMLElement>) {
  const tones = {
    plain:   'border-gray-200 bg-white',
    warning: 'border-amber-300 bg-amber-50',
    danger:  'border-red-200 bg-red-50',
  };
  return <As className={clsx('rounded-lg border shadow-sm', tones[tone], className)} {...rest} />;
}
```

**Field group** — adopt the existing `FormField`; merge `SidebarIntakeFormField` into it via a `variant` prop, then codemod the 40+ inline `<label><span/><input/></label>` groups.

**Detail rows** — collapse `DetailLineRow`/`DetailsPanelRow`/`MetricLineRow` into one `PanelRow` with a `variant` prop, delete orphaned `DetailCell`/`DetailGrid` (or document + adopt), and **resurrect `PanelSection`** as the wrapper the shipped/FBA detail panels currently fake with bare `<div className="space-y-3">`.

### 4.6 Phase 5 — God-component decomposition (high risk, do last, per-file)

Pattern, using `LineEditPanel.tsx` (2,257 lines) as the template:

1. **Extract the data layer** into `useReceivingLineMutations(lineId)` returning `{ persistPoNumber, persistTracking, persistSerial, saving, error }` (built on `useMutation`). Removes ~8-10 inline fetch callbacks.
2. **Promote inline subcomponents** (24 of them) to sibling files: `ReceiveProgressToast`, serial rows, accordion sections → `src/components/receiving/workspace/line-edit/`.
3. **Lift form state** into a `useReducer` or a colocated `useLineEditForm` hook (31 `useState` → one reducer).
4. Target: 2,257 → ~600-line orchestrator + colocated parts. Do one god component per PR, behind the existing E2E specs (`scripts/e2e-*.mjs`).

---

## 5. Suggested sequencing (safe, incremental)

| Phase | Work | Risk | Verify with |
|---|---|---|---|
| 0 | Layering rule + ESLint guard + fix TabSwitch direction + delete dead code | Low | `npm run lint`, `npm run diagrams:check`, `knip` |
| 1 | `StatusPill` + colocate the 18 status maps | Low | Visual diff on inventory/labels/fba/work-orders |
| 2 | Overlay hooks + `<SidePanel>`/`<Modal>` + z-index scale; migrate 5-10 modals first | Med | Manual + existing E2E |
| 3 | Adopt `useFetch`/`useMutation`; query-key factory | Med | Per-component, watch network tab |
| 4 | `InlineCard`, `FormField` adoption, detail-row collapse, `PanelSection` | Med | Visual diff |
| 5 | God components, one per PR | High | E2E specs + `verify` skill |
| ongoing | Spinner/Skeleton/EmptyState/Copy adoption via codemods | Low | lint + visual |

**Guardrails throughout:** each phase is its own branch/PR; run `npm run lint` + `npm run diagrams:check` + relevant `test:*`/`e2e` scripts; prefer codemods (jscodeshift/ts-morph) for the high-count mechanical replacements (spinners, cards, field groups) so changes are reviewable and reversible.

---

## 6. Quick-win checklist (first PR, all low-risk)

Status as of branch `refactor/dedup-phase-0-1` (2026-06-01). `npx tsc --noEmit` → 0 errors; `depcruise` → 0 errors, 32 warnings.

- [x] Add the design-system import-boundary rule — implemented in **dependency-cruiser** (`.dependency-cruiser.cjs`, rule `design-system-stays-generic`), *not* ESLint. The project has **no** project-level ESLint config (only `next lint` defaults); creating an ESLint flat config from scratch was judged not-low-risk. Severity is `warn` because there are **32 pre-existing violations** (the `@/components/Icons` barrel, plus genuinely mis-filed code like `WorkOrderAssignmentCard → @/components/work-orders/*` and `MobileScanSheet → @/lib/scan-resolver`). Drive these to zero in a follow-up, then flip to `error`.
- [x] Flip TabSwitch — real impl now lives in `design-system/components/TabSwitch.tsx`; `components/ui/TabSwitch.tsx` is a `@deprecated` one-line shim pointing at it. Both existing importers keep working.
- [x] Delete confirmed dead code: `CompactSearchInput`, `AlertLineRow` (+ barrel + `DESIGN_SYSTEM.md` references). **NOTE:** `DetailCell`/`DetailGrid` were NOT deleted — each is used in 5 station up-next card files (the audit miscounted barrel re-exports as the only reference).
- [x] Dedupe the 3 inventory `STATUS_COLOR` maps → single source `src/components/inventory/status-classes.ts` (`inventoryStatusBadgeClass` / `inventoryStatusChipClass`). **Zero visual change** — exact prior classes preserved per variant (badge vs ring-chip, the `gray-500` null case, `gray-600` miss case, `red-100` SCRAPPED). **Refinement learned here:** a coarse 7-tone `StatusPill` would have visually regressed these (e.g. `STOCKED` green vs `TESTED` emerald both collapse to "success"). So the generalizable pattern is **colocated `status → {tone|classes}` table per domain**, feeding `StatusPill` only where its tones suffice. `StatusPill` itself is deferred to the next PR (to avoid shipping an unused primitive — the very anti-pattern we're fixing).
- [x] Extract `useBodyScrollLock` + `useEscapeClose` (`src/design-system/hooks/`, exported from the DS barrel). **Additive only.** Migrating the 10 scroll-lock / 30 Escape sites onto them (and fixing the leak bugs) is intentionally a **separate PR** so this one stays mechanically safe and reviewable.

---

## 7. Phase 2 progress — overlay-hook adoption (branch `refactor/dedup-phase-2-overlay-hooks`)

Migrated the **scroll-lock cluster** (9 of the 10 sites) onto `useBodyScrollLock`, plus the Escape handlers that lived in those same files onto `useEscapeClose`. `npx tsc --noEmit` → 0 errors.

| File | Change | Bug fixed |
|---|---|---|
| `receiving/workspace/ReceivingAuditModal.tsx` | combined overflow+esc effect → both hooks | — |
| `features/operations/components/KpiDetailsModal.tsx` | overflow+esc effects → hooks; dropped unused `useEffect` | — |
| `sidebar/RepairSidebarPanel.tsx` | scroll-lock → hook | — |
| `sidebar/SalesSidebarPanel.tsx` | scroll-lock → hook | — |
| `repair/RepairPickupFlow.tsx` | scroll-lock → hook; dropped unused `useEffect` | — |
| `repair/mobile/AddRepairActionSheet.tsx` | scroll-lock → hook; dropped unused `useEffect` | — |
| `station/StationDrawer.tsx` | overflow+esc → hooks | **yes** — set `overflow` without capturing prior value |
| `layout/ResponsiveLayout.tsx` | scroll-lock → hook | **yes** — restored to `''` instead of prior value |
| `shipped/PhotoGallery.tsx` | 3 imperative `overflow` sets → one `useBodyScrollLock(viewerOpen)` | **yes** — restored to `''`; multi-key keydown effect left intact |

`components/ui/BottomSheet.tsx` deliberately **not** migrated — it is the correct reference implementation (portal + scroll-lock + esc + drag-dismiss) others should eventually compose.

**Deferred:** the ~28 standalone Escape-only sites are mostly popovers/dropdowns with intertwined click-outside logic, so `useEscapeClose` alone isn't the full story — they want a dedicated `Popover` / `useOnClickOutside` pass, not a blind swap.
