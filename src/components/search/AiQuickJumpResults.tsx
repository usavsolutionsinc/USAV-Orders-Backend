'use client';

/**
 * AiQuickJumpResults — the shared SearchHit row list for workbench AI
 * quick-jumps (AI search Phase 2, plan §8.4 "normalize result rendering
 * through SearchHit + shared row components").
 *
 * Presentational only: hosts own fetching (useAiQuickJump) and placement
 * (usually a band under their search input). Renders nothing when there are
 * no hits — the host surface must look byte-identical pre-AI when the list
 * is empty. House one-row anatomy (title → meta → chips), semantic chip
 * tones, no size shift on hover. Rows are links (deep-links from
 * searchHitHref), so keyboard/middle-click/new-tab all behave.
 */

import Link from 'next/link';
import {
  Search,
  LayoutDashboard,
  Tool,
  Package,
  ClipboardList,
  Box,
  PackageCheck,
  ChevronRight,
  Loader2,
} from '@/components/Icons';
import type { AiSearchHit } from '@/lib/search/ai-search-client';

type IconComponent = (props: { className?: string }) => JSX.Element;

const ENTITY_ICONS: Record<string, IconComponent> = {
  order: LayoutDashboard,
  repair: Tool,
  fba: Package,
  receiving: ClipboardList,
  sku: Box,
  unit: PackageCheck,
};

// House 3-layer chip tones (bg-x-50 / text-x-700 / ring-x-200).
const CHIP_TONE_CLASSES: Record<string, string> = {
  gray: 'bg-surface-canvas text-text-muted ring-border-soft',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  rose: 'bg-rose-50 text-rose-700 ring-rose-200',
};

export interface AiQuickJumpResultsProps {
  hits: AiSearchHit[];
  searching?: boolean;
  /** Called after a row navigates (hosts close popovers / clear input). */
  onNavigate?: (hit: AiSearchHit) => void;
  className?: string;
}

export function AiQuickJumpResults({
  hits,
  searching = false,
  onNavigate,
  className,
}: AiQuickJumpResultsProps) {
  if (hits.length === 0 && !searching) return null;

  return (
    <div className={className}>
      <p className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-eyebrow font-black uppercase tracking-widest text-text-faint">
        {searching ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Search className="h-3 w-3" />
        )}
        AI matches
      </p>
      <ul className="divide-y divide-border-hairline">
        {hits.map((hit) => {
          const Icon = ENTITY_ICONS[hit.entityType] || Search;
          return (
            <li key={`${hit.entityType}:${hit.id}`}>
              <Link
                href={hit.href}
                onClick={() => onNavigate?.(hit)}
                className="group flex items-center gap-3 px-3 py-1.5 text-left hover:bg-surface-hover"
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
                  <span
                    key={chip.label}
                    className={`hidden shrink-0 rounded px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest ring-1 ring-inset md:inline-flex ${
                      CHIP_TONE_CLASSES[chip.tone ?? 'gray'] ?? CHIP_TONE_CLASSES.gray
                    }`}
                  >
                    {chip.label}
                  </span>
                ))}
                <span className="shrink-0 rounded-md bg-surface-sunken px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest text-text-soft">
                  {hit.entityType}
                </span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-faint opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
