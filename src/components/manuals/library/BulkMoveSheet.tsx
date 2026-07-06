import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, X } from '@/components/Icons';
import { Button, IconButton } from '@/design-system/primitives';
import { FolderPathPicker } from '../FolderPathPicker';

/**
 * Bulk-move sheet — opens from the bulk action bar's "Move". Body is just the
 * FolderPathPicker (search + drill-down + new-folder). Portals to document.body
 * so the overlay covers the whole viewport, matching the other manual modals.
 */
export function BulkMoveSheet({
  count, target, onTargetChange, busy, onCancel, onConfirm,
}: {
  count: number;
  target: string;
  onTargetChange: (next: string) => void;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Gate portal until first client render — document.body doesn't exist in SSR.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);
  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-panelPopover flex items-center justify-center p-4">
      {/* ds-raw-button: full-bleed dismiss scrim, not a Button shape */}
      <button
        type="button"
        onClick={busy ? undefined : onCancel}
        className="ds-raw-button absolute inset-0 bg-scrim/40"
        aria-label="Close"
      />
      <div className="relative z-panelPopover w-full max-w-lg overflow-hidden rounded-2xl border border-border-soft bg-surface-card shadow-2xl shadow-zinc-900/20">
        <div className="flex items-center justify-between border-b border-border-soft px-4 py-3">
          <div>
            <p className="text-micro font-black uppercase tracking-[0.16em] text-text-soft">Bulk Move</p>
            <h2 className="mt-1 text-sm font-black text-text-default">
              Move {count} {count === 1 ? 'manual' : 'manuals'}
            </h2>
          </div>
          <IconButton
            icon={<X className="h-4 w-4" />}
            onClick={onCancel}
            disabled={busy}
            ariaLabel="Close"
            className="rounded-full border border-border-soft bg-surface-card p-2 hover:border-border-default hover:bg-surface-hover hover:text-text-default"
          />
        </div>
        <div className="space-y-4 px-4 py-4">
          <FolderPathPicker value={target} onChange={onTargetChange} />
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border-hairline bg-surface-canvas/60 px-4 py-3">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="brand"
            size="sm"
            loading={busy}
            icon={<Check className="h-3.5 w-3.5" />}
            onClick={onConfirm}
          >
            Move
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
