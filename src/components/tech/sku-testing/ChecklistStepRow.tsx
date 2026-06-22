import { Loader2, Pencil, Trash2, X } from '@/components/Icons';
import { needsValueInput, type ChecklistStep, type UnitResult } from './sku-testing-types';
import { StepValueControl } from './StepValueControl';
import type { ChecklistEditor } from './useChecklistEditor';

/** One checklist step row — record toggle / value input, inline edit, delete. */
export function ChecklistStepRow({
  step,
  result,
  canRecord,
  ed,
}: {
  step: ChecklistStep;
  result?: UnitResult;
  canRecord: boolean;
  ed: ChecklistEditor;
}) {
  const checked = result?.passed === true;
  const recording = ed.recordingStep === step.step_id;
  const isEditing = ed.editingId === step.step_id;
  const isValueStep = needsValueInput(step.value_kind);

  return (
    <li
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 transition-colors duration-150 ${
        checked ? 'border-emerald-200 bg-emerald-50/60' : 'border-gray-200/70 bg-white'
      }`}
    >
      <button
        type="button"
        onClick={() => void ed.toggleRecord(step)}
        disabled={!canRecord || recording || isEditing || isValueStep}
        aria-pressed={checked}
        title={
          isValueStep
            ? 'Pass/fail is set by the recorded value'
            : canRecord
              ? 'Mark for this unit'
              : 'Scan a serial to record results'
        }
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs font-black transition-all duration-150 active:scale-95 ${
          checked ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-gray-300 bg-white text-transparent'
        } ${!canRecord ? 'cursor-default opacity-90' : ''}`}
      >
        {recording ? <Loader2 className="h-3 w-3 animate-spin text-gray-400" /> : '✓'}
      </button>

      <div className="min-w-0 flex-1">
        {isEditing ? (
          <div className="flex items-center gap-1.5">
            <input
              value={ed.editLabel}
              onChange={(e) => ed.setEditLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void ed.saveEdit();
                if (e.key === 'Escape') ed.setEditingId(null);
              }}
              autoFocus
              className="w-full rounded-md border border-blue-300 px-2 py-1 text-caption font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/10"
            />
            <button type="button" onClick={() => void ed.saveEdit()} disabled={ed.busy} className="rounded-md p-1 text-emerald-600 hover:bg-emerald-50">
              {ed.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="text-xs font-black">✓</span>}
            </button>
            <button type="button" onClick={() => ed.setEditingId(null)} className="rounded-md p-1 text-gray-400 hover:bg-gray-100">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <>
            <span className="block text-caption font-semibold leading-snug text-gray-900">{step.step_label}</span>
            {isValueStep && canRecord ? (
              <StepValueControl
                step={step}
                result={result}
                busy={recording}
                onSubmit={(raw) => void ed.recordValue(step, raw)}
              />
            ) : null}
            {result?.verified_by_name && (checked || isValueStep) ? (
              <span className="mt-0.5 block text-micro font-medium uppercase tracking-wide text-emerald-700">
                {result.verified_by_name}
              </span>
            ) : null}
          </>
        )}
      </div>

      {!isEditing ? (
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => {
              ed.setEditingId(step.step_id);
              ed.setEditLabel(step.step_label);
            }}
            className="rounded-md p-1 text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-700"
            title="Edit step"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void ed.removeStep(step.step_id)}
            className="rounded-md p-1 text-gray-400 transition-colors duration-150 hover:bg-rose-50 hover:text-rose-600"
            title="Delete step"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
    </li>
  );
}
