'use client';

import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';

export type TextFieldTone = 'blue' | 'amber' | 'emerald' | 'neutral';

const toneClass: Record<
  TextFieldTone,
  { input: string; floatLabel: string; focusLabel: string }
> = {
  blue: {
    input: 'border-gray-200 focus:border-blue-500 focus:ring-blue-500/20',
    floatLabel: 'text-blue-600',
    focusLabel: 'peer-focus:text-blue-600',
  },
  amber: {
    input: 'border-amber-400 focus:border-amber-500 focus:ring-amber-500/25',
    floatLabel: 'text-amber-600',
    focusLabel: 'peer-focus:text-amber-600',
  },
  emerald: {
    input: 'border-emerald-500 focus:border-emerald-600 focus:ring-emerald-500/25',
    floatLabel: 'text-emerald-600',
    focusLabel: 'peer-focus:text-emerald-600',
  },
  neutral: {
    input: 'border-gray-200 focus:border-gray-900 focus:ring-gray-900/10',
    floatLabel: 'text-gray-500',
    focusLabel: 'peer-focus:text-gray-900',
  },
};

export interface TextFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'size'> {
  /**
   * Floating label. Sits centered inside the field as the placeholder while the
   * input is empty and unfocused, then animates up into the top border on focus
   * — or stays up whenever the field holds a value. So the label doubles as the
   * placeholder and the header, with no separate placeholder text.
   */
  label: string;
  /** Controlled value. */
  value: string;
  /** Receives the next raw string value. */
  onChange: (value: string) => void;
  /** Accent for the focused border + floated label. */
  tone?: TextFieldTone;
  /** Render the input value in a monospace font (serial / tracking scans). */
  mono?: boolean;
  /** Control pinned to the right edge inside the field (e.g. a clear button). */
  trailing?: ReactNode;
  /** Classes for the outer wrapper. */
  className?: string;
  /** Extra classes appended to the <input> / <textarea>. */
  inputClassName?: string;
  /** Render a multi-line <textarea> instead of a single-line <input>. */
  multiline?: boolean;
  /** Row count for the multiline variant. Default 2. */
  rows?: number;
}

/**
 * Floating-label text field — the real implementation of the `/design-demo`
 * "Floating-label field" (03 · Inputs). Replaces the static label-above-input
 * forms: the label animates into the border on focus/fill.
 *
 * The float state is derived from `value` (so it stays up when filled), while
 * the `peer-focus:` variants raise the label on focus even when empty. No
 * leading icon — the motion is the affordance.
 */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  function TextField(
    {
      label,
      value,
      onChange,
      tone = 'blue',
      mono = false,
      trailing,
      className = '',
      inputClassName = '',
      multiline = false,
      rows = 2,
      id,
      disabled,
      ...inputProps
    },
    ref,
  ) {
    const autoId = useId();
    const fieldId = id ?? autoId;
    const float = value.length > 0;
    const t = toneClass[tone];

    // Shared chrome for both variants — only the element + a little padding differ.
    const sharedClass = `peer block w-full rounded-xl border bg-white px-3.5 text-sm text-gray-900 outline-none transition-[box-shadow,border-color] duration-150 placeholder:text-transparent focus:ring-2 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 ${
      mono ? 'font-mono' : ''
    } ${t.input} ${inputClassName}`;

    return (
      <div className={`relative w-full ${className}`.trim()}>
        {multiline ? (
          <textarea
            id={fieldId}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            // A single space keeps the native placeholder empty while the
            // floating <label> owns the empty-state text.
            placeholder=" "
            rows={rows}
            className={`${sharedClass} resize-none pb-2 pt-5 leading-snug`.trim()}
            {...(inputProps as unknown as TextareaHTMLAttributes<HTMLTextAreaElement>)}
          />
        ) : (
          <input
            ref={ref}
            id={fieldId}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            placeholder=" "
            className={`${sharedClass} h-11 pb-1 pt-5 ${trailing ? 'pr-9' : ''}`.trim()}
            {...inputProps}
          />
        )}
        <label
          htmlFor={fieldId}
          className={`pointer-events-none absolute left-3.5 origin-left transition-all duration-150 ${
            float
              ? `top-1.5 text-[10px] font-semibold uppercase tracking-wide ${t.floatLabel}`
              : `${multiline ? 'top-5' : 'top-3'} text-sm text-gray-400`
          } peer-focus:top-1.5 peer-focus:text-[10px] peer-focus:font-semibold peer-focus:uppercase peer-focus:tracking-wide ${t.focusLabel}`}
        >
          {label}
        </label>
        {trailing && !multiline ? (
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2">{trailing}</div>
        ) : null}
      </div>
    );
  },
);
