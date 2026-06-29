'use client';

import { useCallback, useState } from 'react';
import { Trash2 } from '@/components/Icons';
import { IconButton } from '@/design-system/primitives';
import { toast } from '@/lib/toast';
import { SerialCard, SerialChipWithMenu } from '@/components/receiving/workspace/SerialCard';
import {
  SerialMatchResult,
  useSerialLookup,
  type SerialMatchedOrder,
} from '@/components/receiving/workspace/SerialMatchResult';
import { markConditionSet } from '@/components/receiving/workspace/ReceivingProgressStepper';
import { dispatchLineUpdated } from '@/components/station/ReceivingLinesTable';
import { ConditionGradeChip, SkuScanRefChip, getLast4 } from '@/components/ui/CopyChip';
import { ProgressBadge } from '@/components/receiving/workspace/PoLinesAccordion';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import type { UnfoundLine, UnmatchedLineRenderHelpers } from './unmatched-items-shared';

interface UnmatchedLineRowProps {
  line: UnfoundLine;
  receivingId: number;
  staffId?: string;
  receivingType: string;
  onConditionChange: (lineId: number, condition: string) => Promise<void>;
  onRemove: (lineId: number) => Promise<void>;
  onFileReturnClaim?: (matchedOrder: SerialMatchedOrder | null, serial: string) => void;
  /**
   * When provided, replaces the default ConditionPills with a caller-rendered
   * action area. Receives the same helpers the default renderer uses so the
   * caller can still trigger condition changes from inside its custom UI.
   */
  renderActions?: (helpers: UnmatchedLineRenderHelpers) => React.ReactNode;
  refresh: () => void;
}

export function UnmatchedLineRow({
  line,
  receivingId,
  staffId,
  receivingType,
  onConditionChange,
  onRemove,
  onFileReturnClaim,
  renderActions,
  refresh,
}: UnmatchedLineRowProps) {
  const [updating, setUpdating] = useState(false);
  const [serialSubmitting, setSerialSubmitting] = useState(false);
  // Per-line serial-match lookup for the RETURN flow — mirrors the matched
  // carton's SerialCard behavior so an unfound return can be paired to the
  // order it shipped on.
  const serialLookup = useSerialLookup();
  const isReturn = String(receivingType || '').toUpperCase() === 'RETURN';
  const saved = (line.serials ?? []) as Array<{ id: number; serial_number: string }>;

  // Submit a serial against this unfound line. Runs the return lookup first
  // (so it reflects prior inventory, not the row we're about to write), then
  // POSTs the scan and refreshes the carton so the new chip + qty land.
  const submitSerial = useCallback(
    async (raw: string) => {
      const serial = raw.trim();
      if (!serial || serialSubmitting) return;
      setSerialSubmitting(true);
      try {
        if (isReturn) await serialLookup.check(serial);
        const res = await fetch('/api/receiving/scan-serial', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            receiving_id: receivingId,
            receiving_line_id: line.id,
            serial_number: serial,
            staff_id: Number(staffId) || undefined,
            condition_grade: line.condition_grade || undefined,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.success) {
          toast.error(json?.error || 'Scan failed');
          return;
        }
        dispatchLineUpdated({ id: line.id });
        refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Scan failed');
      } finally {
        setSerialSubmitting(false);
      }
    },
    [isReturn, line.condition_grade, line.id, receivingId, refresh, serialLookup, serialSubmitting, staffId],
  );

  const deleteSerial = useCallback(
    async (serial: { id?: number; serial_number: string }) => {
      if (serial.id == null) return;
      if (!window.confirm(`Remove serial ${serial.serial_number}?`)) return;
      try {
        const res = await fetch('/api/receiving/scan-serial', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serial_unit_id: serial.id, receiving_line_id: line.id }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.success) {
          toast.error(json?.error || 'Could not remove serial');
          return;
        }
        refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not remove serial');
      }
    },
    [line.id, refresh],
  );

  const handleCondition = useCallback(
    async (next: string) => {
      if (next === line.condition_grade) return;
      setUpdating(true);
      try {
        await onConditionChange(line.id, next);
      } finally {
        setUpdating(false);
      }
    },
    [line.condition_grade, line.id, onConditionChange],
  );

  return (
    <div className="rounded-xl border border-blue-300 bg-blue-50/60 p-3">
      <div className="flex items-start gap-3">
        {line.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={line.image_url}
            alt=""
            className="h-12 w-12 shrink-0 rounded border border-blue-100 object-cover"
            loading="lazy"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="truncate text-label font-bold text-gray-900">
            {line.item_name ?? line.sku ?? `Line ${line.id}`}
          </div>
          {/* Meta row — EXACTLY PoLinesAccordion's second row (qty · sku ·
              price · condition · serial chips, shared badge components)
              so an unfound / auto-generated-from-serial line reads the same
              as a matched PO item. */}
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-micro font-semibold uppercase tracking-widest text-gray-500">
            <ProgressBadge
              received={line.quantity_received ?? 0}
              expected={line.quantity_expected ?? 1}
            />
            {line.sku ? (
              <>
                <span aria-hidden>·</span>
                <SkuScanRefChip value={line.sku} display={getLast4(line.sku)} />
              </>
            ) : null}
            <span aria-hidden>·</span>
            <ConditionGradeChip grade={line.condition_grade} />
            {saved.length > 0 ? (
              <>
                <span aria-hidden>·</span>
                {saved.map((s, i) => {
                  const sn = (s.serial_number || '').trim();
                  if (!sn) return null;
                  // Menu chip (delete on hover) — the ONLY serial display on
                  // the row now; the SerialCard below has its saved chips off
                  // so the serial isn't shown twice.
                  return (
                    <SerialChipWithMenu
                      key={`${sn}-${i}`}
                      serial={s}
                      isEditing={false}
                      onDelete={(target) => void deleteSerial(target)}
                    />
                  );
                })}
              </>
            ) : null}
          </div>
        </div>
        {/* Right-edge trash — removes the line via DELETE /api/receiving-lines.
            Confirms before deleting so an accidental tap doesn't lose work. */}
        <HoverTooltip label="Remove item" asChild>
          <IconButton
            icon={<Trash2 className="h-4 w-4" />}
            onClick={() => void onRemove(line.id)}
            ariaLabel="Remove item"
            className="shrink-0 self-start rounded-md p-1.5 text-gray-400 hover:bg-rose-50 hover:text-rose-600"
          />
        </HoverTooltip>
      </div>
      <div className="mt-3 border-t border-blue-200/60 pt-3">
        <div
          className={updating ? 'pointer-events-none opacity-60' : undefined}
          aria-busy={updating || undefined}
        >
          {renderActions ? (
            renderActions({
              onConditionChange: (next) => {
                markConditionSet(line.id);
                void handleCondition(next);
              },
              refresh,
            })
          ) : (
            // Full serial card per line — integrated condition picker + serial
            // scan + (RETURN) the serial-match band. This is why an unfound
            // carton can now capture serials the same way a matched line does.
            <SerialCard
              embedded
              saved={saved}
              expected={line.quantity_expected ?? null}
              isSubmitting={serialSubmitting}
              // Saved chips render in the row's meta line (with the delete
              // menu) — suppress the card's own bottom chip list so the
              // serial doesn't display twice.
              showSavedChips={false}
              condition={line.condition_grade}
              onConditionChange={(next) => {
                markConditionSet(line.id);
                void handleCondition(next);
              }}
              onAdd={(sn) => submitSerial(sn)}
              onDeleteSerial={(s) => void deleteSerial(s)}
              resultSlot={
                isReturn ? (
                  <SerialMatchResult
                    state={serialLookup.state}
                    unit={serialLookup.unit}
                    serial={serialLookup.serial}
                    matchedOrder={serialLookup.matchedOrder}
                    onFileClaim={
                      onFileReturnClaim
                        ? (mo) => onFileReturnClaim(mo, serialLookup.serial)
                        : undefined
                    }
                  />
                ) : undefined
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
