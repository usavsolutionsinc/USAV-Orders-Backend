'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/utils/_cn';
import { Button } from '@/design-system/primitives';
import { Check, Loader2, RefreshCw, AlertTriangle } from '@/components/Icons';
import { SkuScanRefChip, SerialChip } from '@/components/ui/CopyChip';
import { SUBSTITUTION_REASONS, type SubstitutionReason } from '@/lib/fulfillment/substitution-reasons';
import { SubstituteReasonPicker } from './SubstituteReasonPicker';

/**
 * Scan-anchored substitution action for the testing / packing card. The operator
 * scans the substitute serial, picks a reason, optionally notes "customer asked
 * for white", and submits — recording the ordered-vs-fulfilled deviation.
 *
 * Presentational + controlled: the parent owns the network (the useSubstituteUnit
 * mutation) and passes `busy` / `error` + an `onSubmit` callback. That keeps this
 * reusable across both stations and renderable in the showroom with a mock
 * handler. Composes the house Button, CopyChip family, and SubstituteReasonPicker
 * — nothing hand-rolled.
 */

export interface SubstitutePayload {
  substituteSerial: string;
  reasonCode: string;
  note: string;
}

export interface SubstitutePanelProps {
  orderLabel: string;
  /** What was ordered / originally allocated. */
  original: { sku: string | null; condition?: string | null; serial?: string | null };
  busy?: boolean;
  error?: string | null;
  /** Drives the approval hint; default advisory. */
  enforcement?: 'advisory' | 'block_until_approved';
  /** Change this (e.g. on a successful submit) to clear the fields. */
  resetKey?: string | number;
  /** Reason vocabulary — tenant rows via useSubstitutionReasons(); defaults to the built-ins. */
  reasons?: readonly SubstitutionReason[];
  onSubmit: (payload: SubstitutePayload) => void;
  className?: string;
}

const FIELD_LABEL = 'text-micro font-black uppercase tracking-widest text-gray-500';

export function SubstitutePanel({
  orderLabel,
  original,
  busy = false,
  error = null,
  enforcement = 'advisory',
  resetKey,
  reasons = SUBSTITUTION_REASONS,
  onSubmit,
  className,
}: SubstitutePanelProps) {
  const [substituteSerial, setSubstituteSerial] = useState('');
  const [reasonCode, setReasonCode] = useState<string | null>(null);
  const [note, setNote] = useState('');

  // Clear the fields when the host bumps resetKey (e.g. after a successful save).
  useEffect(() => {
    setSubstituteSerial('');
    setReasonCode(null);
    setNote('');
  }, [resetKey]);

  const selectedReason = reasons.find((r) => r.code === reasonCode);
  const canSubmit = substituteSerial.trim().length > 0 && !!reasonCode && !busy;

  function submit() {
    if (!canSubmit || !reasonCode) return;
    onSubmit({ substituteSerial: substituteSerial.trim().toUpperCase(), reasonCode, note: note.trim() });
  }

  return (
    <section
      data-testid="substitute-panel"
      className={cn('flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4', className)}
    >
      {/* Eyebrow header */}
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-eyebrow font-black uppercase tracking-widest text-gray-500">
          <RefreshCw className="h-3.5 w-3.5" /> Substitute unit
        </span>
        <span className="truncate text-eyebrow font-semibold uppercase tracking-widest text-gray-400">{orderLabel}</span>
      </div>

      {/* Ordered → Substitute */}
      <div className="space-y-1">
        <p className={FIELD_LABEL}>Ordered</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {original.sku ? (
            <SkuScanRefChip value={original.sku} display={original.sku} dense />
          ) : (
            <span className="text-caption text-gray-400">No SKU</span>
          )}
          {original.serial ? <SerialChip value={original.serial} /> : null}
          {original.condition ? (
            <span className="rounded bg-gray-50 px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest text-gray-600 ring-1 ring-inset ring-gray-200">
              {original.condition}
            </span>
          ) : null}
        </div>
      </div>

      <div className="space-y-1">
        <p className={FIELD_LABEL}>Substitute serial</p>
        <input
          data-testid="substitute-serial-input"
          value={substituteSerial}
          onChange={(e) => setSubstituteSerial(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          placeholder="Scan or enter serial"
          autoCapitalize="characters"
          spellCheck={false}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-sm uppercase tracking-wider placeholder:text-gray-300 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
        />
      </div>

      {/* Reason */}
      <div className="space-y-1.5">
        <p className={FIELD_LABEL}>Reason</p>
        <SubstituteReasonPicker value={reasonCode} onChange={setReasonCode} reasons={reasons} />
        {selectedReason?.hint ? (
          <p className="text-caption text-gray-400">{selectedReason.hint}</p>
        ) : null}
      </div>

      {/* Note */}
      <div className="space-y-1">
        <p className={FIELD_LABEL}>Note</p>
        <textarea
          data-testid="substitute-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="e.g. customer asked for white"
          className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm placeholder:text-gray-300 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
        />
      </div>

      {enforcement === 'block_until_approved' ? (
        <p className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-caption font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
          <AlertTriangle className="h-3.5 w-3.5" /> Needs supervisor approval before this order can ship.
        </p>
      ) : null}

      {error ? (
        <div
          data-testid="substitute-error"
          className="flex items-center gap-2 rounded-xl border border-dashed border-rose-200 bg-rose-50 px-3 py-2 text-caption text-rose-700"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      ) : null}

      <div className="flex justify-end border-t border-gray-100 pt-3">
        <Button
          data-testid="substitute-submit"
          variant="primary"
          disabled={!canSubmit}
          onClick={submit}
          icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        >
          {busy ? 'Substituting…' : 'Substitute unit'}
        </Button>
      </div>
    </section>
  );
}
