import React from 'react';
import { Search, Clipboard, Printer } from '@/components/Icons';
import { IconButton } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { LabelPreviewCard } from '@/components/labels/LabelPreviewCard';
import type { ProductLabelDraft } from '@/components/labels/ProductLabelEditPopover';
import type { BarcodeMode } from '@/components/barcode/ModeSelector';
import type { ModeAccent } from './mode-accent';

/** Helper hint under the SKU field in the comfortable (horizontal) layout. */
export function comfyHelperHint(mode: BarcodeMode) {
  const text =
    mode === 'reprint'
      ? 'Scan or paste a SKU to bring up its last label.'
      : 'Scan or paste a SKU to load product info.';
  return <p className="mt-2 text-xs text-gray-500">{text}</p>;
}

interface WorkspaceCardProps {
  label?: string;
  tone?: ModeAccent['tone'];
  children: React.ReactNode;
  actions?: React.ReactNode;
}

/** Generic white surface card used across the horizontal workspace. */
export function WorkspaceCard({ label, children, actions }: WorkspaceCardProps) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200/60">
      {(label || actions) && (
        <div className="mb-3 flex items-center justify-between">
          {label && (
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">{label}</h3>
          )}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

interface ModernSkuFieldProps {
  value: string;
  inputRef: React.RefObject<HTMLInputElement>;
  accent: ModeAccent;
  onChange: (v: string) => void;
  onNext: () => void;
  onFillAndSearch: (v: string) => void;
}

/** SKU input + clipboard-paste + search button row. */
export function ModernSkuField({ value, inputRef, accent, onChange, onNext, onFillAndSearch }: ModernSkuFieldProps) {
  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const trimmed = text.trim();
      if (trimmed) onFillAndSearch(trimmed);
    } catch {}
  };

  return (
    <div className="flex items-stretch gap-2">
      <div className="relative flex-1">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onNext()}
          placeholder="Scan or type a SKU…"
          autoComplete="off"
          spellCheck={false}
          className={`block h-12 w-full rounded-xl border border-gray-200 bg-white px-4 font-mono text-base text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 ${accent.focusRing}`}
        />
      </div>
      <HoverTooltip label="Paste from clipboard and search" asChild>
        <IconButton
          icon={<Clipboard className="h-4 w-4" />}
          onClick={handlePaste}
          ariaLabel="Paste from clipboard and search"
          className="h-12 w-12 rounded-xl border border-gray-200 bg-white hover:bg-gray-50"
        />
      </HoverTooltip>
      <HoverTooltip label="Search" asChild>
        {/* ds-raw-button: solid accent CTA (renders emerald in sn-to-sku mode) */}
        <button
          type="button"
          onClick={onNext}
          aria-label="Search"
          className={`inline-flex h-12 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold text-white shadow-sm transition-colors ${accent.ctaBg} ${accent.ctaHover}`}
        >
          <Search className="h-4 w-4" />
          <span>Search</span>
        </button>
      </HoverTooltip>
    </div>
  );
}

interface ProductContextCardProps {
  title: string;
  stock: string;
  imageUrl?: string;
  isLoading: boolean;
}

/** Thumbnail + title + stock-level chip for the looked-up product. */
export function ProductContextCard({ title, stock, imageUrl, isLoading }: ProductContextCardProps) {
  const stockNum = parseInt(stock || '0', 10) || 0;
  const stockClass =
    stockNum <= 0
      ? 'bg-red-50 text-red-700 ring-red-200'
      : stockNum <= 5
        ? 'bg-amber-50 text-amber-700 ring-amber-200'
        : 'bg-emerald-50 text-emerald-700 ring-emerald-200';

  return (
    <section className="flex items-start gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200/60">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gray-50 ring-1 ring-gray-200">
        {isLoading ? (
          <div className="h-full w-full animate-pulse bg-gray-200" />
        ) : imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt=""
            className="h-full w-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <Printer className="h-5 w-5 text-gray-300" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        {isLoading ? (
          <div className="space-y-2">
            <div className="h-4 w-3/4 animate-pulse rounded bg-gray-200" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-gray-100" />
          </div>
        ) : (
          <p className="text-base font-semibold leading-snug text-gray-900">
            {title || <span className="italic text-gray-400">SKU not in catalog</span>}
          </p>
        )}
      </div>

      <span className={`shrink-0 rounded-lg px-2.5 py-1 text-sm font-bold tabular-nums ring-1 ${stockClass}`}>
        {stock || '0'} <span className="text-micro font-semibold uppercase tracking-wider">stock</span>
      </span>
    </section>
  );
}

interface NotesCardProps {
  notes: string;
  showNotes: boolean;
  accent: ModeAccent;
  onToggleNotes: () => void;
  onNotesChange: (v: string) => void;
}

/** Collapsible optional notes field. */
export function NotesCard({ notes, showNotes, accent, onToggleNotes, onNotesChange }: NotesCardProps) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200/60">
      {/* ds-raw-button: full-width text-left collapsible header row (label + ± affordance) */}
      <button
        type="button"
        onClick={onToggleNotes}
        className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-[0.14em] text-gray-500 hover:text-gray-700"
      >
        <span>
          Notes{' '}
          {notes ? (
            <span className="ml-1 text-gray-400 normal-case tracking-normal">(filled)</span>
          ) : (
            <span className="ml-1 text-gray-400 normal-case tracking-normal">(optional)</span>
          )}
        </span>
        <span aria-hidden>{showNotes ? '−' : '+'}</span>
      </button>
      {showNotes && (
        <textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="Anything worth recording with this unit…"
          rows={3}
          className={`mt-3 block w-full resize-none rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 ${accent.focusRing}`}
        />
      )}
    </section>
  );
}

interface PreviewCardModernProps {
  mode: BarcodeMode;
  uniqueSku: string;
  title: string;
  serialNumbers: string[];
  condition?: string | null;
  color?: string | null;
  location: string;
  accent: ModeAccent;
  /** DataMatrix payload — same value/symbology the printed label will encode. */
  dataMatrixValue: string;
  dataMatrixSymbology: 'gs1datamatrix' | 'datamatrix';
  /** Surfaces the Edit-label pencil + custom print on the preview card. */
  onApplyAndPrint?: (draft: ProductLabelDraft) => void;
}

/** Live label preview (print/reprint) or a review summary (sn-to-sku). */
export function PreviewCardModern({
  mode,
  uniqueSku,
  title,
  serialNumbers,
  condition,
  color,
  location,
  dataMatrixValue,
  dataMatrixSymbology,
  onApplyAndPrint,
}: PreviewCardModernProps) {
  const isPrintMode = mode === 'print' || mode === 'reprint';

  if (isPrintMode) {
    return (
      <LabelPreviewCard
        sku={uniqueSku}
        title={title}
        condition={mode === 'print' ? condition : null}
        color={color}
        serialNumber={mode === 'print' ? serialNumbers[0] : null}
        dataMatrixValue={dataMatrixValue}
        dataMatrixSymbology={dataMatrixSymbology}
        onApplyAndPrint={onApplyAndPrint}
      />
    );
  }

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200/60">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">Review</h3>
      </div>
      <div className="space-y-2 rounded-xl bg-gray-50 p-5 ring-1 ring-gray-200/50">
        <div>
          <p className="text-micro font-semibold uppercase tracking-[0.14em] text-gray-500">SKU</p>
          <p className="font-mono text-base font-bold text-gray-900">{uniqueSku}</p>
        </div>
        <div>
          <p className="text-micro font-semibold uppercase tracking-[0.14em] text-gray-500">
            Serials ({serialNumbers.length})
          </p>
          <p className="break-all font-mono text-xs text-gray-700">{serialNumbers.join(', ') || '—'}</p>
        </div>
        {location && (
          <div>
            <p className="text-micro font-semibold uppercase tracking-[0.14em] text-gray-500">Location</p>
            <p className="font-mono text-xs text-gray-700">{location}</p>
          </div>
        )}
      </div>
    </section>
  );
}

interface PreviewPlaceholderProps {
  mode: BarcodeMode;
  sku: string;
}

/** Empty-state shown before a SKU/serial is entered. */
export function PreviewPlaceholder({ mode, sku }: PreviewPlaceholderProps) {
  return (
    <section className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-white/50 p-10 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100">
        <Printer className="h-5 w-5 text-gray-400" />
      </div>
      <p className="text-sm font-semibold text-gray-700">
        {mode === 'sn-to-sku' ? 'Review will appear once a serial is added' : 'Label preview will appear here'}
      </p>
      <p className="mt-1 max-w-[280px] text-xs text-gray-500">
        {sku
          ? mode === 'sn-to-sku'
            ? 'Scan at least one serial number to enable the log action.'
            : 'Generating the next unique SKU for this product…'
          : 'Scan a SKU above to begin.'}
      </p>
    </section>
  );
}
