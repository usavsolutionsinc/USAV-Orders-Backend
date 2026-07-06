'use client';

/**
 * SearchResultRow — THE one rich search-result row renderer. Every search
 * surface (header preview, ⌘K, /search, operations, workbench quick-jumps)
 * renders through this so there is exactly one row (SoT: never fork a
 * per-surface renderer).
 *
 * Two variants, chosen internally by entityType (callers never pass a flag):
 *   • order  — Shopify-grade row: status dot · title · order#/sku/platform
 *     meta · status+condition+platform chips · relative date. The dot AND
 *     the status chip both flow from orderStatusTone() so they can't disagree.
 *   • generic — the original AiQuickJumpResults row: entity glyph · title ·
 *     subtitle · ≤2 chips · type tag · hover chevron.
 *
 * The order variant needs facets (status / condition_grade / source_platform /
 * happened_at). Exact-identifier hits carry NO facets (exactResultToHit sets
 * chips:[], no facets) — those render the generic row. In OPERATIONS scope
 * (entityTypes:['ORDER']) the exact bypass is skipped, so operations rows
 * always carry facets → always render the order variant. Do NOT "fix" a
 * missing dot on an exact GLOBAL hit; it is by design.
 *
 * House one-row anatomy (title → meta → chips), semantic tones, links (so
 * middle-click / new-tab / keyboard all behave), and selection = background +
 * ring only, never a size shift.
 */

import type { MouseEvent as ReactMouseEvent } from 'react';
import Link from 'next/link';
import { Search, ChevronRight } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { TrackingChip, getLast4 } from '@/components/ui/CopyChip';
import { formatRelativeTime } from '@/lib/search/search-recents';
import type { AiSearchHit } from '@/lib/search/ai-search-client';
import { cn } from '@/utils/_cn';
import {
  CHIP_TONE_CLASSES,
  ENTITY_ICONS,
  orderStatusTone,
  type ChipTone,
} from './search-result-chips';

export interface SearchResultRowProps {
  hit: AiSearchHit;
  /** Keyboard-highlighted (combobox aria-activedescendant target). */
  active?: boolean;
  /** Stable id for role="option" / aria-activedescendant. */
  optionId?: string;
  /**
   * Called on mouse click. Receives the event so a host can intercept the
   * link (e.g. operations drills in-page via event.preventDefault()); hosts
   * that only close a popover can ignore the event and let the link navigate.
   */
  onNavigate?: (hit: AiSearchHit, event: ReactMouseEvent) => void;
}

const ROW_BASE =
  'group flex items-center gap-3 px-3 py-1.5 text-left hover:bg-surface-hover';
const ROW_ACTIVE = 'bg-blue-50 ring-1 ring-inset ring-blue-400';
const CHIP_BASE =
  'hidden shrink-0 rounded px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest ring-1 ring-inset md:inline-flex';

function Chip({ label, tone }: { label: string; tone: ChipTone | string }) {
  return (
    <span className={cn(CHIP_BASE, CHIP_TONE_CLASSES[tone] ?? CHIP_TONE_CLASSES.gray)}>
      {label}
    </span>
  );
}

/** The Shopify-grade order row. Requires facets (doc-arm hits). */
function OrderRow({ hit, active, optionId, onNavigate }: SearchResultRowProps) {
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
      className={cn(ROW_BASE, active && ROW_ACTIVE)}
    >
      <HoverTooltip label={status.label} focusable={false}>
        <span className={cn('h-2 w-2 shrink-0 rounded-full', status.dot)} />
      </HoverTooltip>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-caption font-bold text-text-default">
          {hit.title}
        </span>
        {hit.subtitle && (
          <span className="block truncate text-eyebrow font-semibold uppercase tracking-widest text-text-soft">
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

/** The original generic quick-jump row (units, receiving, sku, repair, fba). */
function GenericRow({ hit, active, optionId, onNavigate }: SearchResultRowProps) {
  const Icon = ENTITY_ICONS[hit.entityType] || Search;
  return (
    <Link
      href={hit.href}
      onClick={(e) => onNavigate?.(hit, e)}
      role="option"
      id={optionId}
      aria-selected={active || undefined}
      className={cn(ROW_BASE, active && ROW_ACTIVE)}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        <Icon className="h-4 w-4 text-text-faint" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-caption font-bold text-text-default">
          {hit.title}
        </span>
        {hit.subtitle && (
          <span className="block truncate text-eyebrow font-semibold uppercase tracking-widest text-text-soft">
            {hit.subtitle}
          </span>
        )}
      </span>
      {hit.chips?.slice(0, 2).map((chip) => (
        <Chip key={chip.label} label={chip.label} tone={chip.tone ?? 'gray'} />
      ))}
      <span className="shrink-0 rounded-md bg-surface-sunken px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest text-text-soft">
        {hit.entityType}
      </span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-faint opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}

export function SearchResultRow(props: SearchResultRowProps) {
  // Order variant only when the doc arm gave us facets to render richly;
  // exact-identifier order hits (no facets) fall through to the generic row.
  const isOrder = props.hit.entityType === 'order' && props.hit.facets != null;
  return isOrder ? <OrderRow {...props} /> : <GenericRow {...props} />;
}
