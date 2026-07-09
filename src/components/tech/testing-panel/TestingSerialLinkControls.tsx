'use client';

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Link2, Loader2, Unlink } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { IconButton, Popover } from '@/design-system/primitives';
import { toast } from '@/lib/toast';
import { safeRandomUUID } from '@/lib/safe-uuid';
import { dispatchTestingLineUpdated } from '@/components/tech/testing-line-events';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';

interface SiblingLine {
  id: number;
  sku: string | null;
  item_name?: string | null;
  serials?: Array<{ id: number; serial_number: string }>;
  /** A real Zoho-PO line is never deleted on combine — only its serials move. */
  zoho_purchaseorder_id?: string | null;
}

/**
 * LINK / UNLINK controls for the condition+serial row, sitting next to the item-
 * description button in the accordion title row (testing page only).
 *
 * A scanned serial is a sidecar on a line; a SKU import is a whole new line — so
 * they show as separate rows. These merge them into ONE row via the verified
 * `/api/receiving/serial-move` primitive (re-homes membership IN PLACE, preserving
 * the testing verdict):
 *   • LINK  (combine) — pull another row's serial(s) onto THIS line, then delete
 *                       the emptied source line.
 *   • UNLINK (split)  — move this line's serial out to a brand-new line of its own
 *                       (unmatched cartons only — a Zoho-PO carton's lines come
 *                       from the PO and can't take a new unmatched line).
 */
export function TestingSerialLinkControls({
  carton,
  line,
  staffId,
}: {
  /** The active carton row — supplies receiving_id + source. */
  carton: ReceivingLineRow;
  /** This accordion line. */
  line: ReceivingLineRow;
  staffId: string;
}) {
  const qc = useQueryClient();
  const [linkOpen, setLinkOpen] = useState(false);
  const [siblings, setSiblings] = useState<SiblingLine[] | null>(null);
  const [busy, setBusy] = useState(false);
  const linkBtnRef = useRef<HTMLButtonElement>(null);

  const receivingId = carton.receiving_id;
  const isUnmatched = carton.receiving_source === 'unmatched';
  const lineSerials = (line.serials ?? []) as Array<{ id: number; serial_number: string }>;
  const hasSerial = lineSerials.length > 0;

  const refresh = () => {
    if (receivingId != null) {
      qc.invalidateQueries({ queryKey: ['receiving-siblings', receivingId] });
    }
    qc.invalidateQueries({ queryKey: ['receiving-lines'] });
    dispatchTestingLineUpdated({ id: line.id, serials: line.serials ?? [] });
  };

  const moveSerial = async (serialUnitId: number, targetLineId: number): Promise<boolean> => {
    const res = await fetch('/api/receiving/serial-move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serial_unit_id: serialUnitId,
        target_receiving_line_id: targetLineId,
        // Fresh per move so a genuine repeat move back to a previously-visited
        // line never collides with an earlier event's idempotency key.
        client_event_id: safeRandomUUID(),
      }),
    });
    const data = await res.json().catch(() => null);
    return Boolean(res.ok && data?.success);
  };

  const openLink = async () => {
    const next = !linkOpen;
    setLinkOpen(next);
    if (!next || siblings || receivingId == null) return;
    try {
      const res = await fetch(`/api/receiving-lines?receiving_id=${receivingId}&include=serials`);
      const data = await res.json().catch(() => null);
      const rows: SiblingLine[] = Array.isArray(data?.receiving_lines) ? data.receiving_lines : [];
      setSiblings(rows.filter((r) => r.id !== line.id && (r.serials?.length ?? 0) > 0));
    } catch {
      setSiblings([]);
    }
  };

  const combineFrom = async (source: SiblingLine) => {
    if (busy) return;
    setBusy(true);
    try {
      let allOk = true;
      for (const s of source.serials ?? []) {
        if (!(await moveSerial(s.id, line.id))) allOk = false;
      }
      if (!allOk) {
        toast.error('Some serials could not be combined');
      } else {
        // Drop the now-empty source line — but ONLY an ad-hoc line, never a real
        // Zoho-PO line (those belong to the PO; leave the emptied line in place).
        if (!source.zoho_purchaseorder_id) {
          await fetch(`/api/receiving-lines?id=${source.id}`, { method: 'DELETE' }).catch(() => {});
        }
        toast.success('Combined into this row');
      }
      refresh();
      setLinkOpen(false);
      setSiblings(null);
    } finally {
      setBusy(false);
    }
  };

  const splitSerial = async () => {
    if (busy || !hasSerial || receivingId == null) return;
    setBusy(true);
    try {
      const created = await fetch('/api/receiving/add-unmatched-line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receiving_id: receivingId,
          sku: line.sku ?? undefined,
          quantity_expected: 1,
          staff_id: Number(staffId) || undefined,
        }),
      });
      const cdata = await created.json().catch(() => null);
      const newLineId = cdata?.line?.id as number | undefined;
      if (!created.ok || !cdata?.success || !newLineId) {
        toast.error(cdata?.error || 'Could not create a new row to split into');
        return;
      }
      const ok = await moveSerial(lineSerials[0].id, newLineId);
      toast[ok ? 'success' : 'error'](ok ? 'Split to its own row' : 'Could not split the serial');
      refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <HoverTooltip label="Combine another row's serial into this one" asChild focusable={false}>
        <button
          ref={linkBtnRef}
          type="button"
          aria-label="Combine a serial into this row"
          aria-expanded={linkOpen}
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            void openLink();
          }}
          className="ds-raw-button -m-1 flex shrink-0 items-center justify-center rounded-md p-1 text-text-faint transition-colors hover:bg-blue-100 hover:text-blue-600 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
        </button>
      </HoverTooltip>

      {isUnmatched && hasSerial ? (
        <HoverTooltip label="Split this serial out to its own row" asChild focusable={false}>
          <IconButton
            ariaLabel="Split serial to its own row"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              void splitSerial();
            }}
            className="-m-1 flex shrink-0 items-center justify-center rounded-md p-1 text-text-faint transition-colors hover:bg-amber-100 hover:text-amber-600"
            icon={<Unlink className="h-3.5 w-3.5" aria-hidden />}
          />
        </HoverTooltip>
      ) : null}

      <Popover
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        anchorRef={linkBtnRef}
        placement="bottom-end"
        role="listbox"
        aria-label="Combine a serial into this row"
        className="min-w-[13rem] max-w-[18rem]"
        padded={false}
      >
        {siblings == null ? (
          <div className="flex items-center gap-2 px-3 py-2.5 text-caption text-text-faint">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading rows…
          </div>
        ) : siblings.length === 0 ? (
          <div className="px-3 py-2.5 text-caption text-text-soft">
            No other row on this carton has a scanned serial to combine.
          </div>
        ) : (
          <ul className="max-h-64 overflow-y-auto py-1">
            {siblings.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void combineFrom(s)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left transition-colors hover:bg-surface-hover disabled:opacity-40"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-caption font-bold text-text-default">
                      {s.item_name || s.sku || `Line #${s.id}`}
                    </span>
                    <span className="block truncate text-micro font-semibold uppercase tracking-widest text-text-faint">
                      {(s.serials?.length ?? 0)} serial{(s.serials?.length ?? 0) === 1 ? '' : 's'}
                    </span>
                  </span>
                  <Check className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Popover>
    </>
  );
}
