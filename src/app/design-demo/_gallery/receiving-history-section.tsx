'use client';

/**
 * Receiving history — the same locked meta-columns treatment applied to the
 * inbound/receiving rows, with one extra move: the delivery states (STALLED,
 * NO TRACKING #, PENDING CARRIER, DELIVERED · NOT SCANNED, ARRIVING TODAY,
 * IN TRANSIT) become compact ICONS with a hover tooltip for the full context,
 * instead of the long text suffixes that overflow the row today.
 *
 * Reuses RowMetaColumns / RowTitle from the orders section so the qty | condition
 * | state columns lock the same way — receiving just uses a wider qty track for
 * the "received/expected" count (0/1). Self-contained showroom code; promotes
 * the icon+tooltip status set into station/ReceivingLinesTable. Tooltips ride on
 * the site-wide SiteTooltipProvider with a native-title fallback.
 */

import { useCallback, useId, useRef, useState, type ComponentType, type ReactNode } from 'react';
import {
  AlertTriangle,
  Hash,
  Clock,
  Inbox,
  Truck,
  MapPin,
} from '@/components/Icons';
import { cx, type Density } from './sections';
import { useSiteTooltipOptional } from '@/components/providers/SiteTooltipProvider';
import { RowMetaColumns, RowTitle } from './row-meta-columns-section';

/* ───────────────────────────── delivery states ──────────────────────────── */

type StateKey =
  | 'STALLED'
  | 'NO_TRACKING'
  | 'PENDING_CARRIER'
  | 'DELIVERED_UNOPENED'
  | 'ARRIVING_TODAY'
  | 'IN_TRANSIT';

// Each faceted delivery state → icon + tone + the full label shown on hover and
// the legacy text suffix used in the "Before" comparison. Mirrors the switch in
// station/ReceivingLinesTable.tsx (delivery_state).
const STATE: Record<
  StateKey,
  { Icon: ComponentType<{ className?: string }>; tone: string; label: string; text: string; textTone: string }
> = {
  STALLED: {
    Icon: AlertTriangle,
    tone: 'text-orange-600',
    label: 'Stalled — no carrier movement, needs attention',
    text: 'STALLED',
    textTone: 'text-orange-700 font-black',
  },
  NO_TRACKING: {
    Icon: Hash,
    tone: 'text-gray-400',
    label: 'No tracking number on file',
    text: 'NO TRACKING #',
    textTone: 'text-gray-500',
  },
  PENDING_CARRIER: {
    Icon: Clock,
    tone: 'text-gray-400',
    label: 'Pending carrier pickup',
    text: 'PENDING CARRIER',
    textTone: 'text-gray-500',
  },
  DELIVERED_UNOPENED: {
    Icon: Inbox,
    tone: 'text-rose-600',
    label: 'Delivered but not scanned in yet',
    text: 'DELIVERED · NOT SCANNED',
    textTone: 'text-rose-600 font-black',
  },
  ARRIVING_TODAY: {
    Icon: Truck,
    tone: 'text-amber-600',
    label: 'Arriving today',
    text: 'ARRIVING TODAY',
    textTone: 'text-amber-700 font-black',
  },
  IN_TRANSIT: {
    Icon: MapPin,
    tone: 'text-blue-600',
    label: 'In transit',
    text: 'IN TRANSIT',
    textTone: 'text-blue-700',
  },
};

/** A delivery-state glyph — full label on hover via SiteTooltipProvider. */
function StateIcon({ state }: { state: StateKey }) {
  const meta = STATE[state];
  const anchorId = useId();
  const ref = useRef<HTMLSpanElement | null>(null);
  const ctx = useSiteTooltipOptional();
  const getRect = useCallback(() => ref.current?.getBoundingClientRect() ?? null, []);
  return (
    <span
      ref={ref}
      onMouseEnter={() => ctx?.activate({ anchorId, value: meta.label, getRect })}
      onMouseLeave={() => ctx?.scheduleClose(anchorId)}
      title={ctx ? undefined : meta.label}
      aria-label={meta.label}
      className="inline-flex cursor-default items-center"
    >
      <meta.Icon className={cx('h-3.5 w-3.5', meta.tone)} />
    </span>
  );
}

/* ─────────────────────────────── mock chips ─────────────────────────────── */

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-700 ring-1 ring-gray-200">
      {children}
    </span>
  );
}

const RECV_CHIP = { po: 'w-[64px]', sku: 'w-[64px]', tracking: 'w-[64px]' } as const;

function ChipCols({ po, tracking }: { po: string; tracking?: string }) {
  return (
    <div className="flex shrink-0 items-center justify-end gap-0.5 pr-1 -mr-1.5">
      <div className={cx('flex items-center justify-end', RECV_CHIP.po)}>
        <Pill>{po}</Pill>
      </div>
      <div className={cx('flex items-center justify-end', RECV_CHIP.tracking)}>
        {tracking ? <Pill>{tracking}</Pill> : null}
      </div>
    </div>
  );
}

/* ──────────────────────────────── dataset ───────────────────────────────── */

type RecvRow = { title: string; qty: string; condition: string; state: StateKey; po: string; tracking?: string };
type RecvGroup = { date: string | null; rows: RecvRow[] };

const GROUPS: RecvGroup[] = [
  {
    date: null,
    rows: [
      { title: 'Bose Lifestyle V25 Music System', qty: '0/1', condition: 'NEW', state: 'STALLED', po: '4471', tracking: '8821' },
      { title: 'Bose Wave Radio CD Player AWRCC1', qty: '0/1', condition: 'NEW', state: 'NO_TRACKING', po: '4472' },
      { title: 'Sony STR-DH790 7.2 Receiver', qty: '0/1', condition: 'NEW', state: 'DELIVERED_UNOPENED', po: '4470', tracking: '3390' },
    ],
  },
  {
    date: 'TUE, MAY 19TH',
    rows: [
      { title: 'BOSE Wave Radio with Remote', qty: '0/1', condition: 'NEW', state: 'PENDING_CARRIER', po: '4465' },
      { title: 'Klipsch R-120SW Powered Subwoofer', qty: '0/1', condition: 'NEW', state: 'ARRIVING_TODAY', po: '4466', tracking: '7714' },
    ],
  },
  {
    date: 'MON, MAY 18TH',
    rows: [
      { title: 'BOSE WAVE MUSIC SYSTEM AWRCC2', qty: '0/1', condition: 'NEW', state: 'NO_TRACKING', po: '4458' },
      { title: 'Solder Paste Rosin Flux 10g/30cc', qty: '0/1', condition: 'NEW', state: 'PENDING_CARRIER', po: '4459' },
      { title: '2.1 Channel Subwoofer Amplifier', qty: '0/1', condition: 'NEW', state: 'IN_TRANSIT', po: '4460', tracking: '1102' },
    ],
  },
];

/* ───────────────────────── layout: shared widths ────────────────────────── */

// Dot track width; the meta subrow indents by the same amount so qty lines up
// under the TITLE text (not the dot) and a wide "100/100" grows in place.
const RECV_DOT_TRACK = 'w-7'; // 1.75rem
const RECV_INDENT = '1.75rem'; // === RECV_DOT_TRACK

const densityPad: Record<Density, string> = {
  compact: 'py-1',
  cozy: 'py-1.5',
  comfortable: 'py-2.5',
};

const qtyTone = (qty: string) => {
  const [recv, exp] = qty.split('/');
  if (exp && recv === exp) return 'text-emerald-600';
  return 'text-gray-700';
};

/* ─────────────────────────── before/after row ───────────────────────────── */

function BeforeMeta({ row }: { row: RecvRow }) {
  const meta = STATE[row.state];
  return (
    <div className="mt-0.5 truncate pl-4 text-[10px] font-black uppercase tracking-widest text-gray-500">
      <span className={qtyTone(row.qty)}>{row.qty}</span> •{' '}
      <span className="text-gray-500">{row.condition}</span> •{' '}
      <span className={meta.textTone}>{meta.text}</span>
    </div>
  );
}

function DateHeader({ date }: { date: string }) {
  return (
    <div className="border-b border-gray-200 bg-gray-50/70 px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-gray-500">
      {date}
    </div>
  );
}

/* ─────────────────────────── showroom furniture ─────────────────────────── */

function Tag({ kind }: { kind: 'before' | 'after' }) {
  return kind === 'before' ? (
    <span className="inline-flex items-center rounded-full bg-rose-500/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-600 ring-1 ring-rose-500/20">
      Before · text labels
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-600 ring-1 ring-emerald-500/20">
      After · icons + locked
    </span>
  );
}

/* ═══════════════════════════════ the section ═══════════════════════════════ */

export function ReceivingHistorySection({ density }: { density: Density }) {
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
              {m === 'after' ? 'After (icons)' : 'Before (text)'}
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
            ? 'Locked qty | condition | state columns; delivery states collapse to a single icon — hover for the full label.'
            : 'Today: the state rides as a long text suffix that pushes the row wide and never aligns column-to-column.'}
        </p>
      </div>

      {/* legend — every state icon + meaning */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border-soft bg-surface-card px-3 py-2.5">
        <span className="text-[10px] font-bold uppercase tracking-wide text-text-muted">States</span>
        {(Object.keys(STATE) as StateKey[]).map((k) => {
          const m = STATE[k];
          return (
            <span key={k} className="inline-flex items-center gap-1.5">
              <m.Icon className={cx('h-3.5 w-3.5', m.tone)} />
              <span className="text-[11px] text-text-muted">{m.text}</span>
            </span>
          );
        })}
      </div>

      {/* the table */}
      <div className="overflow-hidden rounded-xl border border-border-soft bg-white">
        <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50/70 px-3 py-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
            Receiving history · inbound lines
          </span>
          <Tag kind={after ? 'after' : 'before'} />
        </div>

        {GROUPS.map((group, gi) => {
          let stripe = gi % 2; // continue stripe across groups for rhythm
          return (
            <div key={group.date ?? 'today'}>
              {group.date ? <DateHeader date={group.date} /> : null}
              {group.rows.map((row) => {
                const odd = stripe++ % 2 === 1;
                return (
                  <div
                    key={row.title}
                    className={cx(
                      'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-gray-100 px-3',
                      densityPad[density],
                      odd ? 'bg-gray-50/40' : 'bg-white',
                    )}
                  >
                    <div className="flex min-w-0 flex-col">
                      <RowTitle dot="bg-yellow-400" title={row.title} dotTrack={RECV_DOT_TRACK} />
                      {after ? (
                        <RowMetaColumns
                          showGuides={guides}
                          indent={RECV_INDENT}
                          qty={<span className={qtyTone(row.qty)}>{row.qty}</span>}
                          condition={<span className="text-gray-500">{row.condition}</span>}
                          rest={<StateIcon state={row.state} />}
                        />
                      ) : (
                        <BeforeMeta row={row} />
                      )}
                    </div>
                    <ChipCols po={row.po} tracking={row.tracking} />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
