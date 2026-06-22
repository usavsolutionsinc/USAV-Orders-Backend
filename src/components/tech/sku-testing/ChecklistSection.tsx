import { Loader2, Plus } from '@/components/Icons';
import { EYEBROW, SECTION, type Bundle, type UnitResult } from './sku-testing-types';
import { useChecklistEditor } from './useChecklistEditor';
import { ChecklistStepRow } from './ChecklistStepRow';
import { NoCatalogNotice } from './NoCatalogNotice';

/** Testing checklist — template editing + per-unit recording for one line. */
export function ChecklistSection({
  receivingLineId,
  bundle,
  results,
  canRecord,
  serialUnitId,
  onChanged,
  onReloadResults,
  onResultChange,
}: {
  receivingLineId: number;
  bundle: Bundle;
  results: Record<number, UnitResult>;
  canRecord: boolean;
  serialUnitId: number | null;
  onChanged: () => Promise<void>;
  onReloadResults: () => Promise<void>;
  onResultChange: (stepId: number, next: Partial<UnitResult>) => void;
}) {
  const steps = bundle.checklist;
  const ed = useChecklistEditor({
    receivingLineId,
    steps,
    serialUnitId,
    results,
    onChanged,
    onReloadResults,
    onResultChange,
  });

  return (
    <section className={SECTION}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className={EYEBROW}>Testing checklist</h3>
        <div className="flex items-center gap-2">
          {steps.length > 0 ? (
            <span
              className={`rounded-md px-2 py-0.5 text-micro font-bold uppercase tracking-wider ${
                canRecord && ed.done === steps.length
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-gray-100 text-gray-600'
              }`}
            >
              {ed.done}/{steps.length} done
            </span>
          ) : null}
          {canRecord && steps.length > 0 ? (
            <>
              <button
                type="button"
                onClick={() => void ed.bulkSet(ed.allDone ? 'clear' : 'pass')}
                disabled={ed.bulkBusy}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-micro font-bold uppercase tracking-wider text-emerald-600 transition-colors duration-150 hover:bg-emerald-50 disabled:opacity-50"
                title={ed.allDone ? 'Clear all recorded results for this unit' : 'Mark every step passed for this unit'}
              >
                {ed.bulkBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {ed.allDone ? 'Clear all' : 'Check all'}
              </button>
              <span className="h-3.5 w-px bg-gray-200" aria-hidden />
            </>
          ) : null}
          <button
            type="button"
            onClick={() => {
              ed.setAdding((v) => !v);
              ed.setDraft('');
            }}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-micro font-bold uppercase tracking-wider text-blue-600 transition-colors duration-150 hover:bg-blue-50"
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </div>
      </div>

      {bundle.skuCatalogId == null ? (
        <NoCatalogNotice receivingLineId={receivingLineId} sku={bundle.sku ?? ''} onCreated={onChanged} />
      ) : null}

      <ul className="flex flex-col gap-1.5">
        {steps.map((step) => (
          <ChecklistStepRow
            key={step.step_id}
            step={step}
            result={results[step.step_id]}
            canRecord={canRecord}
            ed={ed}
          />
        ))}
      </ul>

      {ed.adding ? (
        <div className="mt-2 flex items-center gap-1.5">
          <input
            value={ed.draft}
            onChange={(e) => ed.setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void ed.addStep();
              if (e.key === 'Escape') ed.setAdding(false);
            }}
            autoFocus
            placeholder="New checklist step…"
            className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-caption font-medium text-gray-900 placeholder:text-gray-400 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/10"
          />
          <button
            type="button"
            onClick={() => void ed.addStep()}
            disabled={ed.busy || !ed.draft.trim()}
            className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-caption font-bold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {ed.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}
          </button>
        </div>
      ) : null}

      {steps.length === 0 && !ed.adding ? (
        <p className="text-caption text-gray-400">No checklist steps yet. Use “Add” to create one.</p>
      ) : null}

      {steps.length > 0 && !canRecord ? (
        <p className="mt-2.5 text-micro font-medium uppercase tracking-wide text-gray-400">
          Scan a serial to record results
        </p>
      ) : null}
    </section>
  );
}
