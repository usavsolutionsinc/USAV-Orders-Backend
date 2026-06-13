'use client';

import { useRef } from 'react';
import { Camera, Loader2, Check, AlertTriangle, RotateCcw } from '@/components/Icons';
import { useLabelIdentify } from './useLabelIdentify';
import type { LabelCandidate } from '@/lib/vision-identify';

interface LabelIdentifyButtonProps {
  /**
   * Called when the operator confirms a candidate. Wire this to
   * POST /api/receiving/add-unmatched-line (unfound carton) or a line PATCH.
   * Receives the resolved candidate — has sku_catalog_id / sku / item_name.
   */
  onConfirm: (candidate: LabelCandidate) => void | Promise<void>;
  /** Optional label for the trigger button. */
  label?: string;
  className?: string;
  /** Hide entirely when no vision box is configured (default true). */
  hideWhenUnavailable?: boolean;
}

/**
 * "Identify by photo" — the reliable way to add an item by photographing its
 * printed label. Snap the bottom label → the LAN vision box OCRs the Bose model →
 * the server resolves it to a catalog product → operator confirms → caller pairs it.
 *
 * Uses a plain file input with `capture="environment"` (rear camera) so it works
 * on the receiving desktop and on phones without the heavy full-screen capture
 * surface. One photo, one identify — built for "flip it over and shoot the label".
 */
export function LabelIdentifyButton({
  onConfirm,
  label = 'Identify by photo',
  className = '',
  hideWhenUnavailable = true,
}: LabelIdentifyButtonProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { status, candidates, rawText, error, available, identify, reset } = useLabelIdentify();

  if (hideWhenUnavailable && !available) return null;

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (file) await identify(file);
  };

  return (
    <div className={className}>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onFile}
      />

      {(status === 'idle' || status === 'error') && (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <Camera className="h-4 w-4" />
          {label}
        </button>
      )}

      {status === 'identifying' && (
        <div className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          Reading label…
        </div>
      )}

      {status === 'error' && error && (
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {status === 'results' && (
        <div className="mt-2 space-y-2 rounded-lg border border-gray-200 bg-white p-2">
          <div className="px-1 text-xs font-medium uppercase tracking-wide text-gray-500">
            Confirm the product
          </div>
          {candidates.map((c, i) => (
            <CandidateRow key={`${c.model}-${i}`} candidate={c} onConfirm={onConfirm} />
          ))}
          {rawText && (
            <div className="px-1 pt-1 text-[11px] text-gray-400" title="Raw OCR text">
              read: “{rawText.slice(0, 80)}”
            </div>
          )}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-1 pt-1 text-xs text-gray-500 hover:text-gray-700"
          >
            <RotateCcw className="h-3 w-3" /> Retake
          </button>
        </div>
      )}
    </div>
  );
}

function CandidateRow({
  candidate,
  onConfirm,
}: {
  candidate: LabelCandidate;
  onConfirm: (c: LabelCandidate) => void | Promise<void>;
}) {
  const title = candidate.product_title || candidate.item_name || candidate.model;
  return (
    <div className="flex items-center gap-3 rounded-md border border-gray-100 bg-gray-50 p-2">
      {candidate.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={candidate.image_url} alt="" className="h-10 w-10 rounded object-cover" />
      ) : (
        <div className="flex h-10 w-10 items-center justify-center rounded bg-gray-200 text-gray-400">
          <Camera className="h-4 w-4" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-gray-800">{title}</div>
        <div className="truncate text-xs text-gray-500">
          {candidate.sku ? `SKU ${candidate.sku}` : 'no SKU'}
          {candidate.resolved ? '' : ' · not in catalog yet'}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onConfirm(candidate)}
        className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
      >
        <Check className="h-3.5 w-3.5" />
        Add
      </button>
    </div>
  );
}
