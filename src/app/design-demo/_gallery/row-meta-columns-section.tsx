'use client';

/**
 * Row meta-columns — locking the title's "qty · condition · rest" subrow into
 * fixed virtual columns, the same way `ChipColumns` already locks the identity
 * chips on the right edge.
 *
 * The dashboard order-row pattern (title → meta subrow → chip columns) is copied
 * across five desktop tables, but the LEFT subrow has drifted:
 *   • OrdersQueue + Shipped render a fixed grid  →  qty | condition | rest
 *   • Tech + Packer render a free-flow "qty • condition" with a bullet, a
 *     heavier font, and a different title size — so nothing aligns row-to-row.
 *
 * This section previews a single primitive — `RowMetaColumns` + `META_COL` —
 * that mirrors `ChipColumns`/`CHIP_COL`, and shows every desktop table rendered
 * through it so the qty sits directly under the title and the condition column
 * lines up down every row. Flip Before/After and toggle the column guides to
 * see the lock. Self-contained showroom code — it does NOT import the
 * production tables or chips; promotes to @/components/ui/RowMetaColumns.
 */

/* ════════════════════════════════════════════════════════════════════════════
 *                    PROMOTION → SYSTEM · IMPLEMENTATION PLAN
 * ────────────────────────────────────────────────────────────────────────────
 * This section is the approved prototype for two reusable primitives + one
 * pattern. Below is the step-by-step plan to land them in the real app. Work it
 * top-to-bottom; each numbered step is independently shippable on `main`.
 *
 * ── WHAT WE'RE PROMOTING ────────────────────────────────────────────────────
 *   A. RowMetaColumns + RowTitle  — the title row + its "qty · condition · rest"
 *      subrow, indented so qty lines up under the TITLE text (not the dot),
 *      qty/condition content-width with a pr-2.5 breather after qty so heavy
 *      counts (100/100) stay clear. Left-side mirror of ChipColumns/CHIP_COL.
 *   B. Delivery-state ICONS + tooltip — STALLED / NO TRACKING # / PENDING
 *      CARRIER / DELIVERED·NOT SCANNED / ARRIVING TODAY / IN TRANSIT collapse
 *      from text suffixes to one glyph with a SiteTooltipProvider hover label.
 *   C. Staff initials as color-only letters + hover tooltip (tech / packer).
 *
 * ── STEP 1 · Land the primitive (no table changes yet) ──────────────────────
 *   • New file  src/components/ui/RowMetaColumns.tsx  exporting:
 *       - RowTitle({ dot, title, small?, dotTrack='w-5' })
 *       - RowMetaColumns({ qty, condition, rest?, indent=META_COL.indent })
 *       - META_COL = { indent: '1.25rem' }  (the default dot-track width)
 *     Copy the JSX verbatim from this file's RowTitle / RowMetaColumns, minus
 *     the `showGuides` prop (debug-only — drop it for production).
 *   • Typography: swap the literal text-[10px]/text-[13px] for the real tokens
 *       title  → text-label font-bold text-gray-900   (presets/typography)
 *       meta   → text-micro font-bold text-gray-500 uppercase tracking-widest
 *     so it matches the tokens OrdersQueue/Shipped already use.
 *   • INVARIANT: RowMetaColumns `indent` MUST equal RowTitle `dotTrack` width
 *     (w-5→1.25rem, w-7→1.75rem). Document this next to META_COL.
 *
 * ── STEP 2 · Delivery-state icon set (receiving) ────────────────────────────
 *   • Add to the existing receiving display primitives (see memory:
 *     receiving-display-primitives / src/components/station/receiving-constants
 *     + ReceivingIdentityChips) a DELIVERY_STATE_ICON map keyed by the same
 *     delivery_state union ReceivingLinesTable already switches on
 *     (STALLED | AWAITING_TRACKING | PENDING_CARRIER | DELIVERED_UNOPENED |
 *      ARRIVING_TODAY | IN_TRANSIT) → { Icon, tone, label }. Reuse the icon
 *     choices proven here (AlertTriangle/Hash/Clock/Inbox/Truck/MapPin).
 *   • New tiny shared helper IconWithTooltip (or fold into the chip layer):
 *     wraps an icon with useSiteTooltipOptional() activate/scheduleClose and a
 *     native `title` fallback — exactly the StateIcon/StaffInitial pattern here.
 *
 * ── STEP 3 · Migrate the five desktop tables (one PR each, in this order) ────
 *   1. shipped/DashboardShippedTable.tsx   ← PILOT, pixel-identical refactor:
 *        replace the inline grid-cols-[1.25rem_3rem_auto] block with
 *        <RowMetaColumns rest={<StaffInitials …/>} />; switch StaffInitials to
 *        color-only letters + tooltip (Step C). Validates the primitive.
 *   2. dashboard/OrdersQueueTable.tsx       ← same swap; rest = days-late /
 *        out-of-stock nodes. Should be visually identical.
 *   3. TechTable.tsx  +  4. PackerTable.tsx ← VISIBLE change: drop the
 *        "qty • condition" bullet + text-eyebrow/font-black + text-caption
 *        title; route through RowTitle + RowMetaColumns (normalizes title to
 *        text-label). This is the consistency win.
 *   5. station/ReceivingLinesTable.tsx      ← RowTitle dotTrack="w-7",
 *        RowMetaColumns indent="1.75rem" (fits "0/1"…"100/100"); rest = the
 *        workflow icon + <DeliveryStateIcon> from Step 2 (delete the
 *        deliveryStateMeta text-suffix branch).
 *
 * ── STEP 4 · Mobile parity (optional, separate pass) ────────────────────────
 *   • mobile/packer/MobilePackingRow, mobile/receiving/MobileReceivingRow et al
 *     render their own title/meta — adopt RowTitle/RowMetaColumns there too, or
 *     leave as-is if the desktop unification is enough for now.
 *
 * ── STEP 5 · Guardrails & cleanup ───────────────────────────────────────────
 *   • Co-locate META_COL next to CHIP_COL conceptually; cross-reference in both
 *     files' comments so the left/right column systems stay in sync.
 *   • Keep this /design-demo section as the living showroom (per the 2026
 *     component-adoption initiative); update it if the primitive's API changes.
 *   • SiteTooltipProvider already wraps the app (components/Providers.tsx) — no
 *     wiring needed; the native-title fallback covers any isolated render.
 *   • Verify against the audit set (the 5 tables above) — no other file renders
 *     the title+meta subrow, so nothing else needs touching.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import { cx, type Density } from './sections';
import { useSiteTooltipOptional } from '@/components/providers/SiteTooltipProvider';

/* ════════════════════ candidate primitive (preview only) ═══════════════════ */

/**
 * Fixed virtual-column widths for the meta subrow — the left-side mirror of
 * CHIP_COL. qty gets one short track, condition a slightly wider one, and the
 * trailing `auto` track holds whatever each table puts after condition (staff
 * initials, days-late, out-of-stock…). Promotes to @/components/ui/RowMetaColumns.
 */
export const META_COL = {
  qty: '1.25rem', // single qty digit / short count
  condition: '3rem', // USED / NEW / N/A
} as const;

interface MetaColumn {
  key: string;
  node: ReactNode;
  className?: string;
}

/**
 * Locked-width grid: qty | condition | auto(rest). Same wrapper typography for
 * every table, so the subrow can never drift again. `showGuides` paints the
 * track boundaries so the lock is visible in the showroom.
 */
export function RowMetaColumns({
  qty,
  condition,
  rest,
  showGuides,
  indent = META_COL.qty,
}: {
  qty: ReactNode;
  condition: ReactNode;
  rest?: ReactNode;
  showGuides?: boolean;
  /**
   * Left indent so the subrow's first item (qty) lines up with the TITLE text,
   * not the dot. Pass the dot-track width used by RowTitle (w-5 → 1.25rem,
   * w-7 → 1.75rem). qty stays left-aligned and content-width, so a wide count
   * like "100/100" grows in place instead of forcing a big fixed gap.
   */
  indent?: string;
}) {
  return (
    <div
      className="relative mt-0.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-500 min-w-0"
      style={{ paddingLeft: indent }}
    >
      {showGuides ? (
        <span
          className="pointer-events-none absolute inset-y-0 w-px bg-blue-400/50"
          style={{ left: indent }}
        />
      ) : null}
      {/* Extra right padding on qty so a heavy count (100/100) keeps clear air
          before the condition, without reserving a fixed gap for small counts. */}
      <span className="shrink-0 pr-2.5">{qty}</span>
      <span className="shrink-0 truncate">{condition}</span>
      <span className="flex min-w-0 items-center gap-2 truncate">{rest}</span>
    </div>
  );
}

/* ════════════════════════════ mock chip furniture ══════════════════════════ */

const CHIP_COL = {
  platform: 'w-[92px]',
  id: 'w-[64px]',
  tracking: 'w-[64px]',
  serial: 'w-[64px]',
} as const;

function Pill({ children, mono = true }: { children: ReactNode; mono?: boolean }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-700 ring-1 ring-gray-200',
        mono && 'font-mono',
      )}
    >
      {children}
    </span>
  );
}

function PlatformPill({ label, tone }: { label: string; tone: string }) {
  return (
    <span className={cx('text-[10px] font-bold uppercase tracking-wide', tone)}>{label}</span>
  );
}

/**
 * Tech / packer staff — color-only initials (no filled chip), full name on hover
 * via the site-wide SiteTooltipProvider. Falls back to a native title attribute
 * when the provider isn't mounted (e.g. an isolated render).
 */
function StaffInitial({ initials, name, tone }: { initials: string; name: string; tone: string }) {
  const anchorId = useId();
  const ref = useRef<HTMLSpanElement | null>(null);
  const ctx = useSiteTooltipOptional();
  const getRect = useCallback(() => ref.current?.getBoundingClientRect() ?? null, []);
  return (
    <span
      ref={ref}
      onMouseEnter={() => ctx?.activate({ anchorId, value: name, getRect })}
      onMouseLeave={() => ctx?.scheduleClose(anchorId)}
      title={ctx ? undefined : name}
      className={cx('cursor-default text-[11px] font-black tracking-wide', tone)}
    >
      {initials}
    </span>
  );
}

type ChipCell = { key: string; width: string; node: ReactNode };

function MockChipColumns({ columns }: { columns: ChipCell[] }) {
  return (
    <div className="flex shrink-0 items-center justify-end gap-0.5 pr-1 -mr-1.5">
      {columns.map((c) => (
        <div key={c.key} className={cx('flex items-center justify-end', c.width)}>
          {c.node}
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════ row scaffolds ═════════════════════════════ */

const densityPad: Record<Density, string> = {
  compact: 'py-1',
  cozy: 'py-1.5',
  comfortable: 'py-2.5',
};

function RowShell({
  children,
  density,
  stripe,
}: {
  children: ReactNode;
  density: Density;
  stripe?: boolean;
}) {
  return (
    <div
      className={cx(
        'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-gray-200 px-3',
        densityPad[density],
        stripe ? 'bg-gray-50/40' : 'bg-white',
      )}
    >
      {children}
    </div>
  );
}

export function RowTitle({
  dot,
  title,
  small,
  dotTrack = 'w-5',
}: {
  dot: string;
  title: string;
  small?: boolean;
  /** Width of the centered dot track — match the qty track so the dot and the
   *  qty number share a center line. Default w-5 (1.25rem). */
  dotTrack?: string;
}) {
  return (
    <div className="flex min-w-0 items-center">
      {/* Dot centered inside the qty-track width so it shares the qty column's
          center line — the qty number sits directly under the dot. */}
      <span className={cx('flex shrink-0 items-center justify-center', dotTrack)}>
        <span className={cx('h-2 w-2 rounded-full', dot)} />
      </span>
      <div
        className={cx(
          'truncate font-bold text-gray-900',
          small ? 'text-[12px]' : 'text-[13px]',
        )}
      >
        {title}
      </div>
    </div>
  );
}

/* ─────────────────────────── mock table dataset ──────────────────────────── */

type RowData = {
  table: string;
  dot: string;
  title: string;
  qty: number;
  condition: string;
  rest?: ReactNode;
  chips: ChipCell[];
};

const yellow = (n: number) => (n > 1 ? 'text-yellow-600' : '');
const newTone = (c: string) => (c.toLowerCase() === 'new' ? 'text-yellow-600' : '');

const ROWS: RowData[] = [
  {
    table: 'OrdersQueue',
    dot: 'bg-yellow-400',
    title: 'Razer BlackWidow V4 Pro Mechanical Keyboard',
    qty: 1,
    condition: 'NEW',
    rest: <span className="text-red-600">2D</span>,
    chips: [
      { key: 'p', width: CHIP_COL.platform, node: <PlatformPill label="AMZN" tone="text-orange-600" /> },
      { key: 'id', width: CHIP_COL.id, node: <Pill>4821</Pill> },
      { key: 't', width: CHIP_COL.tracking, node: <Pill>9302</Pill> },
    ],
  },
  {
    table: 'Shipped',
    dot: 'bg-emerald-500',
    title: 'Bose QuietComfort Ultra Headphones',
    qty: 4,
    condition: 'USED',
    rest: (
      <>
        <StaffInitial initials="SA" name="Sara Ahmed" tone="text-violet-600" />
        <StaffInitial initials="TH" name="Tariq Hassan" tone="text-rose-600" />
      </>
    ),
    chips: [
      { key: 'p', width: CHIP_COL.platform, node: <PlatformPill label="EBAY" tone="text-blue-600" /> },
      { key: 'id', width: CHIP_COL.id, node: <Pill>7715</Pill> },
      { key: 't', width: CHIP_COL.tracking, node: <Pill>4408</Pill> },
      { key: 's', width: CHIP_COL.serial, node: <Pill>A93F</Pill> },
    ],
  },
  {
    table: 'Tech',
    dot: 'bg-sky-500',
    title: 'Replacement Bose Ear Cushions Kit',
    qty: 1,
    condition: 'USED',
    chips: [
      { key: 'p', width: CHIP_COL.platform, node: <PlatformPill label="WMT" tone="text-blue-700" /> },
      { key: 'id', width: CHIP_COL.id, node: <Pill>3120</Pill> },
      { key: 't', width: CHIP_COL.tracking, node: <Pill>6651</Pill> },
      { key: 's', width: CHIP_COL.serial, node: <Pill>C20B</Pill> },
    ],
  },
  {
    table: 'Packer',
    dot: 'bg-emerald-500',
    title: 'Logitech MX Master 3S Wireless Mouse',
    qty: 2,
    condition: 'NEW',
    chips: [
      { key: 'p', width: CHIP_COL.platform, node: <PlatformPill label="AMZN" tone="text-orange-600" /> },
      { key: 'id', width: CHIP_COL.id, node: <Pill>9087</Pill> },
      { key: 't', width: CHIP_COL.tracking, node: <Pill>1245</Pill> },
    ],
  },
  {
    table: 'ReceivingLines',
    dot: 'bg-amber-500',
    title: 'Anker 737 Power Bank (PowerCore 24K)',
    qty: 6,
    condition: 'USED',
    chips: [
      { key: 'p', width: CHIP_COL.platform, node: <PlatformPill label="PO" tone="text-gray-500" /> },
      { key: 'id', width: CHIP_COL.id, node: <Pill>2210</Pill> },
      { key: 't', width: CHIP_COL.tracking, node: <Pill>8830</Pill> },
      { key: 's', width: CHIP_COL.serial, node: <Pill>F71D</Pill> },
    ],
  },
];

/* ─────────────────── "before": each table's current subrow ─────────────────── */

// OrdersQueue + Shipped already use a locked grid; Tech/Packer/Receiving use the
// free-flow "qty • condition" inline treatment. This reproduces that drift.
const LOCKED_TODAY = new Set(['OrdersQueue', 'Shipped']);

function BeforeMeta({ row }: { row: RowData }) {
  if (LOCKED_TODAY.has(row.table)) {
    return (
      <div
        className="mt-0.5 grid items-center text-[10px] font-bold uppercase tracking-widest text-gray-500"
        style={{ gridTemplateColumns: '1.25rem 3rem auto' }}
      >
        <span className={yellow(row.qty)}>{row.qty}</span>
        <span className={cx('truncate', newTone(row.condition))}>{row.condition}</span>
        <span className="flex items-center gap-2 truncate">{row.rest}</span>
      </div>
    );
  }
  // Tech / Packer / Receiving — inline bullet, heavier font, pl-4 indent.
  return (
    <div className="mt-0.5 truncate pl-4 text-[10px] font-black uppercase tracking-widest text-gray-500">
      <span className={yellow(row.qty)}>{row.qty}</span> • {row.condition}
    </div>
  );
}

/* ════════════════════════════ showroom furniture ═══════════════════════════ */

function Tag({ kind }: { kind: 'before' | 'after' }) {
  return kind === 'before' ? (
    <span className="inline-flex items-center rounded-full bg-rose-500/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-600 ring-1 ring-rose-500/20">
      Before · drift
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-600 ring-1 ring-emerald-500/20">
      After · locked
    </span>
  );
}

function TableMock({
  children,
  label,
  kind,
}: {
  children: ReactNode;
  label: string;
  kind: 'before' | 'after';
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border-soft bg-white">
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50/70 px-3 py-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">{label}</span>
        <Tag kind={kind} />
      </div>
      <div>{children}</div>
    </div>
  );
}

function TableLabelCell({ name }: { name: string }) {
  return (
    <span className="hidden w-[120px] shrink-0 truncate pr-2 font-mono text-[9px] uppercase text-gray-400 sm:inline">
      {name}
    </span>
  );
}

/* ═══════════════════════════════ the section ═══════════════════════════════ */

export function RowMetaColumnsSection({ density }: { density: Density }) {
  const [after, setAfter] = useState(true);
  const [guides, setGuides] = useState(true);

  return (
    <div className="space-y-4">
      {/* control bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-0.5 rounded-xl bg-surface-card p-0.5 ring-1 ring-border-soft">
          {(['before', 'after'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setAfter(m === 'after')}
              className={cx(
                'rounded-lg px-3 py-1 text-[11px] font-semibold capitalize transition-colors',
                (m === 'after') === after
                  ? 'bg-surface-canvas text-text-default shadow-sm ring-1 ring-border-soft'
                  : 'text-text-muted hover:text-text-default',
              )}
            >
              {m === 'after' ? 'After (unified)' : 'Before (current)'}
            </button>
          ))}
        </div>
        <button
          onClick={() => setGuides((g) => !g)}
          className={cx(
            'rounded-xl px-3 py-1 text-[11px] font-semibold ring-1 transition-colors',
            guides
              ? 'bg-blue-500/10 text-blue-600 ring-blue-500/30'
              : 'bg-surface-card text-text-muted ring-border-soft hover:text-text-default',
          )}
        >
          {guides ? 'Hide column guides' : 'Show column guides'}
        </button>
        <p className="text-[11px] text-text-muted">
          {after
            ? 'All five tables routed through one RowMetaColumns primitive — the subrow indents to the title, qty is left-aligned and content-width, condition + rest flow after it.'
            : 'Current state: OrdersQueue + Shipped use a locked grid; Tech, Packer & Receiving free-flow the bullet — columns don’t line up.'}
        </p>
      </div>

      {/* the stacked tables — one combined viewport so cross-table alignment is obvious */}
      <TableMock
        label="Desktop order rows · all five tables stacked"
        kind={after ? 'after' : 'before'}
      >
        {ROWS.map((row, i) => (
          <RowShell key={row.table} density={density} stripe={i % 2 === 1}>
            <div className="flex min-w-0 items-center">
              <TableLabelCell name={row.table} />
              <div className="flex min-w-0 flex-1 flex-col">
                {/* title — After normalizes Tech/Packer to the larger text-label size */}
                <RowTitle
                  dot={row.dot}
                  title={row.title}
                  small={!after && !LOCKED_TODAY.has(row.table)}
                />
                {after ? (
                  <RowMetaColumns
                    showGuides={guides}
                    qty={<span className={yellow(row.qty)}>{row.qty}</span>}
                    condition={
                      <span className={newTone(row.condition)}>{row.condition}</span>
                    }
                    rest={row.rest}
                  />
                ) : (
                  <BeforeMeta row={row} />
                )}
              </div>
            </div>
            <MockChipColumns columns={row.chips} />
          </RowShell>
        ))}
      </TableMock>

      {/* anatomy callout */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border-soft bg-surface-card p-3">
          <p className="font-mono text-[10px] text-text-muted">indent</p>
          <p className="mt-1 text-[12px] font-bold text-text-default">= dot-track width</p>
          <p className="mt-0.5 text-[11px] leading-snug text-text-muted">
            The subrow starts at the title text, not the dot — qty lines up under the product name.
          </p>
        </div>
        <div className="rounded-xl border border-border-soft bg-surface-card p-3">
          <p className="font-mono text-[10px] text-text-muted">qty · condition</p>
          <p className="mt-1 text-[12px] font-bold text-text-default">content-width, flow</p>
          <p className="mt-0.5 text-[11px] leading-snug text-text-muted">
            Left-aligned and content-sized, so a wide count like 100/100 grows in place — no big reserved gap.
          </p>
        </div>
        <div className="rounded-xl border border-border-soft bg-surface-card p-3">
          <p className="font-mono text-[10px] text-text-muted">rest</p>
          <p className="mt-1 text-[12px] font-bold text-text-default">flex track</p>
          <p className="mt-0.5 text-[11px] leading-snug text-text-muted">
            Per-table extras: staff initials (Shipped), days-late / out-of-stock (Queue), state icon (Receiving).
          </p>
        </div>
      </div>
    </div>
  );
}
