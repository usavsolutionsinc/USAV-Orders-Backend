'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface DeferredQtyInputProps {
  /** Committed value. The input shows this when unfocused and reverts to it on invalid blur. */
  value: number;
  /** Called only when user commits a valid value that differs from the current one. */
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLInputElement>;
}

/**
 * Number input with deferred commit — draft lives inside the component.
 *
 * - Typing updates the display only (no parent state changes mid-edit)
 * - Commits on blur or Enter: clamps to [min, max], calls onChange only if value changed
 * - Backspace to empty / invalid → reverts to the last committed value on blur
 * - External `value` prop changes sync into the input only while unfocused
 */
export function DeferredQtyInput({
  value,
  onChange,
  min = 0,
  max,
  disabled,
  className,
  onClick,
}: DeferredQtyInputProps) {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) {
      setDraft(String(value));
    }
  }, [value]);

  const commit = useCallback(() => {
    const trimmed = draft.trim();
    const parsed = parseInt(trimmed, 10);
    if (trimmed === '' || isNaN(parsed)) {
      setDraft(String(value));
      return;
    }
    const clamped =
      max !== undefined
        ? Math.max(min, Math.min(max, parsed))
        : Math.max(min, parsed);
    setDraft(String(clamped));
    if (clamped !== value) {
      onChange(clamped);
    }
  }, [draft, value, min, max, onChange]);

  return (
    <input
      type="number"
      min={min}
      max={max}
      disabled={disabled}
      value={draft}
      className={className}
      onClick={onClick}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => { focused.current = true; }}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}
