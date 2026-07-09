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
    <div className="shrink-0 border-b border-border-hairline px-3 py-2">
      <button
        type="button"
        onClick={onToggleExpanded}
        className="ds-raw-button flex w-full items-center justify-between gap-2 rounded-lg border border-border-soft bg-surface-canvas/90 px-2.5 py-2 text-left transition-colors hover:bg-surface-sunken"
        aria-expanded={false}
      >
        <span className="text-micro font-black uppercase tracking-widest text-text-muted">
          Combine review
        </span>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          {selectedCount > 0 ? (
            <span className="truncate text-micro font-bold tabular-nums text-text-soft">
              {selectedCount} · {collapsedTotalQty}
            </span>
          ) : lockedFbaId ? (
            <span className="truncate font-mono text-micro font-bold text-emerald-700">{lockedFbaId}</span>
          ) : (
            <span className="text-micro font-semibold text-text-faint">Tap to expand</span>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 text-text-faint" />
        </div>
      </button>
    </div>
  );
}
