import { Loader2, Pencil, Trash2, X } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { IconButton } from '@/design-system/primitives';
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
  const recordHint = isValueStep
    ? 'Pass/fail is set by the recorded value'
    : canRecord
      ? 'Mark for this unit'
      : 'Scan a serial to record results';

  return (
    <li
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 transition-colors duration-150 ${
        checked ? 'border-emerald-200 bg-emerald-50/60' : 'border-gray-200/70 bg-white'
      }`}
    >
      <HoverTooltip label={recordHint} asChild>
        {/* ds-raw-button: checkbox-style two-state record toggle (aria-pressed + conditional emerald fill), not a standard action button */}
        <button
          type="button"
          onClick={() => void ed.toggleRecord(step)}
          disabled={!canRecord || recording || isEditing || isValueStep}
          aria-pressed={checked}
          aria-label={recordHint}
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs font-black transition-all duration-150 active:scale-95 ${
            checked ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-gray-300 bg-white text-transparent'
          } ${!canRecord ? 'cursor-default opacity-90' : ''}`}
        >
          {recording ? <Loader2 className="h-3 w-3 animate-spin text-gray-400" /> : '✓'}
        </button>
      </HoverTooltip>

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
            <IconButton
              onClick={() => void ed.saveEdit()}
              disabled={ed.busy}
              ariaLabel="Save step"
              icon={ed.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="text-xs font-black">✓</span>}
              className="rounded-md p-1 text-emerald-600 hover:bg-emerald-50"
            />
            <IconButton
              onClick={() => ed.setEditingId(null)}
              ariaLabel="Cancel edit"
              icon={<X className="h-4 w-4" />}
              className="rounded-md p-1 text-gray-400 hover:bg-gray-100"
            />
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
          <HoverTooltip label="Edit step" asChild>
            <IconButton
              onClick={() => {
                ed.setEditingId(step.step_id);
                ed.setEditLabel(step.step_label);
              }}
              ariaLabel="Edit step"
              icon={<Pencil className="h-3.5 w-3.5" />}
              className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            />
          </HoverTooltip>
          <HoverTooltip label="Delete step" asChild>
            <IconButton
              onClick={() => void ed.removeStep(step.step_id)}
              ariaLabel="Delete step"
              icon={<Trash2 className="h-3.5 w-3.5" />}
              className="rounded-md p-1 text-gray-400 hover:bg-rose-50 hover:text-rose-600"
            />
          </HoverTooltip>
        </div>
      ) : null}
    </li>
  );
}
