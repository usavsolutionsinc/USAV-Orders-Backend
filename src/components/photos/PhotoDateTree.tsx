'use client';

import { useMemo, useState } from 'react';
import { Calendar, ChevronRight } from '@/components/Icons';
import { buildPhotoDateTree } from '@/lib/photos/date-tree';
import type { PhotoLibraryFilterState } from '@/lib/photos/library-filter-state';
import type { LibraryPhoto } from './photo-library-types';
import { cn } from '@/utils/_cn';

export interface PhotoDateSelection {
  dateFrom?: string;
  dateTo?: string;
  poRef?: string;
}

/**
 * Year → Month → Day → PO# navigator, derived from the loaded photos. Drilling a
 * day sets dateFrom=dateTo (clearing any PO); drilling a PO adds poRef. Coexists
 * with the master-folder tree — it's a date lens, not a replacement.
 */
export function PhotoDateTree({
  photos,
  filters,
  onSelect,
  embedded = false,
}: {
  photos: LibraryPhoto[];
  filters: PhotoLibraryFilterState;
  onSelect: (sel: PhotoDateSelection) => void;
  /** Nested under a station folder — drop the standalone "By date" header. */
  embedded?: boolean;
}) {
  const tree = useMemo(() => buildPhotoDateTree(photos), [photos]);

  // Auto-expand the most-recent year (and its newest month) so the tree opens
  // onto useful content instead of a wall of collapsed years.
  const defaultOpen = useMemo(() => {
    const open = new Set<string>();
    const y = tree[0];
    if (y) {
      open.add(`y:${y.year}`);
      const m = y.months[0];
      if (m) open.add(`m:${m.key}`);
    }
    return open;
  }, [tree]);
  const [open, setOpen] = useState<Set<string>>(defaultOpen);
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const dayActive = (ymd: string) =>
    filters.dateFrom === ymd && filters.dateTo === ymd && !filters.poRef;
  const poActive = (ymd: string, ref: string) =>
    filters.dateFrom === ymd && filters.dateTo === ymd && filters.poRef === ref;

  if (tree.length === 0) return null;

  return (
    <div className="space-y-1">
      {embedded ? null : (
        <p className="flex items-center gap-1 px-1 text-micro font-black uppercase tracking-wider text-gray-400">
          <Calendar className="h-3 w-3" /> By date
        </p>
      )}
      <ul className="space-y-0.5">
        {tree.map((year) => {
          const yKey = `y:${year.year}`;
          const yOpen = open.has(yKey);
          return (
            <li key={yKey}>
              <button
                type="button"
                onClick={() => toggle(yKey)}
                className="flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-[12px] font-bold text-gray-700 transition hover:bg-gray-50"
              >
                <ChevronRight className={cn('h-3 w-3 shrink-0 text-gray-400 transition-transform', yOpen && 'rotate-90')} />
                <span className="flex-1">{year.year}</span>
                <span className="text-[10px] font-semibold text-gray-300">{year.count}</span>
              </button>

              {yOpen ? (
                <ul className="ml-2 space-y-0.5 border-l border-gray-100 pl-1.5">
                  {year.months.map((month) => {
                    const mKey = `m:${month.key}`;
                    const mOpen = open.has(mKey);
                    return (
                      <li key={mKey}>
                        <button
                          type="button"
                          onClick={() => toggle(mKey)}
                          className="flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-[12px] font-semibold text-gray-600 transition hover:bg-gray-50"
                        >
                          <ChevronRight className={cn('h-3 w-3 shrink-0 text-gray-300 transition-transform', mOpen && 'rotate-90')} />
                          <span className="flex-1">{month.label}</span>
                          <span className="text-[10px] font-semibold text-gray-300">{month.count}</span>
                        </button>

                        {mOpen ? (
                          <ul className="ml-2 space-y-0.5 border-l border-gray-100 pl-1.5">
                            {month.days.map((day) => {
                              const active = dayActive(day.ymd);
                              const dKey = `d:${day.ymd}`;
                              const dOpen = open.has(dKey);
                              return (
                                <li key={dKey}>
                                  <div
                                    className={cn(
                                      'flex items-center rounded-md transition',
                                      active ? 'bg-blue-50 ring-1 ring-inset ring-blue-400' : 'hover:bg-gray-50',
                                    )}
                                  >
                                    {day.pos.length > 0 ? (
                                      <button
                                        type="button"
                                        aria-label={dOpen ? 'Collapse' : 'Expand POs'}
                                        onClick={() => toggle(dKey)}
                                        className="px-1 py-1 text-gray-300 hover:text-gray-600"
                                      >
                                        <ChevronRight className={cn('h-3 w-3 transition-transform', dOpen && 'rotate-90')} />
                                      </button>
                                    ) : (
                                      <span className="w-[18px]" />
                                    )}
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onSelect(active ? {} : { dateFrom: day.ymd, dateTo: day.ymd })
                                      }
                                      className={cn(
                                        'flex flex-1 items-center gap-1 py-1 pr-1.5 text-left text-[12px]',
                                        active ? 'font-bold text-blue-800' : 'font-medium text-gray-600',
                                      )}
                                    >
                                      <span className="flex-1">{day.dayLabel}</span>
                                      <span className="text-[10px] font-semibold text-gray-300">{day.count}</span>
                                    </button>
                                  </div>

                                  {dOpen ? (
                                    <ul className="ml-[26px] space-y-0.5 border-l border-gray-100 pl-1.5">
                                      {day.pos.map((po) => {
                                        const poOn = poActive(day.ymd, po.ref);
                                        return (
                                          <li key={po.ref}>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                onSelect(
                                                  poOn
                                                    ? { dateFrom: day.ymd, dateTo: day.ymd }
                                                    : { dateFrom: day.ymd, dateTo: day.ymd, poRef: po.ref },
                                                )
                                              }
                                              className={cn(
                                                'flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-[11px] transition',
                                                poOn
                                                  ? 'bg-blue-50 font-bold text-blue-800 ring-1 ring-inset ring-blue-400'
                                                  : 'font-medium text-gray-500 hover:bg-gray-50',
                                              )}
                                            >
                                              <span className="flex-1 truncate">PO {po.ref}</span>
                                              <span className="text-[10px] font-semibold text-gray-300">{po.count}</span>
                                            </button>
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
