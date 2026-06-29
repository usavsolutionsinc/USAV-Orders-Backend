import { FbaSelectedLineRow } from '@/components/fba/sidebar/FbaSelectedLineRow';
import { Button } from '@/design-system/primitives';
import { emitOpenQuickAddFnsku } from '@/components/fba/FbaQuickAddFnskuModal';
import { PLAN_QTY_MAX, type BulkScanCandidate } from '@/lib/fba/plan-helpers';
import type { StationTheme } from '@/utils/staff-colors';
import { FbaQtyStepper } from './FbaQtyStepper';

/**
 * No-`?plan=` review queue (fbaScanOnly plan mode): scanned FNSKUs sit here for
 * qty review, then Cancel / Add-to-plan (or Update-plan when a row already
 * exists in today's plan).
 */
export function FbaPendingPlanQueue({
  rows,
  stationTheme,
  todayPlanQtyByFnsku,
  isLoading,
  touchesExistingLine,
  onPatchQty,
  onCancel,
  onSubmit,
  onSetError,
}: {
  rows: BulkScanCandidate[];
  stationTheme: StationTheme;
  todayPlanQtyByFnsku: Record<string, number>;
  isLoading: boolean;
  touchesExistingLine: boolean;
  onPatchQty: (fnsku: string, nextQty: number) => void;
  onCancel: () => void;
  onSubmit: (rows: BulkScanCandidate[]) => void;
  onSetError: (msg: string) => void;
}) {
  return (
    <>
      <div className="divide-y divide-gray-200 overflow-y-auto">
        {rows.map((r) => {
          const title = (r.product_title && String(r.product_title).trim()) || r.fnsku;
          return (
            <FbaSelectedLineRow
              key={r.fnsku}
              displayTitle={title}
              fnsku={r.fnsku}
              stationTheme={stationTheme}
              microcopyAboveTitle={
                r.upserted_stub || r.needs_details
                  ? 'Added to catalog — details pending'
                  : (todayPlanQtyByFnsku[r.fnsku] ?? 0) > 0
                  ? 'Found in FBA plan — edit qty'
                  : undefined
              }
              microcopyTone={r.upserted_stub || r.needs_details ? 'success' : 'default'}
              onEditDetails={() => emitOpenQuickAddFnsku({
                fnsku: r.fnsku,
                product_title: r.product_title,
                asin: r.asin,
                sku: r.sku,
              })}
              rightSlot={
                <FbaQtyStepper
                  fnsku={r.fnsku}
                  qty={r.qty}
                  onInc={() => onPatchQty(r.fnsku, Math.min(PLAN_QTY_MAX, r.qty + 1))}
                  onDec={() => onPatchQty(r.fnsku, r.qty - 1)}
                  onSet={(v) => onPatchQty(r.fnsku, v)}
                />
              }
            />
          );
        })}
      </div>
      <div className="flex w-full min-w-0 items-center justify-between gap-3 bg-white px-3 py-2.5">
        <Button
          variant="ghost"
          type="button"
          disabled={isLoading}
          onClick={() => onCancel()}
          className="h-auto shrink-0 rounded-none px-0 text-eyebrow font-black uppercase tracking-[0.12em] text-gray-500 hover:bg-transparent hover:text-gray-900"
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          type="button"
          disabled={isLoading}
          onClick={() => {
            if (!rows?.length) return;
            if (rows.every((r) => r.qty <= 0)) {
              onSetError('Set a quantity above zero for at least one line.');
              return;
            }
            const submitRows = rows;
            onCancel();
            onSubmit(submitRows);
          }}
          className="h-auto shrink-0 rounded-md bg-purple-600 px-2.5 py-1 text-eyebrow font-black uppercase tracking-[0.12em] text-white shadow-none hover:bg-purple-700"
        >
          {touchesExistingLine ? 'Update plan' : 'Add to plan'}
        </Button>
      </div>
    </>
  );
}
