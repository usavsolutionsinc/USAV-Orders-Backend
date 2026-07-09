'use client';

import { useCallback, useRef } from 'react';
import { ExternalLink } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Button } from '@/design-system/primitives';
import { PoChip, TrackingChip, getLast4 } from '@/components/ui/CopyChip';
import { DEBOUNCE_MS, splitPoContext, type PatchBody, type QueueRow } from './unfound-queue-shared';

interface QueueTableRowProps {
  row: QueueRow;
  onPatch: (row: QueueRow, patch: PatchBody) => Promise<void>;
  onPush: (row: QueueRow) => Promise<void>;
  onOpen: (row: QueueRow) => void;
  pushing: boolean;
  /** Show a brief "Saved" pulse next to the checkbox after a successful PATCH. */
  justSaved: boolean;
}

export function QueueTableRow({
  row,
  onPatch,
  onPush,
  onOpen,
  pushing,
  justSaved,
}: QueueTableRowProps) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedPatch = useCallback(
    (patch: PatchBody) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void onPatch(row, patch);
      }, DEBOUNCE_MS);
    },
    [onPatch, row],
  );

  // Row-level handler: open the details panel for clicks anywhere in the
  // row EXCEPT on an inline control (text input, textarea, button, label).
  // This lets the operator click the empty padding around a "—" placeholder
  // and still get the panel — without us having to remember stopPropagation
  // on every interactive descendant.
  const handleRowClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, button, label')) return;
      onOpen(row);
    },
    [onOpen, row],
  );

  return (
    <tr
      onClick={handleRowClick}
      className={`cursor-pointer align-top transition-colors hover:bg-blue-50/40 ${
        row.checked ? 'bg-surface-canvas/60 text-text-soft' : 'text-text-default'
      }`}
    >
      <td className="px-3 py-2 font-mono text-label">
        <input
          type="text"
          defaultValue={row.zendesk_ticket_id ?? ''}
          onBlur={(e) => {
            const next = e.target.value.trim() || null;
            if (next !== (row.zendesk_ticket_id ?? null)) {
              void onPatch(row, { zendesk_ticket_id: next });
            }
          }}
          placeholder="—"
          className="w-20 border-b border-transparent bg-transparent px-1 py-0.5 outline-none focus:border-blue-500"
        />
      </td>
      <td className="px-3 py-2 font-semibold">
        {(() => {
          // Email-PO rows: subject as the title (top), chips as the
          // identifier below — same shape as tracking-chip rows below.
          if (row.kind === 'email_po') {
            const { prefix, poNumbers } = splitPoContext(row.context);
            return (
              <>
                <div className="text-left">
                  {prefix || row.product_title || '—'}
                </div>
                {poNumbers.length > 0 && (
                  // Chips render <button> internally — the row-level handler
                  // skips clicks that land inside a <button>, so copy still
                  // wins over opening the panel.
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    {poNumbers.map((po) => (
                      <PoChip key={po} value={po} display={getLast4(po)} />
                    ))}
                  </div>
                )}
              </>
            );
          }
          // Other kinds: product title on top, chip/text below.
          return (
            <>
              <div className="text-left">{row.product_title || '—'}</div>
              {row.context && (
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-micro font-normal text-text-soft">
                  {row.kind === 'unmatched_receiving' ? (
                    <TrackingChip
                      value={row.context}
                      display={getLast4(row.context)}
                    />
                  ) : (
                    <span className="truncate">{row.context}</span>
                  )}
                </div>
              )}
            </>
          );
        })()}
      </td>
      <td className="px-3 py-2">
        <textarea
          rows={1}
          defaultValue={row.usa_team_note ?? ''}
          onChange={(e) =>
            debouncedPatch({ usa_team_note: e.target.value || null })
          }
          placeholder="—"
          className="w-full resize-none border-b border-transparent bg-transparent px-1 py-0.5 text-label outline-none focus:border-blue-500"
        />
      </td>
      <td className="px-3 py-2">
        <textarea
          rows={1}
          defaultValue={row.vietnam_team_note ?? ''}
          onChange={(e) =>
            debouncedPatch({ vietnam_team_note: e.target.value || null })
          }
          placeholder="—"
          className="w-full resize-none border-b border-transparent bg-transparent px-1 py-0.5 text-label outline-none focus:border-blue-500"
        />
      </td>
      <td className="px-3 py-2 text-center">
        <div className="flex items-center justify-center gap-1.5">
          <input
            type="checkbox"
            checked={row.checked}
            onChange={(e) => void onPatch(row, { checked: e.target.checked })}
            className="h-4 w-4"
          />
          {justSaved ? (
            <span className="text-micro font-bold uppercase tracking-wider text-emerald-600">
              Saved
            </span>
          ) : null}
        </div>
      </td>
      <td className="px-3 py-2 text-right">
        {row.zendesk_ticket_id ? (
          <span className="text-micro font-bold uppercase tracking-wider text-emerald-600">
            Synced
          </span>
        ) : (
          <HoverTooltip label="Create a Zendesk ticket from this row" asChild>
            <Button
              variant="ghost"
              size="sm"
              icon={<ExternalLink />}
              onClick={() => void onPush(row)}
              disabled={pushing}
              className="gap-1 rounded-md border border-blue-200 px-2 py-1 text-micro font-bold uppercase tracking-wider text-blue-600 hover:bg-blue-50"
            >
              {pushing ? '…' : 'Push'}
            </Button>
          </HoverTooltip>
        )}
      </td>
    </tr>
  );
}
