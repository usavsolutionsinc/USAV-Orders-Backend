'use client';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface InlineSaveIndicatorProps {
  state: SaveState;
  errorLabel?: string;
  idleLabel?: string | null;
}

export function InlineSaveIndicator({
  state,
  errorLabel = 'Save failed',
  idleLabel = null,
}: InlineSaveIndicatorProps) {
  if (state === 'idle' && !idleLabel) return null;

  const label = state === 'saving'
    ? 'Saving...'
    : state === 'saved'
      ? 'Saved'
      : state === 'error'
        ? errorLabel
        : idleLabel;

  const toneClassName = state === 'saving'
    ? 'text-blue-600'
    : state === 'saved'
      ? 'text-emerald-600'
      : state === 'error'
        ? 'text-red-600'
        : 'text-gray-400';

  return (
    <span className={`shrink-0 text-[10px] font-black uppercase tracking-wide ${toneClassName}`}>
      {label}
    </span>
  );
}
