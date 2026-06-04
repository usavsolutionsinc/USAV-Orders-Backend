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

import { useState, type ReactNode } from 'react';
import { cx, type Density } from './sections';

/* ════════════════════ candidate primitive (preview only) ═══════════════════ */

/**
 * Fixed virtual-column widths for the meta subrow — the left-side mirror of
 * CHIP_COL. qty gets one short track, condition a slightly wider one, and the
 * trailing `auto` track holds whatever each table puts after condition (staff
 * initials, days-late, out-of-stock…). Promotes to @/components/ui/RowMetaColumns.
 */
const META_COL = {
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
function RowMetaColumns({
  qty,
  condition,
  rest,
  showGuides,
}: {
  qty: ReactNode;
  condition: ReactNode;
  rest?: ReactNode;
  showGuides?: boolean;
}) {
  return (
    <div
      className={cx(
        'relative mt-0.5 grid items-center text-[10px] font-bold uppercase tracking-widest text-gray-500 min-w-0',
      )}
      style={{ gridTemplateColumns: `${META_COL.qty} ${META_COL.condition} auto` }}
    >
      {showGuides ? (
        <>
          <span
            className="pointer-events-none absolute inset-y-0 w-px bg-blue-400/50"
            style={{ left: META_COL.qty }}
          />
          <span
            className="pointer-events-none absolute inset-y-0 w-px bg-blue-400/50"
            style={{ left: `calc(${META_COL.qty} + ${META_COL.condition})` }}
          />
        </>
      ) : null}
      <span className="truncate">{qty}</span>
      <span className="truncate">{condition}</span>
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

function StaffDot({ initials, tone }: { initials: string; tone: string }) {
  return (
    <span
      className={cx(
        'inline-flex h-4 items-center rounded px-1 text-[9px] font-black tracking-wide',
        tone,
      )}
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

function RowTitle({ dot, title, small }: { dot: string; title: string; small?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className={cx('h-2 w-2 shrink-0 rounded-full', dot)} />
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
        <StaffDot initials="SA" tone="bg-violet-100 text-violet-700" />
        <StaffDot initials="TH" tone="bg-rose-100 text-rose-700" />
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
            ? 'All five tables routed through one RowMetaColumns primitive — qty | condition | rest lock to the same tracks.'
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
          <p className="font-mono text-[10px] text-text-muted">META_COL.qty</p>
          <p className="mt-1 text-[12px] font-bold text-text-default">1.25rem track</p>
          <p className="mt-0.5 text-[11px] leading-snug text-text-muted">
            Holds the count, tinted yellow when &gt; 1. Sits directly under the title.
          </p>
        </div>
        <div className="rounded-xl border border-border-soft bg-surface-card p-3">
          <p className="font-mono text-[10px] text-text-muted">META_COL.condition</p>
          <p className="mt-1 text-[12px] font-bold text-text-default">3rem track</p>
          <p className="mt-0.5 text-[11px] leading-snug text-text-muted">
            NEW / USED / N/A — aligned column-to-column down every row.
          </p>
        </div>
        <div className="rounded-xl border border-border-soft bg-surface-card p-3">
          <p className="font-mono text-[10px] text-text-muted">auto · rest</p>
          <p className="mt-1 text-[12px] font-bold text-text-default">flex track</p>
          <p className="mt-0.5 text-[11px] leading-snug text-text-muted">
            Per-table extras: staff initials (Shipped), days-late / out-of-stock (Queue).
          </p>
        </div>
      </div>
    </div>
  );
}
