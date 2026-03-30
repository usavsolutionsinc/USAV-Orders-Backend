'use client';

import type { ReactNode } from 'react';

export interface FormFieldProps {
  /** Field label text */
  label: string;
  /** Show red asterisk after label */
  required?: boolean;
  /** Gray hint shown instead of asterisk (e.g. "optional") */
  optionalHint?: string;
  /** Helper text below the control */
  hintBelow?: string;
  /** The form control (input, select, textarea, etc.) */
  children: ReactNode;
  /** Stack label above or beside the control */
  layout?: 'vertical' | 'horizontal';
  className?: string;
}

/**
 * Standardized form field wrapper with label, optional indicator, and hint.
 * Uses: typography.fieldLabel preset pattern.
 */
export function FormField({
  label,
  required = false,
  optionalHint,
  hintBelow,
  children,
  layout = 'vertical',
  className = '',
}: FormFieldProps) {
  const isVertical = layout === 'vertical';

  return (
    <div
      className={`${
        isVertical ? 'flex flex-col gap-1.5' : 'flex items-center gap-3'
      } ${className}`.trim()}
    >
      <label className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-700 flex items-center gap-1">
        {label}
        {required && <span className="text-red-500">*</span>}
        {optionalHint && !required && (
          <span className="text-gray-400 normal-case tracking-normal font-normal">
            ({optionalHint})
          </span>
        )}
      </label>
      {children}
      {hintBelow && (
        <p className="text-[10px] text-gray-400">{hintBelow}</p>
      )}
    </div>
  );
}
