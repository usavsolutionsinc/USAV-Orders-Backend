import { ChevronDown } from '@/components/Icons';

/** Compact one-line strip shown when the combine-review panel is collapsed. */
export function PairedReviewCollapsedStrip({
  onToggleExpanded,
  selectedCount,
  collapsedTotalQty,
  lockedFbaId,
}: {
  onToggleExpanded: () => void;
  selectedCount: number;
  collapsedTotalQty: number;
  lockedFbaId: string | null;
}) {
  return (
    <div className="shrink-0 border-b border-gray-100 px-3 py-2">
      <button
        type="button"
        onClick={onToggleExpanded}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50/90 px-2.5 py-2 text-left transition-colors hover:bg-gray-100"
        aria-expanded={false}
      >
        <span className="text-micro font-black uppercase tracking-widest text-gray-600">
          Combine review
        </span>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          {selectedCount > 0 ? (
            <span className="truncate text-micro font-bold tabular-nums text-gray-500">
              {selectedCount} · {collapsedTotalQty}
            </span>
          ) : lockedFbaId ? (
            <span className="truncate font-mono text-micro font-bold text-emerald-700">{lockedFbaId}</span>
          ) : (
            <span className="text-micro font-semibold text-gray-400">Tap to expand</span>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
        </div>
      </button>
    </div>
  );
}
