'use client';

/**
 * SearchResultRow — THE one rich search-result row renderer. Every search
 * surface (header preview, ⌘K, /search, operations, workbench quick-jumps)
 * renders through this so there is exactly one row (SoT: never fork a
 * per-surface renderer).
 *
 * Two DENSITIES:
 *   • compact     — the header dropdown preview + sidebar quick-jumps. Tight
 *     rows, bare leading glyph. (Default — unchanged from the original.)
 *   • comfortable — the full results surface (/search + operations). Taller
 *     rows, a coloured entity tile, larger title, and — for serial units — a
 *     leading monospace serial badge that echoes the receiving carton display,
 *     so a serial you searched reads the same here as on the unit itself.
 *
 * Variants, chosen internally by entityType (callers never pass a flag):
 *   • order — Shopify-grade row: status dot · title · order#/sku/platform meta ·
 *     status+condition+platform chips · carrier + last-4 tracking · relative
 *     date. The dot AND the status chip both flow from orderStatusTone().
 *   • unit  — serial badge · product title · sku/status meta · chips.
 *   • generic — coloured entity tile · title · subtitle · ≤2 chips · type tag.
 *
 * The order variant needs facets. Exact-identifier hits carry NO facets, so
 * those render as the plain generic row (by design — do not "fix" a missing dot
 * on an exact hit). In operations/keyword scope facets are always present.
 */

import type { MouseEvent as ReactMouseEvent } from 'react';
import Link from 'next/link';
import { Search, ChevronRight } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { TrackingChip, getLast4, getLast4Serial } from '@/components/ui/CopyChip';
import { formatRelativeTime } from '@/lib/search/search-recents';
import type { AiSearchHit } from '@/lib/search/ai-search-client';
import { cn } from '@/utils/_cn';
import {
  CHIP_TONE_CLASSES,
  ENTITY_ICONS,
  orderStatusTone,
  type ChipTone,
} from './search-result-chips';

export type SearchRowDensity = 'compact' | 'comfortable';

export interface SearchResultRowProps {
  hit: AiSearchHit;
  /** Keyboard-highlighted (combobox aria-activedescendant target). */
  active?: boolean;
  /** Stable id for role="option" / aria-activedescendant. */
  optionId?: string;
  /** Row scale — see file header. Default 'compact'. */
  density?: SearchRowDensity;
  /**
   * Called on mouse click. Receives the event so a host can intercept the
   * link (e.g. operations drills in-page via event.preventDefault()); hosts
   * that only close a popover can ignore the event and let the link navigate.
   */
  onNavigate?: (hit: AiSearchHit, event: ReactMouseEvent) => void;
}

// ── Per-density geometry ──────────────────────────────────────────────────────
const ROW_BY_DENSITY: Record<SearchRowDensity, string> = {
  compact: 'gap-3 px-3 py-1.5',
  comfortable: 'gap-3.5 px-4 py-3',
};
const TITLE_BY_DENSITY: Record<SearchRowDensity, string> = {
  compact: 'text-caption',
  comfortable: 'text-sm',
};
const ROW_BASE = 'group flex items-center text-left transition-colors hover:bg-surface-hover';
const ROW_ACTIVE = 'bg-blue-50 ring-1 ring-inset ring-blue-400';
const CHIP_BASE =
  'hidden shrink-0 rounded px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest ring-1 ring-inset md:inline-flex';

// UI entity type → chip tone for the leading tile + type tag (sanctioned 5-tone
// families only — no new colours). Two entities may share a tone.
const ENTITY_TONE: Record<string, ChipTone> = {
  order: 'blue',
  unit: 'emerald',
  receiving: 'amber',
  sku: 'gray',
  repair: 'rose',
  fba: 'blue',
};
// Leading icon-tile classes per tone (soft fill + coloured glyph).
const TILE_BY_TONE: Record<ChipTone, string> = {
  gray: 'bg-surface-sunken text-text-soft',
  blue: 'bg-blue-50 text-blue-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
  rose: 'bg-rose-50 text-rose-600',
};

function Chip({ label, tone }: { label: string; tone: ChipTone | string }) {
  return (
    <span className={cn(CHIP_BASE, CHIP_TONE_CLASSES[tone] ?? CHIP_TONE_CLASSES.gray)}>{label}</span>
  );
}

/** The Shopify-grade order row. Requires facets (doc-arm hits). */
function OrderRow({ hit, active, optionId, density = 'compact', onNavigate }: SearchResultRowProps) {
  const facets = hit.facets ?? {};
  const status = orderStatusTone(facets.status);
  const condition = facets.condition_grade;
  const platform = facets.source_platform;
  const tracking = facets.tracking_number;
  const carrier = facets.carrier;
  const when = facets.happened_at ? formatRelativeTime(facets.happened_at) : null;

  return (
    <Link
      href={hit.href}
      onClick={(e) => onNavigate?.(hit, e)}
      role="option"
      id={optionId}
      aria-selected={active || undefined}
      className={cn(ROW_BASE, ROW_BY_DENSITY[density], active && ROW_ACTIVE)}
    >
      <HoverTooltip label={status.label} focusable={false}>
        <span
          className={cn(
            'shrink-0 rounded-full',
            density === 'comfortable' ? 'h-2.5 w-2.5' : 'h-2 w-2',
            status.dot,
          )}
        />
      </HoverTooltip>
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate font-bold text-text-default', TITLE_BY_DENSITY[density])}>
          {hit.title}
        </span>
        {hit.subtitle && (
          <span className="mt-0.5 block truncate text-eyebrow font-semibold uppercase tracking-widest text-text-soft">
            {hit.subtitle}
          </span>
        )}
      </span>
      {facets.status && <Chip label={facets.status} tone={status.tone} />}
      {condition && <Chip label={condition} tone="amber" />}
      {platform && <Chip label={platform} tone="gray" />}
      {tracking && (
        <span className="hidden shrink-0 items-center gap-1 md:inline-flex">
          {carrier && (
            <span className="text-eyebrow font-semibold uppercase tracking-widest text-text-faint">
              {carrier}
            </span>
          )}
          <TrackingChip value={tracking} display={getLast4(tracking)} dense />
        </span>
      )}
      {when && (
        <span className="shrink-0 text-eyebrow font-semibold uppercase tracking-widest tabular-nums text-text-faint">
          {when}
        </span>
      )}
    </Link>
  );
}

/** Serial-unit row — leads with a mono serial badge echoing the receiving view. */
function UnitRow({ hit, active, optionId, density = 'compact', onNavigate }: SearchResultRowProps) {
  // The unit subtitle is `serial · sku · status` by builder contract; the first
  // segment is the serial. Echo the receiving carton chip (last-4 mono badge).
  const serial = (hit.subtitle ?? '').split(' · ')[0]?.trim() || '';
  const badge = serial ? getLast4Serial(serial) : '';
  const chips = hit.chips?.slice(0, 2) ?? [];
  const big = density === 'comfortable';

  return (
    <Link
      href={hit.href}
      onClick={(e) => onNavigate?.(hit, e)}
      role="option"
      id={optionId}
      aria-selected={active || undefined}
      className={cn(ROW_BASE, ROW_BY_DENSITY[density], active && ROW_ACTIVE)}
    >
      {badge ? (
        <span
          className={cn(
            'flex shrink-0 items-center justify-center rounded-lg font-mono font-bold text-emerald-700 ring-1 ring-inset ring-emerald-200 bg-emerald-50',
            big ? 'h-9 min-w-[3rem] px-2 text-caption' : 'h-6 min-w-[2.5rem] px-1.5 text-eyebrow',
          )}
        >
          {badge}
        </span>
      ) : (
        <EntityTile entityType="unit" density={density} />
      )}
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate font-bold text-text-default', TITLE_BY_DENSITY[density])}>
          {hit.title}
        </span>
        {hit.subtitle && (
          <span className="mt-0.5 block truncate text-eyebrow font-semibold uppercase tracking-widest text-text-soft">
            {hit.subtitle}
          </span>
        )}
      </span>
      {chips.map((chip) => (
        <Chip key={chip.label} label={chip.label} tone={chip.tone ?? 'gray'} />
      ))}
      <EntityTag entityType={hit.entityType} density={density} />
    </Link>
  );
}

/** The coloured leading tile (comfortable) or bare glyph (compact). */
function EntityTile({ entityType, density }: { entityType: string; density: SearchRowDensity }) {
  const Icon = ENTITY_ICONS[entityType] || Search;
  const tone = ENTITY_TONE[entityType] ?? 'gray';
  if (density === 'compact') {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        <Icon className="h-4 w-4 text-text-faint" />
      </span>
    );
  }
  return (
    <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', TILE_BY_TONE[tone])}>
      <Icon className="h-5 w-5" />
    </span>
  );
}

/** Right-edge entity type tag — coloured in comfortable, neutral in compact. */
function EntityTag({ entityType, density }: { entityType: string; density: SearchRowDensity }) {
  const tone = ENTITY_TONE[entityType] ?? 'gray';
  return (
    <span
      className={cn(
        'shrink-0 rounded-md px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest',
        density === 'comfortable'
          ? cn('ring-1 ring-inset', CHIP_TONE_CLASSES[tone])
          : 'bg-surface-sunken text-text-soft',
      )}
    >
      {entityType}
    </span>
  );
}

/** Generic row (receiving, sku, repair, fba). */
function GenericRow({ hit, active, optionId, density = 'compact', onNavigate }: SearchResultRowProps) {
  return (
    <Link
      href={hit.href}
      onClick={(e) => onNavigate?.(hit, e)}
      role="option"
      id={optionId}
      aria-selected={active || undefined}
      className={cn(ROW_BASE, ROW_BY_DENSITY[density], active && ROW_ACTIVE)}
    >
      <EntityTile entityType={hit.entityType} density={density} />
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate font-bold text-text-default', TITLE_BY_DENSITY[density])}>
          {hit.title}
        </span>
        {hit.subtitle && (
          <span className="mt-0.5 block truncate text-eyebrow font-semibold uppercase tracking-widest text-text-soft">
            {hit.subtitle}
          </span>
        )}
      </span>
      {hit.chips?.slice(0, 2).map((chip) => (
        <Chip key={chip.label} label={chip.label} tone={chip.tone ?? 'gray'} />
      ))}
      <EntityTag entityType={hit.entityType} density={density} />
      {density === 'compact' && (
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-faint opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </Link>
  );
}

export function SearchResultRow(props: SearchResultRowProps) {
  // Order variant only when the doc arm gave us facets to render richly;
  // exact-identifier order hits (no facets) fall through to the generic row.
  if (props.hit.entityType === 'order' && props.hit.facets != null) return <OrderRow {...props} />;
  if (props.hit.entityType === 'unit') return <UnitRow {...props} />;
  return <GenericRow {...props} />;
}
