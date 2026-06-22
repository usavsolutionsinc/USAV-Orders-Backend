import { useEffect, useState } from 'react';
import { Loader2 } from '@/components/Icons';
import { NUMERIC_VALUE_KINDS, type ChecklistStep, type UnitResult } from './sku-testing-types';

/**
 * Captures a structured value for one execution step (number / percent / enum /
 * text). Numeric kinds submit `valueNum` (the server derives pass/fail from the
 * step's pass band); enum/text submit `valueText`. Shows the pass band as a hint.
 */
export function StepValueControl({
  step,
  result,
  busy,
  onSubmit,
}: {
  step: ChecklistStep;
  result?: UnitResult;
  busy: boolean;
  onSubmit: (raw: string) => void;
}) {
  const kind = step.value_kind ?? '';
  const isNumeric = NUMERIC_VALUE_KINDS.has(kind);
  const recorded =
    result?.value_num != null
      ? String(result.value_num)
      : result?.value_text != null
        ? result.value_text
        : '';
  const [val, setVal] = useState<string>(recorded);
  // Re-sync when the recorded value changes (reload, unit switch).
  useEffect(() => {
    setVal(recorded);
  }, [recorded]);

  const unitSuffix = step.value_unit ? ` ${step.value_unit}` : kind === 'PERCENT' ? ' %' : '';
  const min = step.pass_min == null ? null : Number(step.pass_min);
  const max = step.pass_max == null ? null : Number(step.pass_max);
  const band =
    min != null && max != null
      ? `${min}–${max}${unitSuffix}`
      : min != null
        ? `≥ ${min}${unitSuffix}`
        : max != null
          ? `≤ ${max}${unitSuffix}`
          : null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      {kind === 'ENUM' ? (
        <select
          value={val}
          onChange={(e) => {
            setVal(e.target.value);
            onSubmit(e.target.value);
          }}
          disabled={busy}
          className="rounded-md border border-gray-200 px-2 py-1 text-caption font-medium text-gray-900 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/10"
        >
          <option value="">—</option>
          {(step.value_enum ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <>
          <input
            type={isNumeric ? 'number' : 'text'}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSubmit(val);
            }}
            onBlur={() => {
              if (val !== recorded) onSubmit(val);
            }}
            placeholder={isNumeric ? step.value_unit || (kind === 'PERCENT' ? '%' : 'value') : 'value'}
            disabled={busy}
            className="w-24 rounded-md border border-gray-200 px-2 py-1 text-caption font-medium text-gray-900 placeholder:text-gray-400 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/10"
          />
          {step.value_unit ? (
            <span className="text-micro font-semibold text-gray-400">{step.value_unit}</span>
          ) : null}
        </>
      )}
      {band ? (
        <span className="text-micro font-medium uppercase tracking-wide text-gray-400">pass {band}</span>
      ) : null}
      {busy ? <Loader2 className="h-3 w-3 animate-spin text-gray-400" /> : null}
    </div>
  );
}
