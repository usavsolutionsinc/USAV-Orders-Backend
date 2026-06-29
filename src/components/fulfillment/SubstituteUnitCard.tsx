'use client';

import { useState } from 'react';
import { cn } from '@/utils/_cn';
import { Loader2 } from '@/components/Icons';
import { SubstitutePanel } from './SubstitutePanel';
import { OrderAmendmentsSection } from './OrderAmendmentsSection';
import {
  useOrderAmendments,
  useOrderPickTasks,
  useSubstituteUnit,
} from '@/hooks/fulfillment/useSubstitution';
import { useSubstitutionReasons } from '@/hooks/useSubstitutionReasons';

/**
 * Drop-in substitution surface for the testing / packing cards. Loads the
 * order's open allocations (pick-tasks) to supply the "ordered" context, lets
 * the operator pick which allocated unit to replace when there's more than one,
 * scans the substitute via SubstitutePanel, and posts through useSubstituteUnit.
 * The order's substitution history renders below via OrderAmendmentsSection.
 *
 * Stateless beyond selection + a reset nonce — all data + mutation live in the
 * hooks, so this is the single piece both stations mount. Gate the mount on the
 * substitution feature where it's hosted; this component assumes it's wanted.
 */
export interface SubstituteUnitCardProps {
  orderId: number;
  orderLabel: string;
  enforcement?: 'advisory' | 'block_until_approved';
  /** Which node is raising the substitution (default 'test'). */
  raisedAtNode?: 'pick' | 'test' | 'pack';
  className?: string;
}

const ALLOC_CHIP =
  'rounded-full px-2.5 py-1 text-micro font-black uppercase tracking-widest ring-1 ring-inset transition-colors';

export function SubstituteUnitCard({
  orderId,
  orderLabel,
  enforcement = 'advisory',
  raisedAtNode = 'test',
  className,
}: SubstituteUnitCardProps) {
  const pickTasks = useOrderPickTasks(orderId);
  const amendments = useOrderAmendments(orderId);
  const substitute = useSubstituteUnit();
  const reasons = useSubstitutionReasons();
  const [selectedAllocId, setSelectedAllocId] = useState<number | null>(null);
  const [resetNonce, setResetNonce] = useState(0);

  const tasks = pickTasks.data?.tasks ?? [];
  const active = tasks.find((t) => t.allocationId === selectedAllocId) ?? tasks[0] ?? null;

  return (
    <div className={cn('space-y-4', className)}>
      {pickTasks.isLoading ? (
        <p className="flex items-center gap-2 text-caption text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading allocations…
        </p>
      ) : active ? (
        <div className="space-y-2">
          {tasks.length > 1 ? (
            <div className="flex flex-wrap gap-1.5">
              {tasks.map((t) => {
                const sel = t.allocationId === active.allocationId;
                return (
                  <button
                    key={t.allocationId}
                    type="button"
                    onClick={() => setSelectedAllocId(t.allocationId)}
                    className={cn(
                      'ds-raw-button',
                      ALLOC_CHIP,
                      sel
                        ? 'bg-blue-50 text-blue-700 ring-blue-400'
                        : 'bg-gray-50 text-gray-600 ring-gray-200 hover:bg-gray-100',
                    )}
                  >
                    {t.sku}
                    {t.serialNumber ? ` · ${t.serialNumber.slice(-4)}` : ''}
                  </button>
                );
              })}
            </div>
          ) : null}

          <SubstitutePanel
            orderLabel={orderLabel}
            original={{ sku: active.sku, condition: active.conditionGrade, serial: active.serialNumber }}
            reasons={reasons}
            enforcement={enforcement}
            busy={substitute.isPending}
            error={substitute.error ? String((substitute.error as Error).message) : null}
            resetKey={resetNonce}
            onSubmit={(p) =>
              substitute.mutate(
                {
                  orderId,
                  originalAllocationId: active.allocationId,
                  substituteSerial: p.substituteSerial,
                  reasonCode: p.reasonCode,
                  customerRequestNote: p.note || undefined,
                  raisedAtNode,
                },
                { onSuccess: () => setResetNonce((n) => n + 1) },
              )
            }
          />
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-caption text-gray-500">
          No open allocations to substitute on this order.
        </div>
      )}

      <OrderAmendmentsSection rows={amendments.data ?? []} loading={amendments.isLoading} />
    </div>
  );
}
