import { AlertCircle, Link2, Loader2 } from '@/components/Icons';

/** Sticky pending-action bar — commit (pair/reject/unpair) or discard. */
export function PendingFooter({
  selectedCount,
  unselectedCount,
  unpairCount,
  saving,
  saveError,
  onCommit,
  onDiscard,
}: {
  /** Suggestions currently selected (will be paired). */
  selectedCount: number;
  /** Suggestions left unselected (will be rejected). */
  unselectedCount: number;
  /** Confirmed rows marked to unpair. */
  unpairCount: number;
  saving: boolean;
  saveError: string | null;
  /** Pair all selected + reject all unselected in one commit. */
  onCommit: () => void;
  onDiscard: () => void;
}) {
  const actionable = selectedCount + unselectedCount + unpairCount;
  if (actionable === 0 && !saveError) return null;

  return (
    <div className="sticky bottom-0 z-10 border-t border-gray-200 bg-white/90 py-3 backdrop-blur">
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-2 px-4 sm:px-6">
        {saveError ? (
          <div className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-caption font-semibold text-red-700">
            <AlertCircle className="h-3.5 w-3.5" />
            {saveError}
          </div>
        ) : null}

        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={onDiscard}
            disabled={saving || actionable === 0}
            className="inline-flex h-9 items-center justify-center rounded-md border border-gray-200 bg-white px-3 text-caption font-bold text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-40"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={onCommit}
            disabled={saving || actionable === 0}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-gray-900 px-4 text-caption font-black uppercase tracking-wider text-white shadow-sm transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
            <span>
              Pair {selectedCount} · Reject {unselectedCount}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
