'use client';

import { Check, Loader2, X } from '@/components/Icons';
import { IconButton } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';

interface ShippedOutOfStockComposerProps {
  value: string;
  onChange?: (value: string) => void;
  onCancel?: () => void;
  onSubmit?: () => void;
  onClick?: () => void;
  isSaving?: boolean;
  readOnly?: boolean;
}

export function ShippedOutOfStockComposer({
  value,
  onChange,
  onCancel,
  onSubmit,
  onClick,
  isSaving = false,
  readOnly = false,
}: ShippedOutOfStockComposerProps) {
  return (
    <section className="mx-8 pt-2">
      <div className="relative rounded-2xl border border-red-200/80 bg-surface-card shadow-[0_1px_0_rgba(15,23,42,0.04)]">
        <span className="pointer-events-none absolute left-4 top-2 z-10 text-micro font-semibold uppercase tracking-[0.18em] text-red-500">
          Out of stock
        </span>
        {readOnly ? (
          <HoverTooltip label="Click to edit" asChild>
            <button
              type="button"
              onClick={onClick}
              className="ds-raw-button block w-full rounded-2xl px-4 pb-3 pt-7 text-left transition hover:bg-red-50/50"
              aria-label="Edit out of stock note"
            >
              <div className="whitespace-pre-wrap text-sm font-medium leading-6 text-text-muted">
                {value}
              </div>
            </button>
          </HoverTooltip>
        ) : (
          <>
            <input
              type="text"
              value={value}
              onChange={(event) => onChange?.(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (!isSaving) onSubmit?.();
                }
              }}
              placeholder="What needs to be ordered?"
              disabled={isSaving}
              className="w-full rounded-t-2xl border-0 bg-transparent px-4 pb-3 pt-7 text-sm font-medium leading-6 text-text-default outline-none placeholder:text-text-faint focus:ring-0"
              autoFocus
            />
            <div className="flex items-center justify-between border-t border-border-hairline px-3 py-2">
              <HoverTooltip label="Cancel" asChild>
                <IconButton
                  onClick={onCancel}
                  disabled={isSaving}
                  ariaLabel="Cancel out of stock note"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-text-faint hover:bg-red-50 hover:text-red-600"
                  icon={<X className="h-4 w-4" />}
                />
              </HoverTooltip>
              <HoverTooltip label={isSaving ? 'Saving' : 'Save'} asChild>
                <IconButton
                  onClick={onSubmit}
                  disabled={isSaving}
                  ariaLabel={isSaving ? 'Saving out of stock note' : 'Save out of stock note'}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-surface-inverse text-white hover:bg-surface-inverse-hover"
                  icon={isSaving ? <Loader2 className="h-4 w-4 animate-spin text-white" /> : <Check className="h-4 w-4 text-white" />}
                />
              </HoverTooltip>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
