import { FbaSelectedLineRow } from '@/components/fba/sidebar/FbaSelectedLineRow';
import { emitOpenQuickAddFnsku } from '@/components/fba/FbaQuickAddFnskuModal';
import { PLAN_QTY_MAX, type PlanPreviewLine } from '@/lib/fba/plan-helpers';
import type { StationTheme } from '@/utils/staff-colors';
import { FbaQtyStepper } from './FbaQtyStepper';

/**
 * Plan-mode (non-fbaScanOnly) preview of the line(s) just added to the open
 * plan, with inline qty stepper that PATCH/DELETEs the line via `onPatchQty`.
 */
export function FbaPlanPreviewList({
  lines,
  stationTheme,
  onPatchQty,
}: {
  lines: PlanPreviewLine[];
  stationTheme: StationTheme;
  onPatchQty: (line: PlanPreviewLine, nextQty: number) => void;
}) {
  return (
    <div className="divide-y divide-border-soft">
      {lines.map((line, idx) => (
        <FbaSelectedLineRow
          key={`${line.itemId}-${idx}`}
          displayTitle={line.displayTitle}
          fnsku={line.fnsku}
          stationTheme={stationTheme}
          onEditDetails={() =>
            emitOpenQuickAddFnsku({
              fnsku: line.fnsku,
              product_title: line.displayTitle || null,
              asin: null,
              sku: null,
              condition: null,
            })
          }
          rightSlot={
            <FbaQtyStepper
              fnsku={line.fnsku}
              qty={line.expectedQty}
              onInc={() => onPatchQty(line, Math.min(PLAN_QTY_MAX, line.expectedQty + 1))}
              onDec={() => onPatchQty(line, line.expectedQty - 1)}
              onSet={(v) => onPatchQty(line, v)}
            />
          }
        />
      ))}
    </div>
  );
}
