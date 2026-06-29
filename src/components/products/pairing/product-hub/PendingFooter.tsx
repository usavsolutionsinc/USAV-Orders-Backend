import { AlertCircle, Link2 } from '@/components/Icons';
import { Button } from '@/design-system/primitives';

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
          <Button
            variant="secondary"
            size="md"
            type="button"
            onClick={onDiscard}
            disabled={saving || actionable === 0}
          >
            Discard
          </Button>
          <Button
            variant="brand"
            size="md"
            type="button"
            onClick={onCommit}
            disabled={saving || actionable === 0}
            loading={saving}
            icon={<Link2 />}
          >
            Pair {selectedCount} · Reject {unselectedCount}
          </Button>
        </div>
      </div>
    </div>
  );
}
