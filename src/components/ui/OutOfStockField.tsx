'use client';

import { Check, Pencil } from '@/components/Icons';
import { AlertLineRow } from '@/design-system/components';
import { dmSans } from '@/lib/fonts';

interface OutOfStockFieldProps {
  value: string;
  editable?: boolean;
  onChange?: (value: string) => void;
  onCancel?: () => void;
  onSubmit?: () => void;
  isSaving?: boolean;
  autoFocus?: boolean;
  className?: string;
  onEdit?: () => void;
  dividerClassName?: string;
}

export function OutOfStockField({
  value,
  editable = false,
  onChange,
  onCancel,
  onSubmit,
  isSaving = false,
  autoFocus = false,
  className = '',
  onEdit,
  dividerClassName = 'border-b border-red-100',
}: OutOfStockFieldProps) {
  return (
    <div className={className}>
      {editable ? (
        <div className="space-y-2 rounded-xl border border-red-200 bg-red-50/40 p-3">
          <textarea
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
            placeholder="What is out of stock?"
            rows={2}
            className={`w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-normal text-gray-900 leading-5 outline-none focus:border-red-400 focus:ring-2 focus:ring-red-200 resize-none ${dmSans.className}`}
            autoFocus={autoFocus}
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="h-8 rounded-lg bg-white border border-red-200 text-red-700 text-[9px] font-black uppercase tracking-wider"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={isSaving}
              className="h-8 inline-flex items-center justify-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[9px] font-black uppercase tracking-wider disabled:opacity-50"
            >
              <Check className="w-3 h-3" />
              {isSaving ? 'Saving' : 'Submit'}
            </button>
          </div>
        </div>
      ) : (
        <AlertLineRow
          value={value}
          dividerClassName={dividerClassName}
          valueClassName={dmSans.className}
          actions={onEdit ? (
            <button
              type="button"
              onClick={onEdit}
              className="text-gray-400 transition-colors hover:text-red-600"
              aria-label="Edit out of stock note"
              title="Edit out of stock note"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          ) : null}
        />
      )}
    </div>
  );
}
