'use client';

import React from 'react';
import { RotateCcw, X } from '../Icons';
import type { LabelRecent } from '@/hooks/useLabelRecents';

interface RecentsStripProps {
  recents: LabelRecent[];
  onPick: (sku: string) => void;
  onClear?: () => void;
}

/**
 * Sticky bottom strip for the desktop workspace showing the last printed
 * labels. Clicking a chip dispatches `sku:fill` via the parent so the
 * workspace re-loads that SKU instantly (one-tap reprint).
 */
export function RecentsStrip({ recents, onPick, onClear }: RecentsStripProps) {
  if (recents.length === 0) return null;

  return (
    <div className="flex items-center gap-2 border-t border-gray-100 bg-gray-50/70 px-6 py-2.5">
      <span className="shrink-0 text-[9px] font-black uppercase tracking-[0.18em] text-gray-500">
        Recent
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto scrollbar-hide">
        {recents.map((r) => (
          <button
            key={r.sku + ':' + r.at}
            type="button"
            onClick={() => onPick(r.sku)}
            title={r.title ? `${r.title}${r.sn ? ' · ' + r.sn : ''}` : r.sku}
            className="group inline-flex shrink-0 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 font-mono text-[11px] font-bold text-gray-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
          >
            <RotateCcw className="h-3 w-3 text-gray-400 group-hover:text-blue-500" />
            <span className="truncate max-w-[140px]">{r.sku}</span>
          </button>
        ))}
      </div>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="shrink-0 rounded-md p-1 text-gray-400 transition-colors hover:bg-white hover:text-gray-700"
          title="Clear recents"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
