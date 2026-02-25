'use client';

import { Check } from '@/components/Icons';
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
}: OutOfStockFieldProps) {
  return (
    <div className={className}>
      <span className="text-[10px] text-orange-700 font-black uppercase tracking-widest block mb-1.5">Out Of Stock</span>
      <div className="space-y-2 rounded-xl border border-orange-200 bg-orange-50/40 p-3">
        {editable ? (
          <>
            <textarea
              value={value}
              onChange={(e) => onChange?.(e.target.value)}
              placeholder="What is out of stock?"
              rows={2}
              className={`w-full rounded-lg border border-orange-200 bg-white px-3 py-2 text-sm font-normal text-gray-900 leading-5 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-200 resize-none ${dmSans.className}`}
              autoFocus={autoFocus}
            />
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="h-8 rounded-lg bg-white border border-orange-200 text-orange-700 text-[9px] font-black uppercase tracking-wider"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onSubmit}
                disabled={isSaving}
                className="h-8 inline-flex items-center justify-center gap-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-[9px] font-black uppercase tracking-wider disabled:opacity-50"
              >
                <Check className="w-3 h-3" />
                {isSaving ? 'Saving' : 'Submit'}
              </button>
            </div>
          </>
        ) : (
          <p
            className={`rounded-lg border border-orange-200 bg-white px-3 py-2 text-sm font-normal text-gray-900 leading-5 break-words whitespace-pre-wrap ${dmSans.className}`}
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {value || 'N/A'}
          </p>
        )}
      </div>
    </div>
  );
}

