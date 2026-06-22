'use client';

import { Loader2 } from '@/components/Icons';
import { SECTION } from './sku-testing/sku-testing-types';
import { useSkuTestingData } from './sku-testing/useSkuTestingData';
import { ChecklistSection } from './sku-testing/ChecklistSection';
import { ManualsSection } from './sku-testing/ManualsSection';

/**
 * Testing-centered panel for one receiving line. Resolves the line's SKU catalog
 * (scanned unit → SKU string crosswalk) and lets a tech:
 *   • view + add/edit/delete the checklist steps (template, per-SKU)
 *   • record each step per scanned unit (who/when) once a serial exists
 *   • see the SKU's manuals, pair one from the library, and open/print it
 *
 * Thin composition layer — data lives in `useSkuTestingData`; the checklist and
 * manuals sections + their mutations live under `./sku-testing/`.
 */
interface Props {
  receivingLineId: number;
  sku: string;
  title: string;
  /** Active scanned unit, if any — enables per-unit step recording. */
  serialUnitId?: number | null;
}

export function SkuTestingPanel({ receivingLineId, sku, title, serialUnitId }: Props) {
  const { bundle, loading, results, canRecord, loadBundle, loadResults, onResultChange } = useSkuTestingData(
    receivingLineId,
    sku,
    title,
    serialUnitId,
  );

  if (loading) {
    return (
      <section className={SECTION}>
        <div className="flex items-center gap-2 py-2 text-caption text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading testing details…
        </div>
      </section>
    );
  }
  if (!bundle) return null;

  return (
    <div className="flex flex-col gap-3">
      <ChecklistSection
        receivingLineId={receivingLineId}
        bundle={bundle}
        results={results}
        canRecord={canRecord}
        serialUnitId={serialUnitId ?? null}
        onChanged={loadBundle}
        onReloadResults={loadResults}
        onResultChange={onResultChange}
      />
      <ManualsSection receivingLineId={receivingLineId} bundle={bundle} onChanged={loadBundle} />
    </div>
  );
}
