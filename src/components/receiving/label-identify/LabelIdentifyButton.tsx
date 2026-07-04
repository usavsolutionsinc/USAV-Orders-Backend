'use client';

import { useRef } from 'react';
import { Camera, Loader2, Check, AlertTriangle, RotateCcw } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Button } from '@/design-system/primitives';
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
        <Button
          variant="secondary"
          size="md"
          icon={<Camera />}
          onClick={() => fileRef.current?.click()}
        >
          {label}
        </Button>
      )}

      {status === 'identifying' && (
        <div className="inline-flex items-center gap-2 rounded-lg border border-border-soft bg-surface-canvas px-3 py-2 text-sm text-text-muted">
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
        <div className="mt-2 space-y-2 rounded-lg border border-border-soft bg-surface-card p-2">
          <div className="px-1 text-xs font-medium uppercase tracking-wide text-text-soft">
            Confirm the product
          </div>
          {candidates.map((c, i) => (
            <CandidateRow key={`${c.model}-${i}`} candidate={c} onConfirm={onConfirm} />
          ))}
          {rawText && (
            <HoverTooltip label="Raw OCR text" asChild>
              <div className="px-1 pt-1 text-caption text-text-faint">
                read: “{rawText.slice(0, 80)}”
              </div>
            </HoverTooltip>
          )}
          <Button
            variant="ghost"
            size="sm"
            icon={<RotateCcw />}
            onClick={() => fileRef.current?.click()}
            className="px-1"
          >
            Retake
          </Button>
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
    <div className="flex items-center gap-3 rounded-md border border-border-hairline bg-surface-canvas p-2">
      {candidate.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={candidate.image_url} alt="" className="h-10 w-10 rounded object-cover" />
      ) : (
        <div className="flex h-10 w-10 items-center justify-center rounded bg-surface-strong text-text-faint">
          <Camera className="h-4 w-4" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-text-default">{title}</div>
        <div className="truncate text-xs text-text-soft">
          {candidate.sku ? `SKU ${candidate.sku}` : 'no SKU'}
          {candidate.resolved ? '' : ' · not in catalog yet'}
        </div>
      </div>
      <Button
        size="sm"
        icon={<Check />}
        onClick={() => onConfirm(candidate)}
        className="bg-emerald-600 text-white shadow-emerald-600/25 hover:bg-emerald-500 active:bg-emerald-700"
      >
        Add
      </Button>
    </div>
  );
}
