'use client';

import { Clock, MapPin, Package, X } from '@/components/Icons';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import type { RecentScanEntry } from '@/hooks/useRecentScans';

// ─── Types ──────────────────────────────────────────────────────────────────

interface RecentScansListProps {
  entries: RecentScanEntry[];
  onSelect: (entry: RecentScanEntry) => void;
  onRemove?: (entry: RecentScanEntry) => void;
  onClear?: () => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatRelative(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function RecentScansList({
  entries,
  onSelect,
  onRemove,
  onClear,
}: RecentScansListProps) {
  if (entries.length === 0) {
    return (
      <div className="px-5 py-8 text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100">
          <Clock className="h-6 w-6 text-gray-400" />
        </div>
        <p className="mb-1 text-[12px] font-black text-gray-700">No recent scans</p>
        <p className="text-[10px] font-bold text-gray-400">
          Tap the camera button to scan a SKU or bin.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 pt-4 pb-2">
        <span className={sectionLabel}>Recent Scans</span>
        {onClear && entries.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-[9px] font-black uppercase tracking-widest text-gray-400 transition-colors active:text-gray-600"
          >
            Clear
          </button>
        )}
      </div>
      <ul className="divide-y divide-gray-100">
        {entries.map((entry) => (
          <li key={`${entry.type}:${entry.value}`}>
            <div className="flex items-stretch">
              <button
                type="button"
                onClick={() => onSelect(entry)}
                className="flex flex-1 items-center gap-3 px-5 py-3 text-left transition-colors active:bg-blue-50"
              >
                <div
                  className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${
                    entry.type === 'bin'
                      ? 'bg-orange-50 text-orange-600'
                      : 'bg-blue-50 text-blue-600'
                  }`}
                >
                  {entry.type === 'bin' ? (
                    <MapPin className="h-4 w-4" />
                  ) : (
                    <Package className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-black font-mono text-gray-900">
                    {entry.label || entry.value}
                  </p>
                  {entry.subLabel && (
                    <p className="mt-0.5 truncate text-[10px] font-bold text-gray-500">
                      {entry.subLabel}
                    </p>
                  )}
                </div>
                <span className="flex-shrink-0 text-[9px] font-black uppercase tracking-widest text-gray-400">
                  {formatRelative(entry.timestamp)}
                </span>
              </button>
              {onRemove && (
                <button
                  type="button"
                  onClick={() => onRemove(entry)}
                  aria-label="Remove from recent"
                  className="flex w-10 flex-shrink-0 items-center justify-center border-l border-gray-100 text-gray-300 transition-colors active:bg-gray-100 active:text-gray-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
