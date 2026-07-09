'use client';

import { X } from '@/components/Icons';
import { IconButton } from '@/design-system/primitives';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';

interface Props {
  rows: ReceivingLineRow[];
  onPick: (row: ReceivingLineRow) => void;
  onCancel: () => void;
}

/**
 * Multi-match picker — surfaces only when a single tracking scan resolves to
 * multiple open receiving lines. Open lines (qty received < qty expected)
 * render in blue; complete lines fall back to muted gray so the tech can
 * still revisit them.
 */
export function ReceivingLinePicker({ rows, onPick, onCancel }: Props) {
  return (
    <div className="border-b border-blue-200 bg-blue-50/60 px-3 py-2">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-eyebrow font-black uppercase tracking-wider text-blue-700">
          Pick a line
        </p>
        <IconButton
          icon={<X className="h-3.5 w-3.5 text-blue-400 group-hover:text-blue-700" />}
          ariaLabel="Cancel scan"
          onClick={onCancel}
          className="group transition-colors"
        />
      </div>
      <div className="flex flex-col gap-1">
        {rows.map((line) => {
          const open =
            line.quantity_expected == null ||
            line.quantity_received < (line.quantity_expected ?? 0);
          return (
            <button
              key={line.id}
              type="button"
              onClick={() => onPick(line)}
              className={`ds-raw-button rounded border px-2 py-1 text-left text-micro font-bold transition-colors ${
                open
                  ? 'border-blue-200 bg-surface-card text-blue-900 hover:bg-blue-100'
                  : 'border-border-soft bg-surface-canvas text-text-soft hover:bg-surface-sunken'
              }`}
            >
              <span className="truncate">
                {line.sku || line.item_name || `Line #${line.id}`}
              </span>
              {' · '}
              {line.quantity_received}/{line.quantity_expected ?? '?'}
              {open ? '' : ' · complete'}
            </button>
          );
        })}
      </div>
    </div>
  );
}
